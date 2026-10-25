import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import type { DB } from "../db/db.js";
import { nowIso } from "../db/db.js";
import type { Config } from "../config.js";
import { WarroomService } from "../tools/service.js";
import { createWarroomServer, SERVER_NAME } from "../tools/warroom.js";
import { buildSubagents, CAPABILITIES } from "./subagents.js";
import { buildHooks } from "./hooks.js";
import { LEAD_PROMPT } from "./prompts.js";
import { Trace } from "./trace.js";
import { runOffline } from "./offline.js";
import { writeReport } from "../report.js";

export interface RunOptions { runId?: string; resumeUrl?: string; offline?: boolean; echo?: boolean; platform?: string }
export interface RunOutcome {
  runId: string; status: "done" | "failed"; mode: "agent" | "offline";
  verdict: { suspectVersion: string; platform: string | null; confidence: number; base: number } | null;
  pendingReplies: number; bugsOpened: number; costUsd: number | null; turns: number | null; subtype: string; reportPath: string; error?: string;
}

export function newRunId() {
  return `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}-${randomUUID().slice(0, 6)}`;
}

export async function runInvestigation(db: DB, cfg: Config, opts: RunOptions = {}): Promise<RunOutcome> {
  const runId = opts.runId ?? newRunId();
  const started = Date.now();
  db.prepare("INSERT OR IGNORE INTO runs (id, status, started_at, resume_url) VALUES (?, 'running', ?, ?)").run(runId, nowIso(), opts.resumeUrl ?? null);
  const svc = new WarroomService(db, cfg, runId);
  const trace = new Trace(cfg.runsDir, runId, opts.echo ?? false);
  const offline = opts.offline || !process.env.ANTHROPIC_API_KEY;
  const mode = offline ? "offline" : "agent";
  trace.log({ event: "run_start", runId, mode, leadModel: cfg.leadModel, subagentModel: cfg.subagentModel });

  let costUsd: number | null = null, turns: number | null = null, subtype = "success", error: string | undefined;
  try {
    if (offline) {
      await runOffline(svc, trace.log);
    } else {
      const prompt = `New ratings investigation (run ${runId})${opts.platform ? ` focused on ${opts.platform}` : ""}. Investigate, decide, hand off, brief the team.`;
      const q = query({
        prompt,
        options: {
          model: cfg.leadModel,
          systemPrompt: LEAD_PROMPT({ maxBugs: cfg.maxBugsPerRun, band: cfg.verdictBand }),
          mcpServers: { [SERVER_NAME]: createWarroomServer(svc) },
          agents: buildSubagents(cfg),
          tools: ["Agent"],
          allowedTools: [...new Set(Object.values(CAPABILITIES).flat())],
          disallowedTools: ["Bash", "Write", "Edit", "WebFetch", "WebSearch"],
          permissionMode: "dontAsk",
          maxTurns: cfg.maxTurns,
          maxBudgetUsd: cfg.maxBudgetUsd,
          settingSources: [],
          persistSession: false,
          hooks: buildHooks(svc, trace),
        },
      });
      for await (const m of q) {
        if (m.type === "assistant") {
          for (const block of (m.message.content as any[]) ?? []) {
            if (block.type === "text" && block.text?.trim()) {
              trace.log({ event: "assistant_text", agent: m.parent_tool_use_id ? "subagent" : "lead", parent_tool_use_id: m.parent_tool_use_id, text: block.text });
            }
            if (block.type === "tool_use") {
              trace.log({ event: "tool_use", tool: block.name, tool_use_id: block.id, parent_tool_use_id: m.parent_tool_use_id });
            }
          }
        } else if (m.type === "result") {
          costUsd = m.total_cost_usd; turns = m.num_turns; subtype = m.subtype;
          trace.log({ event: "result", subtype: m.subtype, num_turns: m.num_turns, total_cost_usd: m.total_cost_usd, duration_ms: m.duration_ms });
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    subtype = "error";
    trace.log({ event: "run_error", error });
  }

  await svc.finalize();
  const reportPath = writeReport(db, svc, cfg.runsDir, { mode, costUsd, turns, subtype, durationMs: Date.now() - started });
  const v = db.prepare("SELECT * FROM verdicts WHERE run_id = ?").get(runId) as any;
  const status = error && !v ? "failed" : "done";
  db.prepare("UPDATE runs SET status = ?, finished_at = ?, cost_usd = ?, turns = ?, error = ? WHERE id = ?").run(status, nowIso(), costUsd, turns, error ?? null, runId);

  const outcome: RunOutcome = {
    runId, status, mode,
    verdict: v ? { suspectVersion: v.suspect_version, platform: v.platform, confidence: v.confidence, base: v.base_confidence } : null,
    pendingReplies: svc.pendingReplies(), bugsOpened: svc.bugsOpened, costUsd, turns, subtype, reportPath, error,
  };
  trace.log({ event: "run_end", ...outcome });

  if (opts.resumeUrl) {
    try {
      await fetch(rewriteResumeUrl(opts.resumeUrl, cfg.n8nInternalUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(outcome) });
    } catch (e) {
      trace.log({ event: "resume_callback_failed", error: String(e) });
    }
  }
  return outcome;
}

/** n8n builds resumeUrl from WEBHOOK_URL (what the browser sees); inside Docker the API must use the service host. */
export function rewriteResumeUrl(url: string, internal: string) {
  if (!internal) return url;
  const u = new URL(url), i = new URL(internal);
  u.protocol = i.protocol; u.host = i.host;
  return u.toString();
}
