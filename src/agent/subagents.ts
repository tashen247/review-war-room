import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "../config.js";
import { T } from "../tools/warroom.js";
import { CLUSTERER_PROMPT, REPLY_WRITER_PROMPT } from "./prompts.js";

/**
 * Capability map — the primary prompt-injection defence.
 * Agents that read raw review text (clusterer, reply-writer) cannot reach Slack, Asana or the verdict.
 * The lead can reach those, but has no tool that returns raw review text.
 * Enforced twice: by each AgentDefinition's `tools`, and by the PreToolUse hook in hooks.ts.
 */
export const CAPABILITIES: Record<string, readonly string[]> = {
  lead: [
    T("submit_plan"), T("list_batches"), T("list_clusters"), T("merge_clusters"), T("get_releases"),
    T("correlate_releases"), T("record_verdict"), T("open_bug"), T("post_war_room"), "Agent",
  ],
  clusterer: [T("list_clusters"), T("get_review_batch"), T("save_clusters")],
  "reply-writer": [T("get_reviews_for_cluster"), T("queue_reply")],
};

/** Tools that return raw review text. */
export const READS_REVIEW_TEXT = [T("get_review_batch"), T("get_reviews_for_cluster")];
/** Tools that send data outside the system or decide the outcome. */
export const OUTBOUND_OR_DECISION = [T("post_war_room"), T("open_bug"), T("record_verdict")];

export function buildSubagents(cfg: Config): Record<string, AgentDefinition> {
  return {
    clusterer: {
      description: "Clusters a list of up to 4 review batch IDs into the canonical theme taxonomy. Give it batch IDs only.",
      prompt: CLUSTERER_PROMPT,
      tools: [...CAPABILITIES.clusterer],
      model: cfg.subagentModel,
      maxTurns: cfg.clustererMaxTurns,
      omitClaudeMd: true,
    },
    "reply-writer": {
      description: "Drafts policy-checked replies for the worst reviews in the given cluster IDs and queues them for human approval.",
      prompt: REPLY_WRITER_PROMPT(cfg.supportDomain),
      tools: [...CAPABILITIES["reply-writer"]],
      model: cfg.subagentModel,
      maxTurns: cfg.replyWriterMaxTurns,
      omitClaudeMd: true,
    },
  };
}
