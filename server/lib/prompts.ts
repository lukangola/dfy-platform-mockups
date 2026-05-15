import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDev } from "./env.js";

// Resolve prompts/ relative to the process working directory (which is the
// repo root both in dev — `pnpm dev` runs there — and in production —
// Railway runs `pnpm start` from /app/). We deliberately avoid the older
// `__dirname` + `../../` pattern: after esbuild bundles to `dist/index.js`,
// `__dirname` is `/app/dist/` and `../../prompts` resolves to `/prompts/`,
// which doesn't exist. Using `process.cwd()` keeps the behaviour consistent
// across dev source-tree and prod bundled output.
const PROMPTS_DIR = path.resolve(process.cwd(), "prompts");

export type PromptConfig = {
  tools?: string[]; // e.g. ["web_search", "web_fetch"]
  model?: string;
  maxTokens?: number;
  expectsJson?: boolean; // if true, the client should JSON.parse(text)
};

type PromptCacheEntry = {
  content: string; // body with frontmatter stripped
  raw: string; // full file content (used for versioning)
  version: string;
  config: PromptConfig;
  mtimeMs: number;
};

const cache = new Map<string, PromptCacheEntry>();

export class PromptNotConfiguredError extends Error {
  constructor(public action: string) {
    super(`Prompt not yet configured for action "${action}". Create prompts/${action}.md and paste the master prompt.`);
    this.name = "PromptNotConfiguredError";
  }
}

function hash(content: string) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

// Minimal YAML-ish frontmatter parser: supports `key: value`, `key: [a, b]`, and `key: "string"`.
function parseFrontmatter(raw: string): { body: string; config: PromptConfig } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { body: raw, config: {} };

  const [, fm, body] = match;
  const config: PromptConfig = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    let value: unknown;
    if (/^\[.*\]$/.test(rawVal)) {
      value = rawVal
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (/^(true|false)$/i.test(rawVal)) {
      value = rawVal.toLowerCase() === "true";
    } else if (/^-?\d+(\.\d+)?$/.test(rawVal)) {
      value = Number(rawVal);
    } else {
      value = rawVal.replace(/^["']|["']$/g, "");
    }
    (config as Record<string, unknown>)[key] = value;
  }
  return { body: body.trim(), config };
}

function readPromptFile(action: string): PromptCacheEntry {
  const file = path.join(PROMPTS_DIR, `${action}.md`);
  if (!fs.existsSync(file)) throw new PromptNotConfiguredError(action);

  const stat = fs.statSync(file);
  const cached = cache.get(action);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

  const raw = fs.readFileSync(file, "utf-8").trim();
  if (!raw) throw new PromptNotConfiguredError(action);

  const { body, config } = parseFrontmatter(raw);
  if (!body.trim()) throw new PromptNotConfiguredError(action);

  const entry: PromptCacheEntry = {
    content: body,
    raw,
    version: hash(raw),
    config,
    mtimeMs: stat.mtimeMs,
  };
  cache.set(action, entry);
  return entry;
}

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const parts = key.split(".");
    let value: unknown = vars;
    for (const p of parts) {
      if (value && typeof value === "object" && p in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[p];
      } else {
        value = undefined;
        break;
      }
    }
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  });
}

export function loadPrompt(action: string, vars: Record<string, unknown> = {}) {
  const entry = readPromptFile(action);
  return {
    rendered: renderTemplate(entry.content, vars),
    raw: entry.raw,
    version: entry.version,
    config: entry.config,
  };
}

export function ensurePromptsDir() {
  if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR, { recursive: true });
}

if (isDev) ensurePromptsDir();
