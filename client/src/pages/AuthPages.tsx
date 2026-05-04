/**
 * Three auth pages — login, register, accept-invite.
 *
 * Co-located because they share most of their layout and styling. Each is
 * exported as its own component and registered as its own route in App.tsx.
 *
 * Flow:
 *   - /login         → email + password → POST /api/auth/login
 *   - /register      → email + password + name. If needsBootstrap is true,
 *                      this is the "first admin" path. Otherwise the page
 *                      explains that registration is invite-only and points
 *                      to /login.
 *   - /accept-invite → reads ?token= from the query string, validates it,
 *                      pre-fills the email, then collects password + name
 *                      and POSTs to /api/auth/register with the inviteToken.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Lock, Mail, Sparkles, ShieldCheck, UserPlus, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { previewInvite, type InvitePreview } from "@/lib/api";

function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "linear-gradient(180deg, #0A0B0E 0%, #0E1014 100%)", color: "#E2E8F0" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 shadow-2xl"
      >
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
            <Sparkles size={14} className="text-cyan-400" />
          </div>
          <span className="font-mono text-xs text-white/40 tracking-widest uppercase">DFY Platform</span>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300 font-mono">
      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

// ── Login ──────────────────────────────────────────────────────────

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/workspace/products", { replace: true });
  }, [loading, user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate("/workspace/products", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenShell>
      <h1 className="text-xl font-medium text-white/90 mb-1">Sign in</h1>
      <p className="text-[12px] text-white/40 font-mono mb-6">Welcome back. Use the email + password your team uses for this workspace.</p>
      <form onSubmit={onSubmit} className="space-y-3">
        <FormError message={error} />
        <Field icon={<Mail size={13} className="text-white/40" />} label="Email" type="email" autoComplete="email" required value={email} onChange={setEmail} />
        <Field icon={<Lock size={13} className="text-white/40" />} label="Password" type="password" autoComplete="current-password" required value={password} onChange={setPassword} />
        <button
          type="submit"
          disabled={submitting || !email.trim() || !password}
          className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 transition-all text-sm font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-[12px] text-white/40 font-mono">
        Don't have an account? <a href="/register" className="text-cyan-400 hover:underline">Register</a>
      </p>
    </ScreenShell>
  );
}

// ── Register ───────────────────────────────────────────────────────
//
// Two shapes inside one page:
//   - needsBootstrap === true   → "Create the first admin account" copy
//   - needsBootstrap === false  → "Registration is invite-only" copy +
//                                  link to /login

export function RegisterPage() {
  const { register, user, loading, needsBootstrap, refresh } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/workspace/products", { replace: true });
  }, [loading, user, navigate]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (loading || needsBootstrap === null) {
    return (
      <ScreenShell>
        <div className="flex items-center gap-2 text-white/50 font-mono text-sm">
          <Loader2 size={14} className="animate-spin" /> Checking workspace status...
        </div>
      </ScreenShell>
    );
  }

  if (!needsBootstrap) {
    return (
      <ScreenShell>
        <div className="flex items-center gap-2 mb-3 text-amber-400">
          <ShieldCheck size={14} />
          <span className="font-mono text-[11px] uppercase tracking-wider">Invite-only workspace</span>
        </div>
        <h1 className="text-xl font-medium text-white/90 mb-1">Registration is invite-only</h1>
        <p className="text-[12px] text-white/50 font-mono mb-5 leading-relaxed">
          This workspace already has an admin. To join, ask an admin for an invite link. They can generate one from <span className="text-white/70">Settings → Team</span>.
        </p>
        <a
          href="/login"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 transition-all text-sm font-mono uppercase tracking-wider"
        >
          <ArrowRight size={13} /> Go to sign in
        </a>
      </ScreenShell>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ email: email.trim(), password, name: name.trim() });
      navigate("/workspace/products", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenShell>
      <div className="flex items-center gap-2 mb-3 text-emerald-400">
        <UserPlus size={14} />
        <span className="font-mono text-[11px] uppercase tracking-wider">First admin</span>
      </div>
      <h1 className="text-xl font-medium text-white/90 mb-1">Create the admin account</h1>
      <p className="text-[12px] text-white/40 font-mono mb-5 leading-relaxed">
        This will be the first account on the workspace, with admin role on the Default Team. All future joiners need an invite link from you.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <FormError message={error} />
        <Field label="Name" autoComplete="name" required value={name} onChange={setName} />
        <Field icon={<Mail size={13} className="text-white/40" />} label="Email" type="email" autoComplete="email" required value={email} onChange={setEmail} />
        <Field icon={<Lock size={13} className="text-white/40" />} label="Password" type="password" autoComplete="new-password" required value={password} onChange={setPassword} hint="At least 8 characters." />
        <button
          type="submit"
          disabled={submitting || !email.trim() || !password || !name.trim()}
          className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 transition-all text-sm font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          {submitting ? "Creating..." : "Create admin"}
        </button>
      </form>
    </ScreenShell>
  );
}

// ── Accept Invite ──────────────────────────────────────────────────

export function AcceptInvitePage() {
  const [, navigate] = useLocation();
  const { register, user, loading } = useAuth();

  // Parse token from the query string. wouter doesn't give us a URLSearchParams
  // helper, so we read window.location directly. Cheap; only happens once.
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") ?? "";
  }, []);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/workspace/products", { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!token) {
      setPreviewError("No invite token in URL.");
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await previewInvite(token);
        if (!cancelled) setPreview(p);
      } catch (err) {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await register({
        email: preview.email,
        password,
        name: name.trim(),
        inviteToken: token,
      });
      navigate("/workspace/products", { replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (previewLoading) {
    return (
      <ScreenShell>
        <div className="flex items-center gap-2 text-white/50 font-mono text-sm">
          <Loader2 size={14} className="animate-spin" /> Validating invite...
        </div>
      </ScreenShell>
    );
  }

  if (previewError || !preview) {
    return (
      <ScreenShell>
        <div className="flex items-center gap-2 mb-3 text-rose-400">
          <AlertTriangle size={14} />
          <span className="font-mono text-[11px] uppercase tracking-wider">Invite issue</span>
        </div>
        <h1 className="text-xl font-medium text-white/90 mb-1">This invite isn't valid</h1>
        <p className="text-[12px] text-white/50 font-mono mb-5 leading-relaxed">{previewError ?? "Unknown error"}</p>
        <a href="/login" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 transition-all text-sm font-mono uppercase tracking-wider">
          <ArrowRight size={13} /> Go to sign in
        </a>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <div className="flex items-center gap-2 mb-3 text-cyan-400">
        <UserPlus size={14} />
        <span className="font-mono text-[11px] uppercase tracking-wider">Accept invite</span>
      </div>
      <h1 className="text-xl font-medium text-white/90 mb-1">Join {preview.teamName ?? "the team"}</h1>
      <p className="text-[12px] text-white/40 font-mono mb-5 leading-relaxed">
        You've been invited to <span className="text-white/70">{preview.teamName ?? "the team"}</span> as <span className="text-white/70">{preview.role}</span>. Set your password and name to accept.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <FormError message={submitError} />
        <Field label="Email" value={preview.email} onChange={() => undefined} disabled hint="This invite is locked to this email." />
        <Field label="Name" autoComplete="name" required value={name} onChange={setName} />
        <Field icon={<Lock size={13} className="text-white/40" />} label="Password" type="password" autoComplete="new-password" required value={password} onChange={setPassword} hint="At least 8 characters." />
        <button
          type="submit"
          disabled={submitting || !password || !name.trim()}
          className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 transition-all text-sm font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          {submitting ? "Joining..." : "Accept invite"}
        </button>
      </form>
    </ScreenShell>
  );
}

// ── Shared field control ───────────────────────────────────────────

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  icon?: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1.5">
        {props.label}
      </span>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 focus-within:border-cyan-500/40 transition-colors">
        {props.icon}
        <input
          type={props.type ?? "text"}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          required={props.required}
          autoComplete={props.autoComplete}
          disabled={props.disabled}
          className="flex-1 bg-transparent py-2.5 text-sm text-white/85 placeholder:text-white/25 outline-none disabled:text-white/40"
        />
      </div>
      {props.hint && (
        <span className="block mt-1 text-[10px] font-mono text-white/30 leading-relaxed">{props.hint}</span>
      )}
    </label>
  );
}
