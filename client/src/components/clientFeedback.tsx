/**
 * Client Console — shared feedback + share-link UI.
 *
 * These components were originally inlined in ProductDetailPage; they're
 * extracted here so BOTH surfaces can use them:
 *   - the operator Product page keeps the inline per-section markers
 *     (`InlineFeedback`, which renders `OperatorSuggestionCard`);
 *   - the new Client Console page renders the full triage
 *     `FeedbackInbox` plus the `ClientShareCard` share-link control.
 *
 * Nothing here is product-page specific — every component takes its data and
 * callbacks via props so it can be dropped anywhere.
 */
import { useMemo, useState } from "react";
import {
  ThumbsUp, AlertCircle, CheckCircle2, Loader2, RefreshCw, Check,
  Sparkles, Inbox, ChevronRight, Share2, Copy, ExternalLink, X, Link2,
} from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  createShareLink, revokeShareLink,
  type OperatorFeedback, type FeedbackSectionKind,
} from "@/lib/api";

// Human labels for the three reviewable section kinds the client can comment
// on. Used both in the inbox grouping and (implicitly) to title inline cards.
export const FEEDBACK_SECTION_LABEL: Record<FeedbackSectionKind, string> = {
  angle: "Strategy / angle",
  messages: "Rewritten messages",
  adCopy: "Ad copy",
};

/**
 * A single client-feedback card — used both inline (next to the section the
 * client reviewed) and inside the triage inbox. Shows the verdict, who left it,
 * when, the optional note, and a resolve/reopen toggle. Marginless so callers
 * control spacing.
 */
export function InlineFeedback({
  fb,
  resolving,
  onResolve,
}: {
  fb: OperatorFeedback;
  resolving: boolean;
  onResolve: (fb: OperatorFeedback) => void;
}) {
  const approved = fb.verdict === "approved";
  const resolved = fb.status === "resolved";
  // The operator only OBSERVES the client-driven AI revision — it was generated,
  // accepted, and applied entirely on the client's side. Show the informational
  // card whenever a proposal exists on a text artifact; it never carries actions.
  const showSuggestion =
    fb.suggestionStatus != null &&
    (fb.sectionKind === "messages" || fb.sectionKind === "adCopy");
  // When a revision was applied live by the client, "resolving" this item is
  // really just acknowledging the notification — label it accordingly.
  const resolveLabel = resolved
    ? "Reopen"
    : fb.suggestionStatus === "applied"
    ? "Mark as read"
    : "Mark resolved";
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        resolved
          ? "border-white/[0.08] bg-white/[0.02]"
          : approved
          ? "border-emerald-500/30 bg-emerald-500/[0.05]"
          : "border-amber-500/30 bg-amber-500/[0.05]"
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${
              approved
                ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
                : "text-amber-300 border-amber-500/40 bg-amber-500/10"
            } ${resolved ? "opacity-60" : ""}`}
          >
            {approved ? <ThumbsUp size={10} /> : <AlertCircle size={10} />}
            {approved ? "Looks good" : "Needs changes"}
          </span>
          {fb.clientName && (
            <span className="text-[10px] font-mono text-white/55 truncate max-w-[12rem]">{fb.clientName}</span>
          )}
          <span className="text-[10px] font-mono text-white/30">
            {new Date(fb.updatedAt).toLocaleString()}
          </span>
          {resolved && (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-white/40">
              <CheckCircle2 size={9} className="text-emerald-400/70" /> Resolved
            </span>
          )}
          {/* An approval is a positive confirmation, not a task — surface it as a
              gentle "no action needed" note rather than a resolve control. */}
          {approved && (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-emerald-300/60">
              <CheckCircle2 size={9} className="text-emerald-400/70" /> No action needed
            </span>
          )}
        </div>
        {/* Only change-requests carry a resolve/reopen action. Approvals never do
            — the client said "looks good", so there's nothing for the operator to
            mark off. */}
        {!approved && (
          <button
            onClick={() => onResolve(fb)}
            disabled={resolving}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-all disabled:opacity-40 shrink-0 ${
              resolved
                ? "text-white/50 border border-white/[0.12] hover:text-white/80 hover:border-white/[0.25]"
                : "text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10"
            }`}
          >
            {resolving ? (
              <Loader2 size={10} className="animate-spin" />
            ) : resolved ? (
              <RefreshCw size={10} />
            ) : (
              <Check size={10} />
            )}
            {resolveLabel}
          </button>
        )}
      </div>
      {fb.note && (
        <p className="mt-2 text-[12px] text-white/75 leading-relaxed whitespace-pre-wrap border-l-2 border-white/[0.1] pl-2.5">
          {fb.note}
        </p>
      )}
      {showSuggestion && <OperatorSuggestionCard fb={fb} />}
    </div>
  );
}

