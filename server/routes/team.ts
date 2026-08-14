/**
 * Team routes — read access for any member, mutating actions admin-only.
 *
 *   GET    /api/team                  → { team, role, members[], invites[] }
 *   POST   /api/team/invites          → admin only. Create an invite for an
 *                                       email + role. Returns the invite
 *                                       row including the bare token so the
 *                                       admin UI can show a copy-paste
 *                                       invite link.
 *   DELETE /api/team/invites/:id      → admin only. Revoke a pending invite.
 *   PATCH  /api/team/members/:userId  → admin only. Body: { role }. Change
 *                                       a member's role. Refuses to demote
 *                                       the last admin so the team can
 *                                       always be administered.
 *   DELETE /api/team/members/:userId  → admin only OR self-removal.
 *                                       Removes a member from the team.
 *                                       Refuses to remove the last admin.
 *
 * Roles:
 *   admin  — full team management.
 *   member — can read team info but can't mutate. Self-removal is allowed
 *            (acts as "leave the team").
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import { generateInviteToken, requireAdmin, requireAuth } from "../lib/auth.js";
import { grantBrandsToUser, revokeBrandsFromUser } from "../lib/brandAccess.js";
import { normalizeInviteBrandIds } from "../lib/inviteBrands.js";
import type { Role } from "../db/schema.js";

export const teamRouter: Router = Router();

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const RESET_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — admin shares the link manually

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "manager" || value === "member";
}

function shapeMember(row: {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: Date;
}) {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role as Role,
    joinedAt: row.joinedAt,
  };
}

function shapeInvite(row: schema.Invite) {
  return {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    brandIds: (row.brandIds as string[] | null) ?? null,
    token: row.token,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  };
}

// ── GET /api/team ──────────────────────────────────────────────────
teamRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { team, role } = req.auth!;

    // Members list with name + email joined from `users`.
    const members = await db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.teamMembers.role,
        joinedAt: schema.teamMembers.createdAt,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
      .where(eq(schema.teamMembers.teamId, team.id))
      .orderBy(desc(schema.teamMembers.createdAt));

    // Pending invites — only admins see this list (members shouldn't be
    // able to enumerate invited email addresses for someone else's team).
    let invites: schema.Invite[] = [];
    if (role === "admin") {
      invites = await db
        .select()
        .from(schema.invites)
        .where(eq(schema.invites.teamId, team.id))
        .orderBy(desc(schema.invites.createdAt));
    }

    res.json({
      team,
      role,
      members: members.map(shapeMember),
      invites: invites.filter((i) => !i.acceptedAt).map(shapeInvite),
      acceptedInvites: invites.filter((i) => i.acceptedAt).map(shapeInvite),
    });
  } catch (err) {
    console.error("[team] list failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── POST /api/team/invites ─────────────────────────────────────────
teamRouter.post("/invites", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { email?: string; role?: string; brandIds?: unknown };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return sendError(res, 400, "A valid email is required");
    const role = isRole(body.role) ? body.role : "member";

    const { team, user } = req.auth!;

    // Refuse if there's already an active user with this email on the team
    // — the admin probably meant to look up the existing member instead.
    const [existingUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existingUser) {
      const [memberRow] = await db
        .select()
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.userId, existingUser.id),
            eq(schema.teamMembers.teamId, team.id),
          ),
        )
        .limit(1);
      if (memberRow)
        return sendError(res, 409, "That email already has an account on this team.");
    }

    // Refuse if there's already a pending invite for the same email +
    // team. The admin can revoke the existing one and re-invite if they
    // need to change the role.
    const [existingInvite] = await db
      .select()
      .from(schema.invites)
      .where(and(eq(schema.invites.email, email), eq(schema.invites.teamId, team.id)))
      .limit(1);
    if (existingInvite && !existingInvite.acceptedAt)
      return sendError(res, 409, "An invite for that email is already pending. Revoke it first to re-invite.");

    // Pre-assigned workspaces: validate against THIS team's brands. Foreign
    // ids reject the whole request (clear error beats a silent drop).
    const teamBrands = await db
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(eq(schema.brands.teamId, team.id));
    const normalized = normalizeInviteBrandIds(body.brandIds, role, new Set(teamBrands.map((b) => b.id)));
    if (!normalized.ok) return sendError(res, 400, normalized.error);

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const [created] = await db
      .insert(schema.invites)
      .values({
        teamId: team.id,
        email,
        role,
        brandIds: normalized.brandIds,
        token,
        invitedByUserId: user.id,
        expiresAt,
      })
      .returning();
    res.json({ invite: shapeInvite(created) });
  } catch (err) {
    console.error("[team] invite create failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── DELETE /api/team/invites/:id ───────────────────────────────────
teamRouter.delete("/invites/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { team } = req.auth!;
    const [row] = await db
      .select()
      .from(schema.invites)
      .where(and(eq(schema.invites.id, req.params.id), eq(schema.invites.teamId, team.id)))
      .limit(1);
    if (!row) return sendError(res, 404, "Invite not found");
    await db.delete(schema.invites).where(eq(schema.invites.id, row.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[team] invite revoke failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── PATCH /api/team/members/:userId ────────────────────────────────
teamRouter.patch("/members/:userId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { role?: string };
    if (!isRole(body.role)) return sendError(res, 400, "role must be 'admin', 'manager', or 'member'");
    const { team } = req.auth!;

    const [target] = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.userId, req.params.userId),
          eq(schema.teamMembers.teamId, team.id),
        ),
      )
      .limit(1);
    if (!target) return sendError(res, 404, "Member not found on this team");

    // Last-admin guard: refuse to demote the only admin so the team can
    // always be administered. Re-promote someone first.
    if (target.role === "admin" && body.role !== "admin") {
      const adminCount = await countAdmins(team.id);
      if (adminCount <= 1)
        return sendError(res, 400, "Can't demote the last admin. Promote another member first.");
    }

    await db
      .update(schema.teamMembers)
      .set({ role: body.role })
      .where(eq(schema.teamMembers.id, target.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[team] role change failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── POST /api/team/members/:userId/reset-password ──────────────────
// Admin issues a one-time password-reset link for a team member. Returns the
// token; the admin shares /reset-password?token=… manually (no email infra).
// Any prior UNUSED reset for that user is invalidated so only the newest link
// works.
teamRouter.post("/members/:userId/reset-password", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { team, user } = req.auth!;
    const targetUserId = req.params.userId;

    const [target] = await db
      .select()
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.userId, targetUserId), eq(schema.teamMembers.teamId, team.id)))
      .limit(1);
    if (!target) return sendError(res, 404, "Member not found on this team");

    await db
      .delete(schema.passwordResets)
      .where(and(eq(schema.passwordResets.userId, targetUserId), isNull(schema.passwordResets.usedAt)));

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    const [created] = await db
      .insert(schema.passwordResets)
      .values({ userId: targetUserId, token, createdByUserId: user.id, expiresAt })
      .returning();
    res.json({ token: created.token, expiresAt: created.expiresAt });
  } catch (err) {
    console.error("[team] password reset issue failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── GET /api/team/members/:userId/brands ────────────────────────────
//
// Admin-only. Returns every brand on the team paired with a boolean
// `hasAccess` flag for this user. Admin target users get `hasAccess:
// true` on every row plus `isAdmin: true` on the response so the UI
// can show the "Admin — full access" state instead of checkboxes.
teamRouter.get("/members/:userId/brands", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { team } = req.auth!;
    const targetUserId = req.params.userId;

    // Confirm the target is actually a member of THIS team.
    const [target] = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(eq(schema.teamMembers.userId, targetUserId), eq(schema.teamMembers.teamId, team.id)),
      )
      .limit(1);
    if (!target) return sendError(res, 404, "Member not found on this team");
    const targetIsAdmin = target.role === "admin";

    const teamBrands = await db
      .select({ id: schema.brands.id, name: schema.brands.name, logoUrl: schema.brands.logoUrl })
      .from(schema.brands)
      .where(eq(schema.brands.teamId, team.id))
      .orderBy(desc(schema.brands.createdAt));

    const grants = await db
      .select({ brandId: schema.brandMembers.brandId })
      .from(schema.brandMembers)
      .where(eq(schema.brandMembers.userId, targetUserId));
    const granted = new Set(grants.map((g) => g.brandId));

    const brands = teamBrands.map((b) => ({
      id: b.id,
      name: b.name,
      logoUrl: b.logoUrl,
      hasAccess: targetIsAdmin || granted.has(b.id),
    }));

    res.json({ isAdmin: targetIsAdmin, brands });
  } catch (err) {
    console.error("[team] list member brands failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── PUT /api/team/members/:userId/brands ────────────────────────────
//
// Admin-only. Body: `{ brandIds: string[] }` — the FULL set of brands
// the target user should have access to. Computes the diff against the
// current grants:
//   - brands in the new set but not in current → INSERT (granted)
//   - brands in current but not in the new set → DELETE (revoked)
//
// Always validates that every brandId in the request belongs to the
// admin's team (so an admin can't accidentally — or maliciously —
// grant a user access to some other team's brand). No-ops on admin
// targets (returns ok: true, message: "user is admin").
teamRouter.put("/members/:userId/brands", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { team, user: adminUser } = req.auth!;
    const targetUserId = req.params.userId;
    const body = (req.body ?? {}) as { brandIds?: unknown };
    if (!Array.isArray(body.brandIds) || !body.brandIds.every((v) => typeof v === "string")) {
      return sendError(res, 400, "brandIds must be an array of strings");
    }
    const requestedBrandIds: string[] = Array.from(new Set(body.brandIds as string[]));

    const [target] = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(eq(schema.teamMembers.userId, targetUserId), eq(schema.teamMembers.teamId, team.id)),
      )
      .limit(1);
    if (!target) return sendError(res, 404, "Member not found on this team");
    if (target.role === "admin") {
      return res.json({ ok: true, message: "User is an admin and already has full access" });
    }

    // Filter out any brand id that isn't on this admin's team — defense
    // against payload tampering. Reject the request entirely if any are
    // foreign, so the admin gets a clear error rather than a silent drop.
    const teamBrands = await db
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(eq(schema.brands.teamId, team.id));
    const teamBrandIds = new Set(teamBrands.map((b) => b.id));
    const foreign = requestedBrandIds.filter((id) => !teamBrandIds.has(id));
    if (foreign.length > 0) {
      return sendError(res, 400, `Some brandIds don't belong to your team: ${foreign.join(", ")}`);
    }

    // Current grants for the user.
    const currentRows = await db
      .select({ brandId: schema.brandMembers.brandId })
      .from(schema.brandMembers)
      .where(eq(schema.brandMembers.userId, targetUserId));
    const current = new Set(currentRows.map((r) => r.brandId));
    const requested = new Set(requestedBrandIds);

    const toAdd = requestedBrandIds.filter((id) => !current.has(id));
    const toRemove = Array.from(current).filter((id) => !requested.has(id));

    const [granted, revoked] = await Promise.all([
      grantBrandsToUser({ userId: targetUserId, brandIds: toAdd, createdBy: adminUser.id }),
      revokeBrandsFromUser({ userId: targetUserId, brandIds: toRemove }),
    ]);
    res.json({ ok: true, granted, revoked, totalGrants: requestedBrandIds.length });
  } catch (err) {
    console.error("[team] put member brands failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── DELETE /api/team/members/:userId ───────────────────────────────
//
// Either an admin removing someone, OR a non-admin self-removing (leave
// team). Last-admin guard applies in both directions.
teamRouter.delete("/members/:userId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { team, user, role } = req.auth!;
    const targetUserId = req.params.userId;
    const isSelf = targetUserId === user.id;
    if (!isSelf && role !== "admin")
      return sendError(res, 403, "Only admins can remove other members");

    const [target] = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(eq(schema.teamMembers.userId, targetUserId), eq(schema.teamMembers.teamId, team.id)),
      )
      .limit(1);
    if (!target) return sendError(res, 404, "Member not found on this team");

    if (target.role === "admin") {
      const adminCount = await countAdmins(team.id);
      if (adminCount <= 1)
        return sendError(res, 400, "Can't remove the last admin. Promote another member first.");
    }

    await db.delete(schema.teamMembers).where(eq(schema.teamMembers.id, target.id));
    // Also revoke every brand grant they held on this team. Without this
    // a re-invited user would silently inherit their previous access set
    // — surprising and a potential security leak.
    try {
      await db
        .delete(schema.brandMembers)
        .where(eq(schema.brandMembers.userId, targetUserId));
    } catch (e) {
      console.warn("[team] brand_members cleanup on remove failed:", (e as Error).message);
    }
    // Sessions for the removed user become orphaned (their team_members
    // row is gone, so loadAuthContext will return null on next request
    // and force a re-login). We don't delete them eagerly — lazy
    // invalidation keeps this endpoint cheap.
    res.json({ ok: true });
  } catch (err) {
    console.error("[team] member remove failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

async function countAdmins(teamId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.role, "admin")));
  return rows.length;
}
