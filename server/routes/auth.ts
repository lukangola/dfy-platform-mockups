/**
 * Auth routes — register / login / logout / me / accept-invite.
 *
 * Bootstrap rule: the very first registration is allowed without an invite
 * token (the database has zero users → this user becomes the admin of a
 * brand-new "Default Team"). Every subsequent registration requires either
 * `inviteToken` (accept the invite) or — at the public register endpoint
 * — gets rejected with a clear "registration is invite-only" message.
 *
 * Endpoints:
 *
 *   GET    /api/auth/me                 → { user, team, role } or 401
 *   POST   /api/auth/register           → { user, team, role } + cookie
 *                                           Body: { email, password, name, inviteToken? }
 *   POST   /api/auth/login              → { user, team, role } + cookie
 *                                           Body: { email, password }
 *   POST   /api/auth/logout             → 200; clears the cookie
 *   GET    /api/auth/bootstrap-status   → { needsBootstrap: bool }
 *                                           Used by the register page to know
 *                                           whether to show "first admin" copy
 *                                           or "invite-only" copy.
 *   GET    /api/auth/invite/:token      → { email, role, teamName }
 *                                           Pre-fill the accept-invite page;
 *                                           validates the token without
 *                                           consuming it.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getOrCreateDefaultTeam,
  hashPassword,
  isBootstrapMoment,
  readCookie,
  SESSION_COOKIE,
  setSessionCookie,
  verifyPassword,
} from "../lib/auth.js";

export const authRouter: Router = Router();

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

// Trim + lowercase + minimal validation. Real apps use a proper email
// validator; for v1 a sane check is enough — the system trusts admins.
function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function validatePassword(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Password is required" };
  if (raw.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  if (raw.length > 256) return { ok: false, error: "Password is too long" };
  return { ok: true, value: raw };
}

function shapeAuthResponse(ctx: { user: schema.User; team: schema.Team; role: string }) {
  return {
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      avatarUrl: ctx.user.avatarUrl,
      createdAt: ctx.user.createdAt,
    },
    team: {
      id: ctx.team.id,
      name: ctx.team.name,
    },
    role: ctx.role,
  };
}

// ── /api/auth/me ───────────────────────────────────────────────────
authRouter.get("/me", async (req: Request, res: Response) => {
  if (!req.auth) {
    sendError(res, 401, "Not signed in");
    return;
  }
  res.json(shapeAuthResponse(req.auth));
});

// ── /api/auth/bootstrap-status ─────────────────────────────────────
authRouter.get("/bootstrap-status", async (_req: Request, res: Response) => {
  try {
    const needsBootstrap = await isBootstrapMoment();
    res.json({ needsBootstrap });
  } catch (err) {
    console.error("[auth] bootstrap-status failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── /api/auth/invite/:token ────────────────────────────────────────
//
// Validates an invite token without consuming it. Used by the
// accept-invite page to pre-fill the email and confirm the team name
// before the user submits the registration form.
authRouter.get("/invite/:token", async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    if (!token) return sendError(res, 400, "Invite token is required");

    const now = new Date();
    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(and(eq(schema.invites.token, token), gt(schema.invites.expiresAt, now)))
      .limit(1);
    if (!invite) return sendError(res, 404, "Invite not found or expired");
    if (invite.acceptedAt) return sendError(res, 410, "Invite has already been used");

    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, invite.teamId)).limit(1);
    res.json({
      email: invite.email,
      role: invite.role,
      teamName: team?.name ?? null,
    });
  } catch (err) {
    console.error("[auth] invite lookup failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── /api/auth/register ─────────────────────────────────────────────
//
// Three paths:
//   1. Bootstrap (no users yet) — creates user, creates default team,
//      makes the user an admin of that team. No invite token needed.
//   2. Invite token supplied — accepts the invite, creates the user,
//      adds them to the inviter's team with the invited role.
//   3. Anything else — rejected with a clear "registration is
//      invite-only" message.
authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      email?: string;
      password?: string;
      name?: string;
      inviteToken?: string;
    };

    const email = normalizeEmail(body.email);
    if (!email) return sendError(res, 400, "A valid email is required");
    const passwordCheck = validatePassword(body.password);
    if (!passwordCheck.ok) return sendError(res, 400, passwordCheck.error);
    const name = (body.name ?? "").trim();
    if (!name) return sendError(res, 400, "Name is required");

    const [existingUser] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existingUser) return sendError(res, 409, "An account with that email already exists. Sign in instead.");

    const passwordHash = await hashPassword(passwordCheck.value);

    let teamId: string;
    let role: "admin" | "member";

    if (body.inviteToken) {
      // INVITE PATH — validate, consume, attach to inviter's team.
      const now = new Date();
      const [invite] = await db
        .select()
        .from(schema.invites)
        .where(and(eq(schema.invites.token, body.inviteToken), gt(schema.invites.expiresAt, now)))
        .limit(1);
      if (!invite) return sendError(res, 404, "Invite token is invalid or expired");
      if (invite.acceptedAt) return sendError(res, 410, "This invite has already been used");
      if (invite.email.toLowerCase() !== email)
        return sendError(res, 400, "This invite was sent to a different email address");
      teamId = invite.teamId;
      role = (invite.role as "admin" | "member") ?? "member";
    } else {
      // BOOTSTRAP PATH — only allowed when no users exist yet.
      const bootstrap = await isBootstrapMoment();
      if (!bootstrap) {
        return sendError(
          res,
          403,
          "Registration is invite-only. Ask an admin for an invite link.",
        );
      }
      const team = await getOrCreateDefaultTeam();
      teamId = team.id;
      role = "admin";
    }

    const [user] = await db
      .insert(schema.users)
      .values({ email, passwordHash, name })
      .returning();
    await db.insert(schema.teamMembers).values({ teamId, userId: user.id, role });

    if (body.inviteToken) {
      await db
        .update(schema.invites)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.invites.token, body.inviteToken));
    }

    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).limit(1);
    const { token } = await createSession(user.id);
    setSessionCookie(res, token);

    res.json(shapeAuthResponse({ user, team, role }));
  } catch (err) {
    console.error("[auth] register failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── /api/auth/login ────────────────────────────────────────────────
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const email = normalizeEmail(body.email);
    if (!email) return sendError(res, 400, "A valid email is required");
    if (typeof body.password !== "string" || !body.password)
      return sendError(res, 400, "Password is required");

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!user) return sendError(res, 401, "Email or password is incorrect");

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return sendError(res, 401, "Email or password is incorrect");

    const [member] = await db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, user.id))
      .limit(1);
    if (!member) return sendError(res, 500, "Account is not attached to a team. Contact an admin.");
    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, member.teamId)).limit(1);
    if (!team) return sendError(res, 500, "Team is missing for this account.");

    const { token } = await createSession(user.id);
    setSessionCookie(res, token);
    res.json(shapeAuthResponse({ user, team, role: member.role }));
  } catch (err) {
    console.error("[auth] login failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── /api/auth/logout ───────────────────────────────────────────────
authRouter.post("/logout", async (req: Request, res: Response) => {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await destroySession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    console.error("[auth] logout failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── /api/auth/reset/:token ─────────────────────────────────────────
// Public — the user lands here from an admin-issued reset link.

/** Validate a reset token without consuming it; returns the target email to confirm on the page. */
async function loadValidReset(token: string) {
  const [reset] = await db
    .select()
    .from(schema.passwordResets)
    .where(
      and(
        eq(schema.passwordResets.token, token),
        gt(schema.passwordResets.expiresAt, new Date()),
        isNull(schema.passwordResets.usedAt),
      ),
    )
    .limit(1);
  return reset ?? null;
}

authRouter.get("/reset/:token", async (req: Request, res: Response) => {
  try {
    const reset = await loadValidReset(req.params.token);
    if (!reset) return sendError(res, 404, "This reset link is invalid or has expired.");
    const [u] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, reset.userId))
      .limit(1);
    if (!u) return sendError(res, 404, "That account no longer exists.");
    res.json({ email: u.email });
  } catch (err) {
    console.error("[auth] reset preview failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

authRouter.post("/reset/:token", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { password?: string };
    const check = validatePassword(body.password);
    if (!check.ok) return sendError(res, 400, check.error);

    const reset = await loadValidReset(req.params.token);
    if (!reset) return sendError(res, 404, "This reset link is invalid or has expired.");

    const passwordHash = await hashPassword(check.value);
    await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, reset.userId));
    await db.update(schema.passwordResets).set({ usedAt: new Date() }).where(eq(schema.passwordResets.id, reset.id));
    // Force re-login everywhere: drop the user's existing sessions.
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, reset.userId));
    res.json({ ok: true });
  } catch (err) {
    console.error("[auth] reset failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
