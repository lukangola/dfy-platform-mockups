import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env.local. We parse the file ourselves (instead of relying
// on Node's `--env-file`) so we can fill in vars that the shell pre-set as
// empty strings — some shell setups inject an empty `ANTHROPIC_API_KEY` etc.
// that would otherwise look "set" to consumers.
//
// **Existing non-empty env vars take precedence**, which matters in two
// places the previous "always override" logic was breaking:
//   1. Production hosts (Railway, Fly, etc.) populate env vars through
//      their dashboard, not a checked-in file. `.env.local` doesn't exist
//      in production, so this is belt-and-braces — but the principle stays
//      right: the host is the source of truth, the file is a fallback.
//   2. One-off CLI runs like `DATABASE_URL=... pnpm db:migrate` — pointing
//      a migration at a DIFFERENT database than the dev one, without
//      editing `.env.local`. Previously the file was silently winning and
//      the migration appeared to no-op against the wrong target.
function loadEnvFile() {
  const envPath = path.resolve(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Only fill in if the existing value is missing or empty — lets an
    // inline shell override (or the production host's injected env) win.
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const required = ["DATABASE_URL"] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}. Fill it in .env.local.`);
  }
}

export const env = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  FAL_KEY: process.env.FAL_KEY ?? "",
  // Apify API token — powers real Reddit harvesting for resonance mining.
  // When unset, the resonance miner falls back to the web_search path.
  APIFY_TOKEN: process.env.APIFY_TOKEN ?? "",
  DATABASE_URL: process.env.DATABASE_URL!,
  // Railway / Fly / Render / Heroku all inject `PORT`. Our existing dev
  // setup uses `API_PORT=3001`. Honor `PORT` first so the production host
  // controls binding, fall back to API_PORT for dev, then default 3001.
  API_PORT: Number(process.env.PORT ?? process.env.API_PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? "development",
};

export const isDev = env.NODE_ENV !== "production";