// ── before→after diff helpers ────────────────────────────────────────────────
// The operator's "applied" notification renders an inline diff so it's obvious
// what the client changed: removed words in red (strikethrough), added words in
// green. We diff at two levels — first align message lines (LCS), then word-diff
// each changed line — so a one-word tweak only highlights that word.

type DiffSeg = { type: "same" | "del" | "add"; text: string };
type DiffRow =
  | { kind: "same"; text: string }
  | { kind: "change"; segs: DiffSeg[] }
  | { kind: "del"; text: string }
  | { kind: "add"; text: string };

// Split artifact copy into comparable message lines, stripping any leading
// bullet/number marker so re-numbering never registers as a change.
function diffSplitLines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

function diffTokenize(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

// Backward LCS length table; dp[i][j] = LCS(a[i:], b[j:]).
function lcsTable(a: string[], b: string[]): Int32Array[] {
  const n = a.length;
  const m = b.length;
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function wordSegments(before: string, after: string): DiffSeg[] {
  const a = diffTokenize(before);
  const b = diffTokenize(after);
  const dp = lcsTable(a, b);
  const out: DiffSeg[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < a.length) out.push({ type: "del", text: a[i++] });
  while (j < b.length) out.push({ type: "add", text: b[j++] });
  return out;
}

function buildLineDiff(before: string, after: string): DiffRow[] {
  const a = diffSplitLines(before);
  const b = diffSplitLines(after);
  const dp = lcsTable(a, b);
  const ops: { type: "same" | "del" | "add"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "del", text: a[i] }); i++; }
    else { ops.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < a.length) ops.push({ type: "del", text: a[i++] });
  while (j < b.length) ops.push({ type: "add", text: b[j++] });

  // Pair each run of removed lines with the following run of added lines so an
  // edited message shows as a single word-diffed row instead of red+green pair.
  const rows: DiffRow[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === "same") { rows.push({ kind: "same", text: ops[k].text }); k++; continue; }
    const dels: string[] = [];
    const adds: string[] = [];
    while (k < ops.length && ops[k].type === "del") dels.push(ops[k++].text);
    while (k < ops.length && ops[k].type === "add") adds.push(ops[k++].text);
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) rows.push({ kind: "change", segs: wordSegments(dels[p], adds[p]) });
    for (let p = pairs; p < dels.length; p++) rows.push({ kind: "del", text: dels[p] });
    for (let p = pairs; p < adds.length; p++) rows.push({ kind: "add", text: adds[p] });
  }
  return rows;
}

function DiffSegments({ segs }: { segs: DiffSeg[] }) {
  return (
    <>
      {segs.map((s, idx) => {
        // Never colorize whitespace — coloured gaps/newlines look like noise.
        if (/^\s+$/.test(s.text)) return <span key={idx}>{s.text}</span>;
        if (s.type === "del")
          return (
            <span key={idx} className="bg-rose-500/20 text-rose-300 line-through rounded-[3px] px-0.5">
              {s.text}
            </span>
          );
        if (s.type === "add")
          return (
            <span key={idx} className="bg-emerald-500/20 text-emerald-200 rounded-[3px] px-0.5">
              {s.text}
            </span>
          );
        return <span key={idx}>{s.text}</span>;
      })}
    </>
  );
}

