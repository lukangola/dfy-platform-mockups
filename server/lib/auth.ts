/**
 * Auth foundation — password hashing, session tokens, cookies, middleware.
 *
 * Auth model:
 *   - Passwords stored as bcrypt hashes (work factor 10).
 *   - On login, we mint a 32-byte hex `token`, persist it in `sessions`
 *     with a 30-day expiry, and set it as the `dfy_session` cookie
 *     (httpOnly, sameSite=lax, secure when behind https).
 *   - Every authenticated request reads the cookie, looks up the session
 *     row, joins to the user + their (single) team_members row, and
 *     attaches `req.auth = { user, team, role, sessionId }`.
 *   - Sessions are pruned lazily on validation: if the row is expired,
 *     it gets deleted and the request is treated as unauthenticated.
 *
 * Middleware:
 *   - `attachAuth`        — populates req.auth (or null) on every request.
 *                           Mounted globally so downstream handlers can
 *                           branch on auth state without crashing.
 *   - `requireAuth`       — 401 if req.auth is null.
 *   - `requireAdmin`      — 403 if req.auth.role !== "admin".
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, schema } from "./db.js";
import type { Role, Team, User } from "../db/schema.js";

export const SESSION_COOKIE = "dfy_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BCRYPT_ROUNDS = 10;

export type AuthContext = {
  user: User;
  team: Team;
  role: Role;
  sessionId: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext | null;
    }
  }
}

// ── Password helpers ───────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── Token helpers ──────────────────────────────────────────────────

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generateInviteToken(): string {
  // Shorter than session tokens — surface in URLs that get pasted into chat
  // apps where length matters. 24 bytes = 48 hex chars, still 192 bits of
  // entropy which is plenty for a one-shot invite token.
  return crypto.randomBytes(24).toString("hex");
}

// ── Cookie helpers ─────────────────────────────────────────────────

/**
 * Parse `req.headers.cookie` (the raw `Cookie` header) into a flat map.
 * We avoid pulling in cookie-parser as a dep since this is the only
 * cookie we read.
 */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setSessionCookie(res: Response, token: string) {
  // sameSite=lax: covers normal in-app navigation while blocking the most
  // common CSRF surfaces. secure=true is conditional on production so dev
  // (http://localhost) still works.
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    `Expires=${new Date(Date.now() + SESSION_TTL_MS).toUTCString()}`,
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

// ── Session lifecycle ──────────────────────────────────────────────

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ userId, token, expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
}

/**
 * Look up the session by token. Returns null if the token doesn't match
 * any row, the row is expired (in which case we delete it inline so the
 * table doesn't grow indefinitely), or the user / team_members row is
 * missing (data corruption — shouldn't happen but treat as unauth).
 */
async function loadAuthContext(token: string): Promise<AuthContext | null> {
  const now = new Date();
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.token, token), gt(schema.sessions.expiresAt, now)))
    .limit(1);
  if (!session) {
    // Best-effort prune: delete an expired row if one matches the token.
    await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
    return null;
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (!user) return null;

  const [member] = await db
    .select()
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, user.id))
    .limit(1);
  if (!member) return null;

  const [team] = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, member.teamId))
    .limit(1);
  if (!team) return null;

  return {
    user,
    team,
    role: (member.role as Role) ?? "member",
    sessionId: session.id,
  };
}

// ── Middleware ─────────────────────────────────────────────────────

/**
 * Mount globally — populates `req.auth` (or sets it to null) on every
 * request. Downstream handlers can branch on it; the stricter
 * `requireAuth` and `requireAdmin` wrappers below short-circuit when the
 * session is missing or under-privileged.
 */
export async function attachAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      req.auth = null;
      return next();
    }
    req.auth = await loadAuthContext(token);
    next();
  } catch (err) {
    console.error("[auth] attachAuth failed:", err);
    req.auth = null;
    next();
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.auth.role !== "admin") {
    res.status(403).json({ error: "Admin role required" });
    return;
  }
  next();
}

// ── Bootstrap helpers ──────────────────────────────────────────────

/**
 * Returns true if this is a fresh database with no users yet. Drives the
 * "first user becomes admin" flow: the registration endpoint allows
 * password+name (no invite) when this is true, and refuses afterwards.
 */
export async function isBootstrapMoment(): Promise<boolean> {
  const [row] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  return !row;
}

export async function getOrCreateDefaultTeam(name = "Default Team"): Promise<Team> {
  const [existing] = await db.select().from(schema.teams).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(schema.teams).values({ name }).returning();
  return created;
}
