import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env.local and OVERRIDE shell-inherited vars.
// Node's --env-file refuses to override existing env — and some shells pre-set
// empty ANTHROPIC_API_KEY etc. — so we parse the file ourselves.
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
    process.env[key] = value;
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
  DATABASE_URL: process.env.DATABASE_URL!,
  API_PORT: Number(process.env.API_PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? "development",
};

export const isDev = env.NODE_ENV !== "production";
