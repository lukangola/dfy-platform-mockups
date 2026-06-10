/**
 * Static ad reference library.
 *
 *   GET    /api/static-ad-references            — list all, newest first
 *   POST   /api/static-ad-references            — create a reference manually { imageUrl, title, niche }
 *                                                  or { dataUrl, filename, niche, title? } to upload a file
 *   POST   /api/static-ad-references/:id/deconstruct — re-run the deconstruction pipeline
 *   DELETE /api/static-ad-references/:id        — remove one entry
 *
 * Each reference has a JSON deconstruction produced by the `static_ad_deconstruct`
 * master prompt (vision input). The deconstruction is fired async on create.
 */
import { desc, eq, inArray, isNull } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { db, schema } from "../lib/db.js";
import { uploadToFalStorage } from "../lib/fal.js";
import { extractJsonObject } from "../lib/jsonExtract.js";
import { loadPrompt, PromptNotConfiguredError } from "../lib/prompts.js";
import { ingestStaticAdLibrary } from "../lib/staticAdIngest.js";
import { buildStaticAdThumbnail } from "../lib/staticAdThumbnails.js";

export const staticAdReferencesRouter: Router = Router();

const DECONSTRUCT_ACTION = "static_ad_deconstruct";
const CLASSIFY_ACTION = "static_ad_classify_niche";

// Closed set mirrored from prompts/static_ad_classify_niche.md. Anything outside
// this set is coerced to "other" so the filter UI never sees free-form noise.
const NICHE_SET = new Set([
  "supplements",
  "skincare",
  "haircare",
  "beauty",
  "bodycare",
  "oralcare",
  "fitness",
  "food_beverage",
  "pet",
  "household",
  "apparel",
  "electronics",
  "other",
]);

// Niches that should be re-classified when a backfill is fired.
const UNCLASSIFIED_NICHES = ["unassigned", "other", ""];

/**
 * Background-job concurrency gate. Anthropic enforces a per-account concurrent-
 * connection cap and fans out of `void runX(id)` across 200+ rows on boot
 * trivially hits it (every overflow becomes a 429 and a "failed" row in the
 * UI). We cap inflight work at a small number and queue the rest.
 */
