import { round } from "./changepoint.js";

export interface RevLite { id: string; platform: string; rating: number; version: string | null; date: string }
export interface RelLite { version: string; platform: string; date: string; changelog?: string | null; crashFree?: number | null }

export interface VersionStat { platform: string; version: string; n: number; avg: number; oneStarShare: number }

export function versionStats(reviews: RevLite[]): VersionStat[] {
  const by = new Map<string, { platform: string; version: string; n: number; sum: number; ones: number }>();
  for (const r of reviews) {
    const v = r.version ?? "unknown";
    const k = `${r.platform}|${v}`;
    const e = by.get(k) ?? { platform: r.platform, version: v, n: 0, sum: 0, ones: 0 };
    e.n++; e.sum += r.rating; if (r.rating === 1) e.ones++;
    by.set(k, e);
  }
  return [...by.values()]
    .map((e) => ({ platform: e.platform, version: e.version, n: e.n, avg: round(e.sum / e.n, 2), oneStarShare: round(e.ones / e.n, 3) }))
    .sort((a, b) => a.platform.localeCompare(b.platform) || compareVersions(a.version, b.version));
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0), pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface ClusterLift {
  clusterId: number;
  label: string;
  kind: string;
  /** share of the cluster among reviews on this release's version (same platform) */
  versionShare: number;
  /** share among reviews on other versions of the same platform, same post-release period */
  otherShare: number;
  /** share in the 7 days before release on this platform */
  preShare: number;
  lift: number; // versionShare - max(otherShare, preShare)
  nVersion: number;
}

/**
 * For one release, how much each cluster is over-represented on the new version.
 * Comparing against reviewers still on the old version in the same window handles staged rollouts.
 */
export function clusterLiftForRelease(
  release: RelLite,
  reviews: RevLite[],
  membership: Map<string, number[]>,
  clusters: { id: number; label: string; kind: string }[],
): ClusterLift[] {
  const plat = reviews.filter((r) => r.platform === release.platform);
  const preStart = addDays(release.date, -7);
  const postEnd = addDays(release.date, 10);
  const pre = plat.filter((r) => r.date >= preStart && r.date < release.date);
  const post = plat.filter((r) => r.date >= release.date && r.date <= postEnd);
  const onVer = post.filter((r) => r.version === release.version);
  const other = post.filter((r) => r.version !== release.version);
  const share = (rs: RevLite[], cid: number) => (rs.length ? rs.filter((r) => membership.get(r.id)?.includes(cid)).length / rs.length : 0);
  return clusters
    .map((c) => {
      const vs = share(onVer, c.id), os = share(other, c.id), ps = share(pre, c.id);
      return { clusterId: c.id, label: c.label, kind: c.kind, versionShare: round(vs), otherShare: round(os), preShare: round(ps), lift: round(vs - Math.max(os, ps)), nVersion: onVer.length };
    })
    .sort((a, b) => b.lift - a.lift);
}

export function addDays(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
