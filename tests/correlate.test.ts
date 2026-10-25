import { describe, expect, it } from "vitest";
import { dailySeries, detectChangepoint } from "../src/correlate/changepoint.js";
import { versionStats, compareVersions, clusterLiftForRelease } from "../src/correlate/versionStats.js";
import { baseConfidence, MAX_CONFIDENCE } from "../src/correlate/confidence.js";

function series(days: number, before: number, after: number, at: number, perDay = 20) {
  const out: { date: string; rating: number }[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.UTC(2026, 8, 1 + d)).toISOString().slice(0, 10);
    const mean = d < at ? before : after;
    for (let i = 0; i < perDay; i++) out.push({ date, rating: Math.max(1, Math.min(5, Math.round(mean + ((i % 5) - 2) * 0.5))) });
  }
  return out;
}

describe("changepoint", () => {
  it("finds a synthetic drop on the right day", () => {
    const cp = detectChangepoint(dailySeries(series(30, 4.2, 2.6, 18)));
    expect(cp?.date).toBe("2026-09-19");
    expect(cp?.significant).toBe(true);
    expect(cp!.delta).toBeLessThan(-1);
  });
  it("reports no significant change on a flat series", () => {
    const cp = detectChangepoint(dailySeries(series(30, 4, 4, 15)));
    expect(cp?.significant ?? false).toBe(false);
  });
  it("needs enough days", () => {
    expect(detectChangepoint(dailySeries(series(4, 4, 2, 2)))).toBeNull();
  });
});

describe("version stats", () => {
  it("averages per platform and version", () => {
    const s = versionStats([
      { id: "a", platform: "android", rating: 5, version: "1.0.0", date: "2026-01-01" },
      { id: "b", platform: "android", rating: 1, version: "1.1.0", date: "2026-01-02" },
      { id: "c", platform: "android", rating: 3, version: "1.1.0", date: "2026-01-02" },
    ]);
    expect(s.find((x) => x.version === "1.1.0")).toMatchObject({ n: 2, avg: 2, oneStarShare: 0.5 });
  });
  it("orders semantic versions numerically", () => {
    expect(compareVersions("4.10.0", "4.9.9")).toBeGreaterThan(0);
  });
  it("computes cluster lift against reviewers still on older versions", () => {
    const reviews = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, platform: "android", rating: 1, version: "2.0", date: "2026-01-05" })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, platform: "android", rating: 4, version: "1.9", date: "2026-01-05" })),
    ];
    const membership = new Map<string, number[]>(reviews.filter((r) => r.id.startsWith("n")).slice(0, 6).map((r) => [r.id, [1]]));
    const lift = clusterLiftForRelease({ version: "2.0", platform: "android", date: "2026-01-04" }, reviews, membership, [{ id: 1, label: "Login loop", kind: "bug" }]);
    expect(lift[0]).toMatchObject({ versionShare: 0.6, otherShare: 0, lift: 0.6 });
  });
});

describe("base confidence", () => {
  it("is bounded and monotonic in each factor", () => {
    expect(baseConfidence({ timing: 1, lift: 1, platform: 1, rating: 1 })).toBe(MAX_CONFIDENCE);
    expect(baseConfidence({ timing: 0, lift: 0, platform: 0, rating: 0 })).toBe(0.1);
    expect(baseConfidence({ timing: 1, lift: 0.5, platform: 1, rating: 0.5 })).toBeGreaterThan(baseConfidence({ timing: 0.5, lift: 0.5, platform: 1, rating: 0.5 }));
  });
});
