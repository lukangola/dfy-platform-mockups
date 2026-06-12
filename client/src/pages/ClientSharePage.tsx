/**
 * ClientSharePage — the PUBLIC, read-only client share document (Phase 2) with
 * structured feedback collection (Phase 3).
 *
 * Reached at /share/:token, outside the auth gate. Fetches the sanitized
 * research payload from GET /api/share/:token (no cookies needed) and renders
 * it as a clean branded document.
 *
 * The client is asked to give ACTIVE FEEDBACK on three things per angle — the
 * angle/strategy, the messages, and the ad copy. For each, they pick a verdict
 * ("Looks good" / "Needs changes") and can leave a note. Feedback is one-way:
 * it's collected for the operator (PUT /api/share/:token/feedback/:anchorId);
 * no operator reply is ever shown here. A sticky left-hand CHECKLIST tracks
 * which sections have feedback (green = approved, amber = changes requested) and
 * lets the client jump between them; progress is driven by REAL submitted
 * feedback, not a self-toggle. State is persisted server-side (so it survives a
 * device change) with localStorage as a fast cache keyed by token. Each section
 * carries a stable anchor id (`angle-<id>`, `angle-<id>-messages`,
 * `angle-<id>-adCopy`) — the same handle the operator's inbox + inline
 * annotations use. Background research (strategic diagnosis + raw mined
 * statements) lives in collapsed accordions — readable on demand, no feedback
 * required.
 */
import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import {
  Loader2, AlertTriangle, Target, FileText, Quote, MessageSquare,
  Megaphone, MessageCircle, BookOpen, CheckCircle2, Circle, ListChecks,
  AlertCircle, ThumbsUp, PencilLine, Sparkles, Check, X, Wand2,
} from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  getSharedResearch, getShareFeedback, submitShareFeedback, clearShareFeedback,
  acceptShareSuggestion, declineShareSuggestion,
  type SharedResearchPayload, type SharedAngle, type FeedbackVerdict,
  type FeedbackSuggestionStatus, type ShareFeedback,
} from "@/lib/api";

// Mirrors the operator-side helper in ProductDetailPage: the research master
// prompt sometimes bakes a verbatim "Customer Statements" list into an angle's
// body. Those live in their own dedicated avatar-statements accordion, so strip
// them out of the angle prose to avoid duplication.
function stripCustomerStatements(block: string): string {
  const lines = block.split("\n");
  const out: string[] = [];
  let i = 0;
  const isHeaderLine = (line: string) =>
    /customer statements/i.test(line) && !/^\s*[-*•]\s+/.test(line);
  const isListOrBlank = (line: string) =>
    line.trim() === "" || /^\s*([-*•]|\d+[.)])\s+/.test(line);
  while (i < lines.length) {
    if (isHeaderLine(lines[i])) {
      i++;
      while (i < lines.length && isListOrBlank(lines[i])) i++;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Split a messages artifact into individual messages for numbered display in the
 * CLIENT UI only (so the client can say "message 3 needs work"). Messages come
 * as plain text — either one per line or separated by blank lines. We prefer
 * blank-line blocks when present (handles multi-line messages), otherwise fall
 * back to single lines, and strip any leading bullet/number the model already
 * emitted so we don't double-number. Returns the original as a single item if it
 * can't be meaningfully split.
 */
function splitMessages(content: string): string[] {
  const stripMarker = (s: string) => s.replace(/^\s*([-*•]|\d+[.)])\s+/, "").trim();
  const byBlank = content
    .split(/\n\s*\n/)
    .map((b) => stripMarker(b.trim()))
    .filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  const byLine = content
    .split(/\n/)
    .map((l) => stripMarker(l.trim()))
    .filter(Boolean);
  if (byLine.length > 1) return byLine;
  const single = content.trim();
  return single ? [single] : [];
}

// ── Feedback model ─────────────────────────────────────────────────────
// A section is only a feedback target once it actually has content to review,
// so the checklist total reflects what's genuinely reviewable (e.g. an angle
// whose messages haven't been generated yet contributes only its strategy row).
type FeedbackEntry = {
  verdict: FeedbackVerdict;
  note: string | null;
  // The AI revision auto-generated when the client asks for changes on a text
  // section. The client accepts ("Use this version") — which applies it to the
  // live copy immediately — or declines ("Send for manual review").
  suggestion: string | null;
  suggestionStatus: FeedbackSuggestionStatus;
  suggestionError: string | null;
};
type FeedbackItem = { id: string; label: string };
type FeedbackGroup = { angleId: string; index: number; name: string; items: FeedbackItem[] };

/** Normalize a server feedback row into the page's local entry shape. */
function entryFromRow(row: ShareFeedback): FeedbackEntry {
  return {
    verdict: row.verdict,
    note: row.note,
    suggestion: row.suggestion ?? null,
    suggestionStatus: row.suggestionStatus ?? null,
    suggestionError: row.suggestionError ?? null,
  };
}

function hasContent(artifact: SharedAngle["artifacts"][keyof SharedAngle["artifacts"]]): boolean {
  return Boolean(artifact?.content?.trim());
}

function buildGroups(angles: SharedAngle[]): FeedbackGroup[] {
  return angles.map((a, i) => {
    const items: FeedbackItem[] = [{ id: `angle-${a.id}`, label: "Angle & strategy" }];
    if (hasContent(a.artifacts?.messages)) items.push({ id: `angle-${a.id}-messages`, label: "Messages" });
    if (hasContent(a.artifacts?.adCopy)) items.push({ id: `angle-${a.id}-adCopy`, label: "Ad copy" });
    return { angleId: a.id, index: i, name: a.name, items };
  });
}

function scrollToAnchor(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function FeedbackBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border border-cyan-500/40 text-cyan-300 bg-cyan-500/10">
      <MessageCircle size={9} />
      Feedback wanted
    </span>
  );
}

