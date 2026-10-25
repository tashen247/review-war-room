import type { DB } from "../src/db/db.js";
import type { RunOutcome } from "../src/agent/runner.js";

export interface Expectation {
  scenario: string;
  suspect: { version: string; platform: string | string[] } | "none";
  /** acceptable alternative verdicts (e.g. pricing: "none" is also fine) */
  alsoAccept?: ("none")[];
  minConfidence?: number;
  topClusterMatch?: RegExp;        // top negative cluster label
  topClusterKindNot?: string;
  bugs: { min: number; max: number };
}

export const EXPECTATIONS: Expectation[] = [
  { scenario: "android-login-v420", suspect: { version: "4.2.0", platform: "android" }, minConfidence: 0.6, topClusterMatch: /log ?in|sign ?in|auth|logged out/i, bugs: { min: 1, max: 1 } },
  { scenario: "ios-crash-v391", suspect: { version: "3.9.1", platform: "ios" }, minConfidence: 0.6, topClusterMatch: /crash|launch|startup|won.?t open/i, bugs: { min: 1, max: 1 } },
  { scenario: "pricing-backlash", suspect: { version: "5.0.0", platform: ["both", "android", "ios"] }, alsoAccept: ["none"], topClusterMatch: /premium|pric|paywall|subscri|cost|expensive/i, topClusterKindNot: "bug", bugs: { min: 0, max: 0 } },
  { scenario: "quiet-week", suspect: "none", bugs: { min: 0, max: 0 } },
];

export function checkExpectation(db: DB, out: RunOutcome, exp: Expectation) {
  const failures: string[] = [];
  const v = out.verdict;
  if (!v) failures.push("no verdict recorded");
  else if (exp.suspect === "none") {
    if (v.suspectVersion !== "none") failures.push(`expected none, got ${v.suspectVersion}`);
  } else {
    const okNone = exp.alsoAccept?.includes("none") && v.suspectVersion === "none";
    const plats = Array.isArray(exp.suspect.platform) ? exp.suspect.platform : [exp.suspect.platform];
    if (!okNone && (v.suspectVersion !== exp.suspect.version || !plats.includes(v.platform ?? ""))) failures.push(`expected ${exp.suspect.version}/${plats.join("|")}, got ${v.suspectVersion}/${v.platform}`);
    if (!okNone && exp.minConfidence && v.confidence < exp.minConfidence) failures.push(`confidence ${v.confidence} < ${exp.minConfidence}`);
  }
  const bugs = (db.prepare("SELECT COUNT(*) c FROM bugs WHERE run_id = ?").get(out.runId) as { c: number }).c;
  if (bugs < exp.bugs.min || bugs > exp.bugs.max) failures.push(`bugs opened ${bugs}, expected ${exp.bugs.min}-${exp.bugs.max}`);

  if (exp.topClusterMatch) {
    // top negative cluster = highest lift on the suspect release, else largest non-praise cluster created after the release
    const top = db.prepare(`SELECT c.label, c.kind, COUNT(*) n FROM clusters c JOIN review_clusters rc ON rc.cluster_id = c.id
      JOIN reviews r ON r.id = rc.review_id WHERE c.merged_into IS NULL AND c.kind <> 'praise' AND r.rating <= 2
      GROUP BY c.id ORDER BY n DESC LIMIT 1`).get() as { label: string; kind: string } | undefined;
    if (!top || !exp.topClusterMatch.test(top.label)) failures.push(`top negative cluster '${top?.label}' does not match ${exp.topClusterMatch}`);
    if (top && exp.topClusterKindNot && top.kind === exp.topClusterKindNot) failures.push(`top cluster kind is ${top.kind}`);
  }
  const badReplies = (db.prepare("SELECT COUNT(*) c FROM replies WHERE run_id = ? AND status NOT IN ('pending','approved')").get(out.runId) as { c: number }).c;
  if (badReplies) failures.push(`${badReplies} replies in a non-queue state`);
  if (out.costUsd !== null && out.costUsd > 0.75) failures.push(`cost $${out.costUsd} over budget`);
  return { failures, bugs };
}
