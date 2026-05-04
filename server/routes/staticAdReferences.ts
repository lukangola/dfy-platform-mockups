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
import { desc, eq, inArray } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { db, schema } from "../lib/db.js";
import { uploadToFalStorage } from "../lib/fal.js";
import { loadPrompt, PromptNotConfiguredError } from "../lib/prompts.js";
import { ingestStaticAdLibrary } from "../lib/staticAdIngest.js";

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
    const rows = await db
      .select()
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

    if (body.imageUrl && typeof body.imageUrl === "string") {
      imageUrl = body.imageUrl.trim();
      title = (body.title ?? "").trim() || `${niche} reference`;
    } else if (body.dataUrl && typeof body.dataUrl === "string") {
      const decoded = decodeDataUrl(body.dataUrl);
      if (!decoded) return sendError(res, 400, "dataUrl is not a valid base64 data URL");
      const filename = body.filename?.trim() || `upload-${Date.now()}.png`;
      imageUrl = await uploadToFalStorage(decoded.buffer, decoded.mime, filename);
      title = (body.title ?? "").trim() || filename.replace(/\.[^.]+$/, "");
    } else {
      return sendError(res, 400, "Provide either imageUrl or dataUrl");
    }

    const [row] = await db
      .insert(schema.staticAdReferences)
      .values({
        title,
        niche,
        imageUrl,
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
        deconstruction = JSON.parse(cleaned);
      } catch {
        // Fallback: try to extract the first {...} block.
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (!m) throw new Error(`Deconstruction returned non-JSON: ${cleaned.slice(0, 200)}…`);
        deconstruction = JSON.parse(m[0]);
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
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { parsed = {}; }
      }
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
