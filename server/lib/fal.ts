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

  const result = await fal.subscribe(model, {
    input: args.input,
    logs: false,
  });

  const data = result.data as { images?: Array<{ url: string }>; image?: { url: string } };
  const urls = data.images?.map((i) => i.url) ?? (data.image ? [data.image.url] : []);

  return { urls, raw: result.data, model, durationMs: Date.now() - started };
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
  });

  const data = result.data as { video?: { url: string }; videos?: Array<{ url: string }> };
  const urls = data.video ? [data.video.url] : data.videos?.map((v) => v.url) ?? [];

  return { urls, raw: result.data, model, durationMs: Date.now() - started };
}
