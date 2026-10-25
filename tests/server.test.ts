import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { openDb } from "../src/db/db.js";
import { buildServer } from "../src/server.js";
import { runInvestigation, rewriteResumeUrl } from "../src/agent/runner.js";
import { testCfg } from "./helpers.js";

describe("HTTP API", () => {
  it("ingest → summary → 202 investigation → resumeUrl callback → approve", async () => {
    const cfg = testCfg();
    const db = openDb(":memory:");
    // a fake n8n Wait webhook
    const received: any[] = [];
    const hook = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { received.push(JSON.parse(b)); res.end("ok"); }); });
    await new Promise<void>((r) => hook.listen(0, r));
    const port = (hook.address() as any).port;

    const app = buildServer(db, cfg, { run: (d, c, o) => runInvestigation(d, c, { ...o, offline: true, echo: false }) });
    expect((await app.inject({ method: "POST", url: "/ingest", payload: {} })).json().inserted).toBe(601);
    expect((await app.inject({ method: "GET", url: "/ratings/summary" })).json().dip).toBe(true);

    const start = await app.inject({ method: "POST", url: "/investigations", payload: { resumeUrl: `http://127.0.0.1:${port}/webhook-waiting/1` } });
    expect(start.statusCode).toBe(202);
    const { runId } = start.json();
    for (let i = 0; i < 100 && !received.length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(received[0]).toMatchObject({ runId, status: "done", verdict: { suspectVersion: "4.2.0", platform: "android" } });

    const status = (await app.inject({ method: "GET", url: `/investigations/${runId}` })).json();
    expect(status.verdict.suspect_version).toBe("4.2.0");
    const approve = (await app.inject({ method: "POST", url: "/replies/approve", payload: { runId } })).json();
    expect(approve.published).toBe(0);
    expect(approve.approved).toBe(received[0].pendingReplies);
    hook.close();
  });

  it("rewrites resumeUrl to the internal n8n origin when configured", () => {
    expect(rewriteResumeUrl("http://localhost:5678/webhook-waiting/42", "http://n8n:5678")).toBe("http://n8n:5678/webhook-waiting/42");
    expect(rewriteResumeUrl("http://localhost:5678/x", "")).toBe("http://localhost:5678/x");
  });
});
