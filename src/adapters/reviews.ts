import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";

export type Platform = "ios" | "android";
export interface RawReview { id: string; platform: Platform; rating: number; text: string; version: string | null; date: string; country?: string }
export interface RawRelease { version: string; platform: Platform; date: string; changelog: string; crashFree: number | null }

export function fixturePaths(cfg: Config, scenario?: string) {
  const dir = scenario ? join(cfg.fixturesDir, scenario) : cfg.fixturesDir;
  return { reviews: join(dir, "reviews.json"), releases: join(dir, "releases.json") };
}

export function loadFixtureReviews(cfg: Config, scenario?: string): RawReview[] {
  const p = fixturePaths(cfg, scenario).reviews;
  if (!existsSync(p)) throw new Error(`Fixture not found: ${p}. Run \`npm run gen\` first.`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function loadFixtureReleases(cfg: Config, scenario?: string): RawRelease[] {
  return JSON.parse(readFileSync(fixturePaths(cfg, scenario).releases, "utf8"));
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(last)}`);
}

/** Real, read-only scraping of public store reviews. Optional dependencies; mock mode never loads them. */
export async function fetchStoreReviews(cfg: Config, app: "ios" | "android" | "both"): Promise<RawReview[]> {
  const out: RawReview[] = [];
  if ((app === "android" || app === "both") && cfg.appIdAndroid) {
    const gplay: any = (await import("google-play-scraper" as string)).default;
    const res = await withRetry(() => gplay.reviews({ appId: cfg.appIdAndroid, sort: gplay.sort.NEWEST, num: 300 }), "google-play-scraper");
    for (const r of (res as any).data ?? res) {
      out.push({ id: `gp-${r.id}`, platform: "android", rating: r.score, text: r.text ?? "", version: r.version ?? null, date: new Date(r.date).toISOString().slice(0, 10) });
    }
  }
  if ((app === "ios" || app === "both") && cfg.appIdIos) {
    const store: any = (await import("app-store-scraper" as string)).default;
    const idField = /^\d+$/.test(cfg.appIdIos) ? { id: Number(cfg.appIdIos) } : { appId: cfg.appIdIos };
    for (let page = 1; page <= 5; page++) {
      const res: any[] = await withRetry(() => store.reviews({ ...idField, sort: store.sort.RECENT, page }), "app-store-scraper");
      for (const r of res) out.push({ id: `as-${r.id}`, platform: "ios", rating: r.score, text: `${r.title ? r.title + ". " : ""}${r.text ?? ""}`, version: r.version ?? null, date: new Date(r.updated).toISOString().slice(0, 10) });
      if (res.length < 50) break;
    }
  }
  return out;
}
