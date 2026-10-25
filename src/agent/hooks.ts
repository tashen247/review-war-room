import type { HookCallbackMatcher, HookEvent, HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { WarroomService } from "../tools/service.js";
import { CAPABILITIES } from "./subagents.js";
import type { Trace } from "./trace.js";

const PLAN_TOOL = "mcp__warroom__submit_plan";

export interface GateDecision { allow: boolean; reason?: string }

/**
 * Pure policy used by the PreToolUse hook (and unit-tested directly):
 * 1. capability map per agent, 2. plan-first, 3. only known subagent types may be launched.
 */
export function gate(svc: Pick<WarroomService, "planAccepted">, agent: string, toolName: string, toolInput: unknown): GateDecision {
  const allowed = CAPABILITIES[agent];
  if (!allowed) return { allow: false, reason: `Unknown agent '${agent}'.` };
  if (!allowed.includes(toolName)) return { allow: false, reason: `Agent '${agent}' may not call ${toolName}.` };
  if (!svc.planAccepted && toolName !== PLAN_TOOL) return { allow: false, reason: "Call submit_plan first: a plan is required before any other tool." };
  if (toolName === "Agent") {
    const t = (toolInput as { subagent_type?: string })?.subagent_type;
    if (t !== "clusterer" && t !== "reply-writer") return { allow: false, reason: `Only 'clusterer' and 'reply-writer' subagents may be launched (got '${t}').` };
  }
  return { allow: true };
}

export const agentOf = (input: HookInput) => (input.agent_id ? input.agent_type ?? "unknown-subagent" : "lead");

function summarize(tool: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  if (tool === "Agent") return `${input.subagent_type}: ${String(input.prompt ?? "").slice(0, 80)}`;
  if (input.batchId) return input.batchId;
  if (input.clusters) return `${input.clusters.length} clusters`;
  if (input.suspectVersion) return `${input.suspectVersion} ${input.platform} @ ${input.confidence}`;
  if (input.clusterId !== undefined) return `cluster ${input.clusterId}`;
  if (input.reviewId) return input.reviewId;
  if (input.steps) return `${input.steps.length} steps`;
  return "";
}

export function buildHooks(svc: WarroomService, trace: Trace): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const pre = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const agent = agentOf(input);
    const d = gate(svc, agent, input.tool_name, input.tool_input);
    if (!d.allow) {
      trace.log({ event: "tool_denied", agent, agent_id: input.agent_id, tool: input.tool_name, tool_use_id: input.tool_use_id, reason: d.reason });
      return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.reason } };
    }
    trace.log({ event: "tool_call", agent, agent_id: input.agent_id, tool: input.tool_name, tool_use_id: input.tool_use_id, summary: summarize(input.tool_name, input.tool_input) });
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
  };

  const post = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name === "PostToolUse") {
      const resp = JSON.stringify(input.tool_response ?? "");
      const error = resp.includes("ERROR:") ? resp.slice(resp.indexOf("ERROR:"), resp.indexOf("ERROR:") + 160) : undefined;
      trace.log({ event: "tool_result", agent: agentOf(input), agent_id: input.agent_id, tool: input.tool_name, tool_use_id: input.tool_use_id, error });
    }
    return {};
  };

  const sub = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name === "SubagentStart") trace.log({ event: "subagent_start", agent_id: input.agent_id, agent_type: input.agent_type });
    if (input.hook_event_name === "SubagentStop") trace.log({ event: "subagent_stop", agent_id: input.agent_id, agent_type: input.agent_type });
    return {};
  };

  return {
    PreToolUse: [{ hooks: [pre] }],
    PostToolUse: [{ hooks: [post] }],
    SubagentStart: [{ hooks: [sub] }],
    SubagentStop: [{ hooks: [sub] }],
  };
}
