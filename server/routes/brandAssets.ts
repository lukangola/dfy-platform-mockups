/**
 * Brand Assets library.
 *
 *   GET    /api/brand-assets       — list all, newest first
 *   POST   /api/brand-assets       — insert one asset OR a batch via { assets: [...] }
 *   DELETE /api/brand-assets/:id   — remove one entry
 *
 * Entries point at fal.ai CDN URLs which are already persistent — we store
 * pointers + metadata only, never re-host the bytes.
 */
import { desc, eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import type { NewBrandAsset } from "../db/schema.js";

export const brandAssetsRouter: Router = Router();

type IncomingAsset = {
  brandId: string;
  kind: "image" | "video" | "document";
  url: string;
  title: string;
  sourceApp: string;
  thumbnailUrl?: string | null;
  productId?: string | null;
  metadata?: Record<string, unknown> | null;
};

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function validateAsset(a: unknown, fallbackBrandId: string | null): IncomingAsset | string {
  if (!a || typeof a !== "object") return "asset must be an object";
  const obj = a as Record<string, unknown>;
  if (obj.kind !== "image" && obj.kind !== "video" && obj.kind !== "document")
    return "kind must be 'image', 'video', or 'document'";
  if (typeof obj.url !== "string" || !obj.url.trim()) return "url is required";
  if (typeof obj.title !== "string" || !obj.title.trim()) return "title is required";
  if (typeof obj.sourceApp !== "string" || !obj.sourceApp.trim()) return "sourceApp is required";
  const brandId = typeof obj.brandId === "string" && obj.brandId.trim()
    ? obj.brandId.trim()
    : fallbackBrandId;
  if (!brandId) return "brandId is required";
  return {
    brandId,
    kind: obj.kind,
    url: obj.url.trim(),
    title: obj.title.trim(),
    sourceApp: obj.sourceApp.trim(),
    thumbnailUrl: typeof obj.thumbnailUrl === "string" ? obj.thumbnailUrl : null,
    productId: typeof obj.productId === "string" ? obj.productId : null,
    metadata: obj.metadata && typeof obj.metadata === "object" ? (obj.metadata as Record<string, unknown>) : null,
  };
}

brandAssetsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const brandId = typeof req.query.brandId === "string" ? req.query.brandId : "";
    if (!brandId) return sendError(res, 400, "brandId query param is required");
    const rows = await db
      .select()
      .from(schema.brandAssets)
      .where(eq(schema.brandAssets.brandId, brandId))
      .orderBy(desc(schema.brandAssets.createdAt));
    res.json({ assets: rows });
  } catch (err) {
    console.error("[brand-assets] list failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

brandAssetsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const topLevelBrandId = typeof body.brandId === "string" ? body.brandId : null;
    const incoming: unknown[] = Array.isArray(body.assets)
      ? body.assets
      : Array.isArray(body)
        ? body
        : [body];
    if (incoming.length === 0) return sendError(res, 400, "No assets provided");

    const validated: NewBrandAsset[] = [];
    for (const a of incoming) {
      const v = validateAsset(a, topLevelBrandId);
      if (typeof v === "string") return sendError(res, 400, v);
      validated.push({
        brandId: v.brandId,
        kind: v.kind,
        url: v.url,
        title: v.title,
        sourceApp: v.sourceApp,
        thumbnailUrl: v.thumbnailUrl ?? undefined,
        productId: v.productId ?? undefined,
        metadata: v.metadata ?? undefined,
      });
    }

    const inserted = await db.insert(schema.brandAssets).values(validated).returning();
    res.json({ assets: inserted });
  } catch (err) {
    console.error("[brand-assets] insert failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

brandAssetsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await db
      .delete(schema.brandAssets)
      .where(eq(schema.brandAssets.id, req.params.id))
      .returning();
    if (deleted.length === 0) return sendError(res, 404, "Asset not found");
    res.json({ ok: true });
  } catch (err) {
    console.error("[brand-assets] delete failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
