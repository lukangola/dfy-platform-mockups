/**
 * DESIGN: Studio Control Room — Static Ads Recreator
 * Step 0: Select Product + Angle + Language
 * Step 1: Select references from library + upload custom references
 * Step 2: Review recreated ads with approve/regenerate/chat feedback
 * Step 3: Export & What's Next
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, X, RefreshCw, MessageSquare, ChevronRight, ChevronDown,
  ArrowLeft, Package, Sparkles, ImagePlus, Upload,
  Layers, PenLine, Eye, CheckCircle2, Download, Globe,
  RotateCcw, Languages, ArrowRight, FolderOpen, Loader2,
} from "lucide-react";
import { LANGUAGES } from "@/lib/mockData";
import {
  createJob, getJob, listJobs,
  createStaticAdReference, getAdPipelineCard, listProducts, listStaticAdReferences,
  saveBrandAssets,
  type Job, type JobItem,
  type Product, type ProductAngle, type StaticAdReference,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";

type RecreationStatus = "generating" | "complete" | "failed";
type UserStatus = "pending" | "approved" | "rejected";

type RecreationErrorCode =
  | "moderation" | "rate_limit" | "timeout" | "upstream" | "bad_input" | "unknown";

type Recreation = {
  referenceId: string;
  reference: StaticAdReference;
  status: RecreationStatus;
  url?: string;
  error?: string;
  errorCode?: RecreationErrorCode;
  errorRetryable?: boolean;
  durationMs?: number;
  model?: string;
  promptVersion?: string;
  userStatus: UserStatus;
};

// Short label shown inside the failure overlay (≤ 3 words).
function errorLabel(code: RecreationErrorCode | undefined): string {
  switch (code) {
    case "moderation": return "Content blocked";
    case "rate_limit": return "Rate limited";
    case "timeout": return "Timed out";
    case "upstream": return "Provider error";
    case "bad_input": return "Invalid input";
    default: return "Failed";
  }
}

function displayStatus(r: Recreation): "generating" | "failed" | UserStatus {
  if (r.status === "generating") return "generating";
  if (r.status === "failed") return "failed";
  return r.userStatus;
}

// Niche keys are snake_case in the DB (e.g. "food_beverage"); the UI shows
// them as human-readable chip labels ("Food & Beverage").
function formatNicheLabel(niche: string): string {
  const map: Record<string, string> = {
    supplements: "Supplements",
    skincare: "Skincare",
    haircare: "Haircare",
    beauty: "Beauty",
    bodycare: "Body Care",
    oralcare: "Oral Care",
    fitness: "Fitness",
    food_beverage: "Food & Beverage",
    pet: "Pet",
    household: "Household",
    apparel: "Apparel",
    electronics: "Electronics",
    other: "Other",
    unassigned: "Unassigned",
  };
  if (map[niche]) return map[niche];
  return niche.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const STEPS = ["Product & Angle", "Select References", "Review Recreations", "Export"];

function StatusBadge({ status }: { status: "generating" | "failed" | UserStatus }) {
  const styles: Record<string, string> = {
    approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    rejected: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    generating: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    failed: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  };
  const label = status === "generating" ? "Generating..." : status;
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-mono uppercase tracking-wider ${styles[status]}`}>
      {label}
    </span>
  );
}

export default function StaticAdsAppPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const { activeBrand, activeBrandId } = useBrand();
  const brand = useMemo(() => {
    if (!activeBrand) return null;
    // Prefer the new guidelines markdown — it carries the full brand
    // identity (palette, typography, voice, do's & don'ts) in one
    // block. Legacy structured fields (still on activeBrand.research
    // until the boot-time backfill regenerates each brand) are passed
    // through as a fallback so workspaces don't break mid-migration.
    const r = activeBrand.research ?? {};
    return {
      name: activeBrand.name,
      websiteUrl: r.websiteUrl ?? activeBrand.brandUrl ?? "",
      logoUrl: activeBrand.logoUrl ?? r.logoUrl ?? null,
      guidelinesMarkdown: activeBrand.guidelinesMarkdown ?? null,
      // Legacy fallback — server uses these only when guidelinesMarkdown is empty.
      description: r.description ?? "",
      tone: r.tone ?? "",
      colorPalette: r.colorPalette ?? [],
      fonts: r.fonts ?? [],
    };
  }, [activeBrand]);

  // Live products
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  // Live static ad references
  const [references, setReferences] = useState<StaticAdReference[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [referencesError, setReferencesError] = useState<string | null>(null);

  // Step 0 state
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [angleMode, setAngleMode] = useState<"select" | "custom">("select");
  const [selectedAngle, setSelectedAngle] = useState("");
  const [customAngle, setCustomAngle] = useState("");
  const [angleDropdownOpen, setAngleDropdownOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  // Step 1 state
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  // Ad Pipeline linkage (deep-link from "Recreate now"). Stamped into the
  // recreate request + saved-asset metadata so the originating card can resolve
  // its output.
  const [pipelineCardId, setPipelineCardId] = useState<string | null>(null);
  // Multi-select niche filter for the library grid. Empty set = show all.
  const [nicheFilter, setNicheFilter] = useState<Set<string>>(new Set());

  // Step 2 state — live recreations
  const [recreations, setRecreations] = useState<Recreation[]>([]);
  const [selectedRecreationId, setSelectedRecreationId] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState<Set<string>>(new Set());
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});

  // Durable jobs: recreations run server-side (survive reload + deploys).
  // The page tracks the active job ids and mirrors item state onto entries
  // via the poll effect below. Multiple ids can be live at once — the batch
  // plus single-entry regenerates fired off already-completed cards.
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  // Unfinished-session banner: newest queued/running static_ads job for this
  // brand, offered as a one-click resume when the page isn't tracking a job.
  const [resumableJob, setResumableJob] = useState<Job | null>(null);
  // Job orchestration errors (create/hydrate failures) — per-entry generation
  // errors still render on the cards themselves.
  const [jobError, setJobError] = useState<string | null>(null);
  // Synchronous re-entrancy guard for the batch creator: activeJobIds only
  // gains the id once createJob returns, so without this a second trigger
  // during the awaits (adoptUnfinishedJob, createJob) double-creates a job.
  const recreateInFlightRef = useRef(false);
  // Monotonic hydration counter — hydrateFromJob bumps it FIRST thing. The
  // batch creator captures it before its first await and re-checks it before
  // createJob, so a resume-banner click (or ?job= deep link) that hydrates a
  // session mid-await aborts the in-flight batch instead of stomping the
  // adopted session.
  const hydrationEpochRef = useRef(0);
  // referenceId → id of the job that most recently targeted it. Two live jobs
  // can both hold an item for the same reference (the original batch + a later
  // single-entry regenerate); without this the still-polled batch item would
  // stomp the regenerate's spinner/result with the old output every tick.
  const jobOwnerRef = useRef<Map<string, string>>(new Map());
  // Latest references list for hydrateFromJob — the mount-time deep-link
  // effect closes over the initial (empty) references array.
  const referencesRef = useRef<StaticAdReference[]>([]);
  referencesRef.current = references;

  // Step 2 save state
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Step 3 state
  const [exported, setExported] = useState(false);

  // Upload state (Step 1) — pending uploads keyed by a temp id so we can show
  // thumbnails + progress inline while the server uploads + fires deconstruction.
  type PendingUpload = {
    tempId: string;
    filename: string;
    previewUrl: string;
    status: "uploading" | "failed";
    error?: string;
  };
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deep-link prefill from the Ad Pipeline ("Recreate now"). Runs once on mount.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const productId = p.get("productId");
    const angle = p.get("angle");
    const language = p.get("language");
    const referenceId = p.get("referenceId");
    const card = p.get("pipelineCardId");
    if (productId) setSelectedProductId(productId);
    if (angle) setSelectedAngle(angle);
    if (language) setSelectedLanguage(language);
    if (referenceId) setSelectedRefs(new Set([referenceId]));
    if (card) setPipelineCardId(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the deep-link lacked a referenceId (static deconstruction wasn't ready
  // yet), poll the pipeline card until its background job produces a
  // staticReferenceId, then preselect it. Stops once a reference is selected.
  useEffect(() => {
    if (!pipelineCardId || !activeBrandId || selectedRefs.size > 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { card } = await getAdPipelineCard(activeBrandId, pipelineCardId);
        if (!cancelled && card.staticReferenceId) setSelectedRefs(new Set([card.staticReferenceId]));
      } catch { /* ignore — user can pick a reference manually */ }
    };
    void tick();
    const iv = setInterval(tick, 2500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [pipelineCardId, activeBrandId, selectedRefs.size]);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    setProductsLoading(true);
    (async () => {
      try {
        const { products } = await listProducts(activeBrandId);
        if (!cancelled) setProducts(products);
      } catch (err) {
        if (!cancelled) setProductsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeBrandId]);

  // Fetch static ad references (the library grid on step 1).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { references } = await listStaticAdReferences();
        if (!cancelled) setReferences(references);
      } catch (err) {
        if (!cancelled) setReferencesError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setReferencesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const researchedProducts = useMemo(
    () => products.filter((p) => p.researchStatus === "complete" && p.research?.markdown),
    [products]
  );

  // Count references per niche (for filter-chip badges) and build a stable,
  // alphabetized list of niches actually present in the library so the UI
  // doesn't show empty buckets.
  const nicheCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ref of references) {
      const key = (ref.niche || "other").toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [references]);

  const availableNiches = useMemo(
    () => Array.from(nicheCounts.keys()).sort((a, b) => a.localeCompare(b)),
    [nicheCounts]
  );

  const filteredReferences = useMemo(() => {
    if (nicheFilter.size === 0) return references;
    return references.filter((r) => nicheFilter.has((r.niche || "other").toLowerCase()));
  }, [references, nicheFilter]);

  const toggleNicheFilter = (niche: string) => {
    setNicheFilter((prev) => {
      const next = new Set(prev);
      if (next.has(niche)) next.delete(niche);
      else next.add(niche);
      return next;
    });
  };
  const selectedProduct = researchedProducts.find((p) => p.id === selectedProductId);
  const contentAngles: ProductAngle[] = selectedProduct?.research?.angles ?? [];
  const activeAngle = angleMode === "custom" ? customAngle : selectedAngle;
  const selectedLang = LANGUAGES.find((l) => l.code === selectedLanguage);
  const selectedRecreation = recreations.find((r) => r.referenceId === selectedRecreationId) ?? null;
  const approvedRecreations = recreations.filter((r) => r.status === "complete" && r.userStatus === "approved");
  const generatingCount = recreations.filter((r) => r.status === "generating").length;
  const resolvedCount = recreations.length - generatingCount;
  const progress = recreations.length > 0 ? resolvedCount / recreations.length : 0;
  const allDone = recreations.length > 0 && generatingCount === 0;

  const handleProductSelect = (productId: string) => {
    setSelectedProductId(productId);
    setProductDropdownOpen(false);
    setSelectedAngle("");
    setCustomAngle("");
  };

  const toggleRef = (id: string) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Convert a File to a base64 data URL that the server endpoint can decode.
  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  // Upload one or more files in parallel. Each becomes a pending chip with its
  // own thumbnail; on success we merge the new reference into the library list
  // and auto-select it so the user can recreate immediately. Uploads default to
  // niche="unassigned" — the user can edit the niche later from the asset view.
  const handleFilesSelected = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;

    const uploads: PendingUpload[] = list.map((file) => ({
      tempId: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      filename: file.name,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));
    setPendingUploads((prev) => [...uploads, ...prev]);

    await Promise.all(
      uploads.map(async (pending, i) => {
        const file = list[i];
        try {
          const dataUrl = await fileToDataUrl(file);
          const { reference } = await createStaticAdReference({
            dataUrl,
            filename: file.name,
            niche: "unassigned",
          });
          setReferences((prev) => [reference, ...prev]);
          setSelectedRefs((prev) => {
            const next = new Set(prev);
            next.add(reference.id);
            return next;
          });
          setPendingUploads((prev) => {
            URL.revokeObjectURL(pending.previewUrl);
            return prev.filter((u) => u.tempId !== pending.tempId);
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setPendingUploads((prev) =>
            prev.map((u) =>
              u.tempId === pending.tempId ? { ...u, status: "failed", error: msg } : u,
            ),
          );
        }
      }),
    );
  };

  const dismissPendingUpload = (tempId: string) => {
    setPendingUploads((prev) => {
      const entry = prev.find((u) => u.tempId === tempId);
      if (entry) URL.revokeObjectURL(entry.previewUrl);
      return prev.filter((u) => u.tempId !== tempId);
    });
  };

  // ---------- Durable-job machinery (mirrors BrollAppPage) ----------

  /** Reference fields the review screen actually renders — snapshotted into
   *  the job payload so a resumed session doesn't depend on the (async)
   *  references fetch having landed. */
  type ReferenceSnapshot = {
    id: string;
    title: string;
    niche: string;
    imageUrl: string;
    thumbnailUrl: string | null;
  };

  type EntrySnapshot = {
    referenceId: string;
    status: RecreationStatus;
    url: string | null;
    error: string | null;
    userStatus: UserStatus;
    model: string | null;
    durationMs: number | null;
    promptVersion: string | null;
    reference: ReferenceSnapshot;
  };

  /** Session snapshot stored on every job — enough to restore the review
   *  screen (config chips + entry cards) without any other fetch. Item
   *  outputs overlay whatever finished after the snapshot. */
  function buildSessionPayload(entries: Recreation[]) {
    return {
      productId: selectedProductId,
      productName: selectedProduct?.name ?? null,
      angleName: activeAngle,
      language: selectedLanguage,
      ...(pipelineCardId ? { pipelineCardId } : {}),
      referenceIds: entries.map((e) => e.referenceId),
      entries: entries.map((e): EntrySnapshot => ({
        referenceId: e.referenceId,
        status: e.status,
        url: e.url ?? null,
        error: e.error ?? null,
        userStatus: e.userStatus,
        model: e.model ?? null,
        durationMs: e.durationMs ?? null,
        promptVersion: e.promptVersion ?? null,
        reference: {
          id: e.reference.id,
          title: e.reference.title,
          niche: e.reference.niche,
          imageUrl: e.reference.imageUrl,
          thumbnailUrl: e.reference.thumbnailUrl,
        },
      })),
    };
  }

  /** item.input — the exact args the old POST /api/static-ads/recreate took
   *  (the executor passes them verbatim to runStaticAdRecreate).
   *
   *  When `previousOutputUrl` is set, the server enters feedback-edit mode:
   *  the previous output is the input image and the feedback text drives the
   *  edit. This is how Regenerate-with-feedback avoids rolling the dice from
   *  scratch every time the user types a note. */
  function buildItemInput(referenceId: string, extra?: { feedback?: string; previousOutputUrl?: string }) {
    return {
      referenceId,
      productId: selectedProductId,
      angleName: activeAngle,
      language: selectedLanguage,
      brand: brand ?? null,
      ...(extra?.feedback ? { feedback: extra.feedback } : {}),
      ...(extra?.previousOutputUrl ? { previousOutputUrl: extra.previousOutputUrl } : {}),
      ...(pipelineCardId ? { pipelineCardId } : {}),
    };
  }

  /** Rebuild a renderable StaticAdReference from a payload snapshot when the
   *  live references list doesn't (yet) contain it. Only the fields the
   *  review screen reads (title / niche / imageUrl) matter; the rest are
   *  placeholders — the synthesized object never enters the library grid. */
  function synthesizeReference(snap: Partial<ReferenceSnapshot> & { id: string }): StaticAdReference {
    return {
      id: snap.id,
      createdAt: new Date(0).toISOString(),
      title: snap.title ?? snap.id,
      niche: snap.niche ?? "other",
      imageUrl: snap.imageUrl ?? "",
      thumbnailUrl: snap.thumbnailUrl ?? null,
      sourcePath: null,
      sourceSignature: null,
      deconstruction: null,
      deconstructionStatus: "complete",
      deconstructionError: null,
      deconstructionGeneratedAt: null,
      promptVersion: null,
      model: null,
    };
  }

  /** Mirror a job item's state onto its recreation entry. */
  function applyItemToEntry(it: JobItem) {
    const referenceId = (it.input as { referenceId?: string }).referenceId;
    if (!referenceId) return;
    // Only the job that most recently targeted this entry may write to it —
    // see jobOwnerRef. (An owner is recorded on every create/adopt, so a
    // missing owner just means "apply".)
    const owner = jobOwnerRef.current.get(referenceId);
    if (owner && owner !== it.jobId) return;
    const out = (it.output ?? {}) as { url?: string; model?: string; durationMs?: number; promptVersion?: string };
    if (it.status === "complete" && out.url) {
      setRecreations((prev) =>
        prev.map((r) =>
          r.referenceId === referenceId && r.status === "generating"
            ? {
                ...r,
                status: "complete",
                url: out.url,
                model: out.model,
                durationMs: out.durationMs,
                promptVersion: out.promptVersion,
                error: undefined,
                errorCode: undefined,
                errorRetryable: undefined,
              }
            : r,
        ),
      );
    } else if (it.status === "failed") {
      setRecreations((prev) =>
        prev.map((r) =>
          r.referenceId === referenceId && r.status === "generating"
            ? { ...r, status: "failed", url: undefined, error: it.error ?? "Generation failed", errorCode: "unknown", errorRetryable: true }
            : r,
        ),
      );
    }
  }

  // Poll all active jobs every 2.5s (the app's standard cadence) and mirror
  // item states onto entries; drop each job from the active set once it
  // reaches a terminal status.
  useEffect(() => {
    if (activeJobIds.length === 0) return;
    let cancelled = false;
    const pollOne = async (jobId: string) => {
      try {
        const { job, items } = await getJob(jobId);
        if (cancelled) return;
        for (const it of items) applyItemToEntry(it);
        if (job.status !== "queued" && job.status !== "running") {
          setActiveJobIds((prev) => prev.filter((id) => id !== jobId));
        }
      } catch {
        /* transient — next tick retries */
      }
    };
    const tick = () => {
      for (const id of activeJobIds) void pollOne(id);
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobIds]);

  /**
   * Restore the full review session from a job: the payload snapshot provides
   * the config + entry cards as of trigger time; item outputs overlay whatever
   * finished after the snapshot. Adopts the job as a poll target when it is
   * still running and moves the user to the review step.
   */
  async function hydrateFromJob(jobId: string) {
    // Invalidate any in-flight batch creator FIRST — see hydrationEpochRef.
    hydrationEpochRef.current += 1;
    const { job, items } = await getJob(jobId);
    const payload = job.payload as {
      productId?: string | null;
      angleName?: string;
      language?: string;
      pipelineCardId?: string;
      referenceIds?: string[];
      entries?: EntrySnapshot[];
    };
    // Restore the step-0/1 config so the summary chips render and post-resume
    // regenerates aren't product/angle-blind. The angle is restored through
    // the "select" mode slot even if it was custom — activeAngle resolves the
    // same either way.
    if (payload.productId && payload.productId !== selectedProductId) setSelectedProductId(payload.productId);
    if (payload.angleName) { setAngleMode("select"); setSelectedAngle(payload.angleName); }
    if (payload.language) setSelectedLanguage(payload.language);
    if (payload.pipelineCardId) setPipelineCardId(payload.pipelineCardId);
    if (payload.referenceIds?.length) setSelectedRefs(new Set(payload.referenceIds));
    // A job can be adopted well after it ended. If the job is no longer
    // active, any item still pending/running will never be picked up by a
    // worker — mapping those to "generating" would spin forever, so treat
    // them as failed with a retry hint instead.
    const jobIsActive = job.status === "queued" || job.status === "running";
    const byRef = new Map(items.map((it) => [(it.input as { referenceId?: string }).referenceId, it] as const));
    const restored: Recreation[] = (payload.entries ?? []).map((e) => {
      const live = referencesRef.current.find((r) => r.id === e.reference?.id);
      const reference = live ?? synthesizeReference(e.reference ?? { id: e.referenceId });
      const base: Recreation = {
        referenceId: e.referenceId,
        reference,
        status: e.status === "complete" && e.url ? "complete" : e.status === "failed" ? "failed" : "generating",
        url: e.url ?? undefined,
        error: e.error ?? undefined,
        userStatus: e.userStatus ?? "pending",
        model: e.model ?? undefined,
        durationMs: e.durationMs ?? undefined,
        promptVersion: e.promptVersion ?? undefined,
      };
      const it = byRef.get(e.referenceId);
      if (it) {
        const out = (it.output ?? {}) as { url?: string; model?: string; durationMs?: number; promptVersion?: string };
        if (it.status === "complete" && out.url) {
          return { ...base, status: "complete" as const, url: out.url, model: out.model, durationMs: out.durationMs, promptVersion: out.promptVersion, error: undefined };
        }
        if (it.status === "failed") {
          return { ...base, status: "failed" as const, url: undefined, error: it.error ?? "Generation failed", errorCode: "unknown" as const, errorRetryable: true };
        }
        return jobIsActive
          ? { ...base, status: "generating" as const, url: undefined, error: undefined }
          : { ...base, status: "failed" as const, url: undefined, error: "Interrupted — job ended before this ad finished. Retry to regenerate.", errorCode: "unknown" as const, errorRetryable: true };
      }
      // Not an item of THIS job — the snapshot state stands, except an entry
      // that was generating under some other job can no longer be tracked.
      if (base.status === "generating") {
        return { ...base, status: "failed" as const, url: undefined, error: "Interrupted — this ad was still generating when the session was saved. Retry to regenerate.", errorCode: "unknown" as const, errorRetryable: true };
      }
      return base;
    });
    setRecreations(restored);
    setSelectedRecreationId(null);
    setFeedbackOpen(new Set());
    setFeedbackDrafts({});
    setSavedCount(0);
    setSaveError(null);
    if (jobIsActive) {
      for (const it of items) {
        const rid = (it.input as { referenceId?: string }).referenceId;
        if (rid) jobOwnerRef.current.set(rid, job.id);
      }
      setActiveJobIds([job.id]);
    } else {
      setActiveJobIds([]);
    }
    setCurrentStep(2);
  }

  /** Returns true when an unfinished static_ads job for the current product
   *  was handled — adopted (session hydrated, poll target set), or found but
   *  adoption failed (error surfaced; never fall through to creating a
   *  duplicate over a live job). Returns false only when there is nothing to
   *  adopt, so a normal create may proceed. */
  async function adoptUnfinishedJob(): Promise<boolean> {
    if (!activeBrandId) return false;
    let candidate: Job | undefined;
    try {
      const { jobs } = await listJobs(activeBrandId);
      candidate = jobs.find(
        (x) =>
          x.app === "static_ads" &&
          x.type === "static_ads_recreate" &&
          (x.status === "queued" || x.status === "running") &&
          (((x.payload as { productId?: string | null }).productId ?? null) === (selectedProductId || null)),
      );
    } catch {
      // Couldn't check — proceed with a normal create rather than blocking the user.
      return false;
    }
    if (!candidate) return false;
    try {
      await hydrateFromJob(candidate.id);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // Deep link from the dashboard: ?job=<id> restores that session.
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (jobId) {
      void hydrateFromJob(jobId).catch((err) =>
        setJobError(err instanceof Error ? err.message : String(err)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unfinished-session banner source: newest queued/running static_ads job.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    void listJobs(activeBrandId)
      .then(({ jobs }) => {
        if (cancelled) return;
        const j = jobs.find(
          (x) => x.app === "static_ads" && x.type === "static_ads_recreate" && (x.status === "queued" || x.status === "running"),
        );
        setResumableJob(j ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeBrandId]);

  // Create ONE durable job for the whole batch (was: N parallel HTTP calls).
  // The server fans the items out; the poll effect fills the grid in.
  const handleRecreate = async () => {
    if (selectedRefs.size === 0 || !selectedProductId || !activeAngle || !activeBrandId) return;
    if (activeJobIds.length > 0) return;
    // Synchronous in-flight guard — activeJobIds only gains the id once
    // createJob returns, so a concurrent second call would race through the
    // awaits below and create a duplicate job.
    if (recreateInFlightRef.current) return;
    recreateInFlightRef.current = true;
    const epoch = hydrationEpochRef.current;
    try {
      // Duplicate-guard: a reload loses activeJobIds, and re-walking the flow
      // re-enters this path while the original batch may still be running
      // server-side. Adopt that job instead of paying for a second one.
      if (await adoptUnfinishedJob()) return;
      // Resume-banner race: a hydration landed during the adopt-check await — drop this stale batch so it can't stomp the adopted session.
      if (hydrationEpochRef.current !== epoch) return;
      const selectedReferences = references.filter((r) => selectedRefs.has(r.id));
      if (selectedReferences.length === 0) return;
      const initial: Recreation[] = selectedReferences.map((reference) => ({
        referenceId: reference.id,
        reference,
        status: "generating",
        userStatus: "pending",
      }));
      setRecreations(initial);
      setSelectedRecreationId(null);
      setFeedbackOpen(new Set());
      setFeedbackDrafts({});
      setSavedCount(0);
      setSaveError(null);
      setJobError(null);
      setCurrentStep(2);
      try {
        const { job } = await createJob({
          app: "static_ads",
          type: "static_ads_recreate",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Static ads — ${selectedReferences.length} recreation${selectedReferences.length === 1 ? "" : "s"}`,
          payload: buildSessionPayload(initial),
          items: selectedReferences.map((reference) => ({
            label: reference.title || reference.id,
            input: buildItemInput(reference.id),
          })),
        });
        for (const reference of selectedReferences) jobOwnerRef.current.set(reference.id, job.id);
        setActiveJobIds((prev) => [...prev, job.id]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setJobError(msg);
        // Roll the optimistic "generating" cards into failed so they stay
        // actionable — each card's Retry fires a fresh single-item job.
        setRecreations((prev) =>
          prev.map((r) => (r.status === "generating" ? { ...r, status: "failed", error: msg, errorCode: "unknown", errorRetryable: true } : r)),
        );
      }
    } finally {
      recreateInFlightRef.current = false;
    }
  };

  // Single-entry retry / regenerate-with-feedback → a 1-item durable job.
  // Runs alongside a still-active batch (each card is independent), which is
  // why activeJobIds is a set-like array rather than a single id.
  const handleRegenerate = async (referenceId: string, feedback?: string) => {
    const entry = recreations.find((r) => r.referenceId === referenceId);
    if (!entry || !selectedProductId || !activeAngle || !activeBrandId) return;
    // Double-click guard: the entry flips to "generating" synchronously below,
    // so a re-entrant click can't fire a duplicate job while createJob is
    // still in flight.
    if (entry.status === "generating") return;
    // Capture the previous output URL BEFORE we flip the entry to "generating"
    // and clear `url`. When feedback is present we pass it through so the
    // server edits the previous output instead of re-running the whole
    // pipeline from the reference. No feedback ⇒ no previousOutputUrl ⇒
    // server falls back to a fresh recreate (the "retry" semantics users
    // expect when they just click Regenerate without typing anything).
    const previousOutputUrl = feedback?.trim() ? entry.url : undefined;
    const feedbackText = feedback?.trim() || undefined;
    setJobError(null);
    // Claim ownership BEFORE flipping the entry to "generating": during the
    // createJob round-trip the batch job (if still polled) would otherwise
    // still own this ref, and one of its ticks could re-apply the OLD
    // terminal item to the just-flipped entry — after which the rework's
    // output never lands (applies only touch "generating" entries). The
    // placeholder matches no job id, so batch ticks are ignored immediately.
    jobOwnerRef.current.set(referenceId, `pending:${Date.now()}`);
    const flip = (r: Recreation): Recreation =>
      r.referenceId === referenceId
        ? { ...r, status: "generating", url: undefined, error: undefined, errorCode: undefined, errorRetryable: undefined, userStatus: "pending" }
        : r;
    setRecreations((prev) => prev.map(flip));
    // Clear inline feedback state after firing.
    if (feedback) {
      setFeedbackOpen((prev) => {
        const next = new Set(prev);
        next.delete(referenceId);
        return next;
      });
      setFeedbackDrafts((prev) => {
        const next = { ...prev };
        delete next[referenceId];
        return next;
      });
    }
    try {
      const { job } = await createJob({
        app: "static_ads",
        type: "static_ads_recreate",
        brandId: activeBrandId,
        productId: selectedProductId || null,
        title: "Static ads — 1 recreation",
        // Snapshot the WHOLE review grid (with this entry flipped), not just
        // the reworked card — resuming this job must restore every card.
        payload: buildSessionPayload(recreations.map(flip)),
        items: [
          {
            label: entry.reference.title || entry.referenceId,
            input: buildItemInput(referenceId, { feedback: feedbackText, previousOutputUrl }),
          },
        ],
      });
      jobOwnerRef.current.set(referenceId, job.id);
      setActiveJobIds((prev) => [...prev, job.id]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Hygiene: drop the placeholder — harmless if left (applies skip
      // non-"generating" entries), but no job ever claimed this ref.
      jobOwnerRef.current.delete(referenceId);
      setRecreations((prev) =>
        prev.map((r) =>
          r.referenceId === referenceId
            ? { ...r, status: "failed", url: undefined, error: msg, errorCode: "unknown", errorRetryable: true }
            : r,
        ),
      );
    }
  };

  const toggleFeedback = (referenceId: string) => {
    setFeedbackOpen((prev) => {
      const next = new Set(prev);
      if (next.has(referenceId)) next.delete(referenceId);
      else next.add(referenceId);
      return next;
    });
  };

  const setFeedbackDraft = (referenceId: string, text: string) => {
    setFeedbackDrafts((prev) => ({ ...prev, [referenceId]: text }));
  };

  // Fetch the image bytes, trigger a browser download, and save to brand assets.
  const handleDownloadAndSave = async () => {
    if (!selectedProduct || approvedRecreations.length === 0 || saving) return;
    if (!activeBrandId) {
      setSaveError("No active brand selected.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveBrandAssets(
        activeBrandId,
        approvedRecreations.map((r) => ({
          kind: "image" as const,
          url: r.url!,
          title: `${selectedProduct.name} — ${r.reference.title}`,
          sourceApp: "static_ads",
          productId: selectedProduct.id,
          metadata: {
            referenceId: r.referenceId,
            niche: r.reference.niche,
            angle: activeAngle,
            language: selectedLanguage,
            durationMs: r.durationMs ?? null,
            model: r.model ?? null,
            promptVersion: r.promptVersion ?? null,
            ...(pipelineCardId ? { pipelineCardId } : {}),
          },
        })),
      );

      for (const r of approvedRecreations) {
        const safeTitle = r.reference.title.replace(/[^a-z0-9\-_]+/gi, "-").slice(0, 40);
        const filename = `${selectedProduct.name.replace(/[^a-z0-9\-_]+/gi, "-")}-${safeTitle}-${r.referenceId.slice(0, 6)}.jpg`;
        const res = await fetch(r.url!);
        if (!res.ok) throw new Error(`Failed to fetch ${r.url} (${res.status})`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      }

      setSavedCount(approvedRecreations.length);
      setExported(true);
      setCurrentStep(3);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const setUserStatus = (referenceId: string, userStatus: UserStatus) => {
    setRecreations((prev) =>
      prev.map((r) => (r.referenceId === referenceId ? { ...r, userStatus } : r)),
    );
  };

  const approveAll = () => {
    setRecreations((prev) =>
      prev.map((r) => (r.status === "complete" ? { ...r, userStatus: "approved" } : r)),
    );
  };

  const handleRestartWithNewAngle = () => {
    setSelectedAngle("");
    setCustomAngle("");
    setAngleMode("select");
    setSelectedRefs(new Set());
    setRecreations([]);
    setSelectedRecreationId(null);
    setSavedCount(0);
    setSaveError(null);
    setExported(false);
    setCurrentStep(0);
  };

  const handleRestartWithNewLanguage = () => {
    setSelectedRefs(new Set());
    setRecreations([]);
    setSelectedRecreationId(null);
    setSavedCount(0);
    setSaveError(null);
    setExported(false);
    setCurrentStep(0);
  };

  // "Recreate more static ads" keeps product + angle + language and sends the
  // user straight back to the reference-selection screen for another batch.
  const handleRecreateMore = () => {
    setSelectedRefs(new Set());
    setRecreations([]);
    setSelectedRecreationId(null);
    setFeedbackOpen(new Set());
    setFeedbackDrafts({});
    setSavedCount(0);
    setSaveError(null);
    setExported(false);
    setCurrentStep(1);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ color: "#E2E8F0" }}>
      {/* Top Bar */}
      <header className="h-12 border-b border-white/[0.06] flex items-center px-4 gap-4 shrink-0" style={{ background: "#0D0F12" }}>
        <Link href="/workspace/apps">
          <button className="flex items-center gap-2 text-white/40 hover:text-cyan-400 transition-colors text-sm">
            <ArrowLeft size={14} />
            <span className="font-mono text-xs">APPS</span>
          </button>
        </Link>
        <div className="w-px h-5 bg-white/10" />
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-amber-500/20 flex items-center justify-center">
            <ImagePlus size={12} className="text-amber-400" />
          </div>
          <span className="font-mono text-xs text-white/60 tracking-wider">STATIC ADS RECREATOR</span>
        </div>

        {/* Step Indicator */}
        <div className="ml-auto flex items-center gap-1">
          {STEPS.map((step, i) => (
            <button
              key={step}
              onClick={() => { if (i <= currentStep) setCurrentStep(i); }}
              className="flex items-center gap-1.5 group"
            >
              <div
                className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold transition-all ${
                  i === currentStep
                    ? "bg-amber-500/20 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
                    : i < currentStep
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-white/5 text-white/30"
                }`}
              >
                {i < currentStep ? <Check size={10} /> : i + 1}
              </div>
              <span
                className={`text-[10px] font-mono tracking-wider hidden md:block ${
                  i === currentStep ? "text-amber-400" : "text-white/30"
                }`}
              >
                {step}
              </span>
              {i < STEPS.length - 1 && (
                <ChevronRight size={10} className="text-white/10 mx-1" />
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-auto p-4">
          {/* Unfinished-session resume banner — hidden while the page is
              already mirroring a job (then the progress UI covers it).
              Not a single <button> because the dismiss X needs its own
              button (nested buttons are invalid HTML). */}
          {resumableJob && activeJobIds.length === 0 && (
            <div className="mb-4 w-full rounded-md border border-cyan-400/30 bg-cyan-400/10 flex items-stretch">
              <button
                type="button"
                onClick={() => {
                  const j = resumableJob;
                  setResumableJob(null);
                  if (j) {
                    void hydrateFromJob(j.id).catch((err) =>
                      setJobError(err instanceof Error ? err.message : String(err)),
                    );
                  }
                }}
                className="flex-1 min-w-0 p-3 flex items-start gap-2 text-left hover:bg-cyan-400/15 transition-colors rounded-l-md"
              >
                <RotateCcw size={14} className="text-cyan-400 shrink-0 mt-0.5" />
                <p className="text-[11px] font-mono text-cyan-200/80 break-words">
                  <span className="font-medium text-cyan-200">A generation is still running: {resumableJob.title}</span>
                  {" "}— click to resume this session.
                </p>
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => setResumableJob(null)}
                className="px-3 flex items-center justify-center text-cyan-400/60 hover:text-cyan-200 hover:bg-cyan-400/15 transition-colors rounded-r-md shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {jobError && (
            <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[11px] font-mono text-rose-400">
              {jobError}
            </div>
          )}
          <AnimatePresence mode="wait">

            {/* ============================================ */}
            {/* STEP 0: PRODUCT & ANGLE & LANGUAGE           */}
            {/* ============================================ */}
            {currentStep === 0 && (
              <motion.div key="product-angle" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="max-w-2xl mx-auto py-12">
                <h2 className="text-xl font-bold font-mono text-amber-400 mb-2 flex items-center gap-2">
                  <Sparkles size={18} />
                  SELECT PRODUCT & ANGLE
                </h2>
                <p className="text-xs text-white/30 mb-8 font-mono">Choose a product, content angle, and language for your static ad recreations.</p>

                <div className="space-y-5">
                  {/* Product Selection */}
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                      Select Product
                    </label>
                    <div className="relative">
                      <button
                        onClick={() => setProductDropdownOpen(!productDropdownOpen)}
                        className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-3 hover:border-white/[0.15] transition-all text-left"
                      >
                        {selectedProduct ? (
                          <>
                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/[0.08] shrink-0 bg-white/[0.02]">
                              {selectedProduct.productImageUrl ? (
                                <img src={selectedProduct.productImageUrl} alt={selectedProduct.name} className="w-full h-full object-contain" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Package size={14} className="text-white/20" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1">
                              <div className="text-sm text-white/80">{selectedProduct.name}</div>
                              <div className="text-[10px] font-mono text-white/30">{selectedProduct.category}</div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="w-10 h-10 rounded-lg border border-dashed border-white/[0.12] flex items-center justify-center shrink-0">
                              {productsLoading ? (
                                <Loader2 size={14} className="text-white/30 animate-spin" />
                              ) : (
                                <Package size={16} className="text-white/20" />
                              )}
                            </div>
                            <div className="flex-1">
                              <div className="text-sm text-white/30">
                                {productsLoading ? "Loading products..." :
                                  productsError ? "Failed to load products" :
                                  researchedProducts.length === 0 ? "No researched products yet" :
                                  "Choose a product..."}
                              </div>
                              <div className="text-[10px] font-mono text-white/15">
                                {productsError ?? "Only researched products available"}
                              </div>
                            </div>
                          </>
                        )}
                        <ChevronDown size={16} className={`text-white/30 transition-transform ${productDropdownOpen ? "rotate-180" : ""}`} />
                      </button>

                      <AnimatePresence>
                        {productDropdownOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-20"
                            style={{ background: "#1A1D28" }}
                          >
                            <div className="p-1.5 max-h-64 overflow-auto">
                              {researchedProducts.length === 0 && (
                                <div className="px-3 py-6 text-center text-[11px] font-mono text-white/30">
                                  No researched products. Add one from the Products page first.
                                </div>
                              )}
                              {researchedProducts.map((product) => (
                                <button
                                  key={product.id}
                                  onClick={() => handleProductSelect(product.id)}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all ${
                                    selectedProductId === product.id
                                      ? "bg-amber-500/10 border border-amber-500/20"
                                      : "hover:bg-white/[0.04] border border-transparent"
                                  }`}
                                >
                                  <div className="w-9 h-9 rounded-lg overflow-hidden border border-white/[0.06] shrink-0 bg-white/[0.02]">
                                    {product.productImageUrl ? (
                                      <img src={product.productImageUrl} alt={product.name} className="w-full h-full object-contain" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        <Package size={12} className="text-white/20" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-white/80 truncate">{product.name}</div>
                                    <div className="text-[10px] font-mono text-white/30 truncate">{product.category}</div>
                                  </div>
                                  {selectedProductId === product.id && (
                                    <Check size={14} className="text-amber-400 shrink-0" />
                                  )}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Angle Selection */}
                  {selectedProduct && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5"
                    >
                      <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                        Content Angle
                      </label>

                      <div className="flex gap-2 mb-4">
                        <button
                          onClick={() => setAngleMode("select")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider transition-all ${
                            angleMode === "select"
                              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                              : "bg-white/[0.03] text-white/30 border border-white/[0.06] hover:text-white/50"
                          }`}
                        >
                          <Layers size={10} />
                          From Research
                        </button>
                        <button
                          onClick={() => setAngleMode("custom")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider transition-all ${
                            angleMode === "custom"
                              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                              : "bg-white/[0.03] text-white/30 border border-white/[0.06] hover:text-white/50"
                          }`}
                        >
                          <PenLine size={10} />
                          Custom Angle
                        </button>
                      </div>

                      {angleMode === "select" ? (
                        <div className="relative">
                          <button
                            onClick={() => setAngleDropdownOpen(!angleDropdownOpen)}
                            className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-3 hover:border-white/[0.15] transition-all text-left"
                          >
                            <Layers size={14} className="text-white/30 shrink-0" />
                            <span className={`text-sm flex-1 ${selectedAngle ? "text-white/80" : "text-white/30"}`}>
                              {selectedAngle || "Select an angle from product research..."}
                            </span>
                            <ChevronDown size={16} className={`text-white/30 transition-transform ${angleDropdownOpen ? "rotate-180" : ""}`} />
                          </button>

                          <AnimatePresence>
                            {angleDropdownOpen && (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-20"
                                style={{ background: "#1A1D28" }}
                              >
                                <div className="p-1.5 max-h-64 overflow-auto">
                                  {contentAngles.length === 0 && (
                                    <div className="px-3 py-6 text-center text-[11px] font-mono text-white/30">
                                      No angles extracted for this product yet.
                                    </div>
                                  )}
                                  {contentAngles.map((angle, i) => (
                                    <button
                                      key={angle.name}
                                      onClick={() => { setSelectedAngle(angle.name); setAngleDropdownOpen(false); }}
                                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all ${
                                        selectedAngle === angle.name
                                          ? "bg-amber-500/10 border border-amber-500/20"
                                          : "hover:bg-white/[0.04] border border-transparent"
                                      }`}
                                    >
                                      <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold bg-white/[0.05] text-white/30 shrink-0">
                                        {i + 1}
                                      </div>
                                      <span className="text-xs text-white/70 flex-1">{angle.name}</span>
                                      {selectedAngle === angle.name && <Check size={12} className="text-amber-400 shrink-0 ml-auto" />}
                                    </button>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-3">
                          <PenLine size={14} className="text-white/30 mt-0.5 shrink-0" />
                          <textarea
                            rows={2}
                            value={customAngle}
                            onChange={(e) => setCustomAngle(e.target.value)}
                            placeholder="Describe your specific angle, e.g. 'Focus on the 24K gold ingredient as a luxury differentiator against drugstore alternatives'"
                            className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 resize-none text-xs leading-relaxed"
                          />
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Language Selection */}
                  {selectedProduct && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5"
                    >
                      <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3 flex items-center gap-1.5">
                        <Globe size={10} />
                        Output Language
                      </label>
                      <div className="relative">
                        <button
                          onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                          className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-3 hover:border-white/[0.15] transition-all text-left"
                        >
                          <span className="text-lg shrink-0">{selectedLang?.flag}</span>
                          <div className="flex-1">
                            <div className="text-sm text-white/80">{selectedLang?.label}</div>
                            <div className="text-[10px] font-mono text-white/30">Text overlays and copy will be generated in this language</div>
                          </div>
                          <ChevronDown size={16} className={`text-white/30 transition-transform ${langDropdownOpen ? "rotate-180" : ""}`} />
                        </button>

                        <AnimatePresence>
                          {langDropdownOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-20"
                              style={{ background: "#1A1D28" }}
                            >
                              <div className="p-1.5 max-h-64 overflow-auto">
                                {LANGUAGES.map((lang) => (
                                  <button
                                    key={lang.code}
                                    onClick={() => { setSelectedLanguage(lang.code); setLangDropdownOpen(false); }}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all ${
                                      selectedLanguage === lang.code
                                        ? "bg-amber-500/10 border border-amber-500/20"
                                        : "hover:bg-white/[0.04] border border-transparent"
                                    }`}
                                  >
                                    <span className="text-base shrink-0">{lang.flag}</span>
                                    <span className="text-xs text-white/70 flex-1">{lang.label}</span>
                                    {selectedLanguage === lang.code && <Check size={12} className="text-amber-400 shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}

                  {/* Next Button */}
                  <button
                    onClick={() => selectedProductId && activeAngle && setCurrentStep(1)}
                    disabled={!selectedProductId || !activeAngle}
                    className={`w-full py-3.5 rounded-lg font-mono text-sm font-bold tracking-wider uppercase transition-all ${
                      selectedProductId && activeAngle ? "cursor-pointer" : "opacity-40 cursor-not-allowed"
                    }`}
                    style={{
                      background: selectedProductId && activeAngle
                        ? "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)"
                        : "rgba(255,255,255,0.05)",
                      color: selectedProductId && activeAngle ? "#0D0F12" : "rgba(255,255,255,0.3)",
                      boxShadow: selectedProductId && activeAngle ? "0 0 20px rgba(245,158,11,0.3)" : "none",
                    }}
                  >
                    Next: Select References
                  </button>
                </div>
              </motion.div>
            )}

            {/* ============================================ */}
            {/* STEP 1: SELECT REFERENCES                    */}
            {/* ============================================ */}
            {currentStep === 1 && (
              <motion.div key="references" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="max-w-5xl mx-auto py-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-bold font-mono text-amber-400 flex items-center gap-2">
                      <Eye size={16} />
                      SELECT REFERENCES
                    </h2>
                    <p className="text-xs text-white/30 mt-1 font-mono">
                      Choose from the library or upload your own ad references to recreate. {selectedRefs.size > 0 && <span className="text-amber-400">{selectedRefs.size} selected</span>}
                    </p>
                  </div>
                  <button
                    onClick={handleRecreate}
                    disabled={selectedRefs.size === 0 || activeJobIds.length > 0}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
                      selectedRefs.size > 0 && activeJobIds.length === 0
                        ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 cursor-pointer"
                        : "bg-white/[0.03] text-white/20 border border-white/[0.06] cursor-not-allowed"
                    }`}
                  >
                    <Sparkles size={12} />
                    Recreate ({selectedRefs.size})
                  </button>
                </div>

                {/* Config Summary */}
                <div className="mb-6 flex items-center gap-3 text-[10px] font-mono text-white/30">
                  <span className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded px-2.5 py-1.5">
                    <Package size={10} /> {selectedProduct?.name}
                  </span>
                  <span className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded px-2.5 py-1.5">
                    <Layers size={10} /> {activeAngle.length > 40 ? activeAngle.slice(0, 40) + "..." : activeAngle}
                  </span>
                  <span className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded px-2.5 py-1.5">
                    <span className="text-xs">{selectedLang?.flag}</span> {selectedLang?.label}
                  </span>
                </div>

                {/* Upload Area */}
                <div className="mb-6">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void handleFilesSelected(e.target.files);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  />
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingOver(true);
                    }}
                    onDragLeave={() => setIsDraggingOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingOver(false);
                      void handleFilesSelected(e.dataTransfer.files);
                    }}
                    className={`rounded-lg border-2 border-dashed p-6 flex flex-col items-center gap-3 transition-colors cursor-pointer group ${
                      isDraggingOver
                        ? "border-amber-500/60 bg-amber-500/[0.04]"
                        : "border-white/[0.08] hover:border-amber-500/30"
                    }`}
                    style={{ background: isDraggingOver ? undefined : "rgba(255,255,255,0.01)" }}
                  >
                    <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center group-hover:bg-amber-500/10 transition-colors">
                      <Upload size={20} className="text-white/20 group-hover:text-amber-400 transition-colors" />
                    </div>
                    <div className="text-xs font-mono text-white/40 group-hover:text-white/60 transition-colors">
                      Drop your own ad references here or click to upload
                    </div>
                    <div className="text-[10px] font-mono text-white/20">
                      PNG, JPG, WEBP · Uploaded refs are deconstructed and saved to the library
                    </div>
                  </div>

                  {/* Pending upload chips */}
                  {pendingUploads.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {pendingUploads.map((upload) => (
                        <div
                          key={upload.tempId}
                          className={`rounded-xl border overflow-hidden relative ${
                            upload.status === "failed"
                              ? "border-rose-500/40"
                              : "border-amber-500/30"
                          }`}
                          style={{ background: "#13161F" }}
                        >
                          <div className="aspect-square overflow-hidden bg-white/[0.02]">
                            <img
                              src={upload.previewUrl}
                              alt={upload.filename}
                              className="w-full h-full object-cover opacity-60"
                            />
                          </div>
                          <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-2 p-3">
                            {upload.status === "uploading" ? (
                              <>
                                <Loader2 size={22} className="text-amber-400 animate-spin" />
                                <div className="text-[10px] font-mono text-amber-300 uppercase tracking-widest">
                                  Uploading…
                                </div>
                              </>
                            ) : (
                              <>
                                <X size={20} className="text-rose-400" />
                                <div className="text-[10px] font-mono text-rose-300 uppercase tracking-widest">
                                  Upload Failed
                                </div>
                                <div className="text-[9px] font-mono text-white/50 text-center line-clamp-3">
                                  {upload.error}
                                </div>
                                <button
                                  onClick={() => dismissPendingUpload(upload.tempId)}
                                  className="mt-1 text-[9px] font-mono text-white/40 hover:text-white/70 underline"
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                          </div>
                          <div className="px-2 py-1.5 text-[10px] font-mono text-white/40 truncate">
                            {upload.filename}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Library Grid */}
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-amber-400" style={{ boxShadow: "0 0 8px rgba(245,158,11,0.5)" }} />
                    <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Reference Library</span>
                    <span className="text-[10px] font-mono text-white/25">
                      ({filteredReferences.length}{filteredReferences.length !== references.length ? ` / ${references.length}` : ""})
                    </span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                    <button
                      onClick={() => {
                        const visibleIds = filteredReferences.map((r) => r.id);
                        const allVisibleSelected =
                          visibleIds.length > 0 && visibleIds.every((id) => selectedRefs.has(id));
                        setSelectedRefs((prev) => {
                          const next = new Set(prev);
                          if (allVisibleSelected) {
                            for (const id of visibleIds) next.delete(id);
                          } else {
                            for (const id of visibleIds) next.add(id);
                          }
                          return next;
                        });
                      }}
                      disabled={filteredReferences.length === 0}
                      className="text-[10px] font-mono text-white/30 hover:text-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-white/30"
                    >
                      {filteredReferences.length > 0 && filteredReferences.every((r) => selectedRefs.has(r.id))
                        ? "Deselect All"
                        : "Select All"}
                    </button>
                  </div>

                  {/* Niche Filter Chips */}
                  {availableNiches.length > 0 && (
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest mr-1">
                        Filter
                      </span>
                      <button
                        onClick={() => setNicheFilter(new Set())}
                        className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border transition-all ${
                          nicheFilter.size === 0
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            : "bg-white/[0.03] text-white/40 border-white/[0.06] hover:text-white/60 hover:border-white/[0.12]"
                        }`}
                      >
                        All ({references.length})
                      </button>
                      {availableNiches.map((niche) => {
                        const active = nicheFilter.has(niche);
                        const count = nicheCounts.get(niche) ?? 0;
                        return (
                          <button
                            key={niche}
                            onClick={() => toggleNicheFilter(niche)}
                            className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border transition-all ${
                              active
                                ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                : "bg-white/[0.03] text-white/40 border-white/[0.06] hover:text-white/60 hover:border-white/[0.12]"
                            }`}
                          >
                            {formatNicheLabel(niche)} ({count})
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {referencesLoading ? (
                    <div className="flex items-center justify-center py-16 text-white/30">
                      <Loader2 size={18} className="animate-spin mr-2" />
                      <span className="text-xs font-mono">Loading references...</span>
                    </div>
                  ) : referencesError ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-6 text-center">
                      <div className="text-xs font-mono text-rose-400">Failed to load references</div>
                      <div className="text-[10px] font-mono text-white/30 mt-1">{referencesError}</div>
                    </div>
                  ) : references.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/[0.08] p-10 text-center">
                      <div className="text-xs font-mono text-white/40">No references in the library yet</div>
                      <div className="text-[10px] font-mono text-white/25 mt-1">
                        Drop images into <span className="text-white/40">client/public/static-ads/library/</span> and restart the server, or POST to /api/static-ad-references
                      </div>
                    </div>
                  ) : filteredReferences.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/[0.08] p-10 text-center">
                      <div className="text-xs font-mono text-white/40">No references match the current filter</div>
                      <button
                        onClick={() => setNicheFilter(new Set())}
                        className="mt-2 text-[10px] font-mono text-amber-400 hover:text-amber-300 underline"
                      >
                        Clear filter
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {filteredReferences.map((ref) => {
                        const isSelected = selectedRefs.has(ref.id);
                        const statusLabel =
                          ref.deconstructionStatus === "complete" ? "deconstructed" :
                          ref.deconstructionStatus === "running" ? "deconstructing…" :
                          ref.deconstructionStatus === "failed" ? "failed" :
                          "pending";
                        const statusClass =
                          ref.deconstructionStatus === "complete" ? "text-emerald-400/70" :
                          ref.deconstructionStatus === "running" ? "text-cyan-400/70" :
                          ref.deconstructionStatus === "failed" ? "text-rose-400/70" :
                          "text-white/30";
                        return (
                          <motion.div
                            key={ref.id}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => toggleRef(ref.id)}
                            className={`rounded-xl border overflow-hidden cursor-pointer group transition-all relative ${
                              isSelected
                                ? "border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.15)]"
                                : "border-white/[0.06] hover:border-white/[0.12]"
                            }`}
                            style={{ background: "#13161F" }}
                          >
                            <div className={`absolute top-3 right-3 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                              isSelected
                                ? "bg-amber-500 text-black"
                                : "bg-black/40 backdrop-blur-sm border border-white/20 text-white/40"
                            }`}>
                              {isSelected ? <Check size={14} /> : <span className="text-[10px]">+</span>}
                            </div>

                            <div className="aspect-square overflow-hidden bg-white/[0.02]">
                              <img
                                // Use the small webp thumbnail when the
                                // server has generated one — it's ~10x
                                // smaller than the original. Falls back to
                                // the source imageUrl for legacy refs that
                                // haven't been backfilled yet.
                                src={ref.thumbnailUrl ?? ref.imageUrl}
                                alt={ref.title}
                                loading="lazy"
                                decoding="async"
                                className={`w-full h-full object-cover transition-all ${isSelected ? "brightness-100" : "brightness-75 group-hover:brightness-90"}`}
                              />
                            </div>
                            <div className="p-3">
                              <div className="text-xs font-medium text-white/80 truncate">{ref.title}</div>
                              <div className="text-[10px] font-mono mt-0.5 flex items-center gap-1.5 truncate">
                                <span className="text-white/30 uppercase tracking-wider">{formatNicheLabel(ref.niche)}</span>
                                <span className="text-white/10">·</span>
                                <span className={statusClass}>{statusLabel}</span>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ============================================ */}
            {/* STEP 2: REVIEW RECREATIONS                   */}
            {/* ============================================ */}
            {currentStep === 2 && (
              <motion.div key="review" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-mono text-white/60 uppercase tracking-widest flex items-center gap-2">
                      <ImagePlus size={14} className="text-amber-400" />
                      Recreated Ads <span className="text-amber-400">({recreations.length})</span>
                    </h2>
                    <p className="text-[10px] text-white/25 font-mono mt-1">
                      Review, approve, regenerate, or leave feedback on each recreation.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={approveAll}
                      disabled={recreations.every((r) => r.status !== "complete")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 size={10} /> Approve All
                    </button>
                    <button
                      onClick={handleDownloadAndSave}
                      disabled={approvedRecreations.length === 0 || saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {saving ? (
                        <>
                          <RefreshCw size={10} className="animate-spin" />
                          Saving…
                        </>
                      ) : savedCount > 0 ? (
                        <>
                          <CheckCircle2 size={10} />
                          Saved {savedCount} to Brand Assets
                        </>
                      ) : (
                        <>
                          <Download size={10} />
                          Download & Save to Brand Assets ({approvedRecreations.length})
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Progress bar — shown while any recreation is still generating */}
                {recreations.length > 0 && (
                  <div className="mb-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-1.5">
                        {allDone ? (
                          <>
                            <CheckCircle2 size={10} className="text-emerald-400" />
                            <span className="text-emerald-400">All Recreations Complete</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw size={10} className="animate-spin text-amber-400" />
                            <span>Generating Ads</span>
                          </>
                        )}
                      </span>
                      <span className="text-[10px] font-mono text-white/60">
                        {resolvedCount} / {recreations.length}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                      <motion.div
                        className={`h-full ${allDone ? "bg-emerald-400" : "bg-amber-400"}`}
                        style={{ boxShadow: allDone ? "0 0 8px rgba(16,185,129,0.5)" : "0 0 8px rgba(245,158,11,0.5)" }}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.round(progress * 100)}%` }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                )}

                {saveError && (
                  <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[11px] font-mono text-rose-400">
                    Save failed: {saveError}
                  </div>
                )}

                {/* Config Summary */}
                <div className="mb-4 flex items-center gap-3 text-[10px] font-mono text-white/30">
                  <span className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded px-2.5 py-1.5">
                    <Package size={10} /> {selectedProduct?.name}
                  </span>
                  <span className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded px-2.5 py-1.5">
                    <Layers size={10} /> {activeAngle.length > 40 ? activeAngle.slice(0, 40) + "..." : activeAngle}
                  </span>
                  <span className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded px-2.5 py-1.5">
                    <span className="text-xs">{selectedLang?.flag}</span> {selectedLang?.label}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recreations.map((rec) => {
                    const isSelected = selectedRecreationId === rec.referenceId;
                    const isGenerating = rec.status === "generating";
                    const isFailed = rec.status === "failed";
                    const isComplete = rec.status === "complete";
                    const isApproved = isComplete && rec.userStatus === "approved";
                    const isRejected = isComplete && rec.userStatus === "rejected";
                    const showFeedback = feedbackOpen.has(rec.referenceId);
                    const draft = feedbackDrafts[rec.referenceId] ?? "";
                    return (
                      <motion.div
                        key={rec.referenceId}
                        className={`rounded-xl border overflow-hidden transition-all ${
                          isSelected
                            ? "border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.15)]"
                            : isApproved
                            ? "border-emerald-500/30"
                            : "border-white/[0.06]"
                        }`}
                        style={{ background: "#13161F" }}
                      >
                        {/* Image */}
                        <div
                          className="relative aspect-square overflow-hidden bg-white/[0.02] cursor-pointer"
                          onClick={() => setSelectedRecreationId(rec.referenceId)}
                        >
                          {isComplete && rec.url ? (
                            <img src={rec.url} alt={rec.reference.title} className="w-full h-full object-cover" />
                          ) : (
                            <img src={rec.reference.imageUrl} alt={rec.reference.title} className="w-full h-full object-cover opacity-30 blur-sm" />
                          )}
                          {isGenerating && (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                              <RefreshCw size={24} className="text-amber-400 animate-spin" />
                              <div className="text-[10px] font-mono text-white/50 uppercase tracking-widest">Generating…</div>
                            </div>
                          )}
                          {isFailed && (
                            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2 p-4">
                              <X size={22} className="text-rose-400" />
                              <div className="text-[10px] font-mono text-rose-400 uppercase tracking-widest">
                                {errorLabel(rec.errorCode)}
                              </div>
                              <div className="text-[10px] font-mono text-white/60 text-center line-clamp-5 leading-relaxed">
                                {rec.error}
                              </div>
                              {rec.errorRetryable === false && (
                                <div className="text-[9px] font-mono text-amber-400/80 uppercase tracking-widest mt-1">
                                  Retry won't help
                                </div>
                              )}
                            </div>
                          )}
                          <div className="absolute top-3 right-3"><StatusBadge status={displayStatus(rec)} /></div>
                        </div>

                        {/* Title / niche */}
                        <div className="px-3 pt-3">
                          <div className="text-xs font-medium text-white/80 truncate">{rec.reference.title}</div>
                          <div className="text-[10px] text-white/30 font-mono mt-0.5 truncate uppercase tracking-wider">{rec.reference.niche}</div>
                        </div>

                        {/* Actions below image */}
                        <div className="p-3">
                          {isGenerating && (
                            <div className="flex items-center justify-center gap-1.5 py-2 text-[10px] font-mono text-white/30">
                              <RefreshCw size={10} className="animate-spin" />
                              Waiting for nano-banana-pro…
                            </div>
                          )}

                          {isFailed && (
                            rec.errorRetryable === false ? (
                              <div
                                title={rec.error ?? undefined}
                                className="w-full flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.03] text-white/30 border border-white/[0.06] cursor-not-allowed select-none"
                              >
                                <X size={10} /> Pick another reference
                              </div>
                            ) : (
                              <button
                                onClick={() => handleRegenerate(rec.referenceId)}
                                className="w-full flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all"
                              >
                                <RefreshCw size={10} /> Retry
                              </button>
                            )
                          )}

                          {isComplete && !showFeedback && (
                            <div className="grid grid-cols-3 gap-1.5">
                              <button
                                onClick={() => setUserStatus(rec.referenceId, isApproved ? "pending" : "approved")}
                                className={`flex items-center justify-center gap-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider border transition-all ${
                                  isApproved
                                    ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20"
                                }`}
                              >
                                <Check size={10} /> {isApproved ? "Approved" : "Approve"}
                              </button>
                              <button
                                onClick={() => handleRegenerate(rec.referenceId)}
                                className="flex items-center justify-center gap-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-all"
                              >
                                <RefreshCw size={10} /> Regenerate
                              </button>
                              <button
                                onClick={() => toggleFeedback(rec.referenceId)}
                                className="flex items-center justify-center gap-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/60 border border-white/[0.08] hover:bg-white/[0.08] transition-all"
                              >
                                <MessageSquare size={10} /> Feedback
                              </button>
                            </div>
                          )}

                          {isComplete && showFeedback && (
                            <div className="space-y-2">
                              <textarea
                                value={draft}
                                onChange={(e) => setFeedbackDraft(rec.referenceId, e.target.value)}
                                rows={3}
                                placeholder="What should change? e.g. 'Make the headline shorter', 'Use the warmer gold from the brand palette'..."
                                className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-[11px] text-white/80 placeholder:text-white/25 outline-none resize-none font-mono focus:border-amber-500/30"
                                autoFocus
                              />
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => {
                                    const text = draft.trim();
                                    if (text) handleRegenerate(rec.referenceId, text);
                                  }}
                                  disabled={!draft.trim()}
                                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <RefreshCw size={10} /> Regenerate with Feedback
                                </button>
                                <button
                                  onClick={() => toggleFeedback(rec.referenceId)}
                                  className="px-3 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.03] text-white/50 border border-white/[0.08] hover:bg-white/[0.06] transition-all"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {isRejected && (
                            <div className="mt-1.5 text-center text-[10px] font-mono text-rose-400/70 uppercase tracking-wider">
                              Rejected
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ============================================ */}
            {/* STEP 3: SUCCESS — SAVED TO BRAND ASSETS      */}
            {/* ============================================ */}
            {currentStep === 3 && exported && (
              <motion.div key="export" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="max-w-3xl mx-auto py-12">
                {/* Success header */}
                <div className="text-center mb-10">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-5"
                    style={{ boxShadow: "0 0 40px rgba(16,185,129,0.2)" }}
                  >
                    <CheckCircle2 size={36} className="text-emerald-400" />
                  </motion.div>
                  <h2 className="text-xl font-bold font-mono text-emerald-400 mb-2">
                    SUCCESSFULLY ADDED TO BRAND ASSETS
                  </h2>
                  <p className="text-xs text-white/40 font-mono">
                    {savedCount} {savedCount === 1 ? "ad was" : "ads were"} downloaded and saved to your brand workspace assets.
                  </p>
                </div>

                {/* Saved Summary Card */}
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] p-5 mb-8">
                  <div className="flex items-center gap-3 mb-3">
                    <FolderOpen size={16} className="text-emerald-400" />
                    <span className="text-xs font-mono text-emerald-400 uppercase tracking-widest">Saved to Assets</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2 mb-3">
                    {approvedRecreations.map((rec) => (
                      <div key={rec.referenceId} className="aspect-square rounded-lg overflow-hidden border border-emerald-500/20">
                        {rec.url && <img src={rec.url} alt={rec.reference.title} className="w-full h-full object-cover" />}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-white/30">
                    <span>{selectedProduct?.name} · {selectedLang?.flag} {selectedLang?.label}</span>
                    <Link href="/workspace/assets">
                      <span className="text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer flex items-center gap-1">
                        View in Assets <ArrowRight size={10} />
                      </span>
                    </Link>
                  </div>
                </div>

                {/* What's Next */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-2 h-2 rounded-full bg-amber-400" style={{ boxShadow: "0 0 8px rgba(245,158,11,0.5)" }} />
                    <span className="text-xs font-mono text-white/40 uppercase tracking-widest">What's Next?</span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Recreate more static ads — keep product + angle + language */}
                    <motion.button
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleRecreateMore}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-left hover:border-emerald-500/30 transition-all group"
                    >
                      <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4 group-hover:bg-emerald-500/20 transition-colors">
                        <Sparkles size={20} className="text-emerald-400" />
                      </div>
                      <h3 className="text-sm font-bold text-white/80 mb-1 font-mono">Recreate More Static Ads</h3>
                      <p className="text-[11px] text-white/30 leading-relaxed">
                        Pick new references for the same product and angle. Everything else stays the same.
                      </p>
                      <div className="mt-4 flex items-center gap-1.5 text-emerald-400 text-[10px] font-mono uppercase tracking-wider group-hover:gap-2.5 transition-all">
                        Pick References <ArrowRight size={12} />
                      </div>
                    </motion.button>

                    {/* Recreate for another angle */}
                    <motion.button
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleRestartWithNewAngle}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-left hover:border-amber-500/30 transition-all group"
                    >
                      <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4 group-hover:bg-amber-500/20 transition-colors">
                        <RotateCcw size={20} className="text-amber-400" />
                      </div>
                      <h3 className="text-sm font-bold text-white/80 mb-1 font-mono">Try Another Angle</h3>
                      <p className="text-[11px] text-white/30 leading-relaxed">
                        Same product, different content angle. Your language ({selectedLang?.label}) is preserved.
                      </p>
                      <div className="mt-4 flex items-center gap-1.5 text-amber-400 text-[10px] font-mono uppercase tracking-wider group-hover:gap-2.5 transition-all">
                        Change Angle <ArrowRight size={12} />
                      </div>
                    </motion.button>

                    {/* Recreate for another language */}
                    <motion.button
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleRestartWithNewLanguage}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-left hover:border-cyan-500/30 transition-all group"
                    >
                      <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 group-hover:bg-cyan-500/20 transition-colors">
                        <Languages size={20} className="text-cyan-400" />
                      </div>
                      <h3 className="text-sm font-bold text-white/80 mb-1 font-mono">Try Another Language</h3>
                      <p className="text-[11px] text-white/30 leading-relaxed">
                        Same product and angle, translated for a new market. Quick localization workflow.
                      </p>
                      <div className="mt-4 flex items-center gap-1.5 text-cyan-400 text-[10px] font-mono uppercase tracking-wider group-hover:gap-2.5 transition-all">
                        Change Language <ArrowRight size={12} />
                      </div>
                    </motion.button>
                  </div>

                  {/* Back to Apps */}
                  <div className="mt-6 text-center">
                    <Link href="/workspace/apps">
                      <button className="text-[10px] font-mono text-white/25 hover:text-white/50 transition-colors uppercase tracking-widest flex items-center gap-1.5 mx-auto">
                        <ArrowLeft size={10} /> Back to Apps
                      </button>
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Right Panel — Ad Details (Step 2 only) */}
        <AnimatePresence>
          {selectedRecreation && currentStep === 2 && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="border-l border-white/[0.06] flex flex-col overflow-hidden shrink-0"
              style={{ background: "#0D0F12" }}
            >
              <div className="p-3 border-b border-white/[0.06]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Ad Details</span>
                  <button onClick={() => setSelectedRecreationId(null)} className="text-white/30 hover:text-white/60"><X size={14} /></button>
                </div>
                <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-white/[0.02]">
                  {selectedRecreation.status === "complete" && selectedRecreation.url ? (
                    <img src={selectedRecreation.url} alt={selectedRecreation.reference.title} className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="w-full aspect-square flex items-center justify-center">
                      {selectedRecreation.status === "generating" ? (
                        <RefreshCw size={24} className="text-amber-400 animate-spin" />
                      ) : (
                        <X size={24} className="text-rose-400" />
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-3">
                  <div className="text-sm font-medium text-white/80">{selectedRecreation.reference.title}</div>
                  <div className="text-[10px] text-white/40 mt-1 uppercase tracking-wider font-mono">{selectedRecreation.reference.niche}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <StatusBadge status={displayStatus(selectedRecreation)} />
                  </div>
                  {selectedRecreation.error && (
                    <div className="mt-2 rounded p-2 border border-rose-500/20 bg-rose-500/5">
                      <div className="text-[10px] font-mono text-rose-400 uppercase tracking-widest mb-1">
                        {errorLabel(selectedRecreation.errorCode)}
                      </div>
                      <div className="text-[10px] text-white/70 font-mono leading-relaxed">
                        {selectedRecreation.error}
                      </div>
                      {selectedRecreation.errorRetryable === false && (
                        <div className="mt-2 text-[10px] font-mono text-amber-400/90">
                          Retrying won't change the outcome — this input is being rejected by a deterministic filter. Pick a different reference for this angle.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {selectedRecreation.status === "complete" && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setUserStatus(selectedRecreation.referenceId, "approved")}
                      className="flex-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all flex items-center justify-center gap-1"
                    >
                      <Check size={10} /> Approve
                    </button>
                    <button
                      onClick={() => handleRegenerate(selectedRecreation.referenceId)}
                      className="flex-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all flex items-center justify-center gap-1"
                    >
                      <RefreshCw size={10} /> Regenerate
                    </button>
                  </div>
                )}
                {selectedRecreation.status === "failed" && (
                  selectedRecreation.errorRetryable === false ? (
                    <div className="w-full mt-3 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.03] text-white/30 border border-white/[0.06] flex items-center justify-center gap-1 select-none">
                      <X size={10} /> Pick another reference
                    </div>
                  ) : (
                  <button
                    onClick={() => handleRegenerate(selectedRecreation.referenceId)}
                    className="w-full mt-3 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all flex items-center justify-center gap-1"
                  >
                    <RefreshCw size={10} /> Retry
                  </button>
                  )
                )}
              </div>

              {/* Reference thumbnail */}
              <div className="p-3 border-b border-white/[0.06]">
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-2">Reference</div>
                <div className="rounded overflow-hidden border border-white/[0.06] bg-white/[0.02]">
                  <img src={selectedRecreation.reference.imageUrl} alt={selectedRecreation.reference.title} className="w-full aspect-square object-cover" />
                </div>
              </div>

              {/* Metadata */}
              {selectedRecreation.status === "complete" && (
                <div className="p-3 border-b border-white/[0.06] space-y-1.5 text-[10px] font-mono">
                  {selectedRecreation.model && (
                    <div className="flex items-center justify-between">
                      <span className="text-white/30 uppercase tracking-wider">Model</span>
                      <span className="text-white/60 truncate ml-2">{selectedRecreation.model}</span>
                    </div>
                  )}
                  {selectedRecreation.durationMs !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-white/30 uppercase tracking-wider">Duration</span>
                      <span className="text-white/60">{(selectedRecreation.durationMs / 1000).toFixed(1)}s</span>
                    </div>
                  )}
                  {selectedRecreation.promptVersion && (
                    <div className="flex items-center justify-between">
                      <span className="text-white/30 uppercase tracking-wider">Prompt</span>
                      <span className="text-white/60 truncate ml-2">{selectedRecreation.promptVersion.slice(0, 10)}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1" />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
