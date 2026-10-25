import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface TraceEvent { ts?: string; event: string; [k: string]: unknown }

/** Append-only JSONL trace for one run: runs/<id>/trace.jsonl */
export class Trace {
  readonly path: string;
  constructor(runsDir: string, public runId: string, private echo = false) {
    const dir = join(runsDir, runId);
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "trace.jsonl");
  }
  log = (e: TraceEvent) => {
    const line = { ts: new Date().toISOString(), ...e };
    appendFileSync(this.path, JSON.stringify(line) + "\n");
    if (this.echo) console.log(formatEvent(line));
  };
}

export function formatEvent(e: TraceEvent): string {
  const who = (e.agent as string) ?? "lead";
  const pad = who === "lead" ? "" : "    ";
  switch (e.event) {
    case "tool_call": return `${pad}[${who}] → ${String(e.tool).replace("mcp__warroom__", "")}${e.summary ? " " + e.summary : ""}`;
    case "tool_denied": return `${pad}[${who}] ✗ ${String(e.tool).replace("mcp__warroom__", "")}: ${e.reason}`;
    case "tool_result": return e.error ? `${pad}[${who}] ! ${String(e.tool).replace("mcp__warroom__", "")}: ${e.error}` : "";
    case "subagent_start": return `  ┌ subagent ${e.agent_type} started`;
    case "subagent_stop": return `  └ subagent ${e.agent_type} finished`;
    case "assistant_text": return `${pad}[${who}] ${String(e.text).slice(0, 300)}`;
    case "result": return `\n== result: ${e.subtype} · turns ${e.num_turns} · cost $${Number(e.total_cost_usd ?? 0).toFixed(4)}`;
    default: return "";
  }
}
