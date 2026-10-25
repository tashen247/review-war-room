import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db/db.js";
import { ingest, ratingsSummary } from "../src/ingest.js";
import { runInvestigation } from "../src/agent/runner.js";
import { approveReplies } from "../src/tools/service.js";
import { EXPECTATIONS, checkExpectation } from "../evals/expectations.js";
import { testCfg } from "./helpers.js";

describe("offline pipeline meets every eval expectation (deterministic parts)", () => {
  for (const exp of EXPECTATIONS) {
    it(exp.scenario, async () => {
      const cfg = testCfg();
      const db = openDb(":memory:");
      await ingest(db, cfg, { scenario: exp.scenario });
      const out = await runInvestigation(db, cfg, { offline: true });
      const res = checkExpectation(db, out, exp);
      expect(res.failures, res.failures.join("; ")).toEqual([]);
      expect(existsSync(out.reportPath)).toBe(true);
    });
  }
});

describe("two consecutive runs", () => {
  it("opens no duplicate bugs and reports cluster growth", async () => {
    const cfg = testCfg();
    const db = openDb(":memory:");
    await ingest(db, cfg, { until: "2026-10-14" });
    const r1 = await runInvestigation(db, cfg, { offline: true });
    await ingest(db, cfg);
    const r2 = await runInvestigation(db, cfg, { offline: true });
    expect(r1.bugsOpened).toBe(1);
    expect(r2.bugsOpened).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM bugs").get() as any).c).toBe(1);
    const report = readFileSync(r2.reportPath, "utf8");
    expect(report).toMatch(/Login loop \| bug \| \d+ \| \+\d+/);
    expect(report).toMatch(/Existing \(not duplicated\)/);
  });
});

describe("ratings summary and approval", () => {
  it("detects the dip on the seeded dataset and not on the quiet week", async () => {
    const cfg = testCfg();
    const a = openDb(":memory:"); await ingest(a, cfg);
    const b = openDb(":memory:"); await ingest(b, cfg, { scenario: "quiet-week" });
    expect(ratingsSummary(a).dip).toBe(true);
    expect(ratingsSummary(b).dip).toBe(false);
  });
  it("approval flips pending to approved and publishes nothing", async () => {
    const cfg = testCfg();
    const db = openDb(":memory:");
    await ingest(db, cfg);
    const out = await runInvestigation(db, cfg, { offline: true });
    expect(out.pendingReplies).toBeGreaterThan(0);
    const res = await approveReplies(db, cfg, out.runId);
    expect(res).toMatchObject({ approved: out.pendingReplies, published: 0 });
    const csv = readFileSync(join(cfg.runsDir, out.runId, "reply-queue.csv"), "utf8");
    expect(csv).toMatch(/"approved"/);
    expect(csv).not.toMatch(/"pending"/);
  });
});
