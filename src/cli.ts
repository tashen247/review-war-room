/**
 *   npm run demo                      ingest the seeded fixture and run one investigation
 *   npm run demo -- --two-runs        ingest up to day 24, investigate, ingest the rest, investigate again
 *   npm run demo -- --offline         keyword stand-in instead of the LLM (no API key needed)
 *   npm run ingest -- --scenario ios-crash-v391 [--until 2026-10-10]
 *   npm run investigate [-- --offline]
 *   npm run approve -- <runId>
 */
import { readFileSync, rmSync } from "node:fs";
import { config } from "./config.js";
import { openDb } from "./db/db.js";
import { ingest, ratingsSummary } from "./ingest.js";
import { runInvestigation } from "./agent/runner.js";
import { approveReplies } from "./tools/service.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "demo";
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

function banner(t: string) { console.log(`\n${"═".repeat(70)}\n${t}\n${"═".repeat(70)}`); }

async function main() {
  const offline = flag("offline");
  if (!offline && !process.env.ANTHROPIC_API_KEY) console.log("ANTHROPIC_API_KEY not set: running the OFFLINE pipeline (keyword stand-in, no LLM).");

  if (cmd === "demo") {
    if (!flag("keep-db")) rmSync(config.dbPath, { force: true }), rmSync(config.dbPath + "-wal", { force: true }), rmSync(config.dbPath + "-shm", { force: true });
    const db = openDb(config.dbPath);
    const scenario = opt("scenario");
    if (flag("two-runs")) {
      banner("Run 1: reviews up to 2026-10-14");
      console.log(await ingest(db, config, { scenario, until: "2026-10-14" }).then((r) => ({ ...r, newBatches: r.newBatches.length })));
      console.log("ratings summary:", ratingsSummary(db));
      await show(await runInvestigation(db, config, { offline, echo: true }));
      banner("Run 2: the remaining days arrive");
    } else banner("Investigation on the seeded dataset");
    console.log(await ingest(db, config, { scenario }).then((r) => ({ ...r, newBatches: r.newBatches.length })));
    console.log("ratings summary:", ratingsSummary(db));
    await show(await runInvestigation(db, config, { offline, echo: true }));
    return;
  }
  const db = openDb(config.dbPath);
  if (cmd === "ingest") return console.log(await ingest(db, config, { scenario: opt("scenario"), until: opt("until") }));
  if (cmd === "summary") return console.log(ratingsSummary(db));
  if (cmd === "investigate") return show(await runInvestigation(db, config, { offline, echo: true }));
  if (cmd === "approve") return console.log(await approveReplies(db, config, args[1]));
  console.error(`Unknown command ${cmd}`);
  process.exit(1);
}

async function show(o: Awaited<ReturnType<typeof runInvestigation>>) {
  console.log(readFileSync(o.reportPath, "utf8"));
  console.log(`\nreport: ${o.reportPath}\ntrace:  ${o.reportPath.replace("report.md", "trace.jsonl")}  (npm run trace -- ${o.runId})`);
  if (o.error) console.error(`error: ${o.error}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
