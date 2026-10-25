/**
 * OFFLINE PIPELINE — not the agent.
 * A deterministic stand-in that drives the same WarroomService calls the agent makes, using keyword
 * rules instead of an LLM. It exists so CI, the eval harness and first-time users without an API key
 * can exercise the whole pipeline (DB, correlation, policy, dedupe, adapters, report). Every number
 * in the verdict still comes from src/correlate.
 */
import type { WarroomService, ClusterInput } from "../tools/service.js";

const RULES: { label: string; kind: ClusterInput["kind"]; severity: number; summary: string; re: RegExp }[] = [
  { label: "Login loop", kind: "bug", severity: 5, summary: "Users are sent back to the login screen after signing in.", re: /log ?in|sign ?in|logging me out|kicks me|authenticat/i },
  { label: "Crash on launch", kind: "bug", severity: 5, summary: "App crashes immediately on startup.", re: /crash|closes straight|won't open|flash then home/i },
  { label: "Premium paywall backlash", kind: "ux", severity: 3, summary: "Users object to features moving behind the Premium plan.", re: /premium|paywall|pay for|expensive|subscription|rip off/i },
  { label: "Slow loading", kind: "ux", severity: 2, summary: "Slow loading and syncing.", re: /slow|forever|sluggish|spinner for ages|loading/i },
  { label: "Battery drain", kind: "bug", severity: 2, summary: "High battery use in the background.", re: /battery|warm/i },
  { label: "Late or duplicate notifications", kind: "bug", severity: 2, summary: "Notifications arrive late, twice or not at all.", re: /notification|reminder/i },
  { label: "Export and sharing requests", kind: "feature", severity: 1, summary: "Requests for CSV/Excel/PDF export, shared budgets, custom categories.", re: /export|csv|excel|pdf|shared budget|custom categor/i },
  { label: "General praise", kind: "praise", severity: 1, summary: "Positive feedback.", re: /love|great|best|smooth|lovely|reliable|no complaints|helpful|five stars|fast/i },
];

export function classify(text: string, flagged: boolean) {
  if (flagged) return { label: "Spam / manipulation", kind: "other" as const, severity: 1, summary: "Reviews attempting to manipulate automated systems." };
  return RULES.find((r) => r.re.test(text)) ?? { label: "Other feedback", kind: "other" as const, severity: 1, summary: "Uncategorised feedback." };
}

const REPLY_TEMPLATES: Record<string, string> = {
  bug: "Thanks for flagging this, and sorry for the trouble. Our engineers are investigating this issue in the latest version and a fix is on the way. If it keeps happening, our team can help at https://SUPPORT/contact.",
  ux: "Thanks for the honest feedback. We've shared it with our product team, who review these comments every week. If you'd like to tell us more, please reach us at https://SUPPORT/contact.",
};

export async function runOffline(svc: WarroomService, log: (e: { event: string; [k: string]: unknown }) => void = () => {}) {
  const call = async <T,>(tool: string, agent: string, fn: () => T | Promise<T>) => {
    log({ event: "tool_call", tool, agent });
    const out = await fn();
    log({ event: "tool_result", tool, agent });
    return out;
  };

  await call("submit_plan", "lead", () => svc.submitPlan(["list batches", "cluster", "correlate", "verdict", "bugs", "replies", "war room"], "offline pipeline"));
  const { unclusteredBatches } = await call("list_batches", "lead", () => svc.listBatches());
  for (const b of unclusteredBatches as { batchId: string }[]) {
    const batch = await call("get_review_batch", "clusterer", () => svc.getReviewBatch(b.batchId));
    const groups = new Map<string, ClusterInput>();
    for (const r of batch.reviews) {
      const c = classify(r.text, Boolean((r as any).flagged));
      const g = groups.get(c.label) ?? { ...c, reviewIds: [] };
      g.reviewIds.push(r.id);
      groups.set(c.label, g);
    }
    await call("save_clusters", "clusterer", () => svc.saveClusters([...groups.values()]));
  }
  const corr = await call("correlate_releases", "lead", () => svc.correlateReleases());
  const s = corr.suspect;
  const best = corr.releases[0];
  await call("record_verdict", "lead", () => svc.recordVerdict({
    suspectVersion: s.version, platform: s.platform, confidence: s.base,
    evidence: s.version === "none"
      ? ["No release shows a rating drop or cluster lift above threshold."]
      : [`v${best.version} ${best.platform}: avg ${best.avgOnVersion}★ vs ${best.avgOtherSamePeriod}★ on other versions in the same period`,
         `Top cluster '${best.topLift?.label}' lift ${best.topLift?.lift}`, `Changepoint ${best.changepoint?.date ?? "n/a"}`],
  }));

  const bugUrls: string[] = [];
  const clusters = svc.listClusters().clusters;
  if (s.version !== "none" && best.topLift && best.topLift.kind === "bug") {
    const bug = await call("open_bug", "lead", () => svc.openBug({
      clusterId: best.topLift!.clusterId, title: `[${s.platform}] ${best.topLift!.label} in v${s.version}`,
      reproHints: `Install v${s.version} on ${s.platform}; sign in; observe behaviour. Changelog: ${best.changelog ?? "n/a"}`,
      version: s.version, platform: s.platform ?? "both", severity: 5,
    }));
    if (bug.url) bugUrls.push(bug.url);
  }
  if (s.version !== "none" && best.topLift) {
    const rv = await call("get_reviews_for_cluster", "reply-writer", () => svc.getReviewsForCluster(best.topLift!.clusterId, 5));
    const tpl = (REPLY_TEMPLATES[best.topLift.kind] ?? REPLY_TEMPLATES.ux).replace("SUPPORT", svc.cfg.supportDomain);
    for (const r of rv.reviews) await call("queue_reply", "reply-writer", () => svc.queueReply(r.id, tpl));
  }
  const suspectCluster = s.version !== "none" ? best.topLift?.clusterId : undefined;
  const top = clusters.filter((c) => c.kind !== "praise")
    .sort((a, b) => Number(b.id === suspectCluster) - Number(a.id === suspectCluster) || b.size - a.size).slice(0, 4)
    .map((c) => `${c.label} (${c.kind}, ${c.size}${c.sinceLastRun !== null ? `, +${c.sinceLastRun} since last run` : ""})`);
  const verdictText = s.version === "none" ? "No release-linked ratings incident in this window." : `v${s.version} (${s.platform}) is the likely cause of the ratings drop.`;
  await call("post_war_room", "lead", () => svc.postWarRoom({ verdict: verdictText, topClusters: top, bugUrls }));
  return { offline: true };
}
