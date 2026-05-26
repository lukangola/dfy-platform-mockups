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
import { desc, eq, isNull, sql } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import type { NewBrandAsset } from "../db/schema.js";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { canSeeBrand } from "../lib/brandAccess.js";

export const brandAssetsRouter: Router = Router();

// Small helper: pick the friendliest display string for the creator chip.
// Prefer `name`; fall back to the email local-part (before the @) so legacy
// users who registered without setting a display name still show something
// human-readable instead of a UUID.
function displayNameFor(user: { name?: string | null; email?: string | null } | null | undefined): string | null {
  if (!user) return null;
  const name = (user.name ?? "").trim();
  if (name) return name;
  const email = (user.email ?? "").trim();
  if (!email) return null;
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

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

brandAssetsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const brandId = typeof req.query.brandId === "string" ? req.query.brandId : "";
    if (!brandId) return sendError(res, 400, "brandId query param is required");
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, brandId))) {
      // Mirror products list: return an empty array on no-access so the
      // workspace's data view degrades gracefully if a user lands on a
      // brand they shouldn't (the underlying brand fetch will 404 too).
      return res.json({ assets: [] });
    }
    // Left-join users so the client gets a ready-to-render creator label
    // without a second round-trip. Left-join (not inner) so legacy rows with
    // null user_id still come back.
    const rows = await db
      .select({
        asset: schema.brandAssets,
        userName: schema.users.name,
        userEmail: schema.users.email,
      })
      .from(schema.brandAssets)
      .leftJoin(schema.users, eq(schema.brandAssets.userId, schema.users.id))
      .where(eq(schema.brandAssets.brandId, brandId))
      .orderBy(desc(schema.brandAssets.createdAt));
    const assets = rows.map((r) => ({
      ...r.asset,
      creatorName: displayNameFor({ name: r.userName, email: r.userEmail }),
    }));
    res.json({ assets });
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

    // Auto-capture the authed user as creator. attachAuth middleware mounts
    // req.auth globally; null is fine here (anonymous saves keep userId NULL
    // and the asset just won't show a creator chip).
    const userId = req.auth?.user?.id ?? null;

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
        userId: userId ?? undefined,
      });
    }

    const inserted = await db.insert(schema.brandAssets).values(validated).returning();
    // Tag each inserted row with the current user's display name so the client
    // can show the "created by" chip on freshly-saved rows without re-fetching.
    const creatorName = displayNameFor(req.auth?.user ?? null);
    const enriched = inserted.map((row) => ({ ...row, creatorName }));
    res.json({ assets: enriched });
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

/**
 * GET /api/brand-assets/_admin/creator-status — diagnostic. Reports the
 * total asset count, the orphan count (rows with NULL user_id that wouldn't
 * show a creator chip), and the user list so we can decide attribution
 * policy. Admin-only.
 */
brandAssetsRouter.get("/_admin/creator-status", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [{ n: total = 0 } = {}] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.brandAssets);
    const [{ n: orphans = 0 } = {}] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.brandAssets)
      .where(isNull(schema.brandAssets.userId));
    const users = await db
      .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .orderBy(schema.users.createdAt);
    res.json({ total, orphans, users });
  } catch (err) {
    console.error("[brand-assets] creator-status failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/brand-assets/_admin/backfill-creators — one-shot backfill.
 * Body: { userId?: string }. If userId is omitted, attribute all orphans
 * to the calling admin (req.auth.user.id). If userId is provided, attribute
 * to that user (must exist). Admin-only.
 */
brandAssetsRouter.post("/_admin/backfill-creators", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { userId?: unknown };
    const explicitUserId = typeof body.userId === "string" && body.userId.trim()
      ? body.userId.trim()
      : null;
    const targetUserId = explicitUserId ?? req.auth!.user.id;

    // Sanity-check the target user exists before mutating any rows.
    const [targetUser] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, targetUserId))
      .limit(1);
    if (!targetUser) return sendError(res, 404, `User ${targetUserId} not found`);

    const updated = await db
      .update(schema.brandAssets)
      .set({ userId: targetUserId })
      .where(isNull(schema.brandAssets.userId))
      .returning({ id: schema.brandAssets.id });

    console.log(`[brand-assets] admin backfill: ${updated.length} row(s) → ${targetUser.email}`);
    res.json({ updated: updated.length, targetUser });
  } catch (err) {
    console.error("[brand-assets] backfill failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
