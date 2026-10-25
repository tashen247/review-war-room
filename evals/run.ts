/**
 *   npm run eval                live agent (needs ANTHROPIC_API_KEY), all 4 scenarios + a second run on the main one
 *   npm run eval -- --offline   offline keyword pipeline (what CI checks)
 *   npm run eval -- --only android-login-v420
 *
 * Writes evals/results.md (or evals/results-offline.md).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.js";
import { openDb } from "../src/db/db.js";
import { ingest } from "../src/ingest.js";
import { runInvestigation } from "../src/agent/runner.js";
import { EXPECTATIONS, checkExpectation } from "./expectations.js";

const args = process.argv.slice(2);
const offline = args.includes("--offline") || !process.env.ANTHROPIC_API_KEY;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
if (!process.env.ANTHROPIC_API_KEY && !args.includes("--offline")) console.log("No ANTHROPIC_API_KEY: running offline.");

const rows: string[] = [];
let allPass = true;
for (const exp of EXPECTATIONS.filter((e) => !only || e.scenario === only)) {
  const cfg = { ...config, mockMode: true, runsDir: join(config.runsDir, "evals") };
  const db = openDb(join(mkdtempSync(join(tmpdir(), "rwr-eval-")), "eval.db"));
  await ingest(db, cfg, { scenario: exp.scenario, until: exp.scenario === "android-login-v420" ? "2026-10-14" : undefined });
  let out = await runInvestigation(db, cfg, { offline, echo: false });
  let extra = "";
  if (exp.scenario === "android-login-v420") {
    // second consecutive run with the remaining reviews: must not duplicate bugs
    const first = out;
    await ingest(db, cfg, { scenario: exp.scenario });
    out = await runInvestigation(db, cfg, { offline, echo: false });
    const totalBugs = (db.prepare("SELECT COUNT(*) c FROM bugs").get() as { c: number }).c;
    extra = ` · run1 ${first.verdict?.suspectVersion}@${first.verdict?.confidence} · bugs across 2 runs: ${totalBugs}`;
    if (totalBugs > 1) { allPass = false; extra += " ✗ duplicate"; }
    // the bug was opened in run 1, so judge run 2 on "no new bugs"
    exp.bugs = { min: 0, max: 0 };
  }
  const res = checkExpectation(db, out, exp);
  const pass = res.failures.length === 0 && out.status === "done";
  allPass &&= pass;
  const v = out.verdict;
  rows.push(`| ${exp.scenario} | ${pass ? "✅" : "❌"} | ${v ? `${v.suspectVersion} ${v.platform ?? ""}` : "–"} | ${v?.confidence ?? "–"} (base ${v?.base ?? "–"}) | ${res.bugs} | ${out.pendingReplies} | ${out.costUsd !== null ? "$" + out.costUsd.toFixed(3) : "n/a"} | ${out.turns ?? "n/a"} | ${res.failures.join("; ")}${extra} |`);
  console.log(rows.at(-1));
}
const md = [`# Eval results (${offline ? "offline pipeline" : `live agent: lead ${config.leadModel}, subagents ${config.subagentModel}`})`, "", `Generated ${new Date().toISOString()}`, "",
  "| Scenario | Pass | Verdict | Confidence | Bugs | Pending replies | Cost | Turns | Notes |", "|---|---|---|---|---|---|---|---|---|", ...rows, ""].join("\n");
writeFileSync(offline ? "evals/results-offline.md" : "evals/results.md", md);
console.log(`\n${allPass ? "ALL PASS" : "FAILURES"} → ${offline ? "evals/results-offline.md" : "evals/results.md"}`);
process.exit(allPass ? 0 : 1);
