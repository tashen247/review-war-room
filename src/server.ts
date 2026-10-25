import Fastify from "fastify";
import { config as defaultConfig, type Config } from "./config.js";
import { openDb, type DB } from "./db/db.js";
import { ingest, ratingsSummary } from "./ingest.js";
import { newRunId, runInvestigation, type RunOptions } from "./agent/runner.js";
import { approveReplies } from "./tools/service.js";

export function buildServer(db: DB, cfg: Config, deps: { run?: (db: DB, cfg: Config, o: RunOptions) => Promise<unknown> } = {}) {
  const app = Fastify({ logger: false });
  const run = deps.run ?? runInvestigation;
  const active = new Set<string>();

  app.get("/health", async () => ({ ok: true, mockMode: cfg.mockMode }));

  app.post<{ Body: { scenario?: string; until?: string; app?: "ios" | "android" | "both" } }>("/ingest", async (req) => ingest(db, cfg, req.body ?? {}));

  app.get<{ Querystring: { threshold?: string } }>("/ratings/summary", async (req) =>
    ratingsSummary(db, req.query.threshold ? Number(req.query.threshold) : 0.3));

  app.post<{ Body: { resumeUrl?: string; platform?: string; offline?: boolean } }>("/investigations", async (req, reply) => {
    if (active.size) return reply.code(409).send({ error: "An investigation is already running", runId: [...active][0] });
    const runId = newRunId();
    active.add(runId);
    // Respond immediately; the run continues in the background and calls resumeUrl when done.
    run(db, cfg, { runId, resumeUrl: req.body?.resumeUrl, platform: req.body?.platform, offline: req.body?.offline, echo: true })
      .catch((e) => console.error(`[run ${runId}]`, e))
      .finally(() => active.delete(runId));
    return reply.code(202).send({ runId, status: "running" });
  });

  app.get<{ Params: { id: string } }>("/investigations/:id", async (req, reply) => {
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(req.params.id);
    if (!r) return reply.code(404).send({ error: "not found" });
    const verdict = db.prepare("SELECT * FROM verdicts WHERE run_id = ?").get(req.params.id) ?? null;
    const replies = db.prepare("SELECT status, COUNT(*) n FROM replies WHERE run_id = ? GROUP BY status").all(req.params.id);
    return { run: r, verdict, replies };
  });

  app.post<{ Body: { runId: string } }>("/replies/approve", async (req, reply) => {
    if (!req.body?.runId) return reply.code(400).send({ error: "runId required" });
    return approveReplies(db, cfg, req.body.runId);
  });

  return app;
}

const isMain = process.argv[1] && /server\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const db = openDb(defaultConfig.dbPath);
  const app = buildServer(db, defaultConfig);
  app.listen({ port: defaultConfig.port, host: "0.0.0.0" }).then(() =>
    console.log(`review-war-room API on :${defaultConfig.port} (mock mode: ${defaultConfig.mockMode}, agent: ${process.env.ANTHROPIC_API_KEY ? "live" : "offline - no ANTHROPIC_API_KEY"})`));
}
