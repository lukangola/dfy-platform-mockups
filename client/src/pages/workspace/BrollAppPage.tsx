/**
 * DESIGN: Studio Control Room — B-Roll App Wrapper
 *
 * Flow (4 steps):
 *   0. Input — product + angle + asset limits
 *   1. Shot List — text-only editable shot list. User can edit/remove/add shots.
 *      "Approve & Generate Images" advances to step 2.
 *   2. Images — auto-fires image generation on entry for every shot in the list.
 *      Per-image: approve / regenerate / feedback-then-regenerate.
 *      "Generate Videos" advances to step 3.
 *   3. Videos — auto-fires video generation on entry for every approved image.
 *      Per-video: approve (download enabled) / regenerate / feedback-then-regenerate.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, ChevronDown, Check, X, RefreshCw, MessageSquare, ChevronRight,
  Send, Image as ImageIcon, Video, Eye, ArrowLeft, Package, Loader2,
  AlertTriangle, Plus, Trash2, Download, RotateCcw,
} from "lucide-react";
import {
  listProducts, getProductMechanism, generateBrollShots,
  generateBrollImagePrompts, generateBrollVideoPrompts,
  saveBrandAssets,
  createJob, getJob, listJobs,
  type Product, type BrollShot, type BrollShotList,
  type ProductMechanism, type Job, type JobItem,
} from "@/lib/api";
import { regenImageWithFeedback } from "@/lib/imageFeedbackRegen";
import { useBrand } from "@/contexts/BrandContext";
import { SHOT_TYPE_INFO, type ShotType } from "@/lib/mockData";
import { downloadViaBlob } from "@/lib/download";

const STEPS = ["Input", "Shot List", "Images", "Videos"];

function toUiShotType(s: BrollShot["shot_type"]): ShotType {
  switch (s) {
    case "Unboxing": return "unboxing";
    case "Product Presentation": return "presentation";
    case "Product Usage": return "usage";
    case "Proof / Results": return "proof";
  }
}

function fromUiShotType(t: ShotType): BrollShot["shot_type"] {
  switch (t) {
    case "unboxing": return "Unboxing";
    case "presentation": return "Product Presentation";
    case "usage": return "Product Usage";
    case "proof": return "Proof / Results";
  }
}

type MediaStatus = "idle" | "generating" | "ready" | "failed";
type Approval = "pending" | "approved" | "rejected";

type UiShot = {
  id: string;        // stable React key / worker id
  shot_id: number;   // numeric shot number used in API shape
  type: ShotType;
  /** True for shots the user added on the shot-list step; false for engine-generated ones. */
  userAdded: boolean;
  title: string;       // editable
  description: string; // editable
  location: string;    // editable
  imageStatus: MediaStatus;
  imageApproval: Approval;
  imageUrl?: string;
  imageError?: string;
  imagePrompt?: string;     // last paragraph sent to the image model
  imageFeedback: string;    // staged feedback typed into the right panel
  videoStatus: MediaStatus;
  videoApproval: Approval;
  videoUrl?: string;
  videoError?: string;
  videoPrompt?: string;
  videoFeedback: string;
};

function uiShotToApi(s: UiShot): BrollShot {
  return {
    id: s.shot_id,
    shot_type: fromUiShotType(s.type),
    action: s.title,
    location: s.location,
    visual_example: s.description,
    // Pass the latest image prompt (with any feedback baked in) so the video
    // prompt writer can align motion with the actual still — not a stale
    // generic description.
    ...(s.imagePrompt ? { image_prompt: s.imagePrompt } : {}),
  };
}

let uiShotCounter = 0;
function newUiShotId(): string {
  uiShotCounter += 1;
  return `ui-shot-${uiShotCounter}`;
}

function toUiShots(list: BrollShotList): UiShot[] {
  return list.shots.map((s) => ({
    id: newUiShotId(),
    shot_id: s.id,
    type: toUiShotType(s.shot_type),
    userAdded: false,
    title: s.action,
    description: s.visual_example,
    location: s.location,
    imageStatus: "idle",
    imageApproval: "pending",
    imageFeedback: "",
    videoStatus: "idle",
    videoApproval: "pending",
    videoFeedback: "",
  }));
}

function nextShotNumber(shots: UiShot[]): number {
  return shots.reduce((max, s) => Math.max(max, s.shot_id), 0) + 1;
}

/**
 * Time-estimated progress bar for the shot-list architect step. Used when a
 * single Claude call has no per-shot granularity to track — we estimate
 * 25s typical duration and asymptote the bar toward 95% so it never claims
 * to be finished before the call actually returns. Parent unmounts this
 * when shots land, which is when the user sees the real list appear.
 */
function ShotListProgressBar() {
  const [pct, setPct] = useState(0);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      // 1 - e^(-t/12s) → 0% at t=0, ~63% at t=12s, ~86% at t=24s, capped at 95%.
      const next = Math.min(95, Math.round((1 - Math.exp(-elapsed / 12_000)) * 100));
      setPct(next);
    }, 250);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-[10px] font-mono text-white/40 mb-1">
        <span className="uppercase tracking-widest flex items-center gap-2">
          <Loader2 size={11} className="animate-spin text-cyan-400" />
          Writing the shot list…
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: "linear-gradient(90deg, #00D4FF, #0099CC)",
            boxShadow: "0 0 8px rgba(0,212,255,0.3)",
          }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </div>
  );
}

function ApprovalBadge({ approval, kind }: { approval: Approval; kind: "image" | "video" }) {
  if (approval === "approved") {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded border font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
        {kind === "image" ? "Approved" : "Approved"}
      </span>
    );
  }
  if (approval === "rejected") {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded border font-mono uppercase tracking-wider bg-rose-500/15 text-rose-400 border-rose-500/30">
        Rejected
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded border font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border-amber-500/30">
      Pending
    </span>
  );
}

