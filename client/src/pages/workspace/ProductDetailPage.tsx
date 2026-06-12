/**
 * DESIGN: Studio Control Room — Product Detail with Async Research
 * Polls /api/products/:id until research is complete, then renders the
 * full strategic diagnosis + 5 elaborated angles as markdown.
 * Also exposes the scraped product image candidates (up to ~10) so the
 * user can promote a different main image, upload their own, or paste a URL.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Streamdown } from "streamdown";
import {
  ArrowLeft, ExternalLink, CheckCircle2, Loader2, Clock,
  Video, ChevronRight, ChevronDown, Package, AlertTriangle, RefreshCw,
  Upload, Link2, Check, ImageIcon, LayoutGrid, FileText, Target, Trash2,
  Plus, X, MessageSquare, Pencil, Save, Quote, Megaphone,
} from "lucide-react";
import {
  getProduct, retriggerResearch, uploadProductImage,
  setProductMainImage, addProductImageCandidate, deleteProductImageCandidate,
  generateReferenceSheet, deleteProduct, addProductAngle,
  updateProductMechanism, patchProduct, generateAngleArtifact,
  type Product, type ProductImageCandidate, type ProductMechanism,
  type ProductAngle, type AngleArtifactKind,
} from "@/lib/api";

type Status = Product["researchStatus"];

function ResearchStatusBadge({ status }: { status: Status }) {
  const config: Record<Status, { label: string; color: string; icon: React.ElementType }> = {
    pending: { label: "Pending", color: "text-white/40 bg-white/[0.04] border-white/[0.08]", icon: Clock },
    researching: { label: "Researching...", color: "text-amber-400 bg-amber-500/10 border-amber-500/25", icon: Loader2 },
    complete: { label: "Research Complete", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", icon: CheckCircle2 },
    failed: { label: "Research Failed", color: "text-rose-400 bg-rose-500/10 border-rose-500/25", icon: AlertTriangle },
  };
  const { label, color, icon: Icon } = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border ${color}`}>
      <Icon size={10} className={status === "researching" ? "animate-spin" : ""} />
      {label}
    </span>
  );
}

function formatDuration(ms?: number) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function splitResearchMarkdown(md: string): { phase1: string; phase2: string | null } {
  // Matches "Phase 2" at the start of a line regardless of heading level or
  // markdown emphasis. Accepts ##/###/etc, optional **bold**, any whitespace.
  // Falls back to "Step 5" (the first Phase-2 step in the prompt) if the
  // model skipped the Phase 2 header outright.
  const patterns = [
    /^#{1,6}[\s*_]*Phase[\s\-_–—]*2\b/im,
    /^\*{0,2}\s*Phase[\s\-_–—]*2[:.\s]/im,
    /^#{1,6}[\s*_]*Step\s*5[AB]?\b/im,
  ];
  for (const p of patterns) {
    const m = md.match(p);
    if (m && m.index != null) {
      return {
        phase1: md.slice(0, m.index).trimEnd(),
        phase2: md.slice(m.index).trimEnd(),
      };
    }
  }
  return { phase1: md, phase2: null };
}

function CollapsibleSection({
  title,
  icon: Icon,
  subtitle,
  defaultOpen = false,
  forceOpen,
  badge,
  headerRight,
  children,
}: {
  title: string;
  icon: React.ElementType;
  subtitle?: string;
  defaultOpen?: boolean;
  /**
   * When set to true, keeps the section open regardless of the user's toggle.
   * Useful for pinning the section open while an inline form inside it is
   * active.
   */
  forceOpen?: boolean;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [userOpen, setUserOpen] = useState(defaultOpen);
  const open = forceOpen ?? userOpen;
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    if (forceOpen) return; // ignore toggle while pinned open
    setUserOpen(v);
  };
  return (
    <section
      className="rounded-xl border border-white/[0.06] overflow-hidden"
      style={{ background: "#13161F" }}
    >
      <div className="flex items-center gap-3 p-5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left group"
        >
          <ChevronDown
            size={14}
            className={`text-white/40 group-hover:text-white/70 shrink-0 transition-transform ${
              open ? "rotate-0" : "-rotate-90"
            }`}
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white/80 flex items-center gap-2">
              <Icon size={14} className="text-cyan-400 shrink-0" />
              <span className="truncate">{title}</span>
              {badge}
            </h2>
            {subtitle && !open && (
              <p className="text-[10px] font-mono text-white/40 mt-1 truncate">{subtitle}</p>
            )}
          </div>
        </button>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>
      {open && (
        <div className="px-5 pb-5 border-t border-white/[0.04]">
          {subtitle && (
            <p className="text-[10px] font-mono text-white/40 mt-3 mb-3">{subtitle}</p>
          )}
          {children}
        </div>
      )}
    </section>
  );
}

// The research master prompt often bakes a "Real-World Customer Statements
// (Verbatim)" bullet list into each angle's body. Those statements have no
// source attribution and now live in their own dedicated, source-linked
// "Real-life avatar statements" sub-accordion — so strip them out of the
// Description so the Description shows only the strategic angle prose.
// Removes a header line matching /customer statements/ plus the blank lines
// and list items that immediately follow it (the statements can sit anywhere
// in the block, not only at the end).
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
      i++; // drop the header
      while (i < lines.length && isListOrBlank(lines[i])) i++; // drop its bullets
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Per-angle sub-artifact presentation. `render` decides whether the cached
// content is markdown (statements come back as bold-headed bullet lists) or
// plain text with hard line breaks (messages + ad copy — one item per line,
// which a markdown renderer would otherwise collapse into a run-on paragraph).
const ARTIFACT_META: Record<
  AngleArtifactKind,
  {
    label: string;
    icon: React.ElementType;
    subtitle: string;
    running: string;
    render: "markdown" | "text";
  }
> = {
  statements: {
    label: "Real-life avatar statements",
    icon: Quote,
    subtitle:
      "Real people voicing this angle's pain in the wild — mined verbatim from Reddit, forums, and social comments (not product reviews). Each links to its source.",
    running: "Mining real resonance statements from forums & social (web research)…",
    render: "markdown",
  },
  messages: {
    label: "Rewritten messages",
    icon: MessageSquare,
    subtitle:
      "Usable first-person messages rewritten from the real mined statements above. Generating this will mine the statements first if you haven't yet.",
    running: "Mining statements (if needed), then rewriting messages…",
    render: "text",
  },
  adCopy: {
    label: "Angle ad copy",
    icon: Megaphone,
    subtitle: "A complete primary ad — hook, benefit bullets, and CTA — written for this angle.",
    running: "Writing ad copy…",
    render: "text",
  },
};

