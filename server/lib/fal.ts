import { fal } from "@fal-ai/client";
import { env } from "./env.js";
import { formatError } from "./formatError.js";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!env.FAL_KEY) {
    throw new Error("FAL_KEY not set. Paste your fal.ai key in .env.local.");
  }
  fal.config({ credentials: env.FAL_KEY });
  configured = true;
}

/**
 * Upload a file buffer to fal.storage and return the public URL.
 * Used for user-supplied product shots and reference images so fal.ai models can read them.
 */
export async function uploadToFalStorage(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  ensureConfigured();
  const file = new File([new Uint8Array(buffer)], filename, { type: mimeType });
  const url = await fal.storage.upload(file);
  return url;
}

export type MediaGenResult = {
  urls: string[];
  raw: unknown;
  model: string;
  durationMs: number;
};

/**
 * Custom error class for fal.ai content-safety rejections (HTTP 422).
 * Lets callers / route handlers distinguish "Gemini said no" from generic
 * fal.ai errors and bubble a specific status to the client so the UI can
 * trigger its auto-soften-and-retry flow.
 *
 * `body` preserves the original fal error body (e.g. the validation
 * `detail[]` array). Previously this class swallowed it, which blinded the
 * downstream diagnostic dig in runReferenceSheetGeneration — every 422 came
 * out as the useless "HTTP 422: Unprocessable Entity" with no field-level
 * reason. Carry the body so callers can persist what actually went wrong.
 */
export class FalContentSafetyError extends Error {
  status = 422;
  body?: unknown;
  constructor(message: string, body?: unknown) {
    super(message);
    this.name = "FalContentSafetyError";
    this.body = body;
  }
}

/**
 * nano-banana-pro (Gemini 3 Pro Image) intermittently returns a 422 that is
 * NOT a hard content block — the model just fails to produce an image for an
 * otherwise valid, benign request ("did not generate the expected output" /
 * "could not generate images with the given prompts and images"). Re-running
 * the IDENTICAL input usually succeeds (measured: ~1-in-3 to ~1-in-5 of these
 * calls refuse, and a retry clears it). We classify those so generateImage can
 * transparently retry instead of killing the whole pipeline on the first flake.
 *
 * A genuine policy block produces the same message but refuses every time —
 * retries are bounded, so we burn a couple of extra attempts then surface it
 * as a FalContentSafetyError exactly as before (the client's soften-and-retry
 * flow then kicks in). False-retrying a hard block costs a little; NOT
 * retrying a transient flake costs the user a "FAILED" on valid input.
 */
export function isTransientGenerationRefusal(status: number | undefined, msg: string): boolean {
  if (status !== 422) return false;
  return /did not generate the expected output|could not generate images with the given|try again with different inputs|model did not generate/i.test(
    msg,
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Generate image(s) via fal.ai. Model defaults to flux-pro.
 * `input` is the fal.ai model-specific payload.
 *
 * `retries` — how many EXTRA attempts to make when fal returns a transient
 * generation-refusal 422 (see isTransientGenerationRefusal). Defaults to 2
 * (so 3 attempts total). Only transient refusals are retried; auth /
 * validation / network errors fail immediately. Set to 0 to disable.
 */
export async function generateImage(args: {
  model?: string;
  input: Record<string, unknown>;
  retries?: number;
}): Promise<MediaGenResult> {
  ensureConfigured();
  const model = args.model ?? "fal-ai/flux-pro/v1.1";
  const maxRetries = Math.max(0, args.retries ?? 2);

  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const result = await fal.subscribe(model, {
        input: args.input,
        logs: false,
        pollInterval: 500,
      });

      const data = result.data as { images?: Array<{ url: string }>; image?: { url: string } };
      const urls = data.images?.map((i) => i.url) ?? (data.image ? [data.image.url] : []);

      return { urls, raw: result.data, model, durationMs: Date.now() - started };
    } catch (err) {
      // `@fal-ai/client` rejects with plain objects shaped like
      //   { status: 422, body: { detail: [{ loc, msg, type }] } }
      // formatError() unwraps those nested shapes (incl. the validation
      // `detail[]` array) so we never lose the real reason to a bare
      // "[object Object]" or "Unprocessable Entity" again.
      const e = err as { status?: number; body?: unknown; message?: string };
      const status = e?.status;
      const msg = formatError(err);

      // Transient nano-banana / Gemini refusal on valid input → retry the
      // IDENTICAL request a bounded number of times before giving up. This
      // is the single biggest source of spurious "FAILED" states in the
      // B-roll reference-sheet pipeline.
      if (isTransientGenerationRefusal(status, msg) && attempt < maxRetries) {
        console.warn(
          `[fal] ${model} transient generation-refusal (attempt ${attempt + 1}/${maxRetries + 1}), retrying: ${msg.slice(0, 140)}`,
        );
        await sleep(1500 * (attempt + 1));
        continue;
      }

      // Out of retries, or a non-retryable error. Gemini-backed 422s
      // surface as a typed FalContentSafetyError so the route handler can
      // return 422 (not 500) and trigger the client's sanitize-and-retry
      // flow. We now carry the original fal `body` on the error so the
      // downstream diagnostic dig can still report the field-level reason.
      if (status === 422 || /did not generate the expected output|unsafe content|content policy/i.test(msg)) {
        throw new FalContentSafetyError(msg, e?.body);
      }
      // Other errors (auth, network, missing input). `@fal-ai/client`
      // rejects with plain objects, so wrap non-Error rejections in a real
      // Error — otherwise `err instanceof Error` is false downstream and
      // `String(err)` renders "[object Object]". Preserve status + body.
      if (err instanceof Error) {
        if (status !== undefined && (err as Error & { status?: number }).status === undefined) {
          (err as Error & { status?: number }).status = status;
        }
        if (e?.body !== undefined && (err as Error & { body?: unknown }).body === undefined) {
          (err as Error & { body?: unknown }).body = e.body;
        }
        throw err;
      }
      const wrapped = new Error(`fal.ai (${model}) failed: ${msg}`);
      if (status !== undefined) (wrapped as Error & { status?: number }).status = status;
      if (e?.body !== undefined) (wrapped as Error & { body?: unknown }).body = e.body;
      throw wrapped;
    }
  }
}

