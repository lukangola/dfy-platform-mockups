/**
 * Settings → Team page.
 *
 * Single-tab today (Team management); the layout reserves space for future
 * tabs (Profile, Workspace, Billing, …) by rendering a left sidebar with a
 * single entry that can grow without restructuring the page.
 *
 * Team page lets the user:
 *   - See their profile + role badge
 *   - See all team members with name, email, role, joined date
 *   - (Admin) invite by email with an admin/member role; the response
 *     surfaces a copy-paste invite link the admin can share manually
 *   - (Admin) revoke pending invites and recopy their links any time
 *   - (Admin) change a member's role or remove them (with last-admin guard)
 *   - Leave the team (members only — admins demote first)
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Check, ChevronDown, Copy, Crown, Loader2, Mail, RefreshCw,
  Shield, Trash2, UserMinus, UserPlus, Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getTeam,
  createTeamInvite,
  revokeTeamInvite,
  updateTeamMemberRole,
  removeTeamMember,
  type TeamSnapshot,
  type TeamRole,
} from "@/lib/api";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return "—";
  }
}

function buildInviteUrl(token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/accept-invite?token=${token}`;
}

export default function SettingsPage() {
  const { user, role, logout } = useAuth();
  const [team, setTeam] = useState<TeamSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setTeam(await getTeam());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  return (
    <div className="min-h-screen flex" style={{ background: "#0A0B0E", color: "#E2E8F0" }}>
      {/* Sub-sidebar (reserved for future Settings tabs) */}
      <aside className="w-56 border-r border-white/[0.06] p-4 shrink-0" style={{ background: "#0D0F12" }}>
        <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">Settings</div>
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-xs font-mono uppercase tracking-wider">
          <Users size={12} /> Team
        </button>
        <p className="text-[10px] font-mono text-white/20 leading-relaxed mt-4 px-1">
          More settings tabs coming as the platform grows.
        </p>
      </aside>

      <main className="flex-1 overflow-auto">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-4xl mx-auto p-6 md:p-10 space-y-6"
        >
          <div>
            <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Workspace settings</div>
            <h1 className="text-xl font-medium text-white/90">Team</h1>
            <p className="text-[12px] text-white/40 font-mono mt-1.5">
              Manage who can access this workspace, set roles, and invite new members.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-300 font-mono flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {actionError && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-300 font-mono flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{actionError}</span>
              <button onClick={() => setActionError(null)} className="ml-auto text-amber-300/70 hover:text-amber-300">×</button>
            </div>
          )}

          {/* Profile card */}
          {user && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-3">Your profile</div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 text-sm font-medium">
                  {user.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white/90">{user.name}</div>
                  <div className="text-[11px] font-mono text-white/40">{user.email}</div>
                </div>
                <RoleBadge role={role} />
                <button
                  onClick={() => void logout()}
                  className="ml-2 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/60 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white/80 transition-all"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}

          {/* Team header + invite form */}
          {loading || !team ? (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-6 flex items-center gap-2 text-white/40 font-mono text-xs">
              <Loader2 size={12} className="animate-spin" /> Loading team...
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1">Team</div>
                    <div className="text-sm text-white/85">{team.team.name}</div>
                  </div>
                  <button
                    onClick={() => void refresh()}
                    className="px-2.5 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/50 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white/80 transition-all flex items-center gap-1.5"
                  >
                    <RefreshCw size={11} /> Refresh
                  </button>
                </div>
                {team.role === "admin" && (
                  <InviteForm
                    onCreated={() => void refresh()}
                    onError={setActionError}
                  />
                )}
              </div>

              {/* Pending invites — admins only */}
              {team.role === "admin" && team.invites.length > 0 && (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                  <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-3">
                    Pending invites ({team.invites.length})
                  </div>
                  <div className="space-y-2">
                    {team.invites.map((invite) => (
                      <div key={invite.id} className="flex items-center gap-3 p-3 rounded border border-white/[0.06] bg-white/[0.02]">
                        <Mail size={13} className="text-amber-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white/85 truncate">{invite.email}</div>
                          <div className="text-[10px] font-mono text-white/40 mt-0.5">
                            invited as <span className="text-white/60">{invite.role}</span> · expires {formatDate(invite.expiresAt)}
                          </div>
                        </div>
                        <CopyInviteButton token={invite.token} />
                        <button
                          onClick={async () => {
                            try {
                              await revokeTeamInvite(invite.id);
                              await refresh();
                            } catch (err) {
                              setActionError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                          className="p-2 rounded text-white/40 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                          title="Revoke invite"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Members list */}
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-3">
                  Members ({team.members.length})
                </div>
                <div className="space-y-2">
                  {team.members.map((member) => {
                    const isSelf = member.userId === user?.id;
                    return (
                      <div key={member.userId} className="flex items-center gap-3 p-3 rounded border border-white/[0.06] bg-white/[0.02]">
                        <div className="w-8 h-8 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/70 text-xs font-medium">
                          {member.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white/85 truncate">
                            {member.name}
                            {isSelf && <span className="ml-2 text-[10px] font-mono text-white/40">(you)</span>}
                          </div>
                          <div className="text-[10px] font-mono text-white/40 mt-0.5">
                            {member.email} · joined {formatDate(member.joinedAt)}
                          </div>
                        </div>

                        {team.role === "admin" && !isSelf ? (
                          <RoleSelect
                            value={member.role}
                            onChange={async (next) => {
                              try {
                                await updateTeamMemberRole(member.userId, next);
                                await refresh();
                              } catch (err) {
                                setActionError(err instanceof Error ? err.message : String(err));
                              }
                            }}
                          />
                        ) : (
                          <RoleBadge role={member.role} />
                        )}

                        {team.role === "admin" && !isSelf && (
                          <button
                            onClick={async () => {
                              if (!confirm(`Remove ${member.name} from ${team.team.name}?`)) return;
                              try {
                                await removeTeamMember(member.userId);
                                await refresh();
                              } catch (err) {
                                setActionError(err instanceof Error ? err.message : String(err));
                              }
                            }}
                            className="p-2 rounded text-white/40 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                            title={`Remove ${member.name}`}
                          >
                            <UserMinus size={12} />
                          </button>
                        )}
                        {isSelf && team.role === "member" && (
                          <button
                            onClick={async () => {
                              if (!confirm("Leave this team?")) return;
                              try {
                                await removeTeamMember(member.userId);
                                await logout();
                              } catch (err) {
                                setActionError(err instanceof Error ? err.message : String(err));
                              }
                            }}
                            className="px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider text-rose-400 hover:bg-rose-500/10 transition-all"
                          >
                            Leave team
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}

function RoleBadge({ role }: { role: TeamRole | null }) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono uppercase tracking-wider text-[10px] bg-amber-500/15 text-amber-300 border-amber-500/30">
        <Crown size={10} /> Admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono uppercase tracking-wider text-[10px] bg-white/[0.04] text-white/60 border-white/[0.08]">
      <Shield size={10} /> Member
    </span>
  );
}

function RoleSelect({ value, onChange }: { value: TeamRole; onChange: (next: TeamRole) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1 px-2 py-1 rounded border border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] text-[10px] font-mono uppercase tracking-wider text-white/70"
      >
        {value === "admin" ? <Crown size={10} className="text-amber-400" /> : <Shield size={10} className="text-white/60" />}
        {value}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-[#13151a] border border-white/[0.08] rounded shadow-xl">
          {(["admin", "member"] as TeamRole[]).map((r) => (
            <button
              key={r}
              onClick={() => { setOpen(false); if (r !== value) onChange(r); }}
              className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider w-full text-left hover:bg-white/[0.04] ${value === r ? "text-cyan-400" : "text-white/70"}`}
            >
              {r === "admin" ? <Crown size={10} /> : <Shield size={10} />}
              {r}
              {value === r && <Check size={10} className="ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InviteForm({ onCreated, onError }: { onCreated: () => void; onError: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [submitting, setSubmitting] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const { invite } = await createTeamInvite({ email: email.trim().toLowerCase(), role });
      const link = buildInviteUrl(invite.token);
      setCreatedLink(link);
      setEmail("");
      onCreated();
      // Auto-copy so the admin can paste straight into Slack/email/etc.
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard rejection is fine — the link is still on screen and
        // there's a Copy button next to it.
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1">Invite by email</label>
          <div className="flex items-center gap-2 rounded border border-white/[0.08] bg-white/[0.03] px-3 focus-within:border-cyan-500/40 transition-colors">
            <Mail size={12} className="text-white/40" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="flex-1 bg-transparent py-2 text-sm text-white/85 placeholder:text-white/25 outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-2 text-xs text-white/85 focus:border-cyan-500/40 focus:outline-none"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={!email.trim() || submitting}
          className="px-4 py-2 rounded text-[11px] font-mono uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {submitting ? <Loader2 size={11} className="animate-spin" /> : <UserPlus size={11} />}
          Send invite
        </button>
      </form>
      {createdLink && (
        <div className="mt-3 p-3 rounded border border-emerald-500/30 bg-emerald-500/[0.07]">
          <div className="text-[10px] font-mono text-emerald-300 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
            <Check size={11} /> Invite link generated
            {copied && <span className="text-emerald-400/80 normal-case tracking-normal">(copied to clipboard)</span>}
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] text-white/70 font-mono break-all">{createdLink}</code>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(createdLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  // ignore
                }
              }}
              className="p-1.5 rounded text-white/50 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyInviteButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(buildInviteUrl(token));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // ignore
        }
      }}
      className="px-2.5 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/60 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white/80 transition-all flex items-center gap-1.5"
      title="Copy invite link"
    >
      <Copy size={11} /> {copied ? "Copied" : "Copy link"}
    </button>
  );
}