/**
 * One sub-accordion under an angle for a single generated artifact. Shows the
 * cached content if present, a spinner while running, an error + retry on
 * failure, or a Generate button when not yet generated.
 */
function AngleArtifactSection({
  angle,
  kind,
  busy,
  localError,
  onGenerate,
}: {
  angle: ProductAngle;
  kind: AngleArtifactKind;
  busy: boolean;
  localError?: string | null;
  onGenerate: (angleId: string, kind: AngleArtifactKind) => void;
}) {
  const meta = ARTIFACT_META[kind];
  const art = angle.artifacts?.[kind];
  const status = art?.status;
  const running = status === "running" || busy;
  const content = art?.content?.trim() || "";
  const error = localError ?? (status === "failed" ? art?.error : null);
  const canGenerate = Boolean(angle.id) && !running;

  const GenerateButton = ({ label }: { label: string }) => (
    <button
      onClick={() => angle.id && onGenerate(angle.id, kind)}
      disabled={!canGenerate}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)", color: "#0D0F12" }}
    >
      <meta.icon size={11} />
      {label}
    </button>
  );

  return (
    <CollapsibleSection
      title={meta.label}
      icon={meta.icon}
      subtitle={meta.subtitle}
      badge={
        content && status === "complete" ? (
          <CheckCircle2 size={11} className="text-emerald-400" />
        ) : null
      }
    >
      {running ? (
        <div className="flex items-center gap-2 text-[11px] font-mono text-amber-300/80 py-2">
          <Loader2 size={12} className="animate-spin" />
          {meta.running}
        </div>
      ) : error ? (
        <div className="space-y-3">
          <div className="text-[10px] font-mono text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-2 whitespace-pre-wrap">
            {error}
          </div>
          <GenerateButton label="Retry" />
        </div>
      ) : content ? (
        <div className="space-y-3">
          {meta.render === "markdown" ? (
            <article className="prose-report max-w-none">
              <Streamdown>{content}</Streamdown>
            </article>
          ) : (
            <div className="whitespace-pre-wrap text-sm text-white/80 leading-relaxed">{content}</div>
          )}
          <button
            onClick={() => angle.id && onGenerate(angle.id, kind)}
            disabled={!canGenerate}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-mono text-white/60 border border-white/[0.08] hover:text-cyan-400 hover:border-cyan-500/40 transition-all disabled:opacity-40"
          >
            <RefreshCw size={11} />
            Regenerate
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[10px] font-mono text-white/40">Not generated yet.</p>
          <GenerateButton label="Generate" />
        </div>
      )}
    </CollapsibleSection>
  );
}

