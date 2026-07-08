/**
 * Per-user × per-brand access control.
 *
 * Model:
 *   - Admins (team_members.role = "admin") implicitly see every brand on
 *     their team. We do NOT persist brand_members rows for admins.
 *   - Members (team_members.role = "member") see ONLY brands listed in
 *     `brand_members` for their userId.
 *   - A user with zero brand_members rows AND role = "member" sees nothing.
 *     The BrandSwitcher renders an "ask your admin" empty state.
 *
 * Enforcement:
 *   - Every brand-scoped route calls `canSeeBrand(...)` or filters its
 *     output via `visibleBrandIds(...)`. Routes return 404 on denied
 *     access — not 403 — so the existence of a brand doesn't leak to
 *     users who shouldn't know about it.
 *   - This module is the single source of truth. If you find yourself
 *     hand-rolling the same check inline elsewhere, refactor through here.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db.js";
import type { Role } from "../db/schema.js";

/**
 * Boolean: can `userId` (with the given team `role`) see this `brandId`?
 *
 * Returns true if:
 *   - The user is an admin (admin = see everything in the team), OR
 *   - A brand_members row exists for (brandId, userId).
 *
 * Does NOT check whether the brand belongs to the user's team. Callers
 * that need that guarantee should fetch the brand and compare `teamId`
 * to `req.auth.team.id` separately. In practice every code path that
 * reaches `canSeeBrand` has already loaded the brand by id, so adding
 * a redundant team check here would mean a second SELECT per call.
 */
export async function canSeeBrand(userId: string, role: Role, brandId: string): Promise<boolean> {
  if (role === "admin") return true;
  const rows = await db
    .select({ id: schema.brandMembers.id })
    .from(schema.brandMembers)
    .where(and(eq(schema.brandMembers.userId, userId), eq(schema.brandMembers.brandId, brandId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Returns the set of brand IDs (on the given team) the user can see.
 * Admins get every brand on the team. Members get only the ids in
 * `brand_members` filtered to that team's brands.
 *
 * Used by `GET /api/brands` to scope the list response. Caller is
 * responsible for then SELECTing only those rows.
 */
export async function visibleBrandIds(userId: string, role: Role, teamId: string): Promise<Set<string>> {
  if (role === "admin") {
    const rows = await db
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(eq(schema.brands.teamId, teamId));
    return new Set(rows.map((r) => r.id));
  }
  // Inner join brand_members ↔ brands so we filter out any stale grant
  // that points at a brand on another team (defense against future bugs).
  const rows = await db
    .select({ id: schema.brands.id })
    .from(schema.brandMembers)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.brandMembers.brandId))
    .where(and(eq(schema.brandMembers.userId, userId), eq(schema.brands.teamId, teamId)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Grant a list of brand ids to a single user. Idempotent — uses
 * ON CONFLICT to skip rows that already exist. Used by the boot-time
 * backfill, the new-brand auto-grant flow, and the SettingsPage
 * "Manage workspaces" PUT.
 */
export async function grantBrandsToUser(args: {
  userId: string;
  brandIds: string[];
  createdBy: string | null;
}): Promise<number> {
  if (args.brandIds.length === 0) return 0;
  const result = await db
    .insert(schema.brandMembers)
    .values(args.brandIds.map((brandId) => ({
      userId: args.userId,
      brandId,
      createdBy: args.createdBy,
    })))
    .onConflictDoNothing({ target: [schema.brandMembers.brandId, schema.brandMembers.userId] })
    .returning({ id: schema.brandMembers.id });
  return result.length;
}

/**
 * Boolean: can `userId` (with team `role`) see the product with id
 * `productId`? Chains to canSeeBrand by looking up the product's
 * brandId once. Returns false if the product doesn't exist — callers
 * should treat that as "no access" and emit a 404 to avoid leaking
 * the (non-)existence of the row.
 */
export async function canSeeProduct(userId: string, role: Role, productId: string): Promise<boolean> {
  if (role === "admin") return true;
  const [row] = await db
    .select({ brandId: schema.products.brandId })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1);
  if (!row) return false;
  return canSeeBrand(userId, role, row.brandId);
}

/**
 * Boolean: can `userId` (with team `role`) see the listicle with id
 * `listicleId`? Chains to canSeeBrand by looking up the listicle's
 * brandId once — same shape as canSeeProduct. Returns false if the
 * listicle doesn't exist — callers should treat that as "no access"
 * and emit a 404 to avoid leaking the (non-)existence of the row.
 */
export async function canSeeListicle(userId: string, role: Role, listicleId: string): Promise<boolean> {
  if (role === "admin") return true;
  const [row] = await db
    .select({ brandId: schema.listicles.brandId })
    .from(schema.listicles)
    .where(eq(schema.listicles.id, listicleId))
    .limit(1);
  if (!row) return false;
  return canSeeBrand(userId, role, row.brandId);
}

/**
 * Revoke all grants for `userId` on the given brand ids in one go.
 * Used by the PUT endpoint when an admin un-checks brands.
 */
export async function revokeBrandsFromUser(args: {
  userId: string;
  brandIds: string[];
}): Promise<number> {
  if (args.brandIds.length === 0) return 0;
  const deleted = await db
    .delete(schema.brandMembers)
    .where(and(
      eq(schema.brandMembers.userId, args.userId),
      inArray(schema.brandMembers.brandId, args.brandIds),
    ))
    .returning({ id: schema.brandMembers.id });
  return deleted.length;
}
