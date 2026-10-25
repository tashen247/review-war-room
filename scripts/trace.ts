/**
 *   npm run trace                 pretty-print the latest run's trace
 *   npm run trace -- <runId>      a specific run
 *
 * Shows which agent (lead / clusterer / reply-writer) made each tool call, using agent_id from hook input.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatEvent } from "../src/agent/trace.js";

const runsDir = process.env.RUNS_DIR || "./runs";
let runId = process.argv[2];
if (!runId) {
  const dirs = readdirSync(runsDir).filter((d) => existsSync(join(runsDir, d, "trace.jsonl")));
  dirs.sort((a, b) => statSync(join(runsDir, b)).mtimeMs - statSync(join(runsDir, a)).mtimeMs);
  runId = dirs[0];
}
if (!runId) { console.error("No runs found."); process.exit(1); }
const events = readFileSync(join(runsDir, runId, "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
console.log(`trace for run ${runId} (${events.length} events)\n`);
const counts: Record<string, number> = {};
for (const e of events) {
  if (e.event === "tool_call") counts[e.agent ?? "lead"] = (counts[e.agent ?? "lead"] ?? 0) + 1;
  const s = formatEvent(e);
  if (s) console.log(s);
}
console.log("\ntool calls by agent:", counts);
