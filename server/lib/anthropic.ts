import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";

export const DEFAULT_MODEL = "claude-opus-4-7";

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export type TextGenResult = {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  stopReason: string | null;
};

// Pricing per 1M tokens (USD) — cached 2026-04-15
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-6": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

function calcCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}

// Server-side tool builders — Anthropic runs these, not us.
function buildServerTools(names: string[] | undefined): Anthropic.ToolUnion[] | undefined {
  if (!names || names.length === 0) return undefined;
  const tools: Anthropic.ToolUnion[] = [];
  for (const n of names) {
    if (n === "web_search") {
      tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 5 } as unknown as Anthropic.ToolUnion);
    } else if (n === "web_fetch") {
      tools.push({ type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 } as unknown as Anthropic.ToolUnion);
    } else if (n === "code_execution") {
      tools.push({ type: "code_execution_20250825", name: "code_execution" } as unknown as Anthropic.ToolUnion);
    }
  }
  return tools.length ? tools : undefined;
}

// ---------------------------------------------------------------------------
// Retry helper — retries on transient Anthropic errors (429 rate-limit and
// 529 overloaded). Uses exponential backoff with jitter. This prevents
// short-lived capacity issues from surfacing as fatal errors to the user.
// ---------------------------------------------------------------------------
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 2_000; // 2 seconds

function isTransientError(err: unknown): boolean {
  if (err && typeof err === "object") {
    // Anthropic SDK wraps HTTP errors with a `status` property
    const status = (err as { status?: number }).status;
    if (status === 429 || status === 529) return true;
    // Some errors carry the status in a nested `error` or message string
    const msg = (err as { message?: string }).message ?? "";
    if (/overloaded|rate.?limit|529|too many requests/i.test(msg)) return true;
  }
  return false;
}

async function retryOnTransient<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err)) throw err;
      if (attempt === MAX_RETRIES) {
        // All retries exhausted on a transient error — throw a user-friendly message
        throw new Error(
          "The AI service is temporarily overloaded. Please wait a minute and try again."
        );
      }
      // Exponential backoff: 2s → 4s → 8s, plus up to 1s random jitter
      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
      console.warn(
        `[anthropic] transient error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${Math.round(delay)}ms:`,
        err instanceof Error ? err.message : String(err)
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError; // unreachable, but satisfies TS
}

/**
 * Non-streaming text generation.
 * - System prompt = master prompt (cached via cache_control: ephemeral)
 * - User message = rendered inputs
 * - Server-side tools (web_search, web_fetch, code_execution) run on Anthropic's infra
 */
export async function generateText(args: {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  maxTokens?: number;
  tools?: string[];
  imageUrls?: string[];
}): Promise<TextGenResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set. Paste your key in .env.local.");
  }

  const model = args.model ?? DEFAULT_MODEL;
  const started = Date.now();
  const serverTools = buildServerTools(args.tools);

  // Adaptive thinking works on Opus 4.6/4.7 and Sonnet 4.6. Haiku rejects it.
  const supportsAdaptiveThinking = /opus-4-(6|7)|sonnet-4-6/.test(model);

  // web_fetch is currently beta and needs a header.
  const betas: string[] = [];
  if (args.tools?.includes("web_fetch")) betas.push("web-fetch-2025-09-10");

  const request = {
    model,
    max_tokens: args.maxTokens ?? 8192,
    ...(supportsAdaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
    system: [
      {
        type: "text" as const,
        text: args.systemPrompt,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [
      {
        role: "user" as const,
        content: args.imageUrls && args.imageUrls.length > 0
          ? [
              ...args.imageUrls.map((url) => ({
                type: "image" as const,
                source: { type: "url" as const, url },
              })),
              { type: "text" as const, text: args.userMessage },
            ]
          : args.userMessage,
      },
    ],
    ...(serverTools ? { tools: serverTools } : {}),
  };

  // SDK type defs lag behind the adaptive-thinking beta; cast the request so TS
  // stops complaining about the "adaptive" literal, and the response so we can
  // read content/usage/stop_reason off a concrete Message.
  type MessageLike = {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
    stop_reason: string | null;
  };

  // Streaming vs non-streaming choice:
  //
  //   The Anthropic SDK refuses non-streaming requests when max_tokens
  //   is high enough that the operation could exceed the 10-minute
  //   request timeout — it throws "Streaming is required for
  //   operations that may take longer than 10 minutes." We hit this on
  //   the listicle HTML render after bumping max_tokens to 24k. So:
  //   anything ≥ ~12k tokens on Opus 4.x is routed through the stream
  //   API and the final message is collected via `.finalMessage()`.
  //
  //   Streaming is also the SDK's recommended default for long requests
  //   per the claude-api skill — we just hadn't reached the threshold
  //   on any prior endpoint.
  const STREAMING_MIN_TOKENS = 12_000;
  const useStreaming = (args.maxTokens ?? 8192) >= STREAMING_MIN_TOKENS;

  const res = await retryOnTransient(async () => {
    if (useStreaming) {
      // .finalMessage() collects the full response after the stream
      // completes, so the caller gets the same Message shape as the
      // non-streaming path.
      const stream = betas.length > 0
        ? anthropic.beta.messages.stream({ ...request, betas } as unknown as Parameters<typeof anthropic.beta.messages.stream>[0])
        : anthropic.messages.stream(request as unknown as Parameters<typeof anthropic.messages.stream>[0]);
      return (await stream.finalMessage()) as unknown as MessageLike;
    }
    return (betas.length > 0
      ? await anthropic.beta.messages.create({ ...request, betas } as unknown as Parameters<typeof anthropic.beta.messages.create>[0])
      : await anthropic.messages.create(request as unknown as Parameters<typeof anthropic.messages.create>[0])) as unknown as MessageLike;
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();

  const tokensIn = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0);
  const tokensOut = res.usage.output_tokens;

  return {
    text,
    model,
    tokensIn,
    tokensOut,
    costUsd: calcCost(model, tokensIn, tokensOut),
    durationMs: Date.now() - started,
    stopReason: res.stop_reason,
  };
}