export default function ProductDetailPage({ productId }: { productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retriggering, setRetriggering] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Inline product rename: when the user clicks the pencil icon next to the
  // title, swap the H1 for a text input. Save commits via PATCH, Cancel
  // reverts. ESC also cancels, Enter commits.
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const progressStartRef = useRef<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Image management state
  const [imgBusy, setImgBusy] = useState(false);
  const [imgBusyNote, setImgBusyNote] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const [imgUrlInput, setImgUrlInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Per-angle artifact generation. Each angle owns 3 lazily-generated
  // sub-artifacts (statements / messages / ad copy). A click flips the
  // server-side status to "running"; polling then surfaces completion.
  const [generatingKeys, setGeneratingKeys] = useState<Set<string>>(new Set());
  const [artifactErrors, setArtifactErrors] = useState<Record<string, string>>({});

  async function handleGenerateArtifact(angleId: string, kind: AngleArtifactKind) {
    const key = `${angleId}:${kind}`;
    if (generatingKeys.has(key)) return;
    setGeneratingKeys((prev) => new Set(prev).add(key));
    setArtifactErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      await generateAngleArtifact(productId, angleId, kind);
      await refresh();
    } catch (err) {
      setArtifactErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setGeneratingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function refresh() {
    try {
      const { product } = await getProduct(productId);
      setProduct(product);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, [productId]);

  const mechanismStatus = product?.research?.mechanismStatus;
  const referenceSheetStatus = product?.research?.referenceSheetStatus;
  // Keep polling while any angle's sub-artifact is mid-generation so the
  // spinner flips to content without a manual refresh.
  const anyAngleArtifactRunning = useMemo(
    () =>
      (product?.research?.angles ?? []).some(
        (a) => a.artifacts && Object.values(a.artifacts).some((art) => art?.status === "running"),
      ),
    [product],
  );

  useEffect(() => {
    if (!product) return;
    const researchBusy =
      product.researchStatus === "pending" || product.researchStatus === "researching";
    const subJobsBusy =
      mechanismStatus === "running" ||
      referenceSheetStatus === "running" ||
      anyAngleArtifactRunning;

    if (researchBusy) {
      if (progressStartRef.current == null) progressStartRef.current = Date.now();
    } else {
      progressStartRef.current = null;
      setElapsedSec(0);
    }

    if (!researchBusy && !subJobsBusy) return;

    const poll = setInterval(refresh, 5000);
    const tick = setInterval(() => {
      if (progressStartRef.current != null) {
        setElapsedSec(Math.floor((Date.now() - progressStartRef.current) / 1000));
      }
    }, 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [product?.researchStatus, mechanismStatus, referenceSheetStatus, anyAngleArtifactRunning, productId]);

  // Build the gallery: start with whatever the URL-scraper / fact-sheet
  // pipeline put in research.imageCandidates, then make sure the three
  // canonical image slots (productImageUrl, productBackImageUrl,
  // contentImageUrl) are also visible — those come from the user-uploaded
  // path (Add Product modal, brand creation, manual upload) and live on
  // dedicated DB columns, not in the candidates array. Without folding
  // them in here, a product created via "URL + front + back" uploads
  // would only show the front in this gallery and the back would be
  // invisible despite being stored. We tag each with a distinct `source`
  // label so the UI knows which is which.
  const candidates = useMemo<ProductImageCandidate[]>(() => {
    const list = [...(product?.research?.imageCandidates ?? [])];
    const seen = new Set(list.map((c) => c.url));
    const fold = (url: string | null | undefined, source: string, score: number) => {
      if (!url || seen.has(url)) return;
      list.unshift({ url, width: null, height: null, source, score });
      seen.add(url);
    };
    // Prepend in reverse-display order so the final list reads:
    // front main → back → content → (rest of scraped candidates).
    fold(product?.contentImageUrl, "upload-content", 9000);
    fold(product?.productBackImageUrl, "upload-back", 9500);
    fold(product?.productImageUrl, "current-main", 10000);
    return list;
  }, [product]);

  async function handleRetrigger() {
    setRetriggering(true);
    try {
      await retriggerResearch(productId);
      await refresh();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetriggering(false);
    }
  }

  function startRenamingProduct() {
    if (!product) return;
    setNameDraft(product.name);
    setNameError(null);
    setNameEditing(true);
  }

  function cancelRenamingProduct() {
    setNameEditing(false);
    setNameError(null);
  }

  async function saveProductName() {
    if (!product) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    if (trimmed === product.name) {
      // No change — just close the editor.
      setNameEditing(false);
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      const { product: updated } = await patchProduct(productId, { name: trimmed });
      setProduct(updated);
      setNameEditing(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : String(err));
    } finally {
      setNameSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProduct(productId);
      setLocation("/workspace/products");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  async function handlePromote(url: string) {
    if (!product) return;
    setImgBusy(true);
    setImgBusyNote("Setting main image…");
    setImgError(null);
    try {
      await setProductMainImage(product.id, url);
      await refresh();
    } catch (err) {
      setImgError(err instanceof Error ? err.message : String(err));
    } finally {
      setImgBusy(false);
      setImgBusyNote(null);
    }
  }

  // Core upload routine, factored so both the <input> change handler and the
  // drag-and-drop handler can share it.
  async function uploadProductImageFile(file: File) {
    if (!product) return;
    if (!file.type.startsWith("image/")) {
      setImgError("Only image files are supported.");
      return;
    }
    setImgBusy(true);
    setImgBusyNote("Uploading to fal.storage…");
    setImgError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await uploadProductImage(product.id, dataUrl, file.name);
      await refresh();
    } catch (err) {
      setImgError(err instanceof Error ? err.message : String(err));
    } finally {
      setImgBusy(false);
      setImgBusyNote(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await uploadProductImageFile(file);
  }

  async function handleAddUrl() {
    if (!product || !imgUrlInput.trim()) return;
    setImgBusy(true);
    setImgBusyNote("Adding image…");
    setImgError(null);
    try {
      await addProductImageCandidate(product.id, imgUrlInput.trim());
      setImgUrlInput("");
      await refresh();
    } catch (err) {
      setImgError(err instanceof Error ? err.message : String(err));
    } finally {
      setImgBusy(false);
      setImgBusyNote(null);
    }
  }

  // Remove an auto-scraped (or user-added) image candidate. If the removed
  // URL is currently the main image, the server auto-promotes the next
  // candidate. Useful for culling bad scraper hits (brand logos, lifestyle
  // photos, icons) before regenerating the product reference sheet.
  async function handleRemoveCandidate(url: string) {
    if (!product) return;
    const isMain = product.productImageUrl === url;
    const confirmMsg = isMain
      ? "This is the current main image. Removing it will promote the next candidate as main. Continue?"
      : "Remove this image from the product?";
    if (!window.confirm(confirmMsg)) return;
    setImgBusy(true);
    setImgBusyNote("Removing image…");
    setImgError(null);
    try {
      await deleteProductImageCandidate(product.id, url);
      await refresh();
    } catch (err) {
      setImgError(err instanceof Error ? err.message : String(err));
    } finally {
      setImgBusy(false);
      setImgBusyNote(null);
    }
  }

  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // "Add strategic angle" inline form state. The user describes an angle in
  // plain text; the server elaborates it via angle_elaborate.md and appends
  // the result to research.angles.
  const [addAngleOpen, setAddAngleOpen] = useState(false);
  const [addAngleDescription, setAddAngleDescription] = useState("");
  const [addAngleBusy, setAddAngleBusy] = useState(false);
  const [addAngleError, setAddAngleError] = useState<string | null>(null);

  async function handleAddAngle() {
    const desc = addAngleDescription.trim();
    if (!desc || addAngleBusy) return;
    setAddAngleBusy(true);
    setAddAngleError(null);
    try {
      await addProductAngle(productId, desc);
      await refresh();
      setAddAngleDescription("");
      setAddAngleOpen(false);
    } catch (err) {
      setAddAngleError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddAngleBusy(false);
    }
  }

  // Feedback-driven reference-sheet regeneration. When `feedback` is non-empty,
  // the server uses the existing sheet as the edit base (nano-banana-pro/edit)
  // and applies the feedback as a targeted change rather than recomposing the
  // whole sheet. Without feedback, this is a normal regenerate.
  const [refFeedbackOpen, setRefFeedbackOpen] = useState(false);
  const [refFeedbackText, setRefFeedbackText] = useState("");

  async function handleRunReferenceAndMechanism(opts: { feedback?: string } = {}) {
    if (!product) return;
    // If either stage is still marked "running", the previous job may be
    // genuinely in flight — or it may be stuck (server crashed / unhandled
    // rejection left the status pinned). Confirm before force-restarting so
    // a mid-flight valid run isn't interrupted by an accidental click.
    const refStatus = product.research?.referenceSheetStatus;
    const mechStatus = product.research?.mechanismStatus;
    const looksRunning = refStatus === "running" || mechStatus === "running";
    if (looksRunning) {
      const ok = window.confirm(
        "A reference-sheet / mechanism run is currently marked as running. " +
        "Force restart anyway? (Use this if the previous run is stuck.)",
      );
      if (!ok) return;
    }
    setPipelineBusy(true);
    setPipelineError(null);
    try {
      await generateReferenceSheet(product.id, { feedback: opts.feedback });
      // Clear the feedback form once the request is accepted — the next poll
      // will pick up the "running" status.
      if (opts.feedback) {
        setRefFeedbackOpen(false);
        setRefFeedbackText("");
      }
      await refresh();
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setPipelineBusy(false);
    }
  }

  // Mechanism editing state. `draft` mirrors research.mechanism so the user
  // can tweak fields without touching the server copy until they hit Save.
  // `savingMechanism` disables the form while the PUT is in flight.
  const [mechanismEditing, setMechanismEditing] = useState(false);
  const [mechanismDraft, setMechanismDraft] = useState<ProductMechanism[]>([]);
  const [savingMechanism, setSavingMechanism] = useState(false);
  const [mechanismSaveError, setMechanismSaveError] = useState<string | null>(null);

  function openMechanismEdit() {
    const src = product?.research?.mechanism ?? [];
    // Deep-clone so in-place edits don't mutate the product state object
    // (React sees the same reference and wouldn't re-render).
    setMechanismDraft(src.map((m) => ({ ...m })));
    setMechanismSaveError(null);
    setMechanismEditing(true);
  }

  function cancelMechanismEdit() {
    setMechanismEditing(false);
    setMechanismDraft([]);
    setMechanismSaveError(null);
  }

  function updateMechanismField(index: number, field: keyof ProductMechanism, value: string) {
    setMechanismDraft((draft) =>
      draft.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    );
  }

  async function saveMechanismEdit() {
    if (!product || savingMechanism) return;
    setSavingMechanism(true);
    setMechanismSaveError(null);
    try {
      await updateProductMechanism(product.id, mechanismDraft);
      await refresh();
      setMechanismEditing(false);
      setMechanismDraft([]);
    } catch (err) {
      setMechanismSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMechanism(false);
    }
  }

  if (loadError && !product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={40} className="text-rose-400/60 mx-auto mb-4" />
          <p className="text-sm text-rose-300 font-mono">{loadError}</p>
          <Link href="/workspace/products">
            <button className="mt-4 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors">
              ← Back to Products
            </button>
          </Link>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={24} className="text-white/20 animate-spin" />
      </div>
    );
  }

  const research = product.research;
  const pct = Math.min(95, Math.round((elapsedSec / 180) * 100));

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-6 py-4" style={{ background: "#0D0F12" }}>
        <div className="flex items-center gap-2 text-[10px] font-mono text-white/30 mb-3">
          <Link href="/workspace/products">
            <button className="hover:text-cyan-400 transition-colors flex items-center gap-1">
              <ArrowLeft size={10} />
              Products
            </button>
          </Link>
          <ChevronRight size={10} />
          <span className="text-white/50 truncate max-w-md">{product.name}</span>
        </div>

        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-lg border border-white/[0.08] bg-white/[0.02] flex items-center justify-center overflow-hidden shrink-0">
            {product.productImageUrl ? (
              <img src={product.productImageUrl} alt={product.name} className="max-h-full max-w-full object-contain" />
            ) : (
              <Package size={24} className="text-white/20" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              {nameEditing ? (
                <div className="flex items-center gap-2 flex-1 min-w-0 max-w-2xl">
                  <input
                    autoFocus
                    type="text"
                    value={nameDraft}
                    onChange={(e) => { setNameDraft(e.target.value); if (nameError) setNameError(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveProductName();
                      else if (e.key === "Escape") cancelRenamingProduct();
                    }}
                    disabled={nameSaving}
                    maxLength={200}
                    className="flex-1 min-w-0 text-lg font-semibold text-white/90 bg-white/[0.04] border border-white/[0.15] rounded px-2.5 py-1 outline-none focus:border-cyan-400/60 disabled:opacity-50"
                  />
                  <button
                    onClick={() => void saveProductName()}
                    disabled={nameSaving || !nameDraft.trim()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {nameSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    Save
                  </button>
                  <button
                    onClick={cancelRenamingProduct}
                    disabled={nameSaving}
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider text-white/50 border border-white/[0.12] hover:text-white/80 hover:border-white/[0.25] transition-all disabled:opacity-40"
                  >
                    <X size={11} />
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <h1 className="text-lg font-semibold text-white/90 truncate">{product.name}</h1>
                  <button
                    onClick={startRenamingProduct}
                    title="Rename product"
                    className="p-1 rounded text-white/30 hover:text-white/80 hover:bg-white/[0.06] transition-all"
                  >
                    <Pencil size={12} />
                  </button>
                </>
              )}
              <ResearchStatusBadge status={product.researchStatus} />
            </div>
            {nameError && (
              <div className="mt-1.5 text-[10px] font-mono text-rose-400 flex items-center gap-1.5">
                <AlertTriangle size={10} />
                {nameError}
              </div>
            )}
            <div className="flex items-center gap-4 mt-1.5 flex-wrap">
              <span className="text-[10px] font-mono text-white/30 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                {product.category}
              </span>
              {product.productUrl ? (
                <a
                  href={product.productUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-mono text-cyan-400/60 hover:text-cyan-400 transition-colors flex items-center gap-1 truncate max-w-md"
                >
                  <ExternalLink size={10} />
                  {product.productUrl}
                </a>
              ) : (
                <span className="text-[10px] font-mono text-white/25 flex items-center gap-1">
                  Fact sheet input
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {(product.researchStatus === "failed" || product.researchStatus === "complete") && (
              <button
                onClick={handleRetrigger}
                disabled={retriggering}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono text-white/50 border border-white/[0.08] hover:bg-white/[0.03] transition-all disabled:opacity-50"
              >
                <RefreshCw size={11} className={retriggering ? "animate-spin" : ""} />
                {retriggering ? "Retrying..." : "Re-run Research"}
              </button>
            )}
            {product.researchStatus === "complete" && (
              <Link href="/workspace/apps/broll">
                <button
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono font-semibold uppercase tracking-wider transition-all"
                  style={{
                    background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)",
                    color: "#0D0F12",
                    boxShadow: "0 0 20px rgba(0,212,255,0.2)",
                  }}
                >
                  <Video size={14} />
                  Generate B-Roll
                </button>
              </Link>
            )}
            <button
              onClick={() => { setDeleteError(null); setConfirmDeleteOpen(true); }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono text-rose-400 border border-rose-500/25 hover:bg-rose-500/10 transition-all"
            >
              <Trash2 size={11} />
              Delete Product
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Product Images gallery */}
        <CollapsibleSection
          title="Product Images"
          icon={ImageIcon}
          subtitle="Up to 10 photos scraped from the product page. Promote any shot as the main image, or add your own."
          badge={
            candidates.length > 0 ? (
              <span className="text-[10px] font-mono text-white/40">({candidates.length})</span>
            ) : null
          }
        >
          {/* Upload + URL actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <label
              onDragEnter={(e) => { e.preventDefault(); if (!imgBusy) setUploadDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); if (!imgBusy) e.dataTransfer.dropEffect = "copy"; }}
              onDragLeave={() => setUploadDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setUploadDragOver(false);
                if (imgBusy) return;
                const file = e.dataTransfer.files?.[0];
                if (file) void uploadProductImageFile(file);
              }}
              className={`flex items-center justify-center gap-2 border border-dashed rounded-lg px-4 py-3 cursor-pointer transition-all ${
                imgBusy
                  ? "border-white/[0.1] opacity-50 pointer-events-none"
                  : uploadDragOver
                  ? "border-cyan-400 bg-cyan-500/[0.06] cursor-copy"
                  : "border-white/[0.1] hover:border-cyan-500/40"
              }`}
            >
              <Upload size={13} className="text-cyan-400" />
              <span className="text-xs font-mono text-white/70">
                {uploadDragOver ? "Drop to upload" : "Click or drag to upload a product shot"}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
              />
            </label>
            <div className="flex items-center gap-2 border border-white/[0.08] rounded-lg px-3 bg-white/[0.02]">
              <Link2 size={12} className="text-white/30" />
              <input
                value={imgUrlInput}
                onChange={(e) => setImgUrlInput(e.target.value)}
                placeholder="Paste an image URL…"
                className="bg-transparent text-xs font-mono text-white/80 placeholder:text-white/20 outline-none flex-1 py-2"
              />
              <button
                onClick={handleAddUrl}
                disabled={imgBusy || !imgUrlInput.trim()}
                className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 hover:text-cyan-300 disabled:opacity-40 px-2"
              >
                Add
              </button>
            </div>
          </div>

          {imgBusyNote && (
            <div className="text-[10px] font-mono text-white/50 flex items-center gap-2 mb-3">
              <Loader2 size={10} className="animate-spin" /> {imgBusyNote}
            </div>
          )}
          {imgError && (
            <div className="text-[10px] font-mono text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-2 mb-3">
              {imgError}
            </div>
          )}

          {candidates.length === 0 ? (
            <div className="text-xs font-mono text-white/40 italic border border-white/[0.06] bg-white/[0.02] rounded-lg px-4 py-6 text-center">
              No images extracted yet. Upload one or paste a URL above.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {candidates.map((c) => {
                const isMain = c.url === product.productImageUrl;
                return (
                  <div
                    key={c.url}
                    className={`group relative rounded-lg border overflow-hidden ${
                      isMain ? "border-cyan-500/60" : "border-white/[0.08] hover:border-white/[0.2]"
                    }`}
                    style={{ background: "rgba(255,255,255,0.02)" }}
                  >
                    {/* Remove button — hover-revealed top-right corner. Works for
                        every candidate including the main; server auto-promotes
                        the next candidate if the main is removed. */}
                    <button
                      onClick={() => handleRemoveCandidate(c.url)}
                      disabled={imgBusy}
                      title="Remove this image"
                      className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-md flex items-center justify-center bg-black/70 border border-white/10 text-white/60 opacity-0 group-hover:opacity-100 hover:bg-rose-500/30 hover:border-rose-500/50 hover:text-rose-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={11} />
                    </button>
                    <div className="aspect-square flex items-center justify-center bg-white/[0.03] p-3">
                      <img
                        src={c.url}
                        alt=""
                        className="max-w-full max-h-full object-contain"
                        onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")}
                      />
                    </div>
                    <div className="p-2 space-y-1.5">
                      <div className="flex items-center justify-between text-[9px] font-mono text-white/40">
                        <span className="uppercase tracking-wider truncate">{c.source}</span>
                        {c.width && c.height && (
                          <span>{c.width}×{c.height}</span>
                        )}
                      </div>
                      {isMain ? (
                        <div className="flex items-center gap-1 text-[10px] font-mono text-cyan-400">
                          <Check size={10} /> Main image
                        </div>
                      ) : (
                        <button
                          onClick={() => handlePromote(c.url)}
                          disabled={imgBusy}
                          className="w-full text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-white/[0.1] text-white/70 hover:text-cyan-400 hover:border-cyan-500/40 transition-all disabled:opacity-40"
                        >
                          Set as main
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleSection>

        {/* Research */}
        {product.researchStatus === "pending" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-white/[0.06] p-12 text-center"
            style={{ background: "#13161F" }}
          >
            <Clock size={40} className="text-white/10 mx-auto mb-4" />
            <h3 className="text-sm font-semibold text-white/60 mb-2">Research Queued</h3>
            <p className="text-xs text-white/30 font-mono max-w-md mx-auto">
              The research will start shortly. This typically takes 2–4 minutes.
            </p>
          </motion.div>
        )}

        {product.researchStatus === "researching" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-amber-500/20 p-12 text-center"
            style={{ background: "#13161F" }}
          >
            <Loader2 size={40} className="text-amber-400 mx-auto mb-4 animate-spin" />
            <h3 className="text-sm font-semibold text-amber-400 mb-2">Strategic Diagnosis In Progress</h3>
            <p className="text-xs text-white/30 font-mono max-w-md mx-auto">
              Analyzing product page, mapping dysfunctions, mining real-world user language,
              and elaborating 5 strategic angles...
            </p>
            <div className="mt-6 max-w-xs mx-auto">
              <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-amber-400"
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, ease: "linear" }}
                />
              </div>
              <div className="flex justify-between mt-2 text-[9px] font-mono text-white/20">
                <span>{elapsedSec}s elapsed</span>
                <span>~{pct}%</span>
              </div>
            </div>
          </motion.div>
        )}

        {product.researchStatus === "failed" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-rose-500/30 p-8"
            style={{ background: "#13161F" }}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-rose-300 mb-1">Research Failed</h3>
                <p className="text-xs text-white/50 font-mono break-words">
                  {product.researchError ?? "Unknown error."}
                </p>
                <p className="text-[10px] text-white/30 font-mono mt-3">
                  You can retry via the Re-run Research button above.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {product.researchStatus === "complete" && research?.markdown && (() => {
          const { phase1, phase2 } = splitResearchMarkdown(research.markdown);
          const metaLine = (
            <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-white/40 mb-4">
              {research.model && <span>model: <span className="text-white/60">{research.model}</span></span>}
              {research.durationMs != null && <span>duration: <span className="text-white/60">{formatDuration(research.durationMs)}</span></span>}
              {research.tokensIn != null && research.tokensOut != null && (
                <span>tokens: <span className="text-white/60">{research.tokensIn.toLocaleString()} in / {research.tokensOut.toLocaleString()} out</span></span>
              )}
              {research.costUsd != null && <span>cost: <span className="text-white/60">${research.costUsd.toFixed(4)}</span></span>}
            </div>
          );
          return (
            <>
              <CollapsibleSection
                title="Research · Phase 1 — Strategic Diagnosis"
                icon={FileText}
                subtitle="Product context, ingredient analysis, competitive map, root-cause + real-world dysfunction language."
              >
                {metaLine}
                <article className="prose-report max-w-none">
                  <Streamdown>{phase1}</Streamdown>
                </article>
              </CollapsibleSection>

              {phase2 && (
                <CollapsibleSection
                  title="Research · Phase 2 — Strategic Angles"
                  icon={Target}
                  // Pin the section open while the inline "add angle" form is
                  // visible — otherwise the form is hidden inside the
                  // collapsed body and the Add button looks like a no-op.
                  forceOpen={addAngleOpen || undefined}
                  subtitle="Five fully elaborated angles, priority-ranked by real-world language frequency + emotional intensity. Add your own custom angle below."
                  badge={
                    research.angles && research.angles.length > 0 ? (
                      <span className="text-[10px] font-mono text-white/40">
                        ({research.angles.length})
                      </span>
                    ) : null
                  }
                  headerRight={
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddAngleError(null);
                        setAddAngleOpen((v) => !v);
                      }}
                      disabled={addAngleBusy}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono text-white/60 border border-white/[0.08] hover:text-cyan-400 hover:border-cyan-500/40 transition-all disabled:opacity-40"
                    >
                      {addAngleOpen ? (
                        <>
                          <X size={11} /> Cancel
                        </>
                      ) : (
                        <>
                          <Plus size={11} /> Add Strategic Angle
                        </>
                      )}
                    </button>
                  }
                >
                  {/* Inline "add angle" form — appears above the angles list */}
                  {addAngleOpen && (
                    <div className="mb-4 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.03] p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <Target size={13} className="text-cyan-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <h3 className="text-xs font-semibold text-white/80 mb-1">
                            Add a Strategic Angle
                          </h3>
                          <p className="text-[10px] font-mono text-white/40 leading-relaxed">
                            Describe the angle you want in plain text — the target audience, the claim, the mechanism, whatever the angle is about. We'll elaborate it into the same 200–350 word format as the extracted angles, grounded in this product's research. Only the new angle runs; the others are untouched.
                          </p>
                        </div>
                      </div>
                      <textarea
                        rows={4}
                        value={addAngleDescription}
                        onChange={(e) => setAddAngleDescription(e.target.value)}
                        placeholder="e.g. 'Focus on time-strapped parents who want a coffee replacement that doesn't leave them jittery before school run — anchor the pitch on the clean-energy mechanism and the no-crash afternoon.'"
                        disabled={addAngleBusy}
                        className="w-full bg-[#0D0F12] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-500/40 disabled:opacity-50 resize-none"
                      />
                      {addAngleError && (
                        <div className="text-[10px] font-mono text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-2">
                          {addAngleError}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setAddAngleOpen(false);
                            setAddAngleDescription("");
                            setAddAngleError(null);
                          }}
                          disabled={addAngleBusy}
                          className="text-[10px] font-mono uppercase tracking-wider text-white/50 hover:text-white/80 px-3 py-2 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleAddAngle}
                          disabled={addAngleBusy || !addAngleDescription.trim()}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-mono font-semibold uppercase tracking-wider transition-all disabled:opacity-40"
                          style={{
                            background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)",
                            color: "#0D0F12",
                          }}
                        >
                          {addAngleBusy ? (
                            <>
                              <Loader2 size={11} className="animate-spin" />
                              Elaborating…
                            </>
                          ) : (
                            <>
                              <Plus size={11} />
                              Generate & Add
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {research.angles && research.angles.length > 0 ? (
                    <div className="space-y-2">
                      {research.angles.map((angle, i) => (
                        <CollapsibleSection
                          key={angle.id ?? `${i}-${angle.name}`}
                          title={`Angle ${i + 1} · ${angle.name}`}
                          icon={Target}
                        >
                          <div className="space-y-2">
                            {/* Description — the elaborated angle block */}
                            <CollapsibleSection
                              title="Description"
                              icon={FileText}
                              subtitle="The fully elaborated strategic angle — audience, pains, root cause, mechanism, framing."
                              defaultOpen
                            >
                              <article className="prose-report max-w-none">
                                <Streamdown>{stripCustomerStatements(angle.block)}</Streamdown>
                              </article>
                            </CollapsibleSection>

                            {/* Lazily-generated, cached per-angle artifacts */}
                            {(["statements", "messages", "adCopy"] as AngleArtifactKind[]).map((kind) => (
                              <AngleArtifactSection
                                key={kind}
                                angle={angle}
                                kind={kind}
                                busy={angle.id ? generatingKeys.has(`${angle.id}:${kind}`) : false}
                                localError={angle.id ? artifactErrors[`${angle.id}:${kind}`] : null}
                                onGenerate={handleGenerateArtifact}
                              />
                            ))}
                          </div>
                        </CollapsibleSection>
                      ))}
                    </div>
                  ) : (
                    <article className="prose-report max-w-none">
                      <Streamdown>{phase2}</Streamdown>
                    </article>
                  )}
                </CollapsibleSection>
              )}
            </>
          );
        })()}

        {/* Reference Sheet + Mechanism (sequential pipeline: sheet first, then mechanism) */}
        <CollapsibleSection
          title="Reference Sheet & Mechanism"
          icon={LayoutGrid}
          // Pin open when the user has an inline form active (feedback or
          // mechanism edit) — collapsing the section while typing would
          // discard visible context and confuse the user.
          forceOpen={refFeedbackOpen || mechanismEditing || undefined}
          subtitle="First we build the 9:16 technical blueprint (nano-banana-pro/edit), then extract container, opening, dispensing, viscosity and other specs from that blueprint + raw photos."
          badge={
            (referenceSheetStatus === "running" || mechanismStatus === "running") ? (
              <Loader2 size={11} className="text-amber-400 animate-spin" />
            ) : null
          }
        >
          {pipelineError && (
            <div className="text-[10px] font-mono text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-2 mb-3">
              {pipelineError}
            </div>
          )}

          {/* Inline feedback form — shown when the user clicks "Regen w/
              Feedback". Server uses the existing referenceSheetUrl as the
              edit base and applies the feedback on top. */}
          {refFeedbackOpen && research?.referenceSheetUrl && (
            <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/[0.03] p-4 space-y-3">
              <div className="flex items-start gap-2">
                <MessageSquare size={13} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-xs font-semibold text-white/80 mb-1">
                    Regenerate with Feedback
                  </h3>
                  <p className="text-[10px] font-mono text-white/40 leading-relaxed">
                    The current reference sheet becomes the edit base. Describe targeted changes — e.g. "shrink the hero bottle by 30%", "show the cap in the unscrewed state on the Unboxed panel", "remove the invented trigger on the side view". The model keeps everything else constant.
                  </p>
                </div>
              </div>
              <textarea
                rows={4}
                value={refFeedbackText}
                onChange={(e) => setRefFeedbackText(e.target.value)}
                placeholder="What should change on the reference sheet?"
                disabled={pipelineBusy}
                className="w-full bg-[#0D0F12] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 outline-none focus:border-amber-500/40 disabled:opacity-50 resize-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setRefFeedbackOpen(false);
                    setRefFeedbackText("");
                  }}
                  disabled={pipelineBusy}
                  className="text-[10px] font-mono uppercase tracking-wider text-white/50 hover:text-white/80 px-3 py-2 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleRunReferenceAndMechanism({ feedback: refFeedbackText });
                  }}
                  disabled={pipelineBusy || !refFeedbackText.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-mono font-semibold uppercase tracking-wider transition-all disabled:opacity-40"
                  style={{
                    background: "linear-gradient(135deg, #FFB347 0%, #CC8800 100%)",
                    color: "#0D0F12",
                  }}
                >
                  {pipelineBusy ? (
                    <>
                      <Loader2 size={11} className="animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <RefreshCw size={11} />
                      Regen w/ Feedback
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Pipeline progress bar — two stages */}
          {(referenceSheetStatus === "running" || mechanismStatus === "running") && (
            <div className="border border-amber-500/20 bg-amber-500/[0.03] rounded-lg px-4 py-3 mb-4">
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <div className="flex items-center gap-1.5">
                  {referenceSheetStatus === "complete" ? (
                    <CheckCircle2 size={12} className="text-emerald-400" />
                  ) : referenceSheetStatus === "running" ? (
                    <Loader2 size={12} className="text-amber-400 animate-spin" />
                  ) : (
                    <Clock size={12} className="text-white/30" />
                  )}
                  <span className={referenceSheetStatus === "running" ? "text-amber-400" : "text-white/50"}>
                    Step 1 · Reference sheet
                  </span>
                </div>
                <ChevronRight size={10} className="text-white/20" />
                <div className="flex items-center gap-1.5">
                  {mechanismStatus === "complete" ? (
                    <CheckCircle2 size={12} className="text-emerald-400" />
                  ) : mechanismStatus === "running" ? (
                    <Loader2 size={12} className="text-amber-400 animate-spin" />
                  ) : (
                    <Clock size={12} className="text-white/30" />
                  )}
                  <span className={mechanismStatus === "running" ? "text-amber-400" : "text-white/50"}>
                    Step 2 · Mechanism extraction
                  </span>
                </div>
              </div>
            </div>
          )}

          {referenceSheetStatus === "failed" && research?.referenceSheetError && (
            <div className="border border-rose-500/30 bg-rose-500/10 rounded-lg px-4 py-3 mb-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-rose-400 mb-1">
                    Reference sheet failed
                  </p>
                  <p className="text-[11px] font-mono text-rose-300 break-words">
                    {research.referenceSheetError}
                  </p>
                </div>
              </div>
            </div>
          )}

          {mechanismStatus === "failed" && research?.mechanismError && (
            <div className="border border-rose-500/30 bg-rose-500/10 rounded-lg px-4 py-3 mb-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-rose-400 mb-1">
                    Mechanism extraction failed
                  </p>
                  <p className="text-[11px] font-mono text-rose-300 break-words">
                    {research.mechanismError}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Empty-state — no sheet yet, no mechanism yet. Gives the user a
              first-time Generate button since the toolbar normally lives
              above the reference image and there is no image to sit above. */}
          {!research?.referenceSheetUrl &&
            !(research?.mechanism && research.mechanism.length > 0) &&
            referenceSheetStatus !== "running" &&
            mechanismStatus !== "running" && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-white/[0.1] bg-white/[0.02] px-4 py-4">
                <div className="text-[11px] font-mono text-white/50">
                  No reference sheet yet.
                </div>
                <button
                  onClick={() => { void handleRunReferenceAndMechanism(); }}
                  disabled={pipelineBusy}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono text-white/70 border border-white/[0.12] hover:bg-white/[0.04] hover:text-cyan-400 hover:border-cyan-500/40 transition-all disabled:opacity-40"
                >
                  <RefreshCw
                    size={11}
                    className={pipelineBusy ? "animate-spin" : ""}
                  />
                  Generate
                </button>
              </div>
            )}

          {/* Reference sheet preview + mechanism specs laid out side-by-side on desktop */}
          {(research?.referenceSheetUrl ||
            (research?.mechanism && research.mechanism.length > 0)) && (
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
              {research?.referenceSheetUrl && (
                <div className="space-y-2">
                  {/* Toolbar directly above the reference image — Regenerate
                      and Regen w/ Feedback sit with the artifact they act on
                      instead of in the accordion header, so the intent is
                      unambiguous. */}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setRefFeedbackOpen((v) => !v)}
                      disabled={pipelineBusy}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono text-amber-400/80 border border-amber-500/25 hover:bg-amber-500/10 transition-all disabled:opacity-40"
                      title="Regenerate with written feedback — keeps the existing sheet as the base and applies your changes"
                    >
                      {refFeedbackOpen ? <X size={11} /> : <MessageSquare size={11} />}
                      {refFeedbackOpen ? "Cancel" : "Feedback"}
                    </button>
                    <button
                      onClick={() => { void handleRunReferenceAndMechanism(); }}
                      // Only disabled during the in-flight POST. Status-based
                      // disable is omitted on purpose — a stuck "running"
                      // status needs a force-restart path, and the click
                      // handler confirms before interrupting a real run.
                      disabled={pipelineBusy}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono text-white/60 border border-white/[0.08] hover:bg-white/[0.03] hover:text-white/80 transition-all disabled:opacity-40"
                      title={
                        referenceSheetStatus === "running" || mechanismStatus === "running"
                          ? "A run is currently marked as running. Click to force-restart if it's stuck."
                          : undefined
                      }
                    >
                      <RefreshCw
                        size={11}
                        className={
                          pipelineBusy ||
                          referenceSheetStatus === "running" ||
                          mechanismStatus === "running"
                            ? "animate-spin"
                            : ""
                        }
                      />
                      {referenceSheetStatus === "running" || mechanismStatus === "running"
                        ? "Force Restart"
                        : "Regenerate"}
                    </button>
                  </div>
                  <div
                    className="rounded-lg border border-white/[0.08] overflow-hidden bg-white/[0.02]"
                  >
                    <div className="relative" style={{ aspectRatio: "9 / 16" }}>
                      <img
                        src={research.referenceSheetUrl}
                        alt="Product reference sheet"
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-white/40">
                    <a
                      href={research.referenceSheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-cyan-400/70 hover:text-cyan-400 transition-colors"
                    >
                      <ExternalLink size={10} />
                      Open full-res
                    </a>
                    {research.referenceSheetGeneratedAt && (
                      <span>
                        {new Date(research.referenceSheetGeneratedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {research?.mechanism && research.mechanism.length > 0 && (
                <div className="space-y-3">
                  {/* Edit / Save / Cancel toolbar. Mechanism edits override
                      the extractor output — downstream B-roll / image prompt
                      pipelines read research.mechanism, so hand-corrected
                      fields propagate through the whole pipeline. */}
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-mono text-white/40">
                      {mechanismEditing
                        ? "Editing mechanism — fields below are user-editable."
                        : "Extracted mechanism specs. Click Edit to correct any hallucinated values."}
                    </div>
                    {mechanismEditing ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={cancelMechanismEdit}
                          disabled={savingMechanism}
                          className="text-[10px] font-mono uppercase tracking-wider text-white/50 hover:text-white/80 px-3 py-1.5 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveMechanismEdit}
                          disabled={savingMechanism}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold uppercase tracking-wider transition-all disabled:opacity-40"
                          style={{
                            background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)",
                            color: "#0D0F12",
                          }}
                        >
                          {savingMechanism ? (
                            <>
                              <Loader2 size={11} className="animate-spin" />
                              Saving…
                            </>
                          ) : (
                            <>
                              <Save size={11} />
                              Save
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={openMechanismEdit}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-mono text-white/60 border border-white/[0.08] hover:text-cyan-400 hover:border-cyan-500/40 transition-all"
                      >
                        <Pencil size={11} />
                        Edit
                      </button>
                    )}
                  </div>

                  {mechanismSaveError && (
                    <div className="text-[10px] font-mono text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-2">
                      {mechanismSaveError}
                    </div>
                  )}

                  {(mechanismEditing ? mechanismDraft : research.mechanism).map((m, i) => {
                    const FIELDS: Array<{ label: string; key: keyof ProductMechanism }> = [
                      { label: "Product ID", key: "product_id" },
                      { label: "Physical", key: "physical_description" },
                      { label: "Material", key: "container_material" },
                      { label: "Opening", key: "opening" },
                      { label: "Dispensing", key: "dispensing" },
                      { label: "Closing", key: "closing" },
                      { label: "Content color", key: "content_color" },
                      { label: "Viscosity", key: "viscosity" },
                    ];
                    return (
                      <div
                        key={`${m.product_id}-${i}`}
                        className={`rounded-lg border p-4 ${
                          mechanismEditing
                            ? "border-cyan-500/25 bg-cyan-500/[0.03]"
                            : "border-white/[0.08] bg-white/[0.02]"
                        }`}
                      >
                        <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400/80 mb-3">
                          {m.product_id || `(entry ${i + 1})`}
                        </div>
                        {mechanismEditing ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                            {FIELDS.map((f) => (
                              <label key={f.key} className="flex flex-col gap-1">
                                <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                                  {f.label}
                                </span>
                                <textarea
                                  rows={f.key === "physical_description" ? 3 : 2}
                                  value={m[f.key] ?? ""}
                                  onChange={(e) =>
                                    updateMechanismField(i, f.key, e.target.value)
                                  }
                                  disabled={savingMechanism}
                                  className="w-full bg-[#0D0F12] border border-white/[0.08] rounded px-2 py-1.5 text-[11px] font-mono text-white/80 outline-none focus:border-cyan-500/40 disabled:opacity-50 resize-y"
                                />
                              </label>
                            ))}
                          </div>
                        ) : (
                          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
                            {FIELDS.filter((f) => f.key !== "product_id").map((f) => (
                              <div key={f.key} className="flex gap-2">
                                <dt className="font-mono text-white/40 shrink-0 w-28">{f.label}</dt>
                                <dd className="text-white/80 break-words">{m[f.key]}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    );
                  })}
                  {!mechanismEditing && (research.mechanismGeneratedAt || research.mechanismEditedAt) && (
                    <div className="text-[10px] font-mono text-white/40 px-1 space-y-1">
                      {research.mechanismGeneratedAt && (
                        <div>
                          mechanism generated:{" "}
                          <span className="text-white/60">
                            {new Date(research.mechanismGeneratedAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                      {research.mechanismEditedAt && (
                        <div>
                          last edited:{" "}
                          <span className="text-white/60">
                            {new Date(research.mechanismEditedAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CollapsibleSection>
      </div>

      <AnimatePresence>
        {confirmDeleteOpen && (
          <motion.div
            key="delete-product-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
            onClick={() => { if (!deleting) setConfirmDeleteOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-xl border border-rose-500/25 p-6"
              style={{ background: "#13161F" }}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <AlertTriangle size={18} className="text-rose-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-white/90 mb-1">
                    Delete this product?
                  </h3>
                  <p className="text-xs text-white/60 leading-relaxed">
                    Are you really sure to delete the product? All product information will be lost and cannot be restored again.
                  </p>
                </div>
              </div>
              {deleteError && (
                <div className="text-[11px] text-rose-300 font-mono bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2 mb-3">
                  {deleteError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmDeleteOpen(false)}
                  disabled={deleting}
                  className="px-3 py-2 rounded-lg text-[11px] font-mono text-white/70 border border-white/[0.1] hover:bg-white/[0.04] transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleConfirmDelete(); }}
                  disabled={deleting}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-mono font-semibold text-white bg-rose-500 hover:bg-rose-600 transition-all disabled:opacity-60"
                >
                  {deleting ? (
                    <><Loader2 size={12} className="animate-spin" /> Deleting…</>
                  ) : (
                    <><Trash2 size={12} /> Delete Product</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