/** Header chip reflecting the client's current verdict for a section. */
function SectionStatusChip({ entry }: { entry?: FeedbackEntry }) {
  if (!entry) return <FeedbackBadge />;
  // An applied AI revision means the change is already live — show it as resolved
  // ("Updated") rather than leaving it stuck on "Needs changes".
  const applied = entry.suggestionStatus === "applied";
  const positive = entry.verdict === "approved" || applied;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${
        positive
          ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
          : "border-amber-500/40 text-amber-300 bg-amber-500/10"
      }`}
    >
      {positive ? <CheckCircle2 size={9} /> : <AlertCircle size={9} />}
      {applied ? "Updated" : positive ? "Looks good" : "Needs changes"}
    </span>
  );
}

/**
 * The Approve+Note control shown under every feedback target. Picks a verdict,
 * optionally adds a note, and submits to the server. Once submitted it collapses
 * to a summary with Edit / Clear. Self-contained draft state; resyncs whenever
 * the saved entry changes (e.g. server hydration arrives after first paint).
 */
function FeedbackControl({
  current,
  busy,
  error,
  revisable,
  applied,
  onSubmit,
  onClear,
}: {
  current?: FeedbackEntry;
  busy: boolean;
  error?: boolean;
  // When true, submitting a "needs changes" verdict kicks off an inline AI
  // revision — so the submit button explains the (slightly longer) wait.
  revisable?: boolean;
  // When true, this section's change is already applied & live. We drop the
  // heavy "you requested changes" summary but keep a quiet way back into editing
  // so the client can refine if they remembered something else.
  applied?: boolean;
  onSubmit: (verdict: FeedbackVerdict, note: string) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(!current);
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(current?.verdict ?? null);
  const [note, setNote] = useState(current?.note ?? "");

  useEffect(() => {
    setVerdict(current?.verdict ?? null);
    setNote(current?.note ?? "");
    if (current) setEditing(false);
    // Resync only when the *saved* values change, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.verdict, current?.note]);

  if (current && !editing) {
    // Applied & live: the full summary would re-introduce the "you requested
    // changes" framing we just cleared. Keep only a quiet "Edit feedback" entry
    // point — clicking it reopens the verdict + note editor (which can kick off a
    // fresh revision if they ask for another change).
    if (applied) {
      return (
        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <button
            onClick={() => setEditing(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-md border border-white/10 text-white/45 hover:text-white/80 hover:border-white/25 transition-colors"
          >
            <PencilLine size={11} /> Edit feedback
          </button>
          <span className="text-[10px] text-white/30">
            Remembered something else? Add to your notes.
          </span>
        </div>
      );
    }
    const approved = current.verdict === "approved";
    return (
      <div
        className={`mt-4 rounded-lg border px-3.5 py-3 flex items-start gap-2.5 ${
          approved
            ? "border-emerald-500/25 bg-emerald-500/[0.06]"
            : "border-amber-500/25 bg-amber-500/[0.06]"
        }`}
      >
        {approved ? (
          <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-[12px] font-semibold ${approved ? "text-emerald-200" : "text-amber-200"}`}>
            {approved ? "You marked this as looking good" : "You requested changes"}
          </p>
          {current.note && (
            <p className="text-[12px] text-white/65 mt-1 whitespace-pre-wrap leading-relaxed">
              {current.note}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setEditing(true)}
            disabled={busy}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-white/10 text-white/55 hover:text-white/85 hover:border-white/25 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onClear}
            disabled={busy}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-white/10 text-white/40 hover:text-rose-300 hover:border-rose-500/30 transition-colors"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : "Clear"}
          </button>
        </div>
      </div>
    );
  }

  const changes = verdict === "changes";
  return (
    <div className="mt-4 space-y-3">
      <p className="text-[10px] font-mono uppercase tracking-wider text-white/40">Your feedback</p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setVerdict("approved")}
          className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-all ${
            verdict === "approved"
              ? "border-emerald-500/50 text-emerald-200 bg-emerald-500/15"
              : "border-white/10 text-white/55 hover:text-white/85 hover:border-white/25"
          }`}
        >
          <ThumbsUp size={13} /> Looks good
        </button>
        <button
          onClick={() => setVerdict("changes")}
          className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-all ${
            verdict === "changes"
              ? "border-amber-500/50 text-amber-200 bg-amber-500/15"
              : "border-white/10 text-white/55 hover:text-white/85 hover:border-white/25"
          }`}
        >
          <PencilLine size={13} /> Needs changes
        </button>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder={
          changes
            ? "What should change? The more specific, the better."
            : "Anything you'd like us to know? (optional)"
        }
        className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-[13px] text-white/85 placeholder:text-white/30 focus:outline-none focus:border-cyan-500/40 resize-y"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => verdict && onSubmit(verdict, note)}
          disabled={!verdict || busy}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)", color: "#06222B" }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          {busy && changes && revisable ? "Generating a revised version…" : "Submit feedback"}
        </button>
        {current && (
          <button
            onClick={() => setEditing(false)}
            disabled={busy}
            className="text-[11px] font-mono uppercase tracking-wider px-2 py-1 text-white/40 hover:text-white/70 transition-colors"
          >
            Cancel
          </button>
        )}
        {error && (
          <span className="text-[11px] text-rose-300 inline-flex items-center gap-1">
            <AlertTriangle size={11} /> Couldn't save — try again
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Sticky checklist sidebar — feedback completeness at a glance + jump nav. Each
 * row reflects its section's verdict (emerald = approved, amber = changes, empty
 * = no feedback yet). The whole row navigates; the active section (scroll-spy)
 * is highlighted. Progress is driven by submitted feedback.
 */
function ReviewChecklist({
  groups,
  feedback,
  activeId,
}: {
  groups: FeedbackGroup[];
  feedback: Record<string, FeedbackEntry>;
  activeId: string | null;
}) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const done = groups.reduce((n, g) => n + g.items.filter((it) => feedback[it.id]).length, 0);
  // Applied revisions are done — don't keep counting them as outstanding changes.
  const changes = groups.reduce(
    (n, g) =>
      n +
      g.items.filter(
        (it) =>
          feedback[it.id]?.verdict === "changes" &&
          feedback[it.id]?.suggestionStatus !== "applied",
      ).length,
    0,
  );
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <nav className="rounded-2xl border border-white/[0.08] p-4" style={{ background: "#13161F" }}>
      <div className="flex items-center gap-2 mb-3">
        <ListChecks size={14} className="text-cyan-400" />
        <h2 className="text-xs font-semibold text-white/80">Your feedback</h2>
        <span className="ml-auto text-[10px] font-mono text-white/45">
          {done}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background:
              done === total && total > 0
                ? "linear-gradient(90deg,#10b981,#34d399)"
                : "linear-gradient(90deg,#00D4FF,#0099CC)",
          }}
        />
      </div>
      <p className="text-[10px] font-mono text-white/35 mb-4">
        {done === total && total > 0
          ? "All sections reviewed — thank you!"
          : `${total - done} left${changes ? ` · ${changes} need changes` : ""}`}
      </p>

      <div className="space-y-3 max-h-[calc(100vh-15rem)] overflow-y-auto pr-1">
        {groups.map((g) => {
          const groupDone = g.items.every((it) => feedback[it.id]);
          return (
            <div key={g.angleId}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-white/35 mb-1 flex items-center gap-1.5">
                <span className="truncate">
                  {g.index + 1}. {g.name}
                </span>
                {groupDone && <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />}
              </p>
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const entry = feedback[it.id];
                  const isActive = activeId === it.id;
                  return (
                    <li key={it.id}>
                      <button
                        onClick={() => scrollToAnchor(it.id)}
                        className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 transition-all text-left ${
                          isActive ? "bg-cyan-500/10 border border-cyan-500/25" : "border border-transparent"
                        }`}
                      >
                        {entry ? (
                          entry.verdict === "approved" || entry.suggestionStatus === "applied" ? (
                            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                          ) : (
                            <AlertCircle size={14} className="text-amber-400 shrink-0" />
                          )
                        ) : (
                          <Circle size={14} className="text-white/30 shrink-0" />
                        )}
                        <span
                          className={`flex-1 min-w-0 text-[11px] truncate transition-colors ${
                            isActive ? "text-cyan-300" : entry ? "text-white/45" : "text-white/70"
                          }`}
                        >
                          {it.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * The client-facing AI revision panel, shown under a "needs changes" note on a
 * text section once a revision has been auto-generated. The client decides:
 *   "ready"     → review the rewrite + "Use this version" / "Send for manual review"
 *   "applied"   → the client chose the rewrite; it's now live (the copy above updates)
 *   "declined"  → sent to the team for manual review (reassures the client)
 *   "failed"    → auto-revision failed; we'll still handle it manually
 * Choosing "Use this version" applies the rewrite to the live copy immediately —
 * no operator step — so the language here can promise it's live.
 */
function SuggestionReview({
  entry,
  busy,
  error,
  onAccept,
  onDecline,
}: {
  entry: FeedbackEntry;
  busy: boolean;
  error?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const status = entry.suggestionStatus;
  if (!status) return null;

  if (status === "declined") {
    return (
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-3 flex items-start gap-2.5">
        <MessageCircle size={15} className="text-white/50 shrink-0 mt-0.5" />
        <p className="text-[12px] text-white/65 leading-relaxed">
          No problem — we've sent your notes to the team for manual review. The original copy is
          unchanged for now.
        </p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-3 flex items-start gap-2.5">
        <MessageCircle size={15} className="text-white/50 shrink-0 mt-0.5" />
        <p className="text-[12px] text-white/65 leading-relaxed">
          Thanks for the notes. We couldn't auto-generate a revision here, but your feedback is
          saved and our team will handle this one manually.
        </p>
      </div>
    );
  }

  if (status === "applied") {
    return (
      <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-3 flex items-start gap-2.5">
        <Sparkles size={15} className="text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-[12px] text-emerald-100/90 leading-relaxed">
          Your requested change has been applied — the copy above reflects your feedback.
        </p>
      </div>
    );
  }

  // status === "ready" — present the rewrite and let the client choose.
  return (
    <div className="mt-3 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.05] p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-300">
        <Wand2 size={13} /> We drafted a revised version from your notes
      </div>
      <p className="text-[11px] text-white/50 leading-relaxed">
        Have a read. If it captures what you meant, choose it and it goes live right away. If not,
        send it for manual review and our team will work through your notes by hand.
      </p>
      <div className="rounded-lg border border-cyan-500/20 bg-black/20 px-3.5 py-3 text-sm text-white/85 leading-relaxed whitespace-pre-wrap">
        {entry.suggestion || "—"}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onAccept}
          disabled={busy || !(entry.suggestion ?? "").trim()}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", color: "#06222B" }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Use this version
        </button>
        <button
          onClick={onDecline}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3.5 py-1.5 rounded-lg border border-white/12 text-white/60 hover:text-white/85 hover:border-white/25 transition-all disabled:opacity-40"
        >
          <X size={13} /> Send for manual review
        </button>
        {error && (
          <span className="text-[11px] text-rose-300 inline-flex items-center gap-1">
            <AlertTriangle size={11} /> Couldn't save — try again
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One "feedback wanted" block — the messages or ad copy for an angle. Rendered
 * inline (not collapsed) so the client sees it without an extra click, with a
 * stable anchor id for the checklist + operator. Only mounted when there's
 * content to review; running/empty sections render a status line and no control.
 */
function FeedbackArtifact({
  anchorId,
  title,
  icon: Icon,
  subtitle,
  artifact,
  entry,
  busy,
  error,
  numbered,
  onSubmit,
  onClear,
  onAcceptSuggestion,
  onDeclineSuggestion,
}: {
  anchorId: string;
  title: string;
  icon: React.ElementType;
  subtitle: string;
  artifact: SharedAngle["artifacts"][keyof SharedAngle["artifacts"]];
  entry?: FeedbackEntry;
  busy: boolean;
  error?: boolean;
  /** CLIENT-ONLY: render the content as a numbered list (used for Messages, so
   *  the client can reference "message 3" when giving feedback). */
  numbered?: boolean;
  onSubmit: (verdict: FeedbackVerdict, note: string) => void;
  onClear: () => void;
  onAcceptSuggestion: () => void;
  onDeclineSuggestion: () => void;
}) {
  const content = artifact?.content?.trim() || "";
  const running = artifact?.status === "running";
  return (
    <section
      id={anchorId}
      className={`scroll-mt-6 rounded-xl border overflow-hidden transition-colors ${
        entry
          ? entry.verdict === "approved" || entry.suggestionStatus === "applied"
            ? "border-emerald-500/[0.22]"
            : "border-amber-500/[0.22]"
          : "border-cyan-500/[0.18]"
      }`}
      style={{ background: "#10141C" }}
    >
      <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-white/[0.05]">
        <Icon size={14} className="text-cyan-400 shrink-0" />
        <h4 className="text-sm font-semibold text-white/85 flex-1">{title}</h4>
        <SectionStatusChip entry={entry} />
      </div>
      <div className="px-5 py-4">
        <p className="text-[11px] text-white/40 mb-3">{subtitle}</p>
        {content ? (
          <>
            {numbered ? (
              <ol className="space-y-2.5">
                {splitMessages(content).map((msg, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-mono font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20"
                      style={{ marginTop: 1 }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap text-sm text-white/85 leading-relaxed">
                      {msg}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="whitespace-pre-wrap text-sm text-white/85 leading-relaxed">{content}</div>
            )}
            {/* Once a revision is applied the change is live and "proven": lead
                with the green confirmation, then drop the verdict/note summary in
                favour of a quiet "Edit feedback" entry point so the section reads
                as resolved but the client can still refine it. */}
            {entry?.suggestionStatus === "applied" ? (
              <>
                <SuggestionReview
                  entry={entry}
                  busy={busy}
                  error={error}
                  onAccept={onAcceptSuggestion}
                  onDecline={onDeclineSuggestion}
                />
                <FeedbackControl
                  current={entry}
                  busy={busy}
                  error={error}
                  revisable
                  applied
                  onSubmit={onSubmit}
                  onClear={onClear}
                />
              </>
            ) : (
              <>
                <FeedbackControl
                  current={entry}
                  busy={busy}
                  error={error}
                  revisable
                  onSubmit={onSubmit}
                  onClear={onClear}
                />
                {entry && (
                  <SuggestionReview
                    entry={entry}
                    busy={busy}
                    error={error}
                    onAccept={onAcceptSuggestion}
                    onDecline={onDeclineSuggestion}
                  />
                )}
              </>
            )}
          </>
        ) : running ? (
          <div className="flex items-center gap-2 text-[12px] font-mono text-amber-300/80 py-1">
            <Loader2 size={12} className="animate-spin" />
            This section is still being prepared…
          </div>
        ) : (
          <p className="text-[12px] font-mono text-white/35 py-1">Not available yet.</p>
        )}
      </div>
    </section>
  );
}

function AngleBlock({
  angle,
  index,
  feedback,
  busyAnchor,
  errorAnchor,
  onSubmit,
  onClear,
  onAcceptSuggestion,
  onDeclineSuggestion,
}: {
  angle: SharedAngle;
  index: number;
  feedback: Record<string, FeedbackEntry>;
  busyAnchor: string | null;
  errorAnchor: string | null;
  onSubmit: (anchorId: string, verdict: FeedbackVerdict, note: string) => void;
  onClear: (anchorId: string) => void;
  onAcceptSuggestion: (anchorId: string) => void;
  onDeclineSuggestion: (anchorId: string) => void;
}) {
  const statements = angle.artifacts?.statements;
  const statementsContent = statements?.content?.trim() || "";
  const angleAnchor = `angle-${angle.id}`;
  const messagesAnchor = `angle-${angle.id}-messages`;
  const adCopyAnchor = `angle-${angle.id}-adCopy`;
  return (
    <section className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: "#13161F" }}>
      {/* Angle header + prose — the "Angle & strategy" feedback target */}
      <div id={angleAnchor} className="scroll-mt-6">
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)" }}
          >
            <Target size={15} className="text-[#0D0F12]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/35">Angle {index + 1}</p>
            <h3 className="text-base font-semibold text-white/90 truncate">{angle.name}</h3>
          </div>
          <SectionStatusChip entry={feedback[angleAnchor]} />
        </div>

        <div className="px-6 pt-5">
          <article className="prose-report max-w-none">
            <Streamdown>{stripCustomerStatements(angle.block)}</Streamdown>
          </article>
          <FeedbackControl
            current={feedback[angleAnchor]}
            busy={busyAnchor === angleAnchor}
            error={errorAnchor === angleAnchor}
            onSubmit={(v, n) => onSubmit(angleAnchor, v, n)}
            onClear={() => onClear(angleAnchor)}
          />
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Feedback-wanted: messages + ad copy */}
        <FeedbackArtifact
          anchorId={messagesAnchor}
          title="Messages"
          icon={MessageSquare}
          subtitle="First-person ad messages written for this angle. Do these sound like your customer? Refer to a message by its number when leaving notes."
          artifact={angle.artifacts?.messages}
          entry={feedback[messagesAnchor]}
          busy={busyAnchor === messagesAnchor}
          error={errorAnchor === messagesAnchor}
          numbered
          onSubmit={(v, n) => onSubmit(messagesAnchor, v, n)}
          onClear={() => onClear(messagesAnchor)}
          onAcceptSuggestion={() => onAcceptSuggestion(messagesAnchor)}
          onDeclineSuggestion={() => onDeclineSuggestion(messagesAnchor)}
        />
        <FeedbackArtifact
          anchorId={adCopyAnchor}
          title="Ad copy"
          icon={Megaphone}
          subtitle="A complete primary ad for this angle — hook, benefits, and call to action. Does the voice and claims feel right?"
          artifact={angle.artifacts?.adCopy}
          entry={feedback[adCopyAnchor]}
          busy={busyAnchor === adCopyAnchor}
          error={errorAnchor === adCopyAnchor}
          onSubmit={(v, n) => onSubmit(adCopyAnchor, v, n)}
          onClear={() => onClear(adCopyAnchor)}
          onAcceptSuggestion={() => onAcceptSuggestion(adCopyAnchor)}
          onDeclineSuggestion={() => onDeclineSuggestion(adCopyAnchor)}
        />

        {/* Reference: raw mined avatar statements (no feedback needed) */}
        {statementsContent && (
          <CollapsibleSection
            title="Real-life avatar statements"
            icon={Quote}
            subtitle="Background only — real people voicing this angle's pain in the wild, mined verbatim from forums and social comments. No feedback needed."
          >
            <article className="prose-report max-w-none">
              <Streamdown>{statementsContent}</Streamdown>
            </article>
          </CollapsibleSection>
        )}
      </div>
    </section>
  );
}

export default function ClientSharePage({ token }: { token: string }) {
  const [data, setData] = useState<SharedResearchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  // Submitted feedback keyed by anchor id. Server is the source of truth;
  // localStorage is a fast cache so the checklist paints instantly on reload.
  const fbKey = `share-feedback:${token}`;
  const nameKey = `share-name:${token}`;
  const [feedback, setFeedback] = useState<Record<string, FeedbackEntry>>({});
  const [clientName, setClientName] = useState("");
  const [busyAnchor, setBusyAnchor] = useState<string | null>(null);
  const [errorAnchor, setErrorAnchor] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Fetch the document.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInvalid(false);
    getSharedResearch(token)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Hydrate feedback: localStorage first (instant), then server truth.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(fbKey);
      if (raw) setFeedback(JSON.parse(raw) as Record<string, FeedbackEntry>);
    } catch {
      /* ignore */
    }
    try {
      const rawName = localStorage.getItem(nameKey);
      if (rawName) setClientName(rawName);
    } catch {
      /* ignore */
    }
    let cancelled = false;
    getShareFeedback(token)
      .then(({ feedback: rows }) => {
        if (cancelled) return;
        const rec: Record<string, FeedbackEntry> = {};
        for (const r of rows) rec[r.anchorId] = entryFromRow(r);
        setFeedback(rec);
        try {
          localStorage.setItem(fbKey, JSON.stringify(rec));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* keep localStorage copy if the server fetch fails */
      });
    return () => {
      cancelled = true;
    };
  }, [token, fbKey, nameKey]);

  const groups = useMemo(() => (data ? buildGroups(data.research.angles) : []), [data]);

  const persist = (rec: Record<string, FeedbackEntry>) => {
    try {
      localStorage.setItem(fbKey, JSON.stringify(rec));
    } catch {
      /* ignore */
    }
  };

  const onNameChange = (v: string) => {
    setClientName(v);
    try {
      localStorage.setItem(nameKey, v);
    } catch {
      /* ignore */
    }
  };

  const submitFeedback = async (anchorId: string, verdict: FeedbackVerdict, note: string) => {
    setBusyAnchor(anchorId);
    setErrorAnchor(null);
    try {
      const { feedback: saved } = await submitShareFeedback(token, anchorId, {
        verdict,
        note: note.trim() || undefined,
        clientName: clientName.trim() || undefined,
      });
      setFeedback((prev) => {
        const next = { ...prev, [anchorId]: entryFromRow(saved) };
        persist(next);
        return next;
      });
    } catch {
      setErrorAnchor(anchorId);
    } finally {
      setBusyAnchor(null);
    }
  };

  // Client accepts the auto-generated revision — this applies it to the LIVE copy
  // immediately (status → "applied"). We then re-fetch the research so the copy
  // shown above this panel reflects the change the client just approved.
  const acceptSuggestion = async (anchorId: string) => {
    setBusyAnchor(anchorId);
    setErrorAnchor(null);
    try {
      const { feedback: saved } = await acceptShareSuggestion(token, anchorId);
      setFeedback((prev) => {
        const next = { ...prev, [anchorId]: entryFromRow(saved) };
        persist(next);
        return next;
      });
      // Re-pull the sanitized research so the now-live artifact replaces the
      // stale copy in the document. Best-effort: a failed refresh leaves the
      // applied confirmation in place; the next page load will reconcile.
      try {
        const refreshed = await getSharedResearch(token);
        setData(refreshed);
      } catch {
        /* keep the applied state; copy will reconcile on next load */
      }
    } catch {
      setErrorAnchor(anchorId);
    } finally {
      setBusyAnchor(null);
    }
  };

  // Client declines the revision — keeps the original and flags the note for the
  // team to handle manually (status → "declined", feedback stays open).
  const declineSuggestion = async (anchorId: string) => {
    setBusyAnchor(anchorId);
    setErrorAnchor(null);
    try {
      const { feedback: saved } = await declineShareSuggestion(token, anchorId);
      setFeedback((prev) => {
        const next = { ...prev, [anchorId]: entryFromRow(saved) };
        persist(next);
        return next;
      });
    } catch {
      setErrorAnchor(anchorId);
    } finally {
      setBusyAnchor(null);
    }
  };

  const clearFeedback = async (anchorId: string) => {
    setBusyAnchor(anchorId);
    setErrorAnchor(null);
    try {
      await clearShareFeedback(token, anchorId);
      setFeedback((prev) => {
        const next = { ...prev };
        delete next[anchorId];
        persist(next);
        return next;
      });
    } catch {
      setErrorAnchor(anchorId);
    } finally {
      setBusyAnchor(null);
    }
  };

  // Scroll-spy: highlight the feedback section nearest the top of the viewport.
  useEffect(() => {
    const ids = groups.flatMap((g) => g.items.map((it) => it.id));
    if (ids.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -75% 0px", threshold: 0 },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [groups]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0A0B0E" }}>
        <div className="flex items-center gap-2 text-white/40 font-mono text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  if (invalid || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#0A0B0E" }}>
        <div className="max-w-md text-center space-y-3">
          <div className="w-12 h-12 rounded-xl border border-rose-500/30 bg-rose-500/10 flex items-center justify-center mx-auto">
            <AlertTriangle size={22} className="text-rose-400" />
          </div>
          <h1 className="text-lg font-semibold text-white/85">This link isn't available</h1>
          <p className="text-sm text-white/45">
            The share link is invalid or has been revoked. Please ask your contact for a fresh link.
          </p>
        </div>
      </div>
    );
  }

  const { brand, product, research } = data;
  const angles = research.angles;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const done = groups.reduce((n, g) => n + g.items.filter((it) => feedback[it.id]).length, 0);

  return (
    <div className="min-h-screen" style={{ background: "#0A0B0E", color: "#E2E8F0" }}>
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 sm:py-14 space-y-8">
        {/* Branded header */}
        <header className="space-y-5">
          <div className="flex items-center gap-3">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.name} className="h-9 w-auto max-w-[160px] object-contain" />
            ) : (
              brand.name && <span className="text-sm font-semibold tracking-wide text-white/70">{brand.name}</span>
            )}
          </div>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-cyan-400/80">
              Research &amp; Messaging Review
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mt-1.5">{product.name}</h1>
          </div>
        </header>

        {/* Feedback callout */}
        <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.05] p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <MessageCircle size={16} className="text-cyan-300" />
            </div>
            <div className="space-y-3 flex-1 min-w-0">
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-white/90">We'd love your feedback</h2>
                <p className="text-sm text-white/60 leading-relaxed">
                  For each section below, let us know if it's{" "}
                  <span className="text-emerald-300 font-medium">looking good</span> or{" "}
                  <span className="text-amber-300 font-medium">needs changes</span>, and add a note if you
                  have one. Use the checklist on the left to track what's left. The background research is
                  included too — open it for more depth, but no feedback is needed there.
                </p>
              </div>
              {angles.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <label htmlFor="share-name" className="text-[11px] font-mono uppercase tracking-wider text-white/40 shrink-0">
                    Your name
                  </label>
                  <input
                    id="share-name"
                    value={clientName}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="optional — so we know who left the notes"
                    className="flex-1 min-w-0 max-w-xs rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-[13px] text-white/85 placeholder:text-white/30 focus:outline-none focus:border-cyan-500/40"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {angles.length > 0 ? (
          <div className="flex gap-8 items-start">
            {/* Sticky checklist sidebar (desktop) */}
            <aside className="hidden lg:block w-64 shrink-0">
              <div className="sticky top-8">
                <ReviewChecklist groups={groups} feedback={feedback} activeId={activeId} />
              </div>
            </aside>

            {/* Document */}
            <main className="flex-1 min-w-0 max-w-3xl space-y-8">
              {/* Compact progress strip (mobile only) */}
              <div className="lg:hidden flex items-center gap-3 rounded-xl border border-white/[0.08] px-4 py-3" style={{ background: "#13161F" }}>
                <ListChecks size={14} className="text-cyan-400 shrink-0" />
                <span className="text-[11px] font-mono text-white/55">
                  {done}/{total} reviewed
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${total ? Math.round((done / total) * 100) : 0}%`,
                      background:
                        done === total && total > 0
                          ? "linear-gradient(90deg,#10b981,#34d399)"
                          : "linear-gradient(90deg,#00D4FF,#0099CC)",
                    }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-white/40 flex items-center gap-2">
                  <Target size={13} className="text-cyan-400" />
                  Marketing Angles
                </h2>
              </div>

              {angles.map((angle, i) => (
                <AngleBlock
                  key={angle.id}
                  angle={angle}
                  index={i}
                  feedback={feedback}
                  busyAnchor={busyAnchor}
                  errorAnchor={errorAnchor}
                  onSubmit={submitFeedback}
                  onClear={clearFeedback}
                  onAcceptSuggestion={acceptSuggestion}
                  onDeclineSuggestion={declineSuggestion}
                />
              ))}

              {/* Background strategic research — reference only, collapsed */}
              {research.markdown && (
                <CollapsibleSection
                  title="Strategic research (background)"
                  icon={BookOpen}
                  subtitle="The full strategic diagnosis behind these angles. Optional reading — no feedback needed."
                >
                  <article className="prose-report max-w-none">
                    <Streamdown>{research.markdown}</Streamdown>
                  </article>
                </CollapsibleSection>
              )}

              <footer className="pt-6 border-t border-white/[0.06] flex items-center gap-2 text-[11px] font-mono text-white/30">
                <FileText size={12} />
                Shared research document{brand.name ? ` · ${brand.name}` : ""}
              </footer>
            </main>
          </div>
        ) : (
          // No angles yet — just render the strategic markdown.
          <div className="max-w-3xl">
            {research.markdown ? (
              <article className="prose-report max-w-none">
                <Streamdown>{research.markdown}</Streamdown>
              </article>
            ) : (
              <p className="text-sm text-white/40 font-mono">No research available yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