class Semaphore {
  private inflight = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inflight >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.inflight++;
    try {
      return await fn();
    } finally {
      this.inflight--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const anthropicGate = new Semaphore(3);

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate_limit_error|overloaded|concurrent connections/i.test(msg);
}

/**
 * Retries a call on 429/overloaded errors with exponential backoff (capped at
 * 6 attempts ≈ 63s total wait). Other errors fall through immediately.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts || !isRateLimitError(err)) throw err;
      const delayMs = Math.min(32_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      console.warn(`[static-ads] ${label} hit rate limit (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("unreachable");
}

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

/**
 * POST /api/static-ad-references/rescan — re-scans the library folder on
 * demand (boot-time ingest misses files added after the server started).
 * Returns the list of newly ingested / re-ingested IDs.
 */
staticAdReferencesRouter.post("/rescan", async (_req: Request, res: Response) => {
  try {
    const ids = await ingestStaticAdLibrary();
    for (const id of ids) {
      void runDeconstruction(id);
      void runNicheClassification(id);
    }
    res.json({ ok: true, ingested: ids.length, ids });
  } catch (err) {
    console.error("[static-ad-refs] rescan failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/static-ad-references/backfill-niches
 * Re-classifies every reference whose niche is still "unassigned" or "other"
 * (or empty). Fires classifications in the background and returns the id list
 * immediately so the caller can poll for updates.
 */
staticAdReferencesRouter.post("/backfill-niches", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({ id: schema.staticAdReferences.id })
      .from(schema.staticAdReferences)
      .where(inArray(schema.staticAdReferences.niche, UNCLASSIFIED_NICHES));
    for (const row of rows) void runNicheClassification(row.id);
    res.json({ ok: true, queued: rows.length, ids: rows.map((r) => r.id) });
  } catch (err) {
    console.error("[static-ad-refs] backfill failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/static-ad-references/backfill-thumbnails
 * Generates the small grid thumbnail for every row whose thumbnailUrl is
 * still NULL. Runs in the background and reports queued count immediately.
 * Sharp is CPU-bound + the upload is I/O — we cap concurrency at 4 to keep
 * the API responsive while we churn through dozens of refs.
 */
staticAdReferencesRouter.post("/backfill-thumbnails", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: schema.staticAdReferences.id,
        imageUrl: schema.staticAdReferences.imageUrl,
        sourcePath: schema.staticAdReferences.sourcePath,
      })
      .from(schema.staticAdReferences)
      .where(isNull(schema.staticAdReferences.thumbnailUrl));
    void runThumbnailBackfill(rows);
    res.json({ ok: true, queued: rows.length, ids: rows.map((r) => r.id) });
  } catch (err) {
    console.error("[static-ad-refs] backfill-thumbnails failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/static-ad-references/retry-failed
 * Re-runs deconstruction on every row whose last attempt failed (typically
 * from 429 rate-limit errors on boot). Queues through the concurrency gate
 * so we don't recreate the fan-out problem.
 */
staticAdReferencesRouter.post("/retry-failed", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({ id: schema.staticAdReferences.id })
      .from(schema.staticAdReferences)
      .where(eq(schema.staticAdReferences.deconstructionStatus, "failed"));
    for (const row of rows) void runDeconstruction(row.id);
    res.json({ ok: true, queued: rows.length, ids: rows.map((r) => r.id) });
  } catch (err) {
    console.error("[static-ad-refs] retry-failed failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

staticAdReferencesRouter.get("/", async (_req: Request, res: Response) => {
  try {
    // Explicit column projection — the `deconstruction` JSON column can be
    // 5–20KB per row; multiplied across 50+ references that's a noticeable
    // payload that the grid never reads (it only needs id, title, niche,
    // image, status). Fetch the full deconstruction on demand via GET /:id.
    const rows = await db
      .select({
        id: schema.staticAdReferences.id,
        createdAt: schema.staticAdReferences.createdAt,
        title: schema.staticAdReferences.title,
        niche: schema.staticAdReferences.niche,
        imageUrl: schema.staticAdReferences.imageUrl,
        thumbnailUrl: schema.staticAdReferences.thumbnailUrl,
        deconstructionStatus: schema.staticAdReferences.deconstructionStatus,
      })
      .from(schema.staticAdReferences)
      .orderBy(desc(schema.staticAdReferences.createdAt));
    res.json({ references: rows });
  } catch (err) {
    console.error("[static-ad-refs] list failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

staticAdReferencesRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.staticAdReferences)
      .where(eq(schema.staticAdReferences.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Reference not found");
    res.json({ reference: row });
  } catch (err) {
    console.error("[static-ad-refs] get failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

staticAdReferencesRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      imageUrl?: string;
      dataUrl?: string;
      filename?: string;
      title?: string;
      niche?: string;
    };
    const niche = (body.niche ?? "").trim() || "other";

    let imageUrl: string;
    let title: string;
    // Filename used as the basename for the thumb upload (e.g. `foo.png` →
    // `foo-thumb.webp`). When we accept a remote imageUrl we derive it from
    // the URL's last path segment.
    let baseFilename: string;

    if (body.imageUrl && typeof body.imageUrl === "string") {
      imageUrl = body.imageUrl.trim();
      title = (body.title ?? "").trim() || `${niche} reference`;
      try {
        const u = new URL(imageUrl);
        baseFilename = (u.pathname.split("/").pop() || `ref-${Date.now()}.png`) || `ref-${Date.now()}.png`;
      } catch {
        baseFilename = `ref-${Date.now()}.png`;
      }
    } else if (body.dataUrl && typeof body.dataUrl === "string") {
      const decoded = decodeDataUrl(body.dataUrl);
      if (!decoded) return sendError(res, 400, "dataUrl is not a valid base64 data URL");
      const filename = body.filename?.trim() || `upload-${Date.now()}.png`;
      imageUrl = await uploadToFalStorage(decoded.buffer, decoded.mime, filename);
      title = (body.title ?? "").trim() || filename.replace(/\.[^.]+$/, "");
      baseFilename = filename;
    } else {
      return sendError(res, 400, "Provide either imageUrl or dataUrl");
    }

    // Build the thumbnail eagerly so the row lands with both URLs and the
    // grid never has to scramble. Failure is non-fatal — the row still gets
    // created, frontend just falls back to imageUrl.
    let thumbnailUrl: string | null = null;
    try {
      thumbnailUrl = await buildStaticAdThumbnail(imageUrl, baseFilename);
    } catch (thumbErr) {
      console.warn(`[static-ad-refs] thumbnail build failed for new reference (non-fatal):`, thumbErr);
    }

    const [row] = await db
      .insert(schema.staticAdReferences)
      .values({
        title,
        niche,
        imageUrl,
        thumbnailUrl,
        deconstructionStatus: "pending",
      })
      .returning();

    if (row) {
      void runDeconstruction(row.id);
      // Only auto-classify when the user didn't provide an explicit, valid niche.
      if (!NICHE_SET.has(row.niche) || row.niche === "other" || row.niche === "unassigned") {
        void runNicheClassification(row.id);
      }
    }
    res.json({ reference: row });
  } catch (err) {
    console.error("[static-ad-refs] create failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

staticAdReferencesRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { title?: string; niche?: string };
    const patch: { title?: string; niche?: string } = {};
    if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
    if (typeof body.niche === "string" && body.niche.trim()) patch.niche = body.niche.trim();
    if (Object.keys(patch).length === 0) return sendError(res, 400, "Nothing to update");

    const [updated] = await db
      .update(schema.staticAdReferences)
      .set(patch)
      .where(eq(schema.staticAdReferences.id, req.params.id))
      .returning();
    if (!updated) return sendError(res, 404, "Reference not found");
    res.json({ reference: updated });
  } catch (err) {
    console.error("[static-ad-refs] patch failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

staticAdReferencesRouter.post("/:id/deconstruct", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.staticAdReferences)
      .where(eq(schema.staticAdReferences.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Reference not found");

    await db
      .update(schema.staticAdReferences)
      .set({ deconstructionStatus: "running", deconstructionError: null })
      .where(eq(schema.staticAdReferences.id, row.id));

    void runDeconstruction(row.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[static-ad-refs] retrigger failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

staticAdReferencesRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await db
      .delete(schema.staticAdReferences)
      .where(eq(schema.staticAdReferences.id, req.params.id))
      .returning();
    if (deleted.length === 0) return sendError(res, 404, "Reference not found");
    res.json({ ok: true });
  } catch (err) {
    console.error("[static-ad-refs] delete failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * Runs the `static_ad_deconstruct` master prompt against the reference image
 * and stores the parsed JSON output on the row. Markdown code fences are
 * stripped. If the prompt file is missing, the job records a clear error and
 * leaves the status as "failed" so the UI can surface it.
 */
export async function runDeconstruction(id: string): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(schema.staticAdReferences)
      .where(eq(schema.staticAdReferences.id, id))
      .limit(1);
    if (!row) return;

    await db
      .update(schema.staticAdReferences)
      .set({ deconstructionStatus: "running", deconstructionError: null })
      .where(eq(schema.staticAdReferences.id, id));

    let prompt: ReturnType<typeof loadPrompt>;
    try {
      prompt = loadPrompt(DECONSTRUCT_ACTION, { niche: row.niche, title: row.title });
    } catch (err) {
      if (err instanceof PromptNotConfiguredError) {
        await db
          .update(schema.staticAdReferences)
          .set({
            deconstructionStatus: "failed",
            deconstructionError: err.message,
          })
          .where(eq(schema.staticAdReferences.id, id));
        console.warn(`[static-ads] prompt not configured for ${DECONSTRUCT_ACTION} — skipping ${id}`);
        return;
      }
      throw err;
    }

    const httpsUrl = row.imageUrl.replace(/^http:\/\//, "https://");

    const result = await anthropicGate.run(() =>
      withRateLimitRetry(
        () =>
          generateText({
            systemPrompt: prompt.rendered,
            userMessage: `Deconstruct this static ad. Niche: ${row.niche}. Title: ${row.title}. Return the structured output as specified in the system prompt.`,
            model: prompt.config.model,
            maxTokens: prompt.config.maxTokens ?? 8000,
            imageUrls: [httpsUrl],
          }),
        `deconstruct ${id}`,
      ),
    );

    const cleaned = result.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let deconstruction: unknown;
    if (prompt.config.expectsJson) {
      try {
        deconstruction = extractJsonObject(result.text, {
          stopReason: result.stopReason,
          action: "Deconstruction",
        });
      } catch (err) {
        console.error(
          `[staticAdReferences] deconstruction parse failed for ref ${id}.\n` +
          `stop_reason=${result.stopReason} tokensOut=${result.tokensOut}\n` +
          `RAW OUTPUT:\n${result.text}`
        );
        throw err;
      }
    } else {
      // Prompt returns free-form text + optional JSON block — store the whole
      // response as { raw } so downstream consumers can parse as they wish.
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      deconstruction = {
        raw: cleaned,
        json: jsonMatch ? safeParse(jsonMatch[0]) : null,
      };
    }

    await db
      .update(schema.staticAdReferences)
      .set({
        deconstruction: deconstruction as Record<string, unknown>,
        deconstructionStatus: "complete",
        deconstructionError: null,
        deconstructionGeneratedAt: new Date(),
        promptVersion: prompt.version,
        model: result.model,
      })
      .where(eq(schema.staticAdReferences.id, id));

    await db.insert(schema.generations).values({
      action: DECONSTRUCT_ACTION,
      kind: "text",
      inputs: { referenceId: id, imageUrl: row.imageUrl, niche: row.niche },
      output: deconstruction as Record<string, unknown>,
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      durationMs: result.durationMs,
    });

    console.log(`[static-ads] deconstructed ${id} (${result.durationMs}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[static-ads] deconstruction failed for ${id}:`, err);
    await db
      .update(schema.staticAdReferences)
      .set({ deconstructionStatus: "failed", deconstructionError: msg })
      .where(eq(schema.staticAdReferences.id, id));
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Classifies a reference into one of the closed niche buckets (see NICHE_SET)
 * using a cheap vision call. Writes the result back to the row's `niche`
 * column. Fails silently (logs + leaves existing niche untouched) — this is a
 * best-effort tagger, not a hard dependency.
 */
export async function runNicheClassification(id: string): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(schema.staticAdReferences)
      .where(eq(schema.staticAdReferences.id, id))
      .limit(1);
    if (!row) return;

    let prompt: ReturnType<typeof loadPrompt>;
    try {
      prompt = loadPrompt(CLASSIFY_ACTION);
    } catch (err) {
      if (err instanceof PromptNotConfiguredError) {
        console.warn(`[static-ads] niche classifier prompt not configured — skipping ${id}`);
        return;
      }
      throw err;
    }

    const httpsUrl = row.imageUrl.replace(/^http:\/\//, "https://");
    const result = await anthropicGate.run(() =>
      withRateLimitRetry(
        () =>
          generateText({
            systemPrompt: prompt.rendered,
            userMessage: "Classify the niche of this static ad. Output only the JSON object specified.",
            model: prompt.config.model ?? "claude-haiku-4-5",
            maxTokens: prompt.config.maxTokens ?? 200,
            imageUrls: [httpsUrl],
          }),
        `classify ${id}`,
      ),
    );

    const cleaned = result.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: { niche?: unknown } = {};
    try {
      parsed = extractJsonObject<{ niche?: unknown }>(result.text, {
        stopReason: result.stopReason,
        action: "Niche classifier",
      });
    } catch {
      // Niche classification is best-effort — leave parsed = {} on failure.
    }

    const raw = typeof parsed.niche === "string" ? parsed.niche.trim().toLowerCase() : "";
    const niche = NICHE_SET.has(raw) ? raw : "other";

    await db
      .update(schema.staticAdReferences)
      .set({ niche })
      .where(eq(schema.staticAdReferences.id, id));

    console.log(`[static-ads] classified ${id} → ${niche} (${result.durationMs}ms)`);
  } catch (err) {
    console.error(`[static-ads] niche classification failed for ${id}:`, err);
  }
}

/**
 * Background worker that walks a batch of references missing thumbnails
 * and builds one for each. Concurrency capped to keep memory + bandwidth
 * usage bounded — sharp resize buffers can be tens of MB peak for large
 * source images. Boot-time auto-backfill calls this on startup.
 */
export async function runThumbnailBackfill(
  rows: { id: string; imageUrl: string; sourcePath: string | null }[],
): Promise<void> {
  if (rows.length === 0) return;
  const concurrency = 4;
  let cursor = 0;
  let built = 0;
  let failed = 0;
  console.log(`[static-ads] thumbnail backfill: queued ${rows.length} reference(s)`);

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= rows.length) return;
      const row = rows[idx];
      try {
        const base = row.sourcePath || `ref-${row.id.slice(0, 8)}.png`;
        const thumbnailUrl = await buildStaticAdThumbnail(row.imageUrl, base);
        await db
          .update(schema.staticAdReferences)
          .set({ thumbnailUrl })
          .where(eq(schema.staticAdReferences.id, row.id));
        built++;
      } catch (err) {
        failed++;
        console.warn(`[static-ads] thumbnail backfill failed for ${row.id}:`, err);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`[static-ads] thumbnail backfill done — built ${built}, failed ${failed}`);
}

/**
 * Boot-time entry point — finds every reference with no thumbnail and
 * builds one. Safe to call repeatedly; rows that already have a thumb are
 * filtered out by the SQL predicate.
 */
export async function backfillMissingThumbnails(): Promise<void> {
  const rows = await db
    .select({
      id: schema.staticAdReferences.id,
      imageUrl: schema.staticAdReferences.imageUrl,
      sourcePath: schema.staticAdReferences.sourcePath,
    })
    .from(schema.staticAdReferences)
    .where(isNull(schema.staticAdReferences.thumbnailUrl));
  await runThumbnailBackfill(rows);
}
