import { describe, expect, it } from "vitest";
import { slugify, fingerprint, ToolError } from "../src/tools/service.js";
import { setup, newSvc } from "./helpers.js";

const ids = (db: any, n: number, where = "1=1") => (db.prepare(`SELECT id FROM reviews WHERE ${where} AND injection_flag = 0 ORDER BY id LIMIT ?`).all(n) as any[]).map((r) => r.id);

describe("cluster taxonomy", () => {
  it("normalises labels so near-identical wording attaches to one cluster", () => {
    expect(slugify("Login loop")).toBe(slugify("Login Loop issue"));
    expect(slugify("Login loop after update")).toBe("login-loop");
    expect(fingerprint("bug", "android", "login-loop")).toHaveLength(16);
  });

  it("attaches to an existing cluster by slug and by alias after a merge", async () => {
    const { db, cfg } = await setup();
    const svc = newSvc(db, cfg);
    const [a, b, c, d] = ids(db, 4);
    const s1 = svc.saveClusters([{ label: "Login loop", kind: "bug", reviewIds: [a], severity: 5, summary: "x" }]).saved[0];
    const s2 = svc.saveClusters([{ label: "Login Loop issue", kind: "bug", reviewIds: [b], severity: 5, summary: "x" }]).saved[0];
    expect(s2.clusterId).toBe(s1.clusterId);
    expect(s2.attachedTo).toBe("Login loop");
    const s3 = svc.saveClusters([{ label: "Can't sign in", kind: "bug", reviewIds: [c], severity: 5, summary: "x" }]).saved[0];
    svc.mergeClusters(s1.clusterId, [s3.clusterId]);
    const s4 = svc.saveClusters([{ label: "Can't sign in", kind: "bug", reviewIds: [d], severity: 5, summary: "x" }]).saved[0];
    expect(s4.clusterId).toBe(s1.clusterId);
    const list = svc.listClusters().clusters;
    expect(list.find((x) => x.id === s1.clusterId)?.size).toBe(4);
    expect(list.find((x) => x.id === s1.clusterId)?.aliases).toContain("can-t-sign");
  });

  it("assigns each review to one cluster only", async () => {
    const { db, cfg } = await setup();
    const svc = newSvc(db, cfg);
    const [a] = ids(db, 1);
    svc.saveClusters([{ label: "Login loop", kind: "bug", reviewIds: [a], severity: 5, summary: "x" }]);
    const r = svc.saveClusters([{ label: "Slow loading", kind: "ux", reviewIds: [a], severity: 2, summary: "x" }]).saved[0];
    expect(r.skipped).toBe(1);
  });
});

describe("verdict band", () => {
  it("accepts base ±0.10 and rejects outside it, and requires a reason to adjust", async () => {
    const { db, cfg } = await setup();
    const svc = newSvc(db, cfg);
    expect(() => svc.recordVerdict({ suspectVersion: "4.2.0", platform: "android", confidence: 0.9, evidence: ["e"] })).toThrow(/correlate_releases/);
    const corr = svc.correlateReleases();
    const base = svc.baseFor("4.2.0", "android");
    expect(corr.suspect.version).toBe("4.2.0");
    expect(() => svc.recordVerdict({ suspectVersion: "4.2.0", platform: "android", confidence: base - 0.2, adjustmentReason: "r", evidence: ["e"] })).toThrow(ToolError);
    expect(() => svc.recordVerdict({ suspectVersion: "4.2.0", platform: "android", confidence: base - 0.05, evidence: ["e"] })).toThrow(/adjustmentReason/);
    expect(svc.recordVerdict({ suspectVersion: "4.2.0", platform: "android", confidence: base - 0.05, adjustmentReason: "small cluster", evidence: ["e"] }).ok).toBe(true);
  });
});

describe("bugs", () => {
  it("dedupes by fingerprint across runs and caps per run", async () => {
    const { db, cfg } = await setup();
    const svc = newSvc(db, cfg, "r1");
    const all = ids(db, 20);
    const made = [0, 1, 2, 3].map((i) => svc.saveClusters([{ label: `Bug theme ${"abcd"[i]}`, kind: "bug", reviewIds: all.slice(i * 4, i * 4 + 4), severity: 3, summary: "x" }]).saved[0].clusterId);
    const bug = (id: number) => ({ clusterId: id, title: "t", reproHints: "h", version: "4.2.0", platform: "android", severity: 4 });
    expect((await svc.openBug(bug(made[0]))).deduped).toBe(false);
    expect((await svc.openBug(bug(made[0]))).deduped).toBe(true);
    await svc.openBug(bug(made[1])); await svc.openBug(bug(made[2]));
    await expect(svc.openBug(bug(made[3]))).rejects.toThrow(/cap/);
    const svc2 = newSvc(db, cfg, "r2");
    expect((await svc2.openBug(bug(made[0]))).deduped).toBe(true);
  });
  it("refuses to open a bug for a non-bug cluster", async () => {
    const { db, cfg } = await setup();
    const svc = newSvc(db, cfg);
    const c = svc.saveClusters([{ label: "Export requests", kind: "feature", reviewIds: ids(db, 2), severity: 1, summary: "x" }]).saved[0];
    await expect(svc.openBug({ clusterId: c.clusterId, title: "t", reproHints: "h", version: "1", platform: "android", severity: 1 })).rejects.toThrow(/not 'bug'/);
  });
});

describe("reply queue", () => {
  it("queues policy-passing replies as pending, rejects others, never publishes", async () => {
    const { db, cfg } = await setup();
    const svc = newSvc(db, cfg);
    const [a, b] = ids(db, 2);
    expect(svc.queueReply(a, "Sorry about the trouble with signing in. Our team is on it; reach us at https://support.example.com/contact.").status).toBe("queued");
    expect(svc.queueReply(a, "Sorry about the trouble with signing in. Our team is working on a fix right now.").status).toBe("rejected");
    expect(svc.queueReply(b, "We'll refund you in full for this inconvenience, sorry!").status).toBe("rejected");
    expect((db.prepare("SELECT status FROM replies").all() as any[]).map((r) => r.status)).toEqual(["pending"]);
  });
});
