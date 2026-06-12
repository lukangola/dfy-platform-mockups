/**
 * Auth state container.
 *
 * Fetches `/api/auth/me` on mount so every page can read `{ user, team,
 * role }` synchronously after the initial bootstrap. Exposes login,
 * register, logout, and refresh helpers so the auth pages don't have to
 * call `fetch` directly.
 *
 * Three lifecycle states:
 *   - `loading`  — initial /me request in flight (or post-login refresh)
 *   - `signedIn` — user + team + role populated; render the workspace
 *   - `signedOut` — no session; render /login or /register
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type AuthRole = "admin" | "manager" | "member";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
};

export type AuthTeam = {
  id: string;
  name: string;
};

type AuthValue = {
  user: AuthUser | null;
  team: AuthTeam | null;
  role: AuthRole | null;
  loading: boolean;
  needsBootstrap: boolean | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (args: {
    email: string;
    password: string;
    name: string;
    inviteToken?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | undefined>(undefined);

async function jsonOrThrow(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [team, setTeam] = useState<AuthTeam | null>(null);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Run /me and /bootstrap-status in parallel — first one decides whether
      // the user is signed in, the second one tells the register page
      // whether to show "first admin" or "invite-only" copy.
      const [meRes, bootRes] = await Promise.all([
        fetch("/api/auth/me", { credentials: "include" }),
        fetch("/api/auth/bootstrap-status", { credentials: "include" }),
      ]);
      if (meRes.ok) {
        const me = await meRes.json();
        setUser(me.user);
        setTeam(me.team);
        setRole(me.role);
      } else {
        setUser(null);
        setTeam(null);
        setRole(null);
      }
      if (bootRes.ok) {
        const boot = await bootRes.json();
        setNeedsBootstrap(!!boot.needsBootstrap);
      }
    } catch {
      setUser(null);
      setTeam(null);
      setRole(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login: AuthValue["login"] = useCallback(async (email, password) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    const body = await jsonOrThrow(res);
    setUser(body.user);
    setTeam(body.team);
    setRole(body.role);
    setNeedsBootstrap(false);
  }, []);

  const register: AuthValue["register"] = useCallback(async (args) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(args),
    });
    const body = await jsonOrThrow(res);
    setUser(body.user);
    setTeam(body.team);
    setRole(body.role);
    setNeedsBootstrap(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      setUser(null);
      setTeam(null);
      setRole(null);
      // After logout, re-check bootstrap status so the next register click
      // sees the right copy. Don't await — we don't need to block.
      void fetch("/api/auth/bootstrap-status")
        .then((r) => (r.ok ? r.json() : { needsBootstrap: false }))
        .then((b) => setNeedsBootstrap(!!b.needsBootstrap))
        .catch(() => undefined);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, team, role, loading, needsBootstrap, refresh, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
