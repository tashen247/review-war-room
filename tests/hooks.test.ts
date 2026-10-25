import { describe, expect, it } from "vitest";
import { gate, buildHooks } from "../src/agent/hooks.js";
import { T } from "../src/tools/warroom.js";
import { Trace } from "../src/agent/trace.js";
import { readFileSync } from "node:fs";
import { setup, newSvc } from "./helpers.js";

describe("PreToolUse gate", () => {
  it("enforces plan-first", () => {
    expect(gate({ planAccepted: false }, "lead", T("list_batches"), {}).allow).toBe(false);
    expect(gate({ planAccepted: false }, "lead", T("submit_plan"), {}).allow).toBe(true);
    expect(gate({ planAccepted: true }, "lead", T("list_batches"), {}).allow).toBe(true);
  });
  it("enforces the capability map per agent", () => {
    const s = { planAccepted: true };
    expect(gate(s, "lead", T("get_review_batch"), {}).allow).toBe(false);
    expect(gate(s, "clusterer", T("post_war_room"), {}).allow).toBe(false);
    expect(gate(s, "reply-writer", T("open_bug"), {}).allow).toBe(false);
    expect(gate(s, "clusterer", T("save_clusters"), {}).allow).toBe(true);
    expect(gate(s, "unknown", T("save_clusters"), {}).allow).toBe(false);
  });
  it("only lets the lead launch the two defined subagents", () => {
    const s = { planAccepted: true };
    expect(gate(s, "lead", "Agent", { subagent_type: "clusterer" }).allow).toBe(true);
    expect(gate(s, "lead", "Agent", { subagent_type: "general-purpose" }).allow).toBe(false);
    expect(gate(s, "clusterer", "Agent", { subagent_type: "clusterer" }).allow).toBe(false);
  });
  it("hook denies with a reason and traces agent attribution", async () => {
    const { db, cfg } = await setup();
    const svc = newSvc(db, cfg);
    const trace = new Trace(cfg.runsDir, "run-1");
    const hooks = buildHooks(svc, trace);
    const pre = hooks.PreToolUse![0].hooks[0];
    const base = { session_id: "s", transcript_path: "", cwd: "", tool_use_id: "tu1", hook_event_name: "PreToolUse" as const };
    const denied: any = await pre({ ...base, tool_name: T("open_bug"), tool_input: {}, agent_id: "ag1", agent_type: "clusterer" }, "tu1", { signal: new AbortController().signal });
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
    svc.planAccepted = true;
    const ok: any = await pre({ ...base, tool_name: T("save_clusters"), tool_input: { clusters: [] }, agent_id: "ag1", agent_type: "clusterer" }, "tu1", { signal: new AbortController().signal });
    expect(ok.hookSpecificOutput.permissionDecision).toBe("allow");
    const lines = readFileSync(trace.path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.event, l.agent, l.agent_id])).toEqual([["tool_denied", "clusterer", "ag1"], ["tool_call", "clusterer", "ag1"]]);
  });
});