/**
 * Transcribe an audio/video file via fal.ai's whisper model.
 * Pass either a fal.storage URL (preferred — no upload roundtrip) or a
 * buffer (auto-uploaded first). Returns the full transcript text plus the
 * detected language. Used by the Listicle Builder "winning ad" workflow
 * to read the audio track off uploaded video ads.
 *
 * fal-ai/whisper model docs: https://fal.ai/models/fal-ai/whisper
 */
export async function transcribeAudio(args: {
  audioUrl?: string;
  buffer?: Buffer;
  mimeType?: string;
  filename?: string;
  language?: string;
}): Promise<{ text: string; language?: string; chunks?: unknown; durationMs: number }> {
  ensureConfigured();
  const started = Date.now();
  let audioUrl = args.audioUrl;
  if (!audioUrl) {
    if (!args.buffer) throw new Error("transcribeAudio: either audioUrl or buffer required");
    audioUrl = await uploadToFalStorage(
      args.buffer,
      args.mimeType ?? "audio/mpeg",
      args.filename ?? "audio",
    );
  }
  const result = await fal.subscribe("fal-ai/whisper", {
    // fal's typed whisperInput uses a strict ISO-language-code union for
    // `language`; we accept arbitrary strings at our boundary, so the
    // input object is built dynamically + the whole call is cast to keep
    // TypeScript happy without dragging the ISO union into our public API.
    input: {
      audio_url: audioUrl,
      task: "transcribe",
      ...(args.language ? { language: args.language } : {}),
    } as unknown as Parameters<typeof fal.subscribe>[1]["input"],
    logs: false,
    pollInterval: 500,
  });
  const data = result.data as { text?: string; chunks?: unknown; inferred_languages?: string[] };
  const text = (data.text ?? "").trim();
  const language = data.inferred_languages?.[0];
  return { text, language, chunks: data.chunks, durationMs: Date.now() - started };
}

/**
 * Generate video via fal.ai. Model defaults to veo3 fast; override per-action as needed.
 */
export async function generateVideo(args: {
  model?: string;
  input: Record<string, unknown>;
}): Promise<MediaGenResult> {
  ensureConfigured();
  const model = args.model ?? "fal-ai/veo3/fast";
  const started = Date.now();

  try {
    const result = await fal.subscribe(model, {
      input: args.input,
      logs: false,
      pollInterval: 500,
    });

    const data = result.data as { video?: { url: string }; videos?: Array<{ url: string }> };
    const urls = data.video ? [data.video.url] : data.videos?.map((v) => v.url) ?? [];

    return { urls, raw: result.data, model, durationMs: Date.now() - started };
  } catch (err) {
    // Same plain-object-rejection problem as generateImage — wrap the
    // SDK error so downstream callers always see a real Error with a
    // useful message instead of the literal "[object Object]" that
    // String() produces on a fal-SDK plain-object rejection.
    if (err instanceof Error) throw err;
    const e = err as { status?: number };
    const wrapped = new Error(`fal.ai (${model}) failed: ${formatError(err)}`);
    if (e?.status !== undefined) (wrapped as Error & { status?: number }).status = e.status;
    throw wrapped;
  }
}
