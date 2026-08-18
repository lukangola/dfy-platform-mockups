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
  AlertTriangle, Building2, Check, ChevronDown, Copy, Crown, FolderOpen, Headset, KeyRound, Loader2, Mail,
  RefreshCw, Shield, ShieldCheck, Trash2, UserMinus, UserPlus, Users, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBrand } from "@/contexts/BrandContext";
import {
  getTeam,
  createTeamInvite,
  revokeTeamInvite,
  updateTeamMemberRole,
  removeTeamMember,
  getMemberBrands,
  setMemberBrands,
  createPasswordReset,
  setBrandDfyClient,
  listBrands,
  type Brand,
  type MemberBrandAccess,
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

function buildResetUrl(token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/reset-password?token=${token}`;
}

export default function SettingsPage() {
  const { user, role, logout } = useAuth();
  // Settings sub-tabs. "clients" is admin-only (flag DFY brands); members and
  // managers only ever see "team".
  const [tab, setTab] = useState<"team" | "clients">("team");
  const [team, setTeam] = useState<TeamSnapshot | null>(null);
  // Manage-workspaces modal — null when closed; object holds the
  // target member's userId + display name while open.
  const [workspaceModal, setWorkspaceModal] = useState<{ userId: string; name: string } | null>(null);
  // Generated password-reset link to copy + hand to the member (admin only).
  const [resetBanner, setResetBanner] = useState<{ name: string; url: string } | null>(null);
  const [resetBusyUserId, setResetBusyUserId] = useState<string | null>(null);
  const [resetCopied, setResetCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Team brands — used for the invite-form workspace picker and to resolve
  // pre-assigned brandIds on pending invites into display names.
  const [brands, setBrands] = useState<Brand[]>([]);

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
  useEffect(() => {
    listBrands().then(({ brands }) => setBrands(brands)).catch(() => setBrands([]));
  }, []);

  return (
    <div className="min-h-screen flex" style={{ background: "#0A0B0E", color: "#E2E8F0" }}>
      {/* Sub-sidebar (reserved for future Settings tabs) */}
      <aside className="w-56 border-r border-white/[0.06] p-4 shrink-0" style={{ background: "#0D0F12" }}>
        <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">Settings</div>
        <div className="space-y-1">
          <button
            onClick={() => setTab("team")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
              tab === "team"
                ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30"
                : "text-white/50 hover:text-white/80 hover:bg-white/[0.04] border border-transparent"
            }`}
          >
            <Users size={12} /> Team
          </button>
          {role === "admin" && (
            <button
              onClick={() => setTab("clients")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
                tab === "clients"
                  ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30"
                  : "text-white/50 hover:text-white/80 hover:bg-white/[0.04] border border-transparent"
              }`}
            >
              <Building2 size={12} /> Clients
            </button>
          )}
        </div>
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
            <h1 className="text-xl font-medium text-white/90">{tab === "team" ? "Team" : "Clients"}</h1>
            <p className="text-[12px] text-white/40 font-mono mt-1.5">
              {tab === "team"
                ? "Manage who can access this workspace, set roles, and invite new members."
                : "Flag brands as Done-For-You clients to unlock the Client Console for managers and admins."}
            </p>
          </div>

          {tab === "team" ? (
          <>
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
                    brands={brands}
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
                    {(() => {
                      const brandNameById = new Map(brands.map((b) => [b.id, b.name]));
                      return team.invites.map((invite) => (
                      <div key={invite.id} className="flex items-center gap-3 p-3 rounded border border-white/[0.06] bg-white/[0.02]">
                        <Mail size={13} className="text-amber-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white/85 truncate">{invite.email}</div>
                          <div className="text-[10px] font-mono text-white/40 mt-0.5">
                            invited as <span className="text-white/60">{invite.role}</span> · expires {formatDate(invite.expiresAt)}
                            {invite.brandIds && invite.brandIds.length > 0 && (() => {
                              const names = invite.brandIds
                                .map((id) => brandNameById.get(id))
                                .filter((n): n is string => Boolean(n));
                              if (names.length === 0) return null;
                              const shown = names.slice(0, 2).join(", ");
                              const more = names.length > 2 ? ` +${names.length - 2} more` : "";
                              return <> · grants <span className="text-white/60">{shown}{more}</span></>;
                            })()}
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
                      ));
                    })()}
                  </div>
                </div>
              )}

              {/* Members list */}
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-3">
                  Members ({team.members.length})
                </div>
                {resetBanner && (
                  <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-amber-200/90">
                        Reset link for <span className="text-white/90">{resetBanner.name}</span>
                        {resetCopied && <span className="text-emerald-300"> · copied to clipboard</span>}
                      </span>
                      <button onClick={() => setResetBanner(null)} className="text-white/40 hover:text-white/80" title="Dismiss">
                        <X size={13} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={resetBanner.url}
                        onFocusCapture={(e) => e.currentTarget.select()}
                        className="flex-1 bg-[#0D0F12] border border-white/[0.08] rounded px-2 py-1.5 text-[10px] font-mono text-white/70 outline-none"
                      />
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(resetBanner.url);
                            setResetCopied(true);
                            setTimeout(() => setResetCopied(false), 2500);
                          } catch {
                            /* clipboard blocked — link is selectable above */
                          }
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-mono text-cyan-300 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20"
                      >
                        {resetCopied ? <Check size={11} /> : <Copy size={11} />} Copy
                      </button>
                    </div>
                    <p className="text-[10px] font-mono text-white/30 leading-relaxed">
                      Send this to {resetBanner.name}. It expires in 24h, works once, and signs them out everywhere — they open it, set a new password, and sign in.
                    </p>
                  </div>
                )}
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

                        {team.role === "admin" && !isSelf && member.role !== "admin" && (
                          <button
                            onClick={() => setWorkspaceModal({ userId: member.userId, name: member.name })}
                            className="p-2 rounded text-white/40 hover:text-cyan-300 hover:bg-cyan-500/10 transition-all"
                            title={`Manage workspaces for ${member.name}`}
                          >
                            <FolderOpen size={12} />
                          </button>
                        )}
                        {team.role === "admin" && !isSelf && (
                          <button
                            onClick={async () => {
                              setResetBusyUserId(member.userId);
                              setActionError(null);
                              try {
                                const { token } = await createPasswordReset(member.userId);
                                const url = buildResetUrl(token);
                                setResetBanner({ name: member.name, url });
                                try {
                                  await navigator.clipboard.writeText(url);
                                  setResetCopied(true);
                                  setTimeout(() => setResetCopied(false), 2500);
                                } catch {
                                  /* clipboard may be blocked — the banner still shows the link */
                                }
                              } catch (err) {
                                setActionError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setResetBusyUserId(null);
                              }
                            }}
                            disabled={resetBusyUserId === member.userId}
                            className="p-2 rounded text-white/40 hover:text-amber-300 hover:bg-amber-500/10 transition-all disabled:opacity-50"
                            title={`Generate a password-reset link for ${member.name}`}
                          >
                            {resetBusyUserId === member.userId ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                          </button>
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
          </>
          ) : (
            <ClientsTab />
          )}
        </motion.div>
      </main>

      {workspaceModal && (
        <ManageWorkspacesModal
          userId={workspaceModal.userId}
          userName={workspaceModal.name}
          onClose={() => setWorkspaceModal(null)}
        />
      )}
    </div>
  );
}

// ── Manage Workspaces modal ──────────────────────────────────────────
//
// Per-user × per-brand access control. Loads the brand-list-with-flags
// from /api/team/members/:userId/brands, lets the admin tick/untick each
// brand, and PUTs the full set back on save. Admin targets get a
// "User is an admin — already has full access" state with no checkboxes.
function ManageWorkspacesModal({
  userId,
  userName,
  onClose,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [brands, setBrands] = useState<MemberBrandAccess[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Local checkbox state, keyed by brandId. Initialized from the server's
  // hasAccess flags so we can compute a clean diff on save.
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getMemberBrands(userId);
        if (cancelled) return;
        setIsAdmin(data.isAdmin);
        setBrands(data.brands);
        setChecked(Object.fromEntries(data.brands.map((b) => [b.id, b.hasAccess])));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const brandIds = Object.entries(checked).filter(([, v]) => v).map(([k]) => k);
      await setMemberBrands(userId, brandIds);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = Object.values(checked).filter(Boolean).length;
  const totalCount = brands.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0c0c10] border border-white/[0.08] rounded-lg shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <div className="text-sm text-white/90 font-semibold">Manage Workspaces</div>
            <div className="text-[11px] font-mono text-white/40 mt-0.5">
              {userName}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-white/40 hover:text-white/80 hover:bg-white/[0.05] transition-all"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-[11px] font-mono text-white/40">
              <Loader2 size={12} className="animate-spin" /> Loading workspaces…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 p-3 rounded border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : isAdmin ? (
            <div className="flex items-start gap-2 p-3 rounded border border-amber-500/30 bg-amber-500/10 text-[12px] text-amber-200">
              <Crown size={14} className="flex-shrink-0 mt-0.5 text-amber-300" />
              <span>
                This user is an <strong>admin</strong> and automatically sees every workspace on
                the team. Demote them to <em>member</em> first if you want to scope their access.
              </span>
            </div>
          ) : brands.length === 0 ? (
            <div className="text-[12px] text-white/50">
              No workspaces on this team yet. Create one first, then come back to assign access.
            </div>
          ) : (
            <div className="space-y-1.5">
              {brands.map((b) => (
                <label
                  key={b.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04] cursor-pointer transition-all"
                >
                  <input
                    type="checkbox"
                    checked={checked[b.id] ?? false}
                    onChange={(e) =>
                      setChecked((p) => ({ ...p, [b.id]: e.target.checked }))
                    }
                    className="accent-cyan-400 w-3.5 h-3.5"
                  />
                  {b.logoUrl ? (
                    <img
                      src={b.logoUrl}
                      alt=""
                      className="w-6 h-6 rounded object-cover bg-white/[0.04] border border-white/[0.06] flex-shrink-0"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/40 text-[10px] font-medium flex-shrink-0">
                      {b.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm text-white/85 flex-1 truncate">{b.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {!loading && !error && !isAdmin && brands.length > 0 && (
          <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between gap-3">
            <div className="text-[11px] font-mono text-white/40">
              {selectedCount} of {totalCount} selected
              {selectedCount === 0 && (
                <span className="ml-2 text-amber-300/80">— user will see no workspaces</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded border border-white/[0.08] text-[11px] font-mono uppercase tracking-wider text-white/70 hover:border-white/[0.15] hover:text-white/90 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-[11px] font-mono uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/25 hover:border-cyan-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Save
              </button>
            </div>
          </div>
        )}
      </div>
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
  if (role === "manager") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono uppercase tracking-wider text-[10px] bg-cyan-500/15 text-cyan-300 border-cyan-500/30">
        <ShieldCheck size={10} /> Manager
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono uppercase tracking-wider text-[10px] bg-white/[0.04] text-white/60 border-white/[0.08]">
      <Shield size={10} /> Member
    </span>
  );
}

function roleIcon(r: TeamRole) {
  if (r === "admin") return <Crown size={10} className="text-amber-400" />;
  if (r === "manager") return <ShieldCheck size={10} className="text-cyan-400" />;
  return <Shield size={10} className="text-white/60" />;
}

function RoleSelect({ value, onChange }: { value: TeamRole; onChange: (next: TeamRole) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1 px-2 py-1 rounded border border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] text-[10px] font-mono uppercase tracking-wider text-white/70"
      >
        {roleIcon(value)}
        {value}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-[#13151a] border border-white/[0.08] rounded shadow-xl">
          {(["admin", "manager", "member"] as TeamRole[]).map((r) => (
            <button
              key={r}
              onClick={() => { setOpen(false); if (r !== value) onChange(r); }}
              className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider w-full text-left hover:bg-white/[0.04] ${value === r ? "text-cyan-400" : "text-white/70"}`}
            >
              {roleIcon(r)}
              {r}
              {value === r && <Check size={10} className="ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Clients tab ──────────────────────────────────────────────────────
//
// Admin-only. Lists every brand on the team and lets the admin flag which
// ones are Done-For-You clients. Flipping the flag unlocks the Client Command
// Center (share links + feedback triage) for managers and admins on that
// brand. Driven from BrandContext so toggling immediately reflects in the
// sidebar nav + BrandSwitcher after refreshBrands().
function ClientsTab() {
  const { brands, refreshBrands } = useBrand();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(brand: Brand) {
    if (busyId) return;
    setBusyId(brand.id);
    setError(null);
    try {
      await setBrandDfyClient(brand.id, !brand.isDfyClient);
      await refreshBrands();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const dfyCount = brands.filter((b) => b.isDfyClient).length;

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1">
            Done-For-You clients
          </div>
          <div className="text-sm text-white/85">
            {dfyCount} of {brands.length} brand{brands.length === 1 ? "" : "s"} flagged
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-cyan-300/70 uppercase tracking-wider">
          <Headset size={12} /> Client Console
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-300 font-mono flex items-start gap-2 mb-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {brands.length === 0 ? (
        <div className="text-[12px] text-white/50 font-mono py-4">
          No brands on this team yet. Create one first, then come back to flag it as a client.
        </div>
      ) : (
        <div className="space-y-2">
          {brands.map((b) => {
            const on = Boolean(b.isDfyClient);
            const busy = busyId === b.id;
            return (
              <div
                key={b.id}
                className="flex items-center gap-3 p-3 rounded border border-white/[0.06] bg-white/[0.02]"
              >
                {b.logoUrl ? (
                  <img
                    src={b.logoUrl}
                    alt=""
                    className="w-8 h-8 rounded object-cover bg-white/[0.04] border border-white/[0.06] shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/40 text-[11px] font-medium shrink-0">
                    {b.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white/85 truncate">{b.name}</div>
                  <div className="text-[10px] font-mono mt-0.5">
                    {on ? (
                      <span className="text-cyan-300/80">Done-For-You client</span>
                    ) : (
                      <span className="text-white/30">Standard brand</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void toggle(b)}
                  disabled={busy}
                  role="switch"
                  aria-checked={on}
                  title={on ? "Disable Client Console for this brand" : "Enable Client Console for this brand"}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                    on ? "bg-cyan-500/40 border border-cyan-500/50" : "bg-white/[0.06] border border-white/[0.1]"
                  }`}
                >
                  <span
                    className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white transition-all ${
                      on ? "left-[22px]" : "left-[3px]"
                    } ${busy ? "opacity-60" : ""}`}
                  />
                  {busy && (
                    <Loader2 size={11} className="animate-spin text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] font-mono text-white/30 leading-relaxed mt-4">
        Flagging a brand unlocks the <span className="text-cyan-300/70">Client Console</span> in the sidebar for managers and admins — where you mint client share links and triage their feedback. Non-client brands stay hidden from it.
      </p>
    </div>
  );
}

function InviteForm({ brands, onCreated, onError }: { brands: Brand[]; onCreated: () => void; onError: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const { invite } = await createTeamInvite({
        email: email.trim().toLowerCase(),
        role,
        brandIds: role === "admin" ? undefined : selectedBrandIds,
      });
      const link = buildInviteUrl(invite.token);
      setCreatedLink(link);
      setEmail("");
      setSelectedBrandIds([]);
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
      <form onSubmit={onSubmit}>
        <div className="flex items-end gap-2">
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
              onChange={(e) => {
                setRole(e.target.value as TeamRole);
                if (e.target.value === "admin") setSelectedBrandIds([]);
              }}
              className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-2 text-xs text-white/85 focus:border-cyan-500/40 focus:outline-none"
            >
              <option value="member">member</option>
              <option value="manager">manager</option>
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
        </div>
        {role !== "admin" && brands.length > 0 && (
          <div className="mt-3">
            <label className="block text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1.5">
              Workspaces (granted on accept)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {brands.map((b) => {
                const checked = selectedBrandIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() =>
                      setSelectedBrandIds((prev) =>
                        checked ? prev.filter((id) => id !== b.id) : [...prev, b.id],
                      )
                    }
                    className={`px-2.5 py-1.5 rounded border text-[11px] transition-all ${
                      checked
                        ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                        : "border-white/[0.08] bg-white/[0.03] text-white/50 hover:text-white/75"
                    }`}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