function AppliedRevisionDiff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => buildLineDiff(before, after), [before, after]);
  return (
    <div className="rounded border border-white/[0.08] bg-black/20 px-2.5 py-2 max-h-72 overflow-auto space-y-1">
      {rows.map((row, idx) => {
        if (row.kind === "same")
          return (
            <div key={idx} className="flex gap-2 text-[11px] leading-relaxed text-white/45">
              <span className="select-none w-3 shrink-0 text-white/15">·</span>
              <span className="whitespace-pre-wrap">{row.text}</span>
            </div>
          );
        if (row.kind === "del")
          return (
            <div key={idx} className="flex gap-2 text-[11px] leading-relaxed text-rose-300/80">
              <span className="select-none w-3 shrink-0 text-rose-400/60">−</span>
              <span className="whitespace-pre-wrap line-through">{row.text}</span>
            </div>
          );
        if (row.kind === "add")
          return (
            <div key={idx} className="flex gap-2 text-[11px] leading-relaxed text-emerald-200">
              <span className="select-none w-3 shrink-0 text-emerald-400/70">+</span>
              <span className="whitespace-pre-wrap">{row.text}</span>
            </div>
          );
        return (
          <div key={idx} className="flex gap-2 text-[11px] leading-relaxed text-white/80">
            <span className="select-none w-3 shrink-0 text-amber-400/70">~</span>
            <span className="whitespace-pre-wrap"><DiffSegments segs={row.segs} /></span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The operator's READ-ONLY notification of a client-driven AI revision. In this
 * flow the client requests changes, the revision is generated automatically, and
 * the CLIENT accepts (applies it live) or sends it for manual review — entirely
 * on their side. The operator never generates, edits, or applies; this card only
 * reports what happened so they can acknowledge it. States keyed off
 * `fb.suggestionStatus`:
 *   "applied"  → the headline case: before→after diff of what the client put live
 *   "ready"    → client is still reviewing (informational)
 *   "declined" → client sent the note for manual review (informational)
 *   "failed"   → auto-revision errored; handle the note manually (informational)
 */
export function OperatorSuggestionCard({ fb }: { fb: OperatorFeedback }) {
  if (fb.suggestionStatus === "applied") {
    const before = (fb.suggestionOriginal ?? "").trim();
    const after = (fb.suggestion ?? "").trim();
    return (
      <div className="mt-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
            <Sparkles size={11} /> Client applied this AI revision — it's now live
          </div>
          {before && (
            <div className="flex items-center gap-3 text-[9px] font-mono uppercase tracking-wider text-white/40">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-[2px] bg-rose-500/30 border border-rose-500/40" />
                Removed
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-[2px] bg-emerald-500/30 border border-emerald-500/40" />
                Added
              </span>
            </div>
          )}
        </div>
        {before ? (
          <AppliedRevisionDiff before={before} after={after} />
        ) : (
          <div className="space-y-1">
            <div className="text-[9px] font-mono uppercase tracking-wider text-emerald-300/70">
              Now live
            </div>
            <div className="rounded border border-emerald-500/25 bg-emerald-500/[0.04] px-2.5 py-2 text-[11px] text-white/85 leading-relaxed whitespace-pre-wrap max-h-72 overflow-auto">
              {after || "—"}
            </div>
            <p className="text-[10px] text-white/35 font-mono">
              The previous version wasn't captured for this item, so no diff is available.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (fb.suggestionStatus === "ready") {
    return (
      <div className="mt-2.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-cyan-300/70">
        <Loader2 size={10} className="animate-spin" />
        AI revision generated — waiting on the client to accept or decline
      </div>
    );
  }

  if (fb.suggestionStatus === "declined") {
    return (
      <div className="mt-2.5 text-[10px] font-mono text-amber-300/80 border border-amber-500/25 bg-amber-500/[0.05] rounded-lg px-3 py-2 leading-relaxed">
        The client sent the AI revision for manual review and asked your team to handle this note
        by hand. The original copy is unchanged.
      </div>
    );
  }

  if (fb.suggestionStatus === "failed") {
    return (
      <div className="mt-2.5 text-[10px] font-mono text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-2 whitespace-pre-wrap">
        The automatic revision failed{fb.suggestionError ? `: ${fb.suggestionError}` : ""}. Handle
        this note manually.
      </div>
    );
  }

  return null;
}

/** Group a flat feedback list by angle (mirroring the angle order), each angle's
 *  items sorted angle → messages → adCopy. */
export function groupFeedbackByAngle(items: OperatorFeedback[], angleOrder: string[]) {
  const byAngle = new Map<string, OperatorFeedback[]>();
  for (const f of items) {
    const arr = byAngle.get(f.angleId) ?? [];
    arr.push(f);
    byAngle.set(f.angleId, arr);
  }
  const orderIndex = (id: string) => {
    const i = angleOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const kindRank: Record<FeedbackSectionKind, number> = { angle: 0, messages: 1, adCopy: 2 };
  return Array.from(byAngle.entries())
    .sort((a, b) => orderIndex(a[0]) - orderIndex(b[0]))
    .map(([angleId, list]) => ({
      angleId,
      angleName: list.find((it) => it.angleName)?.angleName ?? null,
      items: [...list].sort((x, y) => kindRank[x.sectionKind] - kindRank[y.sectionKind]),
    }));
}

type FeedbackGroup = { angleId: string; angleName: string | null; items: OperatorFeedback[] };

/**
 * Triage inbox — the client feedback that still NEEDS ACTION, grouped by angle.
 * Once the operator marks an item read/resolved it drops out of the default view
 * so the inbox only ever shows outstanding work. Resolved items stay reachable
 * behind a "Show resolved" toggle so an accidental resolve can be reopened.
 */
export function FeedbackInbox({
  feedback,
  angleOrder,
  resolvingId,
  busy,
  error,
  onResolve,
  onRefresh,
}: {
  feedback: OperatorFeedback[];
  angleOrder: string[];
  resolvingId: string | null;
  busy: boolean;
  error: string | null;
  onResolve: (fb: OperatorFeedback) => void;
  onRefresh: () => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  // Approvals ("looks good") are positive confirmations, not work items — they
  // never need a resolve click, so they're kept out of the actionable set and
  // shown separately for reference. The actionable inbox is open change-requests
  // only; resolved is the change-requests the operator has already handled.
  const actionableItems = useMemo(
    () => feedback.filter((f) => f.status === "open" && f.verdict !== "approved"),
    [feedback],
  );
  const approvedItems = useMemo(
    () => feedback.filter((f) => f.verdict === "approved"),
    [feedback],
  );
  const resolvedItems = useMemo(
    () => feedback.filter((f) => f.status !== "open" && f.verdict !== "approved"),
    [feedback],
  );
  const actionableCount = actionableItems.length;
  const approvedCount = approvedItems.length;
  const resolvedCount = resolvedItems.length;
  const actionableGroups = useMemo(
    () => groupFeedbackByAngle(actionableItems, angleOrder),
    [actionableItems, angleOrder],
  );
  const approvedGroups = useMemo(
    () => groupFeedbackByAngle(approvedItems, angleOrder),
    [approvedItems, angleOrder],
  );
  const resolvedGroups = useMemo(
    () => groupFeedbackByAngle(resolvedItems, angleOrder),
    [resolvedItems, angleOrder],
  );

  const renderGroup = (g: FeedbackGroup) => (
    <div key={g.angleId} className="space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400/70">
        {g.angleName || "Angle"}
      </div>
      {g.items.map((fb) => (
        <div key={fb.id} className="space-y-1">
          <div className="text-[10px] font-mono text-white/35 pl-0.5">
            {FEEDBACK_SECTION_LABEL[fb.sectionKind]}
          </div>
          <InlineFeedback fb={fb} resolving={resolvingId === fb.id} onResolve={onResolve} />
        </div>
      ))}
    </div>
  );

  return (
    <CollapsibleSection
      title="Client Feedback"
      icon={Inbox}
      subtitle="What the client flagged on the shared review page. Change-requests drop off as you mark them read/resolved; approvals need no action and are listed for reference."
      defaultOpen={actionableCount > 0}
      badge={
        actionableCount > 0 ? (
          <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300 bg-amber-500/10">
            {actionableCount} to action
          </span>
        ) : feedback.length > 0 ? (
          <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300 bg-emerald-500/10">
            All clear
          </span>
        ) : null
      }
      headerRight={
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          disabled={busy}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono text-white/60 border border-white/[0.08] hover:text-cyan-400 hover:border-cyan-500/40 transition-all disabled:opacity-40"
        >
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
          Refresh
        </button>
      }
    >
      {error && (
        <div className="mb-3 text-[10px] font-mono text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {feedback.length === 0 ? (
        <div className="text-xs font-mono text-white/40 italic border border-white/[0.06] bg-white/[0.02] rounded-lg px-4 py-6 text-center">
          No client feedback yet. Once the client reviews the shared page, their approvals and
          change-requests appear here.
        </div>
      ) : (
        <div className="space-y-5">
          {actionableCount > 0 ? (
            actionableGroups.map(renderGroup)
          ) : (
            <div className="flex items-center justify-center gap-2 text-xs font-mono text-emerald-300/80 border border-emerald-500/20 bg-emerald-500/[0.04] rounded-lg px-4 py-5 text-center">
              <CheckCircle2 size={14} />
              No change-requests need your attention.
            </div>
          )}

          {/* Approvals — positive confirmations the client left. Shown for
              reference only; they carry no resolve action. */}
          {approvedCount > 0 && (
            <div className="pt-1 border-t border-white/[0.06]">
              <div className="mt-3 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-300/70">
                <ThumbsUp size={11} />
                {approvedCount === 1 ? "1 client approval" : `${approvedCount} client approvals`}
              </div>
              <div className="mt-3 space-y-5">{approvedGroups.map(renderGroup)}</div>
            </div>
          )}

          {resolvedCount > 0 && (
            <div className="pt-1 border-t border-white/[0.06]">
              <button
                onClick={() => setShowResolved((v) => !v)}
                className="mt-3 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/40 hover:text-white/70 transition-all"
              >
                <ChevronRight
                  size={11}
                  className={`transition-transform ${showResolved ? "rotate-90" : ""}`}
                />
                {showResolved ? "Hide resolved" : `Show ${resolvedCount} resolved`}
              </button>
              {showResolved && (
                <div className="mt-3 space-y-5 opacity-60">{resolvedGroups.map(renderGroup)}</div>
              )}
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

/**
 * Self-contained client share-link control. Owns its own busy/error/copied
 * state and calls the operator share endpoints (`createShareLink` /
 * `revokeShareLink`), then asks the parent to refresh via `onChanged` so the
 * `shareToken` prop reflects the new state. Manager-or-admin gated on the
 * server — plain members get a 403 surfaced inline.
 */
export function ClientShareCard({
  productId,
  shareToken,
  onChanged,
}: {
  productId: string;
  shareToken: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const shareUrl = shareToken ? `${window.location.origin}/share/${shareToken}` : "";

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createShareLink(productId);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await revokeShareLink(productId);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy to clipboard — select and copy the link manually.");
    }
  }

  return (
    <CollapsibleSection
      title="Client Share Link"
      icon={Share2}
      subtitle="A read-only public link the client opens to review the angles, messages, and ad copy and leave feedback. No login required."
      defaultOpen={Boolean(shareToken)}
      badge={
        shareToken ? (
          <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300 bg-emerald-500/10">
            Live
          </span>
        ) : null
      }
    >
      {error && (
        <div className="mb-3 text-[10px] font-mono text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {shareToken ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-cyan-300/90 focus:outline-none focus:border-cyan-500/40"
            />
            <button
              onClick={copy}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono text-white/60 border border-white/[0.08] hover:text-cyan-400 hover:border-cyan-500/40 transition-all shrink-0"
            >
              {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono text-white/60 border border-white/[0.08] hover:text-cyan-400 hover:border-cyan-500/40 transition-all shrink-0"
            >
              <ExternalLink size={11} />
              Open
            </a>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={create}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-mono text-white/60 border border-white/[0.08] hover:text-amber-300 hover:border-amber-500/40 transition-all disabled:opacity-40"
            >
              <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
              Regenerate
            </button>
            <button
              onClick={revoke}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-mono text-rose-400 border border-rose-500/25 hover:bg-rose-500/10 transition-all disabled:opacity-40"
            >
              <X size={11} />
              Revoke
            </button>
          </div>
          <p className="text-[10px] font-mono text-white/35">
            Regenerating issues a new link and immediately breaks the old one. Revoking takes the
            page offline (the client sees an "unavailable" message).
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] font-mono text-white/40">
            Not shared yet. Create a link to let the client review this research.
          </p>
          <button
            onClick={create}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider font-semibold transition-all disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)", color: "#0D0F12" }}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
            {busy ? "Creating…" : "Create share link"}
          </button>
        </div>
      )}
    </CollapsibleSection>
  );
}
