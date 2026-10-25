import "dotenv/config";

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  leadModel: process.env.LEAD_MODEL || "claude-sonnet-5-5",
  subagentModel: process.env.SUBAGENT_MODEL || "claude-haiku-5-5",
  mockMode: (process.env.MOCK_MODE ?? "true").toLowerCase() !== "false",
  maxBudgetUsd: num(process.env.MAX_BUDGET_USD, 0.75),
  maxTurns: num(process.env.MAX_TURNS, 25),
  clustererMaxTurns: 12,
  replyWriterMaxTurns: 10,
  batchSize: 50,
  maxBugsPerRun: 3,
  maxRepliesPerRun: 15,
  repliesPerCluster: 5,
  verdictBand: 0.1,
  appIdAndroid: process.env.APP_ID_ANDROID || "",
  appIdIos: process.env.APP_ID_IOS || "",
  asanaPat: process.env.ASANA_PAT || "",
  asanaProjectGid: process.env.ASANA_PROJECT_GID || "",
  slackBotToken: process.env.SLACK_BOT_TOKEN || "",
  slackChannel: process.env.SLACK_WARROOM_CHANNEL_ID || "",
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
  replyQueueSheetId: process.env.REPLY_QUEUE_SHEET_ID || "",
  supportDomain: process.env.SUPPORT_DOMAIN || "support.example.com",
  dbPath: process.env.DB_PATH || "./data/warroom.db",
  port: num(process.env.PORT, 8787),
  /** When the API reaches n8n on a different host than the browser does (Docker), rewrite resumeUrl to this origin. */
  n8nInternalUrl: process.env.N8N_INTERNAL_URL || "",
  fixturesDir: process.env.FIXTURES_DIR || "./fixtures",
  runsDir: process.env.RUNS_DIR || "./runs",
};

export type Config = typeof config;
