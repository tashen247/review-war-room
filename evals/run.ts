/**
 *   npm run eval                      live agent (needs ANTHROPIC_API_KEY), 3 repeats per scenario
 *   npm run eval -- --repeats 1       one repeat per scenario (a smoke test, not a pass rate)
 *   npm run eval -- --offline         offline keyword pipeline (what CI checks)
 *   npm run eval -- --only android-login-v420
 *
 * Each repeat uses a fresh database. The login scenario runs twice per repeat
 * (days 1–24, then the rest) to check that no duplicate bug is opened.
 * Writes evals/results.md (or evals/results-offline.md).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.js";
import { openDb } from "../src/db/db.js";
import { ingest } from "../src/ingest.js";
import { runInvestigation, type RunOutcome } from "../src/agent/runner.js";
import { EXPECTATIONS, checkExpectation, type Expectation } from "./expectations.js";

const args = process.argv.slice(2);
const arg = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const offline = args.includes("--offline") || !process.env.ANTHROPIC_API_KEY;
const only = arg("only");
const repeats = Math.max(1, Number(arg("repeats") ?? 3) || 3);
if (!process.env.ANTHROPIC_API_KEY && !args.includes("--offline")) console.log("No ANTHROPIC_API_KEY: running offline.");

const TWO_RUN = "android-login-v420";

interface Attempt { pass: boolean; out: RunOutcome; cost: number; failures: string[]; bugs: number; note: string }

async function attempt(base: Expectation): Promise<Attempt> {
  const exp: Expectation = { ...base, bugs: { ...base.bugs } };
  const cfg = { ...config, mockMode: true, runsDir: join(config.runsDir, "evals") };
  const db = openDb(join(mkdtempSync(join(tmpdir(), "rwr-eval-")), "eval.db"));
  let cost = 0, note = "";
  await ingest(db, cfg, { scenario: exp.scenario, until: exp.scenario === TWO_RUN ? "2026-10-14" : undefined });
  let out = await runInvestigation(db, cfg, { offline, echo: false });
  cost += out.costUsd ?? 0;
  let dupFail = false;
  if (exp.scenario === TWO_RUN) {
    const first = out;
    await ingest(db, cfg, { scenario: exp.scenario });
    out = await runInvestigation(db, cfg, { offline, echo: false });
    cost += out.costUsd ?? 0;
    const totalBugs = (db.prepare("SELECT COUNT(*) c FROM bugs").get() as { c: number }).c;
    dupFail = totalBugs > 1;
    note = `run 1 ${first.verdict?.suspectVersion ?? "–"}@${first.verdict?.confidence ?? "–"}, bugs across both runs: ${totalBugs}`;
    exp.bugs = { min: 0, max: 0 }; // the bug was opened in run 1; run 2 must open none
  }
  const res = checkExpectation(db, out, exp);
  const failures = [...res.failures, ...(dupFail ? ["duplicate bug across runs"] : [])];
  return { pass: failures.length === 0 && out.status === "done", out, cost, failures, bugs: res.bugs, note };
}

const summary: string[] = [];
const detail: string[] = [];
let allPass = true, totalPass = 0, totalRuns = 0, totalCost = 0, investigations = 0;

for (const exp of EXPECTATIONS.filter((e) => !only || e.scenario === only)) {
  const attempts: Attempt[] = [];
  for (let i = 1; i <= repeats; i++) {
    const a = await attempt(exp);
    attempts.push(a);
    const v = a.out.verdict;
    const line = `| ${exp.scenario} | ${i} | ${a.pass ? "✅" : "❌"} | ${v ? `${v.suspectVersion} ${v.platform ?? ""}`.trim() : "–"} | ${v ? `${v.confidence} (base ${v.base})` : "–"} | ${a.bugs} | ${a.out.pendingReplies} | ${offline ? "n/a" : "$" + a.cost.toFixed(3)} | ${a.out.turns ?? "n/a"} | ${[...a.failures, a.note].filter(Boolean).join("; ")} |`;
    detail.push(line);
    console.log(line);
  }
  const passes = attempts.filter((a) => a.pass).length;
  const avgCost = attempts.reduce((s, a) => s + a.cost, 0) / attempts.length;
  allPass &&= passes === attempts.length;
  totalPass += passes; totalRuns += attempts.length; investigations += attempts.length * (exp.scenario === TWO_RUN ? 2 : 1); totalCost += attempts.reduce((s, a) => s + a.cost, 0);
  summary.push(`| ${exp.scenario} | ${passes}/${attempts.length} | ${offline ? "n/a" : "$" + avgCost.toFixed(3)} |`);
}

const scenarios = summary.length;
const scenariosAllPass = summary.filter((s) => { const m = s.match(/\| (\d+)\/(\d+) \|/); return m && m[1] === m[2]; }).length;
const headline = repeats === 1
  ? `${scenariosAllPass} of ${scenarios} scenarios passed. 1 repeat per scenario – a smoke test, not a pass rate.`
  : `${scenariosAllPass} of ${scenarios} scenarios passed on all ${repeats} repeats (${totalPass}/${totalRuns} runs)${offline ? "" : `, average $${(totalCost / investigations).toFixed(2)} per investigation`}.`;

const md = [
  `# Eval results (${offline ? "offline pipeline" : `live agent: lead ${config.leadModel}, subagents ${config.subagentModel}`})`, "",
  `Generated ${new Date().toISOString()} · ${repeats} repeat${repeats > 1 ? "s" : ""} per scenario, fresh database each repeat.`, "",
  `**${headline}**`, "",
  "| Scenario | Pass rate | Average cost per repeat |", "|---|---|---|", ...summary, "",
  "The login scenario's cost per repeat covers two investigations (days 1–24, then the rest), and its row shows the second run.", "",
  "## Every run", "",
  "| Scenario | Repeat | Pass | Verdict | Confidence | Bugs | Pending replies | Cost | Lead turns | Notes |", "|---|---|---|---|---|---|---|---|---|---|", ...detail, "",
].join("\n");
const outFile = offline ? "evals/results-offline.md" : "evals/results.md";
writeFileSync(outFile, md);
console.log(`\n${headline}\n→ ${outFile}`);
process.exit(allPass ? 0 : 1);