export default function BrollAppPage() {
  // Also pull the full activeBrand object — we need its logoUrl for the
  // unboxing shot's packing-tape branding (the brand's standalone wordmark,
  // not the version on the product label which is often curved or partial).
  const { activeBrandId, activeBrand } = useBrand();
  const [currentStep, setCurrentStep] = useState(0);

  // Input state
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  const [assetLimits, setAssetLimits] = useState("");

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [shotList, setShotList] = useState<BrollShotList | null>(null);
  const [uiShots, setUiShots] = useState<UiShot[]>([]);
  const [productLine, setProductLine] = useState("");

  // Mechanism + prompt-writer caches (shared across a run).
  const [mechanism, setMechanism] = useState<ProductMechanism[] | null>(null);
  const [mechanismLoading, setMechanismLoading] = useState(false);
  const [imagePromptsLoading, setImagePromptsLoading] = useState(false);
  const [videoPromptsLoading, setVideoPromptsLoading] = useState(false);
  // Counters for the determinate two-phase progress bar (Phase 1: prompt
  // writing; Phase 2: image / video generation). Incremented as each parallel
  // Claude call finishes.
  const [imagePromptsWritten, setImagePromptsWritten] = useState(0);
  const [videoPromptsWritten, setVideoPromptsWritten] = useState(0);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Durable-jobs pilot: batch generation runs server-side (survives reload +
  // deploys). The page holds only the active job ids and mirrors item state
  // onto shots via the poll effect below.
  const [activeImageJobId, setActiveImageJobId] = useState<string | null>(null);
  const [activeVideoJobId, setActiveVideoJobId] = useState<string | null>(null);
  // Session-resume banner: newest queued/running broll job for this brand —
  // or, when none is live, the newest broll job of any status — offered as a
  // one-click resume/restore when the page isn't already tracking a job.
  // Dismissible (null) for the rest of the visit via the banner's X.
  const [resumableJob, setResumableJob] = useState<Job | null>(null);

  // Review state
  const [selectedType, setSelectedType] = useState<ShotType | "all">("all");
  const [selectedShot, setSelectedShot] = useState<UiShot | null>(null);

  // Inline feedback UX on each image / video card. Each shot id can have
  // its own "feedback open" state on the card itself, letting the user
  // type direction inline and fire "Regenerate with Feedback" without
  // having to open the right-side detail panel first. Mirrors the same
  // pattern Character B-Roll uses — the underlying regenerateImage /
  // regenerateVideo already accept a feedback string, this just wires
  // up the second entry point right where users are looking.
  const [imageFeedbackOpen, setImageFeedbackOpen] = useState<Set<string>>(new Set());
  function toggleImageFeedback(shotId: string) {
    setImageFeedbackOpen((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }
  function closeImageFeedback(shotId: string) {
    setImageFeedbackOpen((prev) => {
      if (!prev.has(shotId)) return prev;
      const next = new Set(prev);
      next.delete(shotId);
      return next;
    });
  }
  const [videoFeedbackOpen, setVideoFeedbackOpen] = useState<Set<string>>(new Set());
  function toggleVideoFeedback(shotId: string) {
    setVideoFeedbackOpen((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }
  function closeVideoFeedback(shotId: string) {
    setVideoFeedbackOpen((prev) => {
      if (!prev.has(shotId)) return prev;
      const next = new Set(prev);
      next.delete(shotId);
      return next;
    });
  }

  // Brand assets export state
  const [savingToBrandAssets, setSavingToBrandAssets] = useState(false);
  const [brandAssetsSavedCount, setBrandAssetsSavedCount] = useState(0);

  // Track whether we've already auto-kicked generation for a step, so that
  // navigating back and forth doesn't re-fire for already-generated shots.
  const imagesAutoKickedRef = useRef(false);
  const videosAutoKickedRef = useRef(false);

  // Synchronous re-entrancy guards for the batch creators. During their
  // multi-second awaits (adoptUnfinishedJob, prompt writing) the active job
  // id is still null, so a second trigger (stepper back + re-approve, banner
  // click) could double-create a job — and double the fal spend.
  const imagesBatchInFlightRef = useRef(false);
  const videosBatchInFlightRef = useRef(false);

  // Monotonic hydration counter — hydrateFromJob bumps it FIRST thing. Batch
  // creators capture it before their first await and re-check it before
  // createJob, so a resume-banner click (or ?job= deep link) that hydrates a
  // session mid-await aborts the in-flight batch instead of stomping the
  // adopted session.
  const hydrationEpochRef = useRef(0);

  // Fetch products for the active brand.
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

  const researchedProducts = useMemo(
    () => products.filter((p) => p.researchStatus === "complete" && p.research?.markdown),
    [products]
  );
  const selectedProduct = researchedProducts.find((p) => p.id === selectedProductId);

  const handleProductSelect = (productId: string) => {
    setSelectedProductId(productId);
    setProductDropdownOpen(false);
  };

  const canGenerate = !!selectedProduct && !generating;

  async function handleGenerate() {
    if (!selectedProduct) return;
    setGenerating(true);
    setGenerationError(null);
    // Mirror the Listicle Builder's jump-then-work UX: move to step 1
    // immediately so the user sees the loading state, then run the (10-30s)
    // shot-list generation in the background. Clearing uiShots first means
    // the step-1 view renders its skeleton/loader instead of a stale list.
    setShotList(null);
    setUiShots([]);
    imagesAutoKickedRef.current = false;
    videosAutoKickedRef.current = false;
    setCurrentStep(1);
    try {
      const line = [
        selectedProduct.name,
        selectedProduct.category ? `(${selectedProduct.category})` : "",
        selectedProduct.productUrl ? `URL: ${selectedProduct.productUrl}` : "",
      ].filter(Boolean).join(" ");
      setProductLine(line);
      const { shots } = await generateBrollShots({
        product: line,
        research: selectedProduct.research?.markdown ?? "",
        assetLimits: assetLimits.trim(),
      });
      setShotList(shots);
      setUiShots(toUiShots(shots));
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  function patchShot(id: string, patch: Partial<UiShot>) {
    setUiShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setSelectedShot((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }

  // ---------- Shot list editing (step 1) ----------

  function updateShotField(id: string, patch: Partial<Pick<UiShot, "title" | "description" | "location" | "type">>) {
    patchShot(id, patch);
  }

  function removeShot(id: string) {
    setUiShots((prev) => prev.filter((s) => s.id !== id));
    setSelectedShot((prev) => (prev && prev.id === id ? null : prev));
  }

  function addShot(type: ShotType = "presentation") {
    setUiShots((prev) => {
      const next: UiShot = {
        id: newUiShotId(),
        shot_id: nextShotNumber(prev),
        type,
        userAdded: true,
        title: "",
        description: "",
        location: shotList?.location_default ?? "",
        imageStatus: "idle",
        imageApproval: "pending",
        imageFeedback: "",
        videoStatus: "idle",
        videoApproval: "pending",
        videoFeedback: "",
      };
      return [...prev, next];
    });
  }

  // ---------- Mechanism + prompt writers ----------

  async function ensureMechanism(): Promise<ProductMechanism[]> {
    if (mechanism) return mechanism;
    if (!selectedProductId) throw new Error("No product selected");
    setMechanismLoading(true);
    try {
      const { mechanism: m } = await getProductMechanism(selectedProductId);
      setMechanism(m);
      return m;
    } finally {
      setMechanismLoading(false);
    }
  }

  // Writes one image prompt per target shot. Used to be a single Claude call
  // with ALL shots batched in the request — which made Claude write them
  // sequentially inside one response and took ~3-4s per shot. Now we fan out
  // one Claude call PER shot in parallel: total time = max(individual times)
  // ≈ 4-6s regardless of shot count. Our system prompt has ephemeral cache
  // control, so the per-call cost barely changes (cache hits across the
  // parallel calls within the 5-min TTL).
  async function writeImagePrompts(targets: UiShot[]): Promise<string[]> {
    if (targets.length === 0) return [];
    setImagePromptsLoading(true);
    setImagePromptsWritten(0);
    try {
      const m = await ensureMechanism().catch(() => [] as ProductMechanism[]);
      const results = await Promise.all(
        targets.map(async (t) => {
          const { prompts } = await generateBrollImagePrompts({
            product: productLine,
            mechanism: m,
            shots: [uiShotToApi(t)],
          });
          setImagePromptsWritten((c) => c + 1);
          return prompts[0] ?? "";
        }),
      );
      return results;
    } finally {
      setImagePromptsLoading(false);
    }
  }

  async function writeVideoPrompts(targets: UiShot[]): Promise<string[]> {
    if (targets.length === 0) return [];
    setVideoPromptsLoading(true);
    setVideoPromptsWritten(0);
    try {
      const m = await ensureMechanism().catch(() => [] as ProductMechanism[]);
      const results = await Promise.all(
        targets.map(async (t) => {
          const { prompts } = await generateBrollVideoPrompts({
            product: productLine,
            mechanism: m,
            shots: [uiShotToApi(t)],
          });
          setVideoPromptsWritten((c) => c + 1);
          return prompts[0] ?? "";
        }),
      );
      return results;
    } finally {
      setVideoPromptsLoading(false);
    }
  }

  // ---------- Image reference helpers ----------

  // Collect every visual reference we have for the product. nano-banana-pro/edit
  // can ingest multiple images — feeding it the hero shot, the supplementary
  // content image, and (when available) the generated reference sheet gives it
  // more angles / packaging detail to work with, which noticeably improves
  // fidelity on the B-roll stills.
  function collectProductImageUrls(): string[] {
    if (!selectedProduct) return [];
    const urls = [
      selectedProduct.productImageUrl,
      selectedProduct.contentImageUrl,
      selectedProduct.research?.referenceSheetUrl ?? null,
    ].filter((u): u is string => !!u);
    // De-dupe in case the same URL landed in two slots.
    return Array.from(new Set(urls));
  }

  /**
   * Build the reference-image list for a single shot. For unboxing shots we
   * prepend the brand's standalone logo (from brand_extract / brands.logoUrl)
   * — this is what the model uses to render the brand wordmark on the
   * shipping carton's packing tape. The product label's version of the
   * logo can be curved, partial, or stylized in ways that don't translate
   * to a flat tape strip; the standalone brand logo is the cleaner source.
   * For non-unboxing shots, the brand logo is omitted to avoid confusing
   * the model with an extra unused reference.
   */
  function collectReferenceImagesForShot(shot: UiShot): string[] {
    const productRefs = collectProductImageUrls();
    if (shot.type === "unboxing" && activeBrand?.logoUrl) {
      // Brand logo first: nano-banana-pro/edit weights earlier images more
      // heavily as the "anchor." The product refs follow so the model still
      // knows what's inside the box for post-open reveals.
      return [activeBrand.logoUrl, ...productRefs];
    }
    return productRefs;
  }

  // ---------- Durable batch jobs (images + videos) ----------

  // Builds the fal payload for one shot's image — used by both the batch
  // (generateAllImages) and single-shot (regenerateImage) durable jobs.
  function buildImageItemInput(shot: UiShot, prompt: string): Record<string, unknown> {
    const imageUrls = collectReferenceImagesForShot(shot);
    const hasImages = imageUrls.length > 0;
    return {
      shotId: shot.id,
      kind: "image",
      model: hasImages ? "fal-ai/nano-banana-pro/edit" : "fal-ai/flux-pro/v1.1",
      falInput: hasImages
        ? { prompt, image_urls: imageUrls, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" }
        : { prompt, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" },
    };
  }

  // Builds the fal payload for one shot's video — used by both the batch
  // (generateAllVideos) and single-shot (regenerateVideo) durable jobs.
  //
  // Seedance 2.0 reference-to-video takes `image_urls` (up to 9) and references
  // them inside the prompt as @Image1, @Image2, etc. @Image1 is the B-roll
  // starting frame; subsequent entries are the product hero / content image /
  // reference sheet so the model can match packaging + angles across the clip.
  function buildVideoItemInput(shot: UiShot, prompt: string): Record<string, unknown> {
    const productRefs = collectProductImageUrls();
    // Starting frame first, then product references (de-duped in case the
    // broll still is somehow one of the product URLs).
    const imageUrls = [shot.imageUrl!, ...productRefs.filter((u) => u !== shot.imageUrl)];
    return {
      shotId: shot.id,
      kind: "video",
      // Fast tier is the PRODUCTION choice (decided 2026-07-09): ~2-3× faster,
      // ~30-50% cheaper, same 9 reference images and 4-15s duration as the
      // regular tier. If quality issues appear (softer motion, label/text
      // drift on packaging, color/lighting deviation from the starting
      // frame), the rollback is: model: "bytedance/seedance-2.0/reference-to-video"
      model: "bytedance/seedance-2.0/fast/reference-to-video",
      falInput: {
        prompt,
        image_urls: imageUrls,
        // 5 seconds (was 4): Seedance 2.0 supports 4-15. 5s gives the model
        // a touch more room for product motion (rotation reveal, pour beat,
        // unboxing slide) without a noticeable cost or latency hit.
        duration: "5",
        aspect_ratio: "9:16",
        resolution: "720p",
        // Audio off: we never use the generated audio track, and disabling it
        // shaves generation time + drops Seedance/Kling cost noticeably.
        generate_audio: false,
      },
    };
  }

  /** Full working-state snapshot stored on the job so a reload can restore the session. */
  function buildSessionPayload(): Record<string, unknown> {
    return {
      productId: selectedProductId,
      productName: selectedProduct?.name ?? null,
      shots: uiShots.map((s) => ({
        id: s.id, shot_id: s.shot_id, type: s.type, userAdded: s.userAdded,
        title: s.title, description: s.description, location: s.location,
        imagePrompt: s.imagePrompt ?? null, imageUrl: s.imageUrl ?? null,
        imageApproval: s.imageApproval,
        videoPrompt: s.videoPrompt ?? null, videoUrl: s.videoUrl ?? null,
        videoApproval: s.videoApproval,
      })),
    };
  }

  /** Mirror a job item's state onto its shot. */
  function applyItemToShot(it: JobItem, isImage: boolean) {
    const shotId = (it.input as { shotId?: string }).shotId;
    if (!shotId) return;
    const url = it.output?.url;
    if (isImage) {
      if (it.status === "complete" && url) patchShot(shotId, { imageStatus: "ready", imageUrl: url });
      else if (it.status === "failed") patchShot(shotId, { imageStatus: "failed", imageError: it.error ?? "Generation failed" });
    } else {
      if (it.status === "complete" && url) patchShot(shotId, { videoStatus: "ready", videoUrl: url });
      else if (it.status === "failed") patchShot(shotId, { videoStatus: "failed", videoError: it.error ?? "Generation failed" });
    }
  }

  // Poll the active job(s) every 2.5s (the app's standard cadence) and mirror
  // item states onto shots; stop when a job reaches a terminal status. Image
  // and video jobs are polled independently — the user can step back and
  // start an image batch while a video job is still running.
  useEffect(() => {
    if (!activeImageJobId && !activeVideoJobId) return;
    let cancelled = false;
    const pollOne = async (jobId: string, isImage: boolean) => {
      try {
        const { job, items } = await getJob(jobId);
        if (cancelled) return;
        for (const it of items) applyItemToShot(it, isImage);
        if (job.status !== "queued" && job.status !== "running") {
          if (isImage) setActiveImageJobId(null); else setActiveVideoJobId(null);
        }
      } catch {
        /* transient — next tick retries */
      }
    };
    const tick = () => {
      if (activeImageJobId) void pollOne(activeImageJobId, true);
      if (activeVideoJobId) void pollOne(activeVideoJobId, false);
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageJobId, activeVideoJobId]);

  /**
   * Restore the page's full working session from a job: the payload snapshot
   * (buildSessionPayload) provides the shot list — prompts/urls/approvals as
   * of trigger time; item outputs overlay whatever finished after the
   * snapshot. Adopts the job as the active poll target when it is still
   * running, marks the matching auto-kick ref(s) as fired so entering the
   * step below can't fire a duplicate batch, and moves the user to the step
   * that matches the job type.
   */
  async function hydrateFromJob(jobId: string) {
    // Invalidate any in-flight batch creator FIRST — see hydrationEpochRef.
    hydrationEpochRef.current += 1;
    const { job, items } = await getJob(jobId);
    const payload = job.payload as {
      productId?: string | null;
      productName?: string | null;
      shots?: Array<Record<string, unknown>>;
    };
    if (payload.productId && payload.productId !== selectedProductId) {
      // selectedProduct is a derived lookup (researchedProducts.find), so
      // setting the id before the products fetch resolves is safe — it
      // simply matches once the existing effect lands.
      setSelectedProductId(payload.productId);
    }
    // The prompt writers compose against productLine; restore a usable value
    // from the snapshot so post-resume regenerates aren't product-blind.
    if (payload.productName) setProductLine(payload.productName);
    const isImage = job.type === "broll_images";
    // A job can be adopted well after it ended (e.g. deep link opened later,
    // or a dev-server restart marked queued/running jobs failed). If the job
    // itself is no longer active, any item still "pending"/"running" will
    // never be picked up by a worker — mapping those to "generating" would
    // leave the shot spinning forever. Only map to "generating" while the
    // job itself is still active; otherwise treat unfinished items as failed.
    const jobIsActive = job.status === "queued" || job.status === "running";
    const byShot = new Map(items.map((it) => [(it.input as { shotId?: string }).shotId, it] as const));
    const restored: UiShot[] = (payload.shots ?? []).map((s) => {
      const base: UiShot = {
        id: s.id as string,
        shot_id: s.shot_id as number,
        type: s.type as ShotType,
        userAdded: Boolean(s.userAdded),
        title: (s.title as string) ?? "",
        description: (s.description as string) ?? "",
        location: (s.location as string) ?? "",
        imageStatus: s.imageUrl ? "ready" : "idle",
        imageApproval: ((s.imageApproval as Approval) ?? "pending"),
        imageUrl: (s.imageUrl as string) ?? undefined,
        imagePrompt: (s.imagePrompt as string) ?? undefined,
        imageFeedback: "",
        videoStatus: s.videoUrl ? "ready" : "idle",
        videoApproval: ((s.videoApproval as Approval) ?? "pending"),
        videoUrl: (s.videoUrl as string) ?? undefined,
        videoPrompt: (s.videoPrompt as string) ?? undefined,
        videoFeedback: "",
      };
      const it = byShot.get(s.id as string);
      if (!it) return base;
      const url = it.output?.url;
      if (isImage) {
        if (it.status === "complete" && url) return { ...base, imageStatus: "ready" as const, imageUrl: url };
        if (it.status === "failed") return { ...base, imageStatus: "failed" as const, imageError: it.error ?? undefined };
        return {
          ...base,
          imageStatus: jobIsActive ? ("generating" as const) : ("failed" as const),
          ...(jobIsActive ? {} : { imageError: "Interrupted — job ended before this shot finished. Regenerate to retry." }),
        };
      }
      if (it.status === "complete" && url) return { ...base, videoStatus: "ready" as const, videoUrl: url };
      if (it.status === "failed") return { ...base, videoStatus: "failed" as const, videoError: it.error ?? undefined };
      return {
        ...base,
        videoStatus: jobIsActive ? ("generating" as const) : ("failed" as const),
        ...(jobIsActive ? {} : { videoError: "Interrupted — job ended before this shot finished. Regenerate to retry." }),
      };
    });
    // Restored ids came from a previous session's newUiShotId() sequence, but
    // this session's module-level counter restarts at 0 on a fresh page load.
    // Bump it past the highest restored suffix so a post-resume addShot can't
    // mint an id (and React key) that collides with a restored shot.
    for (const s of restored) {
      const m = /^ui-shot-(\d+)$/.exec(s.id);
      if (m) uiShotCounter = Math.max(uiShotCounter, Number(m[1]));
    }
    setUiShots(restored);
    if (job.status === "queued" || job.status === "running") {
      if (isImage) setActiveImageJobId(job.id);
      else setActiveVideoJobId(job.id);
    }
    // Mark the restored step's auto-kick as already fired BEFORE navigating —
    // otherwise the step-entry effect would immediately create a new batch
    // over the restored shots. A videos job implies images are done too.
    imagesAutoKickedRef.current = true;
    if (!isImage) videosAutoKickedRef.current = true;
    setCurrentStep(isImage ? 2 : 3);
  }

  /** Returns true when an unfinished broll job of the given type for the
   *  current product was handled — adopted (session hydrated, poll target
   *  set), or found but adoption failed (error surfaced; never fall through
   *  to creating a duplicate over a live job). Returns false only when there
   *  is nothing to adopt, so a normal create may proceed. */
  async function adoptUnfinishedJob(type: "broll_images" | "broll_videos"): Promise<boolean> {
    if (!activeBrandId) return false;
    let candidate: Job | undefined;
    try {
      const { jobs } = await listJobs(activeBrandId);
      candidate = jobs.find(
        (x) =>
          x.app === "broll" &&
          x.type === type &&
          (x.status === "queued" || x.status === "running") &&
          (x.productId ?? null) === (selectedProductId || null),
      );
    } catch {
      // Couldn't check — proceed with a normal create rather than blocking the user.
      return false;
    }
    if (!candidate) return false;
    try {
      await hydrateFromJob(candidate.id);
    } catch (err) {
      // A job to adopt EXISTS but adoption failed — surface it and report
      // "handled" so the caller does NOT create a duplicate over a live job.
      setPipelineError(err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // Deep link from the dashboard: ?job=<id> restores that session.
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (jobId) {
      void hydrateFromJob(jobId).catch((err) =>
        setPipelineError(err instanceof Error ? err.message : String(err)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session-resume banner source: prefer the newest queued/running broll job;
  // with none, fall back to the newest broll job of ANY status so users can
  // jump straight back into their LAST session even after it finished
  // (hydrateFromJob handles terminal jobs — spinners end as failed/complete).
  // The server lists running/queued first, then newest, so within the broll
  // subset the first entry of each group is the right pick.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    void listJobs(activeBrandId)
      .then(({ jobs }) => {
        if (cancelled) return;
        const broll = jobs.filter((x) => x.app === "broll");
        const running = broll.find((x) => x.status === "queued" || x.status === "running");
        setResumableJob(running ?? broll[0] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeBrandId]);

  // ---------- Image generation (batch + single-shot jobs) ----------

  async function generateAllImages() {
    const queue = uiShots.filter(
      (s) => s.imageStatus === "idle" || s.imageStatus === "failed",
    );
    if (queue.length === 0 || !activeBrand || activeImageJobId) return;
    // Synchronous in-flight guard — activeImageJobId only flips once createJob
    // returns, so without this a concurrent second call (auto-kick + banner
    // click, stepper back-and-re-approve) races through the awaits below and
    // creates a duplicate job.
    if (imagesBatchInFlightRef.current) return;
    imagesBatchInFlightRef.current = true;
    const epoch = hydrationEpochRef.current;
    try {
      // Duplicate-guard: a reload loses activeImageJobId, and re-walking the
      // flow re-enters this path (auto-kick or button) while the original batch
      // may still be running server-side. Adopt that job instead of paying fal
      // for a second one.
      if (await adoptUnfinishedJob("broll_images")) return;
      setPipelineError(null);
      try {
        const prompts = await writeImagePrompts(queue);
        // Resume-banner race: a hydration landed during the prompt-writing await — drop this stale batch so it can't stomp the adopted session.
        if (hydrationEpochRef.current !== epoch) return;
        queue.forEach((s, i) => patchShot(s.id, { imageStatus: "generating", imageError: undefined, imagePrompt: prompts[i] ?? "" }));
        const { job } = await createJob({
          app: "broll",
          type: "broll_images",
          brandId: activeBrand.id,
          productId: selectedProductId || null,
          title: `B-roll images — ${selectedProduct?.name ?? "product"} · ${queue.length} shot(s)`,
          payload: buildSessionPayload(),
          items: queue.map((s, i) => ({ label: s.title, input: buildImageItemInput(s, prompts[i] ?? "") })),
        });
        setActiveImageJobId(job.id);
      } catch (err) {
        setPipelineError(err instanceof Error ? err.message : String(err));
        // Roll the optimistic "generating" state back so shots stay actionable.
        // `queue` is the pre-patch snapshot, so each shot's imageStatus is its
        // pre-call value ("idle" or "failed").
        queue.forEach((s) => patchShot(s.id, { imageStatus: s.imageStatus === "failed" ? "failed" : "idle" }));
      }
    } finally {
      imagesBatchInFlightRef.current = false;
    }
  }

  async function regenerateImage(shotId: string, feedback?: string) {
    // Can't run two image jobs at once — mirrors the batch guard, and keeps
    // the regenerate buttons effectively inert while a batch is in flight.
    if (activeImageJobId) return;
    const target = uiShots.find((s) => s.id === shotId);
    if (!target) return;
    // Double-click guard: without a live job id yet (e.g. this very call is
    // mid-flight through its awaits), a second click on the same shot would
    // re-enter and fire a duplicate regenerate for a shot already in flight.
    if (target.imageStatus === "generating") return;
    setPipelineError(null);
    const epoch = hydrationEpochRef.current;
    const feedbackText = (feedback ?? target.imageFeedback ?? "").trim();
    patchShot(shotId, {
      imageStatus: "generating",
      imageError: undefined,
      imageApproval: "pending",
      ...(feedbackText ? { imageFeedback: feedbackText } : {}),
    });
    try {
      // FEEDBACK PATH — feedback supplied AND a prior image exists. Route
      // through the focused rework prompt (`prompts/broll_image_feedback.md`)
      // via the shared `regenImageWithFeedback` helper. That helper also
      // backs Character B-Roll + Single Scene; the difference is just the
      // prompt file (the product variant drops character-identity rules).
      //
      // We used to append the feedback as a tail of the full scene prompt
      // ("…1500 chars of camera/lighting/pose…\n\nAdditional direction
      // from user: <feedback>"). nano-banana-pro/edit weighted the long
      // original section much more than the short user direction at the
      // tail, so feedback often had little visible effect. The rework
      // prompt inverts that — feedback IS the directive, "preserve
      // everything else" is the constraint, and the prior image is the
      // edit source (image_urls[0]).
      //
      // This path stays a direct call (not a durable job): it goes through
      // the server's prompt-template route (action + vars.feedback), which
      // the job executor's flat `falInput` shape has no equivalent for.
      if (feedbackText && target.imageUrl) {
        const newUrl = await regenImageWithFeedback({
          feedback: feedbackText,
          sourceImageUrl: target.imageUrl,
          extraRefs: collectReferenceImagesForShot(target),
          action: "broll_image_feedback",
        });
        // Bake the feedback into the stored imagePrompt for traceability +
        // future video prompt alignment, then invalidate the stale video
        // prompt so the next video pass rewrites from the new still.
        const updatedPrompt = target.imagePrompt
          ? `${target.imagePrompt}\n\nAdditional direction from user: ${feedbackText}`
          : feedbackText;
        patchShot(shotId, {
          imageStatus: "ready",
          imageUrl: newUrl,
          imagePrompt: updatedPrompt,
          videoPrompt: undefined,
        });
        return;
      }

      // FRESH-REGEN PATH — no feedback or no prior image. Either:
      //   - user clicked the plain "regenerate" button → produce a different
      //     take of the same shot, no prior image as ref;
      //   - or this is the first generation attempt, so there's nothing
      //     to edit yet.
      // Runs as a 1-item durable job so it survives reload the same way the
      // batch generations do.
      let basePrompt = target.imagePrompt;
      if (!basePrompt) {
        const [written] = await writeImagePrompts([target]);
        basePrompt = written ?? "";
      }
      patchShot(shotId, {
        imagePrompt: basePrompt,
        ...(feedbackText ? { videoPrompt: undefined } : {}),
      });
      if (!activeBrand) throw new Error("No active brand selected.");
      // Resume-banner race: a hydration landed during the awaits above — roll back this shot's optimistic spinner instead of stomping the adopted session with a stale job.
      if (hydrationEpochRef.current !== epoch) {
        patchShot(shotId, { imageStatus: target.imageStatus, imageApproval: target.imageApproval, imageError: target.imageError });
        return;
      }
      try {
        const { job } = await createJob({
          app: "broll",
          type: "broll_images",
          brandId: activeBrand.id,
          productId: selectedProductId || null,
          title: `B-roll image regenerate — ${target.title}`,
          payload: buildSessionPayload(),
          items: [{ label: target.title, input: buildImageItemInput(target, basePrompt) }],
        });
        setActiveImageJobId(job.id);
      } catch (err) {
        // A failed job CREATION must not leave the shot stuck "generating" —
        // mirrors the batch fns' rollback style.
        patchShot(shotId, {
          imageStatus: "failed",
          imageError: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      patchShot(shotId, {
        imageStatus: "failed",
        imageError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------- Video generation (batch + single-shot jobs) ----------

  async function generateAllVideos() {
    const queue = uiShots.filter(
      (s) =>
        s.imageApproval === "approved" &&
        s.imageUrl &&
        s.videoStatus !== "generating" &&
        s.videoStatus !== "ready",
    );
    if (queue.length === 0 || !activeBrand || activeVideoJobId) return;
    // Synchronous in-flight guard — see generateAllImages; same race window.
    if (videosBatchInFlightRef.current) return;
    videosBatchInFlightRef.current = true;
    const epoch = hydrationEpochRef.current;
    try {
      // Duplicate-guard — see generateAllImages; same reload/double-spend risk.
      if (await adoptUnfinishedJob("broll_videos")) return;
      setPipelineError(null);
      try {
        const prompts = await writeVideoPrompts(queue);
        // Resume-banner race: a hydration landed during the prompt-writing await — drop this stale batch so it can't stomp the adopted session.
        if (hydrationEpochRef.current !== epoch) return;
        queue.forEach((s, i) => patchShot(s.id, { videoStatus: "generating", videoError: undefined, videoPrompt: prompts[i] ?? "" }));
        const { job } = await createJob({
          app: "broll",
          type: "broll_videos",
          brandId: activeBrand.id,
          productId: selectedProductId || null,
          title: `B-roll videos — ${selectedProduct?.name ?? "product"} · ${queue.length} shot(s)`,
          payload: buildSessionPayload(),
          items: queue.map((s, i) => ({ label: s.title, input: buildVideoItemInput(s, prompts[i] ?? "") })),
        });
        setActiveVideoJobId(job.id);
      } catch (err) {
        setPipelineError(err instanceof Error ? err.message : String(err));
        // Same rollback rationale as generateAllImages.
        queue.forEach((s) => patchShot(s.id, { videoStatus: s.videoStatus === "failed" ? "failed" : "idle" }));
      }
    } finally {
      videosBatchInFlightRef.current = false;
    }
  }

  async function regenerateVideo(shotId: string, feedback?: string) {
    // Can't run two video jobs at once — mirrors the batch guard, and keeps
    // the regenerate buttons effectively inert while a batch is in flight.
    if (activeVideoJobId) return;
    const target = uiShots.find((s) => s.id === shotId);
    if (!target || !target.imageUrl) return;
    // Double-click guard: mirrors regenerateImage — without a live job id yet,
    // a second click on the same shot would re-enter and fire a duplicate
    // regenerate for a shot already in flight.
    if (target.videoStatus === "generating") return;
    setPipelineError(null);
    const epoch = hydrationEpochRef.current;
    const feedbackText = (feedback ?? target.videoFeedback ?? "").trim();
    patchShot(shotId, {
      videoStatus: "generating",
      videoError: undefined,
      videoApproval: "pending",
      ...(feedbackText ? { videoFeedback: feedbackText } : {}),
    });
    try {
      let basePrompt = target.videoPrompt;
      if (!basePrompt) {
        const [written] = await writeVideoPrompts([target]);
        basePrompt = written ?? "";
      }
      const finalPrompt = feedbackText
        ? `${basePrompt}\n\nAdditional direction from user: ${feedbackText}`
        : basePrompt;
      patchShot(shotId, { videoPrompt: finalPrompt });
      if (!activeBrand) throw new Error("No active brand selected.");
      // Resume-banner race: a hydration landed during the awaits above — roll back this shot's optimistic spinner instead of stomping the adopted session with a stale job.
      if (hydrationEpochRef.current !== epoch) {
        patchShot(shotId, { videoStatus: target.videoStatus, videoApproval: target.videoApproval, videoError: target.videoError });
        return;
      }
      try {
        const { job } = await createJob({
          app: "broll",
          type: "broll_videos",
          brandId: activeBrand.id,
          productId: selectedProductId || null,
          title: `B-roll video regenerate — ${target.title}`,
          payload: buildSessionPayload(),
          items: [{ label: target.title, input: buildVideoItemInput(target, finalPrompt) }],
        });
        setActiveVideoJobId(job.id);
      } catch (err) {
        // A failed job CREATION must not leave the shot stuck "generating" —
        // mirrors the batch fns' rollback style.
        patchShot(shotId, {
          videoStatus: "failed",
          videoError: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      patchShot(shotId, {
        videoStatus: "failed",
        videoError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------- Step transitions ----------

  function handleApproveShotList() {
    if (uiShots.length === 0) return;
    // Drop any empty shots the user left unfilled.
    const cleaned = uiShots.filter((s) => s.title.trim() || s.description.trim());
    if (cleaned.length !== uiShots.length) setUiShots(cleaned);
    imagesAutoKickedRef.current = false;
    setCurrentStep(2);
  }

  function handleAdvanceToVideos() {
    const approved = uiShots.filter((s) => s.imageApproval === "approved" && s.imageUrl);
    if (approved.length === 0) {
      setPipelineError("Approve at least one image before generating videos.");
      return;
    }
    videosAutoKickedRef.current = false;
    setCurrentStep(3);
  }

  // Auto-kick on step entry.
  useEffect(() => {
    if (currentStep === 2 && !imagesAutoKickedRef.current && uiShots.length > 0) {
      imagesAutoKickedRef.current = true;
      void generateAllImages();
    }
    if (currentStep === 3 && !videosAutoKickedRef.current) {
      videosAutoKickedRef.current = true;
      void generateAllVideos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // ---------- Approval / download helpers ----------

  function setImageApproval(id: string, approval: Approval) {
    patchShot(id, { imageApproval: approval });
  }

  function setVideoApproval(id: string, approval: Approval) {
    patchShot(id, { videoApproval: approval });
  }

  async function downloadVideo(shot: UiShot) {
    if (!shot.videoUrl) return;
    const filename = `broll-${shot.shot_id}-${(shot.title || "shot").slice(0, 40).replace(/\s+/g, "-")}.mp4`;
    try {
      await downloadViaBlob(shot.videoUrl, filename);
    } catch (err) {
      setPipelineError(
        `Download failed for "${shot.title}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function approveAllReadyImages() {
    setUiShots((prev) =>
      prev.map((s) =>
        s.imageStatus === "ready" && s.imageApproval !== "approved"
          ? { ...s, imageApproval: "approved" as const }
          : s,
      ),
    );
  }

  function approveAllReadyVideos() {
    setUiShots((prev) =>
      prev.map((s) =>
        s.videoStatus === "ready" && s.videoApproval !== "approved"
          ? { ...s, videoApproval: "approved" as const }
          : s,
      ),
    );
  }

  async function downloadAllAndSaveToBrandAssets() {
    const targets = uiShots.filter((s) => s.videoApproval === "approved" && s.videoUrl);
    if (targets.length === 0) return;
    if (!activeBrandId) {
      setPipelineError("No active brand selected.");
      return;
    }
    setSavingToBrandAssets(true);
    setPipelineError(null);
    // Kick off downloads and persistence in parallel; neither should redirect the page.
    const downloadPromise = Promise.allSettled(
      targets.map((shot, i) =>
        new Promise<void>((resolve) => {
          setTimeout(async () => {
            await downloadVideo(shot);
            resolve();
          }, i * 350);
        }),
      ),
    );
    try {
      const payload = targets.map((shot) => ({
        kind: "video" as const,
        url: shot.videoUrl!,
        thumbnailUrl: shot.imageUrl ?? null,
        title: shot.title || `B-Roll shot #${shot.shot_id}`,
        sourceApp: "broll",
        productId: selectedProduct?.id ?? null,
        metadata: {
          shot_id: shot.shot_id,
          shot_type: fromUiShotType(shot.type),
          location: shot.location,
          description: shot.description,
          imagePrompt: shot.imagePrompt ?? null,
          videoPrompt: shot.videoPrompt ?? null,
        },
      }));
      const { assets } = await saveBrandAssets(activeBrandId, payload);
      setBrandAssetsSavedCount(assets.length);
    } catch (err) {
      setPipelineError(
        `Saved locally but failed to write to Brand Assets: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      // Wait for all file downloads to finish triggering before clearing spinner.
      await downloadPromise;
      setSavingToBrandAssets(false);
    }
  }

  // ---------- Derived ----------

  const filteredShots = selectedType === "all" ? uiShots : uiShots.filter((s) => s.type === selectedType);
  const shotsByType = (type: ShotType) => uiShots.filter((s) => s.type === type);
  const imagesApprovedCount = uiShots.filter((s) => s.imageApproval === "approved").length;
  const imagesReadyCount = uiShots.filter((s) => s.imageStatus === "ready").length;
  const imagesFailedCount = uiShots.filter((s) => s.imageStatus === "failed").length;
  const imagesGeneratingCount = uiShots.filter((s) => s.imageStatus === "generating").length;
  const imagesProgressPct = uiShots.length === 0
    ? 0
    : Math.round(((imagesReadyCount + imagesFailedCount) / uiShots.length) * 100);

  // Two-phase progress: each shot does 2 units of work (write prompt, then
  // generate image). Total = 2N. We count each parallel prompt completion
  // (capped at N) plus each image completion (capped at N). Result is a
  // single 0-100% bar that moves continuously across both phases.
  const twoPhaseImagesPct = uiShots.length === 0
    ? 0
    : Math.round(
        ((Math.min(imagePromptsWritten, uiShots.length) + imagesReadyCount + imagesFailedCount)
          / (uiShots.length * 2)) * 100,
      );

  const approvedImageShots = uiShots.filter((s) => s.imageApproval === "approved");
  const videosReadyCount = approvedImageShots.filter((s) => s.videoStatus === "ready").length;
  const videosFailedCount = approvedImageShots.filter((s) => s.videoStatus === "failed").length;
  const videosGeneratingCount = approvedImageShots.filter((s) => s.videoStatus === "generating").length;
  const videosApprovedCount = uiShots.filter((s) => s.videoApproval === "approved").length;
  const videosProgressPct = approvedImageShots.length === 0
    ? 0
    : Math.round(((videosReadyCount + videosFailedCount) / approvedImageShots.length) * 100);

  // Same two-phase calculation for videos.
  const twoPhaseVideosPct = approvedImageShots.length === 0
    ? 0
    : Math.round(
        ((Math.min(videoPromptsWritten, approvedImageShots.length) + videosReadyCount + videosFailedCount)
          / (approvedImageShots.length * 2)) * 100,
      );

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
          <div className="w-6 h-6 rounded bg-cyan-500/20 flex items-center justify-center">
            <Video size={12} className="text-cyan-400" />
          </div>
          <span className="font-mono text-xs text-white/60 tracking-wider">B-ROLL GENERATOR</span>
        </div>

        {/* Step Indicator */}
        <div className="ml-auto flex items-center gap-1">
          {STEPS.map((step, i) => (
            <button
              key={step}
              onClick={() => {
                if (i === 0 || uiShots.length > 0) setCurrentStep(i);
              }}
              disabled={i > 0 && uiShots.length === 0}
              className="flex items-center gap-1.5 group disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div
                className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold transition-all ${
                  i === currentStep
                    ? "bg-cyan-500/20 text-cyan-400 shadow-[0_0_12px_rgba(0,212,255,0.3)]"
                    : i < currentStep
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-white/5 text-white/30"
                }`}
              >
                {i < currentStep ? <Check size={10} /> : i + 1}
              </div>
              <span
                className={`text-[10px] font-mono tracking-wider hidden md:block ${
                  i === currentStep ? "text-cyan-400" : "text-white/30"
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
        {/* Left Sidebar — Shot Type Filter (hidden on input and shot-list steps) */}
        {currentStep > 1 && uiShots.length > 0 && (
          <aside className="w-52 border-r border-white/[0.06] p-3 flex flex-col gap-1 shrink-0" style={{ background: "#0D0F12" }}>
            <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest px-2 py-2 mb-1">
              Shot Categories
            </div>
            <button
              onClick={() => setSelectedType("all")}
              className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-all ${
                selectedType === "all" ? "bg-cyan-500/10 text-cyan-400" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
              }`}
            >
              <Eye size={13} />
              <span className="font-mono">All Shots</span>
              <span className="ml-auto text-[10px] opacity-50">{uiShots.length}</span>
            </button>
            {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-all ${
                  selectedType === type ? "bg-white/[0.06] text-white" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: SHOT_TYPE_INFO[type].color,
                    boxShadow: selectedType === type ? `0 0 8px ${SHOT_TYPE_INFO[type].color}60` : "none",
                  }}
                />
                <span className="font-mono truncate">{SHOT_TYPE_INFO[type].label}</span>
                <span className="ml-auto text-[10px] opacity-50">{shotsByType(type).length}</span>
              </button>
            ))}

            {shotList && (
              <div className="mt-auto border-t border-white/[0.06] pt-3">
                <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest px-2 py-1 mb-2">Project</div>
                <div className="px-2">
                  <div className="text-[11px] text-white/70 truncate" title={shotList.project}>{shotList.project}</div>
                  <div className="text-[10px] font-mono text-white/30 mt-1 truncate" title={shotList.location_default}>
                    {shotList.location_default}
                  </div>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* Center — Content Area */}
        <main className="flex-1 overflow-auto p-4">
          {/* Session-resume banner — running jobs resume live, finished jobs
              restore the last session. Hidden while the page is already
              mirroring a job (then the progress UI covers it). Not a single
              <button> because the dismiss X needs its own button (nested
              buttons are invalid HTML). */}
          {resumableJob && !activeImageJobId && !activeVideoJobId && (
            <div className="mb-4 w-full rounded-md border border-cyan-400/30 bg-cyan-400/10 flex items-stretch">
              <button
                type="button"
                onClick={() => {
                  const j = resumableJob;
                  setResumableJob(null);
                  if (j) {
                    void hydrateFromJob(j.id).catch((err) =>
                      setPipelineError(err instanceof Error ? err.message : String(err)),
                    );
                  }
                }}
                className="flex-1 min-w-0 p-3 flex items-start gap-2 text-left hover:bg-cyan-400/15 transition-colors rounded-l-md"
              >
                <RotateCcw size={14} className="text-cyan-400 shrink-0 mt-0.5" />
                <p className="text-[11px] font-mono text-cyan-200/80 break-words">
                  {resumableJob.status === "queued" || resumableJob.status === "running" ? (
                    <>
                      <span className="font-medium text-cyan-200">A generation is still running: {resumableJob.title}</span>
                      {" "}— click to resume this session.
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-cyan-200">Jump back into your last session: {resumableJob.title}</span>
                      {" "}— click to restore it.
                    </>
                  )}
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
          <AnimatePresence mode="wait">
            {/* STEP 0: INPUT */}
            {currentStep === 0 && (
              <motion.div key="input" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="max-w-3xl mx-auto py-8">
                <h2 className="text-xl font-bold font-mono text-cyan-400 mb-2 flex items-center gap-2">
                  <Sparkles size={18} />
                  PROJECT INPUT
                </h2>
                <p className="text-xs text-white/30 mb-8 font-mono">
                  Pick a researched product, then generate a B-roll shot list.
                </p>

                <div className="space-y-5">
                  {/* Product Selection */}
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                      1 — Select Product
                    </label>
                    {productsError ? (
                      <div className="text-[11px] text-rose-400 font-mono flex items-center gap-2">
                        <AlertTriangle size={12} /> {productsError}
                      </div>
                    ) : productsLoading ? (
                      <div className="text-[11px] text-white/30 font-mono flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin" /> Loading products...
                      </div>
                    ) : (
                      <div className="relative">
                        <button
                          onClick={() => setProductDropdownOpen(!productDropdownOpen)}
                          className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-3 hover:border-white/[0.15] transition-all text-left"
                        >
                          {selectedProduct ? (
                            <>
                              <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/[0.08] shrink-0 bg-white/[0.02] flex items-center justify-center">
                                {selectedProduct.productImageUrl ? (
                                  <img src={selectedProduct.productImageUrl} alt={selectedProduct.name} className="max-h-full max-w-full object-contain" />
                                ) : (
                                  <Package size={16} className="text-white/20" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-white/80 truncate">{selectedProduct.name}</div>
                                <div className="text-[10px] font-mono text-white/30">{selectedProduct.category}</div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="w-10 h-10 rounded-lg border border-dashed border-white/[0.12] flex items-center justify-center shrink-0">
                                <Package size={16} className="text-white/20" />
                              </div>
                              <div className="flex-1">
                                <div className="text-sm text-white/30">Choose a researched product...</div>
                                <div className="text-[10px] font-mono text-white/15">
                                  {researchedProducts.length} available
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
                                {researchedProducts.length === 0 ? (
                                  <div className="px-3 py-4 text-center text-xs text-white/30 font-mono">
                                    No researched products available. Add and research a product first.
                                  </div>
                                ) : (
                                  researchedProducts.map((product) => (
                                    <button
                                      key={product.id}
                                      onClick={() => handleProductSelect(product.id)}
                                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all ${
                                        selectedProductId === product.id
                                          ? "bg-cyan-500/10 border border-cyan-500/20"
                                          : "hover:bg-white/[0.04] border border-transparent"
                                      }`}
                                    >
                                      <div className="w-9 h-9 rounded-lg overflow-hidden border border-white/[0.06] shrink-0 bg-white/[0.02] flex items-center justify-center">
                                        {product.productImageUrl ? (
                                          <img src={product.productImageUrl} alt={product.name} className="max-h-full max-w-full object-contain" />
                                        ) : (
                                          <Package size={14} className="text-white/20" />
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs text-white/80 truncate">{product.name}</div>
                                        <div className="text-[10px] font-mono text-white/30">{product.category}</div>
                                      </div>
                                      {selectedProductId === product.id && (
                                        <Check size={14} className="text-cyan-400 shrink-0" />
                                      )}
                                    </button>
                                  ))
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>

                  {/* Asset Limits (optional) */}
                  {selectedProduct && (
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                      <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                        2 — Asset Limits <span className="text-white/20 normal-case tracking-normal">(optional)</span>
                      </label>
                      <textarea
                        rows={2}
                        value={assetLimits}
                        onChange={(e) => setAssetLimits(e.target.value)}
                        placeholder="e.g. Vertical 9:16 only · No outdoor locations · Max 10 shots · No talent, product only"
                        className="w-full bg-black/30 border border-white/[0.06] rounded-md px-3 py-2 text-[12px] text-white/80 placeholder:text-white/20 outline-none font-mono leading-relaxed resize-y"
                      />
                    </div>
                  )}

                  {generationError && (
                    <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 flex items-start gap-2">
                      <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-rose-300 font-mono break-words">{generationError}</p>
                    </div>
                  )}

                  <button
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className={`w-full py-3.5 rounded-lg font-mono text-sm font-bold tracking-wider uppercase transition-all flex items-center justify-center gap-2 ${
                      canGenerate ? "cursor-pointer" : "opacity-40 cursor-not-allowed"
                    }`}
                    style={{
                      background: canGenerate
                        ? "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)"
                        : "rgba(255,255,255,0.05)",
                      color: canGenerate ? "#0D0F12" : "rgba(255,255,255,0.3)",
                      boxShadow: canGenerate ? "0 0 20px rgba(0,212,255,0.3)" : "none",
                    }}
                  >
                    {generating ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Generating shot list...
                      </>
                    ) : (
                      <>Generate B-Roll Shots</>
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 1: TEXT SHOT LIST (editable) */}
            {currentStep === 1 && (
              <motion.div key="shotlist" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="max-w-4xl mx-auto py-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
                  <h2 className="text-sm font-mono text-white/60 uppercase tracking-widest flex items-center gap-2">
                    <ImageIcon size={14} className="text-cyan-400" />
                    Shot List <span className="text-cyan-400">({uiShots.length})</span>
                  </h2>
                  <button
                    onClick={handleApproveShotList}
                    disabled={uiShots.length === 0 || Boolean(activeImageJobId)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded font-mono text-xs uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles size={12} /> Approve & Generate Images
                  </button>
                </div>
                <p className="text-[11px] text-white/30 font-mono mb-6">
                  Edit any shot, remove what you don't need, add your own. When the list looks right, approve it — images generate for every remaining shot.
                </p>

                {pipelineError && (
                  <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/5 p-3 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-rose-300 font-mono break-words">{pipelineError}</p>
                  </div>
                )}

                {/* Loading state — shown while handleGenerate() is running the
                    shot-list architect prompt in the background. The progress
                    bar is time-estimated since one Claude call has no
                    sub-progress; it asymptotes toward 95% over ~25s and snaps
                    to 100% when the call returns. */}
                {generating && uiShots.length === 0 && (
                  <div className="flex flex-col gap-3 mb-6">
                    <ShotListProgressBar />
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-white/[0.06] p-4 animate-pulse"
                        style={{ background: "#13161F", animationDelay: `${i * 0.1}s` }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <div className="h-4 w-6 rounded bg-white/[0.06]" />
                          <div className="h-4 w-24 rounded bg-white/[0.06]" />
                        </div>
                        <div className="h-3 w-3/4 rounded bg-white/[0.04] mb-2" />
                        <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  {uiShots.map((shot, idx) => (
                    <div
                      key={shot.id}
                      className="rounded-lg border border-white/[0.06] p-4"
                      style={{ background: "#13161F" }}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] font-mono text-white/40 bg-white/[0.04] border border-white/[0.06] rounded px-2 py-0.5">
                          #{idx + 1}
                        </span>
                        {shot.userAdded ? (
                          <select
                            value={shot.type}
                            onChange={(e) => updateShotField(shot.id, { type: e.target.value as ShotType })}
                            className="text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/70 border border-white/[0.08] rounded px-2 py-1 outline-none hover:border-white/[0.18]"
                          >
                            {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((t) => (
                              <option key={t} value={t} style={{ background: "#1A1D28" }}>
                                {SHOT_TYPE_INFO[t].label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-white/60 bg-white/[0.02] border border-white/[0.06] rounded px-2 py-1">
                            {SHOT_TYPE_INFO[shot.type].label}
                          </span>
                        )}
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: SHOT_TYPE_INFO[shot.type].color,
                            boxShadow: `0 0 6px ${SHOT_TYPE_INFO[shot.type].color}80`,
                          }}
                        />
                        <button
                          onClick={() => removeShot(shot.id)}
                          className="ml-auto p-1.5 rounded text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Remove shot"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Action</label>
                      <input
                        type="text"
                        value={shot.title}
                        onChange={(e) => updateShotField(shot.id, { title: e.target.value })}
                        placeholder="Short action description — what happens on screen"
                        className="w-full mt-1 mb-3 bg-black/30 border border-white/[0.06] rounded px-3 py-2 text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-500/40"
                      />

                      <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Visual Example</label>
                      <textarea
                        rows={2}
                        value={shot.description}
                        onChange={(e) => updateShotField(shot.id, { description: e.target.value })}
                        placeholder="What should this shot look like? Lighting, composition, feel..."
                        className="w-full mt-1 mb-3 bg-black/30 border border-white/[0.06] rounded px-3 py-2 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-cyan-500/40 font-mono leading-relaxed resize-y"
                      />

                      <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Location</label>
                      <input
                        type="text"
                        value={shot.location}
                        onChange={(e) => updateShotField(shot.id, { location: e.target.value })}
                        placeholder="Location / setting"
                        className="w-full mt-1 bg-black/30 border border-white/[0.06] rounded px-3 py-2 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-cyan-500/40 font-mono"
                      />
                    </div>
                  ))}

                  <button
                    onClick={() => addShot()}
                    className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.12] bg-white/[0.01] py-4 text-white/40 hover:border-cyan-500/30 hover:text-cyan-400 transition-all text-xs font-mono uppercase tracking-wider"
                  >
                    <Plus size={14} /> Add Shot
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 2: IMAGES */}
            {currentStep === 2 && (
              <motion.div key="images" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                  <h2 className="text-sm font-mono text-white/60 uppercase tracking-widest flex items-center gap-2">
                    <ImageIcon size={14} className="text-cyan-400" />
                    Images <span className="text-cyan-400">({imagesReadyCount} / {uiShots.length})</span>
                    <span className="text-white/20 mx-2">·</span>
                    <span className="text-emerald-400/60">{imagesApprovedCount} approved</span>
                  </h2>
                  <div className="flex items-center gap-2">
                    {(imagePromptsLoading || mechanismLoading) && (
                      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/50 border border-white/[0.08]">
                        <Loader2 size={10} className="animate-spin" />
                        {mechanismLoading ? "Extracting mechanism..." : "Writing prompts..."}
                      </span>
                    )}
                    <button
                      onClick={approveAllReadyImages}
                      disabled={imagesReadyCount === 0 || imagesReadyCount === imagesApprovedCount}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Check size={10} /> Approve All
                    </button>
                    <button
                      onClick={handleAdvanceToVideos}
                      disabled={imagesApprovedCount === 0 || Boolean(activeVideoJobId)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Video size={10} /> Generate Videos ({imagesApprovedCount})
                    </button>
                  </div>
                </div>

                {/* Two-phase determinate progress bar.
                    Phase 1 (0→50%): prompt writing — counts parallel Claude
                      calls as they land (imagePromptsWritten / total).
                    Phase 2 (50→100%): image generation — counts fal jobs as
                      they finish (imagesReadyCount + imagesFailedCount).
                    The bar moves continuously across both phases so there's
                    always visible progress. */}
                <div className="mb-4">
                  <div className="flex items-center justify-between text-[10px] font-mono text-white/40 mb-1">
                    <span className="uppercase tracking-widest">
                      {imagesReadyCount + imagesFailedCount >= uiShots.length && uiShots.length > 0
                        ? "All images ready"
                        : imagePromptsWritten < uiShots.length && imagesReadyCount === 0
                        ? `Writing prompts… (${imagePromptsWritten}/${uiShots.length})`
                        : `Generating images… (${imagesReadyCount + imagesFailedCount}/${uiShots.length})`}
                    </span>
                    <span>
                      {Math.round(twoPhaseImagesPct)}%
                      {imagesFailedCount > 0 && (
                        <span className="text-rose-400/80 ml-2">({imagesFailedCount} failed)</span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{
                        background:
                          twoPhaseImagesPct >= 100
                            ? "linear-gradient(90deg, #10B981, #34D399)"
                            : "linear-gradient(90deg, #00D4FF, #0099CC)",
                        boxShadow:
                          twoPhaseImagesPct >= 100
                            ? "0 0 8px rgba(16,185,129,0.3)"
                            : "0 0 8px rgba(0,212,255,0.3)",
                      }}
                      animate={{ width: `${twoPhaseImagesPct}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                </div>

                {pipelineError && (
                  <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/5 p-3 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-rose-300 font-mono break-words">{pipelineError}</p>
                  </div>
                )}

                {(selectedType === "all" ? (Object.keys(SHOT_TYPE_INFO) as ShotType[]) : [selectedType]).map((type) => {
                  const shots = selectedType === "all" ? shotsByType(type) : filteredShots;
                  if (shots.length === 0) return null;
                  return (
                    <div key={type} className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: SHOT_TYPE_INFO[type].color, boxShadow: `0 0 8px ${SHOT_TYPE_INFO[type].color}60` }} />
                        <span className="text-xs font-mono text-white/50 uppercase tracking-widest">{SHOT_TYPE_INFO[type].label}</span>
                        <span className="text-[10px] font-mono text-white/20">({shots.length})</span>
                        <div className="flex-1 h-px bg-white/[0.06]" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {shots.map((shot) => (
                          <motion.div
                            key={shot.id}
                            whileHover={{ scale: 1.005 }}
                            className={`rounded-lg border overflow-hidden cursor-pointer group transition-all ${selectedShot?.id === shot.id ? "border-cyan-500/50 shadow-[0_0_15px_rgba(0,212,255,0.15)]" : "border-white/[0.06] hover:border-white/[0.12]"}`}
                            style={{ background: "#13161F" }}
                            onClick={() => setSelectedShot(shot)}
                          >
                            <div className="relative aspect-[9/16] overflow-hidden bg-white/[0.02] flex items-center justify-center">
                              {shot.imageStatus === "ready" && shot.imageUrl ? (
                                <img src={shot.imageUrl} alt={shot.title} className="w-full h-full object-cover" />
                              ) : shot.imageStatus === "generating" ? (
                                <div className="flex flex-col items-center gap-2 text-cyan-400">
                                  <Loader2 size={22} className="animate-spin" />
                                  <span className="text-[9px] font-mono uppercase tracking-wider">Generating...</span>
                                </div>
                              ) : shot.imageStatus === "failed" ? (
                                <div className="flex flex-col items-center gap-1 text-rose-400 px-3 text-center">
                                  <AlertTriangle size={22} />
                                  <span className="text-[9px] font-mono break-words">{shot.imageError}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void regenerateImage(shot.id); }}
                                    className="mt-1 text-[9px] font-mono text-cyan-400 hover:underline"
                                  >
                                    Retry
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-2 text-white/30">
                                  <Loader2 size={22} className="animate-spin" />
                                  <span className="text-[9px] font-mono uppercase tracking-wider">Queued...</span>
                                </div>
                              )}
                              <div className="absolute top-2 right-2"><ApprovalBadge approval={shot.imageApproval} kind="image" /></div>
                              <div className="absolute top-2 left-2 text-[9px] font-mono text-white/60 bg-black/60 border border-white/10 px-1.5 py-0.5 rounded">
                                #{shot.shot_id}
                              </div>
                            </div>
                            <div className="p-3">
                              <div className="text-xs font-medium text-white/80 line-clamp-2">{shot.title}</div>
                              <div className="text-[10px] text-white/40 mt-1 line-clamp-2 leading-relaxed">{shot.description}</div>
                              <div className="text-[10px] text-white/30 mt-2 font-mono truncate">📍 {shot.location}</div>
                              {shot.imageStatus === "ready" && (
                                <div onClick={(e) => e.stopPropagation()}>
                                  <div className="flex gap-1 mt-3">
                                    <button
                                      onClick={() =>
                                        setImageApproval(
                                          shot.id,
                                          shot.imageApproval === "approved" ? "pending" : "approved",
                                        )
                                      }
                                      className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${
                                        shot.imageApproval === "approved"
                                          ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                                          : "bg-emerald-500/10 text-emerald-400/70 border-emerald-500/20 hover:bg-emerald-500/20"
                                      }`}
                                    >
                                      <Check size={9} /> {shot.imageApproval === "approved" ? "Approved" : "Approve"}
                                    </button>
                                    <button
                                      onClick={() => void regenerateImage(shot.id)}
                                      className="flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-cyan-500/10 text-cyan-400/70 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all flex items-center justify-center gap-1"
                                      title="Regenerate from scratch — no prior image used as reference"
                                    >
                                      <RefreshCw size={9} /> Regen
                                    </button>
                                    <button
                                      onClick={() => toggleImageFeedback(shot.id)}
                                      className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${
                                        imageFeedbackOpen.has(shot.id)
                                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                          : "bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]"
                                      }`}
                                      title="Refine this image with written direction — passes the current image to nano-banana-pro/edit as the edit source"
                                    >
                                      <MessageSquare size={9} /> Feedback
                                    </button>
                                    <button
                                      onClick={() => setImageApproval(shot.id, "rejected")}
                                      className="py-1.5 px-2 rounded text-[9px] font-mono uppercase tracking-wider bg-rose-500/10 text-rose-400/70 border border-rose-500/20 hover:bg-rose-500/20 transition-all"
                                      title="Reject"
                                    >
                                      <X size={9} />
                                    </button>
                                  </div>
                                  {imageFeedbackOpen.has(shot.id) && (
                                    <div className="mt-2 space-y-1.5">
                                      <textarea
                                        value={shot.imageFeedback}
                                        onChange={(e) =>
                                          patchShot(shot.id, { imageFeedback: e.target.value })
                                        }
                                        rows={3}
                                        placeholder="What should change? e.g. 'tighter framing on the bottle', 'warmer light', 'no second product in frame'..."
                                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[10px] text-white/80 placeholder:text-white/25 outline-none resize-none font-mono leading-relaxed focus:border-amber-500/30"
                                        autoFocus
                                      />
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() => {
                                            const text = shot.imageFeedback.trim();
                                            if (text) void regenerateImage(shot.id, text);
                                          }}
                                          disabled={!shot.imageFeedback.trim()}
                                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                          <RefreshCw size={9} /> Regen w/ Feedback
                                        </button>
                                        <button
                                          onClick={() => closeImageFeedback(shot.id)}
                                          className="px-2 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-white/[0.03] text-white/50 border border-white/[0.08] hover:bg-white/[0.06] transition-all"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}

            {/* STEP 3: VIDEOS */}
            {currentStep === 3 && (
              <motion.div key="videos" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                {(() => {
                  const approved = uiShots.filter((s) => s.imageApproval === "approved");
                  if (approved.length === 0) {
                    return (
                      <div className="max-w-2xl mx-auto py-16 text-center">
                        <Video size={40} className="text-white/20 mx-auto mb-4" />
                        <h3 className="text-sm font-semibold text-white/60 mb-2">No approved images yet</h3>
                        <p className="text-xs text-white/30 font-mono max-w-md mx-auto">
                          Go back to Images, approve at least one shot, then come here.
                        </p>
                        <button
                          onClick={() => setCurrentStep(2)}
                          className="mt-4 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                          ← Back to Images
                        </button>
                      </div>
                    );
                  }
                  return (
                    <>
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                        <h2 className="text-sm font-mono text-white/60 uppercase tracking-widest flex items-center gap-2">
                          <Video size={14} className="text-cyan-400" />
                          Videos <span className="text-cyan-400">({videosReadyCount} / {approved.length})</span>
                          <span className="text-white/20 mx-2">·</span>
                          <span className="text-emerald-400/60">{videosApprovedCount} approved</span>
                        </h2>
                        <div className="flex items-center gap-2">
                          {(videoPromptsLoading || mechanismLoading) && (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/50 border border-white/[0.08]">
                              <Loader2 size={10} className="animate-spin" />
                              {mechanismLoading ? "Extracting mechanism..." : "Writing prompts..."}
                            </span>
                          )}
                          <button
                            onClick={approveAllReadyVideos}
                            disabled={videosReadyCount === 0 || videosReadyCount === videosApprovedCount}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Check size={10} /> Approve All
                          </button>
                          <button
                            onClick={() => void downloadAllAndSaveToBrandAssets()}
                            disabled={videosApprovedCount === 0 || savingToBrandAssets}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {savingToBrandAssets ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                            Download All &amp; Save to Brand Assets ({videosApprovedCount})
                          </button>
                          {brandAssetsSavedCount > 0 && (
                            <span className="text-[10px] font-mono text-emerald-400/80">
                              ✓ {brandAssetsSavedCount} saved to Brand Assets
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Two-phase determinate progress bar (prompts → videos). */}
                      <div className="mb-4">
                        <div className="flex items-center justify-between text-[10px] font-mono text-white/40 mb-1">
                          <span className="uppercase tracking-widest">
                            {videosReadyCount + videosFailedCount >= approved.length && approved.length > 0
                              ? "All videos ready"
                              : videoPromptsWritten < approved.length && videosReadyCount === 0
                              ? `Writing prompts… (${videoPromptsWritten}/${approved.length})`
                              : `Generating videos… (${videosReadyCount + videosFailedCount}/${approved.length})`}
                          </span>
                          <span>
                            {Math.round(twoPhaseVideosPct)}%
                            {videosFailedCount > 0 && (
                              <span className="text-rose-400/80 ml-2">({videosFailedCount} failed)</span>
                            )}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{
                              background:
                                twoPhaseVideosPct >= 100
                                  ? "linear-gradient(90deg, #10B981, #34D399)"
                                  : "linear-gradient(90deg, #00D4FF, #0099CC)",
                              boxShadow:
                                twoPhaseVideosPct >= 100
                                  ? "0 0 8px rgba(16,185,129,0.3)"
                                  : "0 0 8px rgba(0,212,255,0.3)",
                            }}
                            animate={{ width: `${twoPhaseVideosPct}%` }}
                            transition={{ duration: 0.4 }}
                          />
                        </div>
                      </div>

                      {pipelineError && (
                        <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/5 p-3 flex items-start gap-2">
                          <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                          <p className="text-[11px] text-rose-300 font-mono break-words">{pipelineError}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {approved.map((shot) => (
                          <div
                            key={shot.id}
                            className={`rounded-lg border overflow-hidden cursor-pointer transition-all ${
                              selectedShot?.id === shot.id
                                ? "border-cyan-500/50 shadow-[0_0_15px_rgba(0,212,255,0.15)]"
                                : "border-white/[0.06] hover:border-white/[0.12]"
                            }`}
                            style={{ background: "#13161F" }}
                            onClick={() => setSelectedShot(shot)}
                          >
                            <div className="relative aspect-[9/16] overflow-hidden bg-white/[0.02] flex items-center justify-center">
                              {shot.videoStatus === "ready" && shot.videoUrl ? (
                                <video src={shot.videoUrl} controls loop className="w-full h-full object-cover" />
                              ) : shot.videoStatus === "generating" ? (
                                <>
                                  {shot.imageUrl && (
                                    <img src={shot.imageUrl} alt={shot.title} className="w-full h-full object-cover opacity-40" />
                                  )}
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-cyan-400 bg-black/40">
                                    <Loader2 size={26} className="animate-spin" />
                                    <span className="text-[10px] font-mono uppercase tracking-wider">Generating video...</span>
                                  </div>
                                </>
                              ) : shot.videoStatus === "failed" ? (
                                <div className="flex flex-col items-center gap-1 text-rose-400 px-3 text-center">
                                  <AlertTriangle size={22} />
                                  <span className="text-[9px] font-mono break-words">{shot.videoError}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void regenerateVideo(shot.id); }}
                                    className="mt-1 text-[9px] font-mono text-cyan-400 hover:underline"
                                  >
                                    Retry
                                  </button>
                                </div>
                              ) : (
                                <>
                                  {shot.imageUrl && (
                                    <img src={shot.imageUrl} alt={shot.title} className="w-full h-full object-cover opacity-60" />
                                  )}
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60 bg-black/30">
                                    <Loader2 size={22} className="animate-spin" />
                                    <span className="text-[9px] font-mono uppercase tracking-wider">Queued...</span>
                                  </div>
                                </>
                              )}
                              <div className="absolute top-2 right-2"><ApprovalBadge approval={shot.videoApproval} kind="video" /></div>
                              <div className="absolute top-2 left-2 text-[9px] font-mono text-white/60 bg-black/60 border border-white/10 px-1.5 py-0.5 rounded">
                                #{shot.shot_id}
                              </div>
                            </div>
                            <div className="p-3">
                              <div className="text-xs font-medium text-white/80 truncate">{shot.title}</div>
                              <div className="text-[10px] text-white/30 font-mono truncate">{SHOT_TYPE_INFO[shot.type].label}</div>
                              {shot.videoStatus === "ready" && (
                                <div onClick={(e) => e.stopPropagation()}>
                                  <div className="flex gap-1 mt-3">
                                    <button
                                      onClick={() =>
                                        setVideoApproval(
                                          shot.id,
                                          shot.videoApproval === "approved" ? "pending" : "approved",
                                        )
                                      }
                                      className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${
                                        shot.videoApproval === "approved"
                                          ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                                          : "bg-emerald-500/10 text-emerald-400/70 border-emerald-500/20 hover:bg-emerald-500/20"
                                      }`}
                                    >
                                      <Check size={9} /> {shot.videoApproval === "approved" ? "Approved" : "Approve"}
                                    </button>
                                    <button
                                      onClick={() => void regenerateVideo(shot.id)}
                                      className="flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-cyan-500/10 text-cyan-400/70 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all flex items-center justify-center gap-1"
                                      title="Regenerate from scratch — uses the existing image as the starting frame"
                                    >
                                      <RefreshCw size={9} /> Regen
                                    </button>
                                    <button
                                      onClick={() => toggleVideoFeedback(shot.id)}
                                      className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${
                                        videoFeedbackOpen.has(shot.id)
                                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                          : "bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]"
                                      }`}
                                      title="Refine this video with written direction — your feedback is appended to the video prompt"
                                    >
                                      <MessageSquare size={9} /> Feedback
                                    </button>
                                    <button
                                      onClick={() => downloadVideo(shot)}
                                      disabled={shot.videoApproval !== "approved"}
                                      className="py-1.5 px-2 rounded text-[9px] font-mono uppercase tracking-wider bg-cyan-500/10 text-cyan-400/70 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                      title={shot.videoApproval === "approved" ? "Download MP4" : "Approve first to enable download"}
                                    >
                                      <Download size={9} />
                                    </button>
                                  </div>
                                  {videoFeedbackOpen.has(shot.id) && (
                                    <div className="mt-2 space-y-1.5">
                                      <textarea
                                        value={shot.videoFeedback}
                                        onChange={(e) =>
                                          patchShot(shot.id, { videoFeedback: e.target.value })
                                        }
                                        rows={3}
                                        placeholder="What should change? e.g. 'slower camera drift', 'tilt instead of pour', 'less hand motion'..."
                                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[10px] text-white/80 placeholder:text-white/25 outline-none resize-none font-mono leading-relaxed focus:border-amber-500/30"
                                        autoFocus
                                      />
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() => {
                                            const text = shot.videoFeedback.trim();
                                            if (text) void regenerateVideo(shot.id, text);
                                          }}
                                          disabled={!shot.videoFeedback.trim()}
                                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                          <RefreshCw size={9} /> Regen w/ Feedback
                                        </button>
                                        <button
                                          onClick={() => closeVideoFeedback(shot.id)}
                                          className="px-2 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-white/[0.03] text-white/50 border border-white/[0.08] hover:bg-white/[0.06] transition-all"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Right Panel — Shot Details + Feedback */}
        <AnimatePresence>
          {selectedShot && currentStep > 1 && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="border-l border-white/[0.06] flex flex-col overflow-hidden shrink-0"
              style={{ background: "#0D0F12" }}
            >
              {(() => {
                const shot = uiShots.find((s) => s.id === selectedShot.id) ?? selectedShot;
                const mode: "image" | "video" = currentStep === 3 ? "video" : "image";
                const approval = mode === "image" ? shot.imageApproval : shot.videoApproval;
                const feedback = mode === "image" ? shot.imageFeedback : shot.videoFeedback;
                const status = mode === "image" ? shot.imageStatus : shot.videoStatus;
                const regen = mode === "image"
                  ? (text?: string) => void regenerateImage(shot.id, text)
                  : (text?: string) => void regenerateVideo(shot.id, text);
                const approveToggle = mode === "image"
                  ? () => setImageApproval(shot.id, approval === "approved" ? "pending" : "approved")
                  : () => setVideoApproval(shot.id, approval === "approved" ? "pending" : "approved");
                const setFeedback = (v: string) =>
                  patchShot(shot.id, mode === "image" ? { imageFeedback: v } : { videoFeedback: v });

                return (
                  <>
                    <div className="p-3 border-b border-white/[0.06]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                          {mode === "image" ? "Image Details" : "Video Details"}
                        </span>
                        <button onClick={() => setSelectedShot(null)} className="text-white/30 hover:text-white/60"><X size={14} /></button>
                      </div>
                      <div className="rounded-lg overflow-hidden border border-white/[0.06] aspect-[9/16] bg-white/[0.02] flex items-center justify-center relative">
                        {mode === "video" && shot.videoStatus === "ready" && shot.videoUrl ? (
                          <video
                            src={shot.videoUrl}
                            controls
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        ) : shot.imageStatus === "ready" && shot.imageUrl ? (
                          <img src={shot.imageUrl} alt={shot.title} className={`w-full h-full object-cover ${mode === "video" && shot.videoStatus === "generating" ? "opacity-40" : ""}`} />
                        ) : status === "generating" ? (
                          <Loader2 size={24} className="text-cyan-400 animate-spin" />
                        ) : (
                          <ImageIcon size={24} className="text-white/20" />
                        )}
                        {mode === "video" && shot.videoStatus === "generating" && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <Loader2 size={24} className="text-cyan-400 animate-spin" />
                          </div>
                        )}
                      </div>
                      <div className="mt-3">
                        <div className="text-sm font-medium text-white/80 leading-snug">{shot.title}</div>
                        <div className="text-[11px] text-white/40 mt-2 leading-relaxed">{shot.description}</div>
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          <ApprovalBadge approval={approval} kind={mode} />
                          <span className="text-[10px] font-mono text-white/20 uppercase">{SHOT_TYPE_INFO[shot.type].label}</span>
                        </div>
                        <div className="text-[10px] text-white/30 mt-2 font-mono">📍 {shot.location}</div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={approveToggle}
                          disabled={status !== "ready"}
                          className={`flex-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed ${
                            approval === "approved"
                              ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                              : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25"
                          }`}
                        >
                          <Check size={10} /> {approval === "approved" ? "Approved" : "Approve"}
                        </button>
                        <button
                          onClick={() => regen()}
                          disabled={status === "generating"}
                          className="flex-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25 transition-all flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <RefreshCw size={10} /> Regenerate
                        </button>
                        {mode === "video" && (
                          <button
                            onClick={() => downloadVideo(shot)}
                            disabled={approval !== "approved" || !shot.videoUrl}
                            className="py-2 px-2 rounded text-[10px] font-mono uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            title={approval === "approved" ? "Download MP4" : "Approve first to enable download"}
                          >
                            <Download size={10} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 flex flex-col overflow-hidden">
                      <div className="p-3 border-b border-white/[0.06] flex items-center gap-2">
                        <MessageSquare size={12} className="text-cyan-400" />
                        <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                          Feedback → Regenerate
                        </span>
                      </div>
                      <div className="flex-1 overflow-auto p-3">
                        <p className="text-[11px] text-white/40 font-mono leading-relaxed">
                          Tell the model what to change, then click Regenerate. Your direction is appended to the current prompt.
                        </p>
                        {(mode === "image" ? shot.imagePrompt : shot.videoPrompt) && (
                          <details className="mt-3">
                            <summary className="text-[10px] font-mono text-white/30 uppercase tracking-widest cursor-pointer hover:text-white/50">
                              Current prompt
                            </summary>
                            <div className="mt-2 text-[11px] text-white/50 font-mono leading-relaxed bg-white/[0.02] rounded p-2 border border-white/[0.04] whitespace-pre-wrap">
                              {mode === "image" ? shot.imagePrompt : shot.videoPrompt}
                            </div>
                          </details>
                        )}
                      </div>
                      <div className="p-3 border-t border-white/[0.06]">
                        <textarea
                          rows={3}
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                          placeholder={mode === "image"
                            ? "e.g. brighter morning light, warmer skin tone, no steam"
                            : "e.g. slower pour, tighter zoom on the cap, subtle hand motion"}
                          className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-500/30 font-mono leading-relaxed resize-y"
                        />
                        <button
                          onClick={() => regen(feedback)}
                          disabled={!feedback.trim() || status === "generating"}
                          className="mt-2 w-full flex items-center justify-center gap-2 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Send size={11} /> Regenerate with Feedback
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
