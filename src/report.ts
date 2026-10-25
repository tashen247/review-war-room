import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db/db.js";
import type { WarroomService } from "./tools/service.js";

export function writeReport(db: DB, svc: WarroomService, runsDir: string, meta: { mode: string; costUsd: number | null; turns: number | null; subtype: string; durationMs: number }) {
  const runId = svc.runId;
  const v = db.prepare("SELECT * FROM verdicts WHERE run_id = ?").get(runId) as any;
  const corr = svc.lastCorrelation;
  const clusters = svc.listClusters().clusters.filter((c) => c.kind !== "praise").sort((a, b) => b.size - a.size).slice(0, 8);
  const bugs = db.prepare("SELECT * FROM bugs WHERE run_id = ?").all(runId) as any[];
  const deduped = db.prepare("SELECT b.* FROM bugs b WHERE b.run_id <> ? AND b.cluster_id IN (SELECT id FROM clusters)").all(runId) as any[];
  const replies = db.prepare("SELECT status, COUNT(*) n FROM replies WHERE run_id = ? GROUP BY status").all(runId) as any[];
  const slack = db.prepare("SELECT * FROM war_room_posts WHERE run_id = ?").get(runId) as any;

  const lines: string[] = [];
  lines.push(`# War-room report · run \`${runId}\``, "");
  lines.push(`Mode: **${meta.mode}** · outcome: ${meta.subtype} · turns: ${meta.turns ?? "n/a"} · cost: ${meta.costUsd !== null ? "$" + meta.costUsd.toFixed(4) : "n/a"} · ${(meta.durationMs / 1000).toFixed(1)}s`, "");
  lines.push("## Verdict", "");
  if (v) {
    const ev: string[] = JSON.parse(v.evidence);
    lines.push("```", v.suspect_version === "none" ? "NO RELEASE-LINKED INCIDENT" : `SUSPECT: v${v.suspect_version} (${v.platform})`,
      `confidence ${v.confidence}  (deterministic base ${v.base_confidence}${v.adjustment_reason ? `; adjusted: ${v.adjustment_reason}` : ""})`, "```", "");
    for (const e of ev) lines.push(`- ${e}`);
    lines.push("");
  } else lines.push("_No verdict recorded._", "");

  if (corr) {
    lines.push("## Correlation (deterministic)", "", "| Release | Platform | Date | Avg on version | Avg others | Δ | Top cluster lift | Changepoint | Base |", "|---|---|---|---|---|---|---|---|---|");
    for (const r of corr.releases) {
      lines.push(`| ${r.version} | ${r.attributedPlatform} | ${r.date} | ${r.avgOnVersion ?? "–"} | ${r.avgOtherSamePeriod ?? "–"} | ${r.ratingDelta} | ${r.topLift ? `${r.topLift.label} ${r.topLift.lift}` : "–"} | ${r.changepoint?.significant ? `${r.changepoint.date} (z ${r.changepoint.z})` : "–"} | **${r.base}** |`);
    }
    lines.push("");
  }
  lines.push("## Clusters", "", "| Label | Kind | Size | Since last run | Platform |", "|---|---|---|---|---|");
  for (const c of clusters) lines.push(`| ${c.label} | ${c.kind} | ${c.size} | ${c.sinceLastRun === null ? "first run" : (c.sinceLastRun >= 0 ? "+" : "") + c.sinceLastRun} | ${c.platform} |`);
  lines.push("", "## Engineering", "");
  if (bugs.length) for (const b of bugs) lines.push(`- Opened: [${b.title}](${b.url})`);
  if (deduped.length) for (const b of deduped) lines.push(`- Existing (not duplicated): [${b.title}](${b.url}) from run ${b.run_id}`);
  if (!bugs.length && !deduped.length) lines.push("- No bugs opened.");
  lines.push("", "## Support", "", `Replies: ${replies.map((r) => `${r.n} ${r.status}`).join(", ") || "none"} (never auto-published; see reply-queue.csv)`, "");
  if (slack) {
    const p = JSON.parse(slack.payload);
    lines.push("## War-room post", "", `> ${p.headline}`, ">", `> ${p.body}`, "");
  }
  const path = join(runsDir, runId, "report.md");
  writeFileSync(path, lines.join("\n"));
  return path;
}
