import { detectChangepoint, dailySeries, round, type Changepoint } from "./changepoint.js";
import { clusterLiftForRelease, versionStats, daysBetween, addDays, type ClusterLift, type RelLite, type RevLite, type VersionStat } from "./versionStats.js";

export interface ConfidenceFactors { timing: number; lift: number; platform: number; rating: number }

/** Weighted, bounded base confidence. Weights are documented in the README so the number is explainable. */
export const WEIGHTS = { intercept: 0.1, timing: 0.3, lift: 0.25, platform: 0.1, rating: 0.25 } as const;
export const MAX_CONFIDENCE = 0.95;

export function baseConfidence(f: ConfidenceFactors): number {
  const raw = WEIGHTS.intercept + WEIGHTS.timing * f.timing + WEIGHTS.lift * f.lift + WEIGHTS.platform * f.platform + WEIGHTS.rating * f.rating;
  return round(Math.min(MAX_CONFIDENCE, Math.max(0, raw)), 2);
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface ReleaseAssessment {
  version: string;
  platform: string;          // platform of the release examined
  attributedPlatform: string; // "android" | "ios" | "both"
  date: string;
  changelog?: string | null;
  crashFree?: number | null;
  avgOnVersion: number | null;
  avgOtherSamePeriod: number | null;
  ratingDelta: number;       // positive = the version rates worse
  topLift: ClusterLift | null;
  counterpartLift: number | null;
  changepoint: Changepoint | null;
  factors: ConfidenceFactors;
  base: number;
}

export interface CorrelationResult {
  window: { from: string; to: string; reviews: number };
  versionStats: VersionStat[];
  changepoints: Record<string, Changepoint | null>;
  releases: ReleaseAssessment[];
  suspect: { version: string; platform: string; base: number; topClusterKind: string | null } | { version: "none"; platform: null; base: number; topClusterKind: null };
}

const NEGATIVE_KINDS = new Set(["bug", "ux", "feature", "other"]);

export function correlate(
  reviews: RevLite[],
  releases: RelLite[],
  membership: Map<string, number[]>,
  clusters: { id: number; label: string; kind: string }[],
): CorrelationResult {
  const dates = reviews.map((r) => r.date).sort();
  const from = dates[0] ?? "", to = dates.at(-1) ?? "";
  const cps: Record<string, Changepoint | null> = {
    all: detectChangepoint(dailySeries(reviews)),
    android: detectChangepoint(dailySeries(reviews.filter((r) => r.platform === "android"))),
    ios: detectChangepoint(dailySeries(reviews.filter((r) => r.platform === "ios"))),
  };
  const negClusters = clusters.filter((c) => NEGATIVE_KINDS.has(c.kind));
  const inWindow = releases.filter((r) => r.date >= from && r.date <= to);

  const lifts = new Map<string, ClusterLift[]>();
  for (const rel of inWindow) lifts.set(`${rel.platform}|${rel.version}`, clusterLiftForRelease(rel, reviews, membership, negClusters));

  const assessments: ReleaseAssessment[] = inWindow.map((rel) => {
    const postEnd = addDays(rel.date, 10);
    const post = reviews.filter((r) => r.platform === rel.platform && r.date >= rel.date && r.date <= postEnd);
    const on = post.filter((r) => r.version === rel.version), other = post.filter((r) => r.version !== rel.version);
    const pre = reviews.filter((r) => r.platform === rel.platform && r.date < rel.date && r.date >= addDays(rel.date, -7));
    const avg = (rs: RevLite[]) => (rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : null);
    const avgOn = avg(on);
    const baseline = avg(other.length >= 10 ? other : pre);
    const ratingDelta = avgOn !== null && baseline !== null ? baseline - avgOn : 0;

    const top = lifts.get(`${rel.platform}|${rel.version}`)?.[0] ?? null;
    const counterpartPlat = rel.platform === "android" ? "ios" : "android";
    const cLifts = lifts.get(`${counterpartPlat}|${rel.version}`);
    const counterpartLift = top && cLifts ? cLifts.find((l) => l.clusterId === top.clusterId)?.lift ?? 0 : null;

    let platformFactor = 0.7, attributed = rel.platform;
    if (top && top.lift > 0.05 && counterpartLift !== null) {
      const ratio = counterpartLift / top.lift;
      if (ratio < 0.3) platformFactor = 1;
      else if (ratio > 0.7) { platformFactor = 1; attributed = "both"; }
      else platformFactor = 0.5;
    }

    const cp = cps[rel.platform];
    let timing = 0;
    if (cp?.significant) {
      const gap = daysBetween(rel.date, cp.date);
      if (gap >= -1 && gap <= 4) timing = 1;
      else if (gap >= -2 && gap <= 8) timing = 0.5;
    }
    const factors: ConfidenceFactors = {
      timing,
      lift: round(clamp01((top?.lift ?? 0) / 0.4), 2),
      platform: platformFactor,
      rating: round(clamp01(ratingDelta / 1.2), 2),
    };
    return {
      version: rel.version, platform: rel.platform, attributedPlatform: attributed, date: rel.date,
      changelog: rel.changelog, crashFree: rel.crashFree,
      avgOnVersion: avgOn === null ? null : round(avgOn, 2), avgOtherSamePeriod: baseline === null ? null : round(baseline, 2),
      ratingDelta: round(ratingDelta, 2), topLift: top, counterpartLift, changepoint: cp, factors, base: baseConfidence(factors),
    };
  }).sort((a, b) => b.base - a.base);

  const best = assessments[0];
  const isIncident = best && best.base >= 0.45 && (best.ratingDelta >= 0.3 || (best.topLift?.lift ?? 0) >= 0.1);
  const suspect: CorrelationResult["suspect"] = isIncident
    ? { version: best.version, platform: best.attributedPlatform, base: best.base, topClusterKind: best.topLift?.kind ?? null }
    : { version: "none", platform: null, base: round(Math.min(MAX_CONFIDENCE, 1 - (best?.base ?? 0)), 2), topClusterKind: null };

  return { window: { from, to, reviews: reviews.length }, versionStats: versionStats(reviews), changepoints: cps, releases: assessments, suspect };
}
