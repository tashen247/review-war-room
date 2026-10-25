import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.js";
import { openDb } from "../src/db/db.js";
import { ingest } from "../src/ingest.js";
import { WarroomService } from "../src/tools/service.js";

export function testCfg() {
  return { ...config, mockMode: true, runsDir: mkdtempSync(join(tmpdir(), "rwr-runs-")), dbPath: ":memory:" };
}

export async function setup(scenario = "android-login-v420", until?: string) {
  const cfg = testCfg();
  const db = openDb(":memory:");
  await ingest(db, cfg, { scenario, until });
  return { cfg, db };
}

export function newSvc(db: ReturnType<typeof openDb>, cfg: ReturnType<typeof testCfg>, runId = "run-1") {
  db.prepare("INSERT OR IGNORE INTO runs (id, status, started_at) VALUES (?, 'running', ?)").run(runId, new Date().toISOString());
  return new WarroomService(db, cfg, runId);
}
