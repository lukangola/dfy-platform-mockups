import { fal } from "@fal-ai/client";
import { env } from "./env.js";

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
 */
export class FalContentSafetyError extends Error {
  status = 422;
  constructor(message: string) {
    super(message);
    this.name = "FalContentSafetyError";
  }
}

/**
 * Generate image(s) via fal.ai. Model defaults to flux-pro.
 * `input` is the fal.ai model-specific payload.
 */
export async function generateImage(args: {
  model?: string;
  input: Record<string, unknown>;
}): Promise<MediaGenResult> {
  ensureConfigured();
  const model = args.model ?? "fal-ai/flux-pro/v1.1";
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
    // Gemini's safety classifier rejects the prompt → fal returns 422 with
    // the "did not generate the expected output" body. Re-throw as a typed
    // error so the route handler can return 422 (instead of 500) and the
    // client knows to trigger its sanitize-and-retry flow. Other errors
    // (auth, network, missing input) propagate untouched.
    const e = err as { status?: number; body?: { detail?: string }; message?: string };
    const status = e?.status;
    const msg = e?.body?.detail ?? e?.message ?? String(err);
    if (status === 422 || /did not generate the expected output|unsafe content|content policy/i.test(msg)) {
      throw new FalContentSafetyError(msg);
    }
    throw err;
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

  const result = await fal.subscribe(model, {
    input: args.input,
    logs: false,
    pollInterval: 500,
  });

  const data = result.data as { video?: { url: string }; videos?: Array<{ url: string }> };
  const urls = data.video ? [data.video.url] : data.videos?.map((v) => v.url) ?? [];

  return { urls, raw: result.data, model, durationMs: Date.now() - started };
}
