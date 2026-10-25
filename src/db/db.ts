import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DB = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));

/** Open (and migrate) a SQLite database. Pass ":memory:" for tests. */
export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
  return db;
}

export const nowIso = () => new Date().toISOString();
