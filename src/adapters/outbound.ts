/**
 * Outbound adapters: Asana (bugs), Slack (war-room thread), Google Sheets (reply-queue mirror).
 * Each has a real implementation and a mock that writes JSON/CSV under runs/<id>/.
 * Every outbound payload passes through `guard` (prompt-injection / secret checks) first.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";

export type Guard = (payload: string) => void;

function runDir(cfg: Config, runId: string) {
  const d = join(cfg.runsDir, runId);
  mkdirSync(d, { recursive: true });
  return d;
}
function appendJson(path: string, item: unknown) {
  const arr = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  arr.push(item);
  writeFileSync(path, JSON.stringify(arr, null, 2));
  return arr.length;
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 400 * 2 ** i)); }
  }
  throw last;
}

// ---------------- Asana ----------------
export interface BugPayload { title: string; notes: string; severity: number; platform: string; version: string; fingerprint: string }
export interface BugResult { gid: string; url: string; mock: boolean }

export async function createAsanaBug(cfg: Config, runId: string, bug: BugPayload, guard: Guard): Promise<BugResult> {
  guard(`${bug.title}\n${bug.notes}`);
  if (cfg.mockMode || !cfg.asanaPat || !cfg.asanaProjectGid) {
    const n = appendJson(join(runDir(cfg, runId), "asana.json"), { ...bug, createdAt: new Date().toISOString() });
    const gid = `mock-${runId}-${n}`;
    return { gid, url: `https://app.asana.com/0/mock/${gid}`, mock: true };
  }
  const res = await retry(async () => {
    const r = await fetch("https://app.asana.com/api/1.0/tasks", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.asanaPat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { name: bug.title, notes: bug.notes, projects: [cfg.asanaProjectGid] } }),
    });
    if (!r.ok) throw new Error(`Asana ${r.status}: ${await r.text()}`);
    return (await r.json()) as { data: { gid: string; permalink_url: string } };
  });
  return { gid: res.data.gid, url: res.data.permalink_url, mock: false };
}

// ---------------- Slack ----------------
export interface WarRoomMessage { headline: string; body: string; threadReplies: string[] }

export async function postSlackWarRoom(cfg: Config, runId: string, msg: WarRoomMessage, guard: Guard): Promise<{ ts: string; mock: boolean }> {
  guard([msg.headline, msg.body, ...msg.threadReplies].join("\n"));
  if (cfg.mockMode || !cfg.slackBotToken || !cfg.slackChannel) {
    const ts = `mock-${Date.now()}`;
    writeFileSync(join(runDir(cfg, runId), "slack.json"), JSON.stringify({ ts, channel: "#war-room (mock)", ...msg }, null, 2));
    console.log(`\n[slack:mock] ${msg.headline}\n${msg.body}\n${msg.threadReplies.map((t) => "  ↳ " + t).join("\n")}\n`);
    return { ts, mock: true };
  }
  const { WebClient } = await import("@slack/web-api");
  const client = new WebClient(cfg.slackBotToken);
  const parent = await retry(() => client.chat.postMessage({ channel: cfg.slackChannel, text: `${msg.headline}\n${msg.body}` }));
  for (const t of msg.threadReplies) await retry(() => client.chat.postMessage({ channel: cfg.slackChannel, thread_ts: parent.ts!, text: t }));
  return { ts: parent.ts!, mock: false };
}

// ---------------- Sheets mirror ----------------
export interface ReplyRow { id: number; runId: string; reviewId: string; platform: string; rating: number; text: string; status: string; reasons: string }

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function mirrorReplyQueue(cfg: Config, runId: string, rows: ReplyRow[]): Promise<{ target: string; mock: boolean }> {
  const header = ["id", "run_id", "review_id", "platform", "rating", "reply_text", "status", "reasons"];
  const values = rows.map((r) => [r.id, r.runId, r.reviewId, r.platform, r.rating, r.text, r.status, r.reasons]);
  if (cfg.mockMode || !cfg.googleServiceAccountJson || !cfg.replyQueueSheetId) {
    const p = join(runDir(cfg, runId), "reply-queue.csv");
    writeFileSync(p, [header, ...values].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");
    return { target: p, mock: true };
  }
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(cfg.googleServiceAccountJson), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  await retry(() => sheets.spreadsheets.values.update({
    spreadsheetId: cfg.replyQueueSheetId, range: "ReplyQueue!A1", valueInputOption: "RAW",
    requestBody: { values: [header, ...values.map((v) => v.map(String))] },
  }));
  return { target: `sheet:${cfg.replyQueueSheetId}`, mock: false };
}
