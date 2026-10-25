import type { DB } from "./db/db.js";
import { nowIso } from "./db/db.js";
import type { Config } from "./config.js";
import { loadFixtureReleases, loadFixtureReviews, fetchStoreReviews, type RawReview, type RawRelease } from "./adapters/reviews.js";
import { scanForInjection } from "./policy/injection.js";

export interface IngestOptions { scenario?: string; until?: string; app?: "ios" | "android" | "both" }
export interface IngestResult { fetched: number; inserted: number; total: number; newBatches: string[] }

export async function ingest(db: DB, cfg: Config, opts: IngestOptions = {}): Promise<IngestResult> {
  let reviews: RawReview[];
  let releases: RawRelease[];
  if (cfg.mockMode) {
    reviews = loadFixtureReviews(cfg, opts.scenario);
    releases = loadFixtureReleases(cfg, opts.scenario);
  } else {
    reviews = await fetchStoreReviews(cfg, opts.app ?? "both");
    releases = loadFixtureReleases(cfg, opts.scenario); // real release history would come from Crashlytics / store APIs
  }
  if (opts.until) {
    reviews = reviews.filter((r) => r.date <= opts.until!);
    releases = releases.filter((r) => r.date <= opts.until!);
  }

  const insRev = db.prepare(`INSERT OR IGNORE INTO reviews (id, platform, rating, text, version, date, country, injection_flag, ingested_at)
    VALUES (@id, @platform, @rating, @text, @version, @date, @country, @flag, @at)`);
  const insRel = db.prepare(`INSERT INTO releases (version, platform, date, changelog, crash_free) VALUES (@version, @platform, @date, @changelog, @crashFree)
    ON CONFLICT(version, platform) DO UPDATE SET date=excluded.date, changelog=excluded.changelog, crash_free=excluded.crash_free`);
  let inserted = 0;
  const at = nowIso();
  db.transaction(() => {
    for (const r of reviews) {
      const res = insRev.run({ ...r, country: r.country ?? null, version: r.version ?? null, flag: scanForInjection(r.text).flagged ? 1 : 0, at });
      inserted += res.changes;
    }
    for (const rel of releases) insRel.run({ ...rel, crashFree: rel.crashFree ?? null });
  })();

  const newBatches = assignBatches(db, cfg.batchSize);
  const total = (db.prepare("SELECT COUNT(*) c FROM reviews").get() as { c: number }).c;
  return { fetched: reviews.length, inserted, total, newBatches };
}

/** Group reviews that have no batch yet into batches of `size`, oldest first. */
export function assignBatches(db: DB, size: number): string[] {
  const ids = (db.prepare("SELECT id FROM reviews WHERE batch_id IS NULL ORDER BY date, id").all() as { id: string }[]).map((r) => r.id);
  if (!ids.length) return [];
  const prefix = `b${Date.now().toString(36)}`;
  const upd = db.prepare("UPDATE reviews SET batch_id = ? WHERE id = ?");
  const batches: string[] = [];
  db.transaction(() => {
    for (let i = 0; i < ids.length; i += size) {
      const b = `${prefix}-${String(i / size + 1).padStart(2, "0")}`;
      batches.push(b);
      for (const id of ids.slice(i, i + size)) upd.run(b, id);
    }
  })();
  return batches;
}

export interface RatingsSummary { asOf: string | null; avg24h: number | null; avg7d: number | null; drop: number | null; dip: boolean; n24h: number; n7d: number }

/** Rolling summary relative to the newest review date (so fixtures behave like "now"). */
export function ratingsSummary(db: DB, threshold = 0.3): RatingsSummary {
  const last = (db.prepare("SELECT MAX(date) d FROM reviews").get() as { d: string | null }).d;
  if (!last) return { asOf: null, avg24h: null, avg7d: null, drop: null, dip: false, n24h: 0, n7d: 0 };
  const d = new Date(last + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 7);
  const weekStart = d.toISOString().slice(0, 10);
  const day = db.prepare("SELECT AVG(rating) a, COUNT(*) n FROM reviews WHERE date = ?").get(last) as { a: number; n: number };
  const week = db.prepare("SELECT AVG(rating) a, COUNT(*) n FROM reviews WHERE date >= ? AND date < ?").get(weekStart, last) as { a: number | null; n: number };
  const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
  const drop = week.a !== null ? week.a - day.a : null;
  return { asOf: last, avg24h: r2(day.a), avg7d: r2(week.a), drop: r2(drop), dip: drop !== null && drop >= threshold, n24h: day.n, n7d: week.n };
}
