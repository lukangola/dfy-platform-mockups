/**
 * Character library — reference photos of on-camera subjects for the
 * Character B-roll app. Two-tier ownership:
 *
 *   - `brandId IS NULL`  → default / shared library (every brand sees it),
 *                          ingested from `client/public/characters/library/`.
 *   - `brandId = <uuid>` → brand-private, uploaded via the UI.
 *
 * Endpoints:
 *
 *   GET    /api/characters?brandId=<uuid>  — returns { defaults: [...], brand: [...] }
 *                                            (`brandId` query is required so the
 *                                            response is filtered server-side)
 *   POST   /api/characters                  — create a brand-private character
 *                                            { brandId, dataUrl, filename, title? }
 *   POST   /api/characters/rescan           — re-scan the seed folder on demand
 *   DELETE /api/characters/:id              — remove a brand-private character.
 *                                            Default-library rows (brandId NULL)
 *                                            are protected and return 403.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import { uploadToFalStorage } from "../lib/fal.js";
import { ingestCharacterLibrary } from "../lib/characterIngest.js";
import { prepareCharacterForSeedance } from "../lib/characterSeedancePrep.js";

export const charactersRouter: Router = Router();

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

charactersRouter.post("/rescan", async (_req: Request, res: Response) => {
  try {
    const ids = await ingestCharacterLibrary();
    res.json({ ok: true, ingested: ids.length, ids });
  } catch (err) {
    console.error("[characters] rescan failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * GET /api/characters?brandId=<uuid>
 *
 * Returns the merged library for the picker. Splits the response into
 * `defaults` (shared, brandId NULL) and `brand` (brand-private rows only)
 * so the UI can render two distinct sections without re-filtering.
 *
 * If `brandId` is omitted, only defaults are returned.
 */
charactersRouter.get("/", async (req: Request, res: Response) => {
  try {
    const brandId = typeof req.query.brandId === "string" ? req.query.brandId.trim() : "";

    const defaults = await db
      .select()
      .from(schema.characters)
      .where(isNull(schema.characters.brandId))
      .orderBy(desc(schema.characters.createdAt));

    const brand = brandId
      ? await db
          .select()
          .from(schema.characters)
          .where(eq(schema.characters.brandId, brandId))
          .orderBy(desc(schema.characters.createdAt))
      : [];

    res.json({ defaults, brand });
  } catch (err) {
    console.error("[characters] list failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

charactersRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      brandId?: string;
      dataUrl?: string;
      filename?: string;
      title?: string;
    };

    const brandId = (body.brandId ?? "").trim();
    if (!brandId) return sendError(res, 400, "brandId is required for uploads");

    if (!body.dataUrl) return sendError(res, 400, "dataUrl is required");
    const decoded = decodeDataUrl(body.dataUrl);
    if (!decoded) return sendError(res, 400, "dataUrl is not a valid base64 data URL");

    const filename = body.filename?.trim() || `character-${Date.now()}.png`;
    const imageUrl = await uploadToFalStorage(decoded.buffer, decoded.mime, filename);
    const title = (body.title ?? "").trim() || filename.replace(/\.[^.]+$/, "");

    const [row] = await db
      .insert(schema.characters)
      .values({ brandId, title, imageUrl })
      .returning();

    // Fire the 2-step Seedance prep async so the row gets a synthetic portrait
    // before the user attempts video generation. The endpoint returns
    // immediately; the frontend can poll the row to see when status flips to
    // "complete".
    if (row) void prepareCharacterForSeedance(row.id);

    res.json({ character: row });
  } catch (err) {
    console.error("[characters] create failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/characters/:id/prepare-seedance
 *
 * Manually re-runs the 2-step Seedance prep pipeline for a character. Useful
 * when the previous attempt failed (status=failed) or when the upstream
 * prompts have changed and we want to regenerate. Always force-reruns;
 * idempotent skip-if-complete is bypassed.
 */
charactersRouter.post("/:id/prepare-seedance", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select({ id: schema.characters.id })
      .from(schema.characters)
      .where(eq(schema.characters.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Character not found");

    void prepareCharacterForSeedance(row.id, { force: true });
    res.json({ ok: true, queued: true });
  } catch (err) {
    console.error("[characters] prepare-seedance trigger failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

charactersRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    // Protect default-library rows so a brand-private user can't accidentally
    // delete a shared character. Re-ingest from the folder on next boot is
    // idempotent, but exposing the endpoint would let any brand wipe the seed.
    const [row] = await db
      .select({ id: schema.characters.id, brandId: schema.characters.brandId })
      .from(schema.characters)
      .where(eq(schema.characters.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Character not found");
    if (row.brandId === null) {
      return sendError(res, 403, "Default-library characters cannot be deleted via the API");
    }

    await db
      .delete(schema.characters)
      .where(and(eq(schema.characters.id, req.params.id), eq(schema.characters.brandId, row.brandId)));
    res.json({ ok: true });
  } catch (err) {
    console.error("[characters] delete failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
