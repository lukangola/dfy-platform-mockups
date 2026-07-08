/**
 * Single Scene Generator — a trimmed spin-off of the Character B-roll app.
 *
 * Where Character B-roll runs the full angle/script → shot-list architect →
 * images → videos pipeline, this page lets the user write scene lines
 * directly. Every other step is shared in spirit with Character B-roll
 * (Nano-Banana-Pro for image gen, Kling v3 Pro for video gen, the same
 * approve / regen / regen-with-feedback UX on every card).
 *
 * Flow (3 steps):
 *   0. Setup — character + optional product + scene lines (one line per
 *      scene, "+" to add more, "x" to remove). Generate advances to step 1.
 *   1. Images — auto-generates one Nano-Banana-Pro image per scene line.
 *      Per-image: approve / regen / regen-with-feedback / reject.
 *      "Generate Videos" advances to step 2.
 *   2. Videos — auto-generates one Kling v3 Pro clip per approved image.
 *      Per-video: approve / regen / regen-with-feedback / download.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, ChevronDown, Check, X, RefreshCw, MessageSquare,
  Video, ArrowLeft, Package, Loader2,
  AlertTriangle, Plus, Trash2, Download, RotateCcw, Upload, Wand2,
} from "lucide-react";
import {
  listProducts, getProductMechanism,
  listCharacters, createCharacter, deleteCharacter,
  generateSingleSceneImagePrompts, generateCharacterBrollVideoPrompts,
  generateText, saveBrandAssets,
  createJob, getJob, listJobs,
  type Product, type ProductMechanism, type CharacterRef,
  type Job, type JobItem,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { isContentSafetyErrorText, SAFETY_REJECTION_HELP } from "@/lib/contentSafety";
import { downloadViaBlob } from "@/lib/download";
import { regenImageWithFeedback } from "@/lib/imageFeedbackRegen";

const STEPS = ["Setup", "Images", "Videos"];

type MediaStatus = "idle" | "generating" | "ready" | "failed";
type Approval = "pending" | "approved" | "rejected";

/**
 * One scene the user wants to render. Mirrors the B-roll UiShot shape so
 * the image / video helpers feel familiar, but trimmed: there's no
 * `category` arc, no `script_beat`, no `shot_type`. Each scene is just a
 * free-form `description` line that the user typed.
 */
type UiScene = {
  id: string;        // stable React key
  shot_id: number;   // sequential 1-based number
  description: string;
  imageStatus: MediaStatus;
  imageApproval: Approval;
  imageUrl?: string;
  imageError?: string;
  imagePrompt?: string;
  imageFeedback: string;
  videoStatus: MediaStatus;
  videoApproval: Approval;
  videoUrl?: string;
  videoError?: string;
  videoPrompt?: string;
  videoFeedback: string;
};

let sceneIdCounter = 0;
function newSceneId(): string {
  sceneIdCounter += 1;
  return `scene-${sceneIdCounter}`;
}

/** Job-item label — scenes have no title (unlike b-roll shots), so use the
 *  scene number plus a trimmed slice of the user's free-form line. */
function sceneJobLabel(s: UiScene): string {
  return `#${s.shot_id} — ${(s.description || "scene").slice(0, 60)}`;
}

function ApprovalBadge({ approval }: { approval: Approval }) {
  if (approval === "approved") {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded border font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
        Approved
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

// Image model — fixed to nano-banana-pro/edit. We used to have a dropdown
// here but in practice there was only ever one option; removed for clarity.
const IMAGE_MODEL_ID = "fal-ai/nano-banana-pro/edit";

export default function SingleSceneAppPage() {
  const { activeBrandId } = useBrand();

  const [currentStep, setCurrentStep] = useState(0);

  // ── Setup state ──────────────────────────────────────────────────

  // Products (optional — single-scene gen works without a product picked)
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  // Character library (mirrors the b-roll picker — default + brand-private)
  const [defaultCharacters, setDefaultCharacters] = useState<CharacterRef[]>([]);
  const [brandCharacters, setBrandCharacters] = useState<CharacterRef[]>([]);
  const [charactersLoading, setCharactersLoading] = useState(false);
  const [charactersError, setCharactersError] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [characterImageUrl, setCharacterImageUrl] = useState<string | null>(null);
  const [characterVideoRefUrl, setCharacterVideoRefUrl] = useState<string | null>(null);
  const [characterImageUploading, setCharacterImageUploading] = useState(false);
  const [characterImageError, setCharacterImageError] = useState<string | null>(null);

  // Scene lines — the one input that's specific to this app. Starts with a
  // single empty line; "+" adds another, "x" removes (but we always keep at
  // least one line in the state).
  const [sceneLines, setSceneLines] = useState<{ id: string; text: string }[]>([
    { id: `line-${Date.now()}`, text: "" },
  ]);

  // Mechanism cache (used by both image + video prompt writers when product is in scope)
  const [mechanism, setMechanism] = useState<ProductMechanism[] | null>(null);
  const [mechanismLoading, setMechanismLoading] = useState(false);
  // Two-phase progress tracking: prompts being written → media being generated.
  const [imagePromptsLoading, setImagePromptsLoading] = useState(false);
  const [videoPromptsLoading, setVideoPromptsLoading] = useState(false);
  const [imagePromptsWritten, setImagePromptsWritten] = useState(0);
  const [videoPromptsWritten, setVideoPromptsWritten] = useState(0);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [uiShots, setUiShots] = useState<UiScene[]>([]);
  const [productLine, setProductLine] = useState("");

  // Durable-jobs pilot: batch generation runs server-side (survives reload +
  // deploys). The page holds only the active job ids and mirrors item state
  // onto scenes via the poll effect below.
  const [activeImageJobId, setActiveImageJobId] = useState<string | null>(null);
  const [activeVideoJobId, setActiveVideoJobId] = useState<string | null>(null);
  // Session-resume banner: newest queued/running single-scene job for this
  // brand — or, when none is live, the newest single-scene job of any
  // status — offered as a one-click resume/restore when the page isn't
  // already tracking a job. Dismissible (null) for the rest of the visit via
  // the banner's X.
  const [resumableJob, setResumableJob] = useState<Job | null>(null);

  // Inline feedback toggle — mirrors b-roll
  const [imageFeedbackOpen, setImageFeedbackOpen] = useState<Set<string>>(new Set());
  function toggleImageFeedback(id: string) {
    setImageFeedbackOpen((p) => {
      const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
    });
  }
  function closeImageFeedback(id: string) {
    setImageFeedbackOpen((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; });
  }
  const [videoFeedbackOpen, setVideoFeedbackOpen] = useState<Set<string>>(new Set());
  function toggleVideoFeedback(id: string) {
    setVideoFeedbackOpen((p) => {
      const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
    });
  }
  function closeVideoFeedback(id: string) {
    setVideoFeedbackOpen((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; });
  }

  // Brand assets export
  const [savingToBrandAssets, setSavingToBrandAssets] = useState(false);
  const [brandAssetsSavedCount, setBrandAssetsSavedCount] = useState(0);

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

  // Synchronous mirror of activeImageJobId (plus a "claiming" sentinel while
  // a create is in flight). The poll's content-safety auto-retry runs from an
  // effect closure and must check-and-claim the single image-job slot without
  // waiting for a render — state alone can't do that. Every image-job id
  // change goes through trackImageJob() so the mirror never drifts. Video
  // jobs have no async claimant, so they keep the plain state setter.
  const activeImageJobIdRef = useRef<string | null>(null);
  // Scenes that already consumed their one automatic sanitize-retry — a
  // second safety rejection surfaces SAFETY_REJECTION_HELP instead of
  // looping rewrite+generate spend.
  const sanitizedOnceRef = useRef<Set<string>>(new Set());
  // Latest uiShots for the poll-driven sanitize retry: its effect closure
  // goes stale as batch items land, but the session payload it snapshots
  // onto the follow-up job must not lose those results.
  const uiShotsRef = useRef<UiScene[]>([]);
  useEffect(() => { uiShotsRef.current = uiShots; }, [uiShots]);

  function trackImageJob(id: string | null) {
    activeImageJobIdRef.current = id;
    setActiveImageJobId(id);
  }

  // ── Load products ───────────────────────────────────────────────
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
    [products],
  );
  const selectedProduct = researchedProducts.find((p) => p.id === selectedProductId);

  // ── Load characters (default + brand-private) ───────────────────
  useEffect(() => {
    let cancelled = false;
    setCharactersLoading(true);
    setCharactersError(null);
    let pollHandle: ReturnType<typeof setTimeout> | null = null;

    async function refresh(initial: boolean) {
      try {
        const { defaults, brand } = await listCharacters(activeBrandId ?? null);
        if (cancelled) return;
        setDefaultCharacters(defaults);
        setBrandCharacters(brand);
        const all = [...defaults, ...brand];
        if (selectedCharacterId) {
          const me = all.find((c) => c.id === selectedCharacterId);
          if (me?.seedancePortraitUrl) setCharacterVideoRefUrl(me.seedancePortraitUrl);
        }
        const stillPrepping = all.some(
          (c) => c.seedancePrepStatus === "pending" || c.seedancePrepStatus === "running",
        );
        if (stillPrepping && !cancelled) {
          pollHandle = setTimeout(() => void refresh(false), 5000);
        }
      } catch (err) {
        if (!cancelled && initial) setCharactersError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled && initial) setCharactersLoading(false);
      }
    }

    void refresh(true);
    return () => {
      cancelled = true;
      if (pollHandle) clearTimeout(pollHandle);
    };
  }, [activeBrandId, selectedCharacterId]);

  function pickCharacter(c: CharacterRef) {
    setSelectedCharacterId(c.id);
    setCharacterImageUrl(c.imageUrl);
    setCharacterVideoRefUrl(c.seedancePortraitUrl ?? c.imageUrl);
    setCharacterImageError(null);
  }

  async function handleCharacterImageFile(file: File) {
    setCharacterImageError(null);
    if (!activeBrandId) {
      setCharacterImageError("Select a brand before uploading characters");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setCharacterImageError("Please choose an image file");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setCharacterImageError("Image exceeds 8MB limit");
      return;
    }
    setCharacterImageUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error ?? new Error("Failed to read file"));
        r.readAsDataURL(file);
      });
      const { character } = await createCharacter({ brandId: activeBrandId, dataUrl, filename: file.name });
      setBrandCharacters((p) => [character, ...p]);
      pickCharacter(character);
    } catch (err) {
      setCharacterImageError(err instanceof Error ? err.message : String(err));
    } finally {
      setCharacterImageUploading(false);
    }
  }

  async function handleDeleteBrandCharacter(c: CharacterRef) {
    try {
      await deleteCharacter(c.id);
      setBrandCharacters((p) => p.filter((x) => x.id !== c.id));
      if (selectedCharacterId === c.id) {
        setSelectedCharacterId(null);
        setCharacterImageUrl(null);
        setCharacterVideoRefUrl(null);
      }
    } catch (err) {
      setCharactersError(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Mechanism cache ─────────────────────────────────────────────
  async function ensureMechanism(): Promise<ProductMechanism[]> {
    if (mechanism) return mechanism;
    if (!selectedProductId) return [];
    setMechanismLoading(true);
    try {
      const { mechanism: m } = await getProductMechanism(selectedProductId);
      setMechanism(m);
      return m;
    } finally {
      setMechanismLoading(false);
    }
  }

  // ── Scene-line management ───────────────────────────────────────
  function addSceneLine() {
    setSceneLines((p) => [...p, { id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: "" }]);
  }
  function removeSceneLine(id: string) {
    setSceneLines((p) => (p.length === 1 ? p : p.filter((l) => l.id !== id)));
  }
  function updateSceneLine(id: string, text: string) {
    setSceneLines((p) => p.map((l) => (l.id === id ? { ...l, text } : l)));
  }

  // ── Helpers shared with b-roll ──────────────────────────────────
  function collectProductImageUrls(): string[] {
    if (!selectedProduct) return [];
    const urls = [
      selectedProduct.productImageUrl,
      selectedProduct.productBackImageUrl,
      selectedProduct.contentImageUrl,
      selectedProduct.research?.referenceSheetUrl ?? null,
    ].filter((u): u is string => !!u);
    return Array.from(new Set(urls));
  }

  function promptReferencesProduct(prompt: string): boolean {
    if (!prompt) return false;
    const text = prompt.toLowerCase();

    // Product-name tokens, word-boundary matched.
    const productName = (productLine || selectedProduct?.name || "").toLowerCase();
    const tokens = productName
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length >= 4);
    if (tokens.some((t) => new RegExp(`\\b${t}\\b`, "i").test(text))) return true;

    // Curated generic-noun list. Naive substring matching caught common
    // English words ("can"→"she can see", "tin"→"waiting", "box"→"boxing",
    // "cap"→"capture", "lid"→"valid", "tube"→"youtube") and force-fed
    // product refs into shots that had nothing to do with the product.
    // Single-syllable ambiguous nouns dropped; everything below is matched
    // with word boundaries.
    const generic = [
      "the product", "bottle", "jar", "pouch", "sachet", "spray bottle",
      "container", "dropper", "packaging", "package", "wrapper",
    ];
    if (generic.some((g) => new RegExp(`\\b${g}\\b`, "i").test(text))) return true;

    if (/@element\d/i.test(prompt) || /@image[3-9]/i.test(prompt)) return true;
    return false;
  }

  function patchShot(id: string, patch: Partial<UiScene>) {
    setUiShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  // ── Image generation ────────────────────────────────────────────
  function collectImageRefs(scene: UiScene, prompt: string): string[] {
    const refs: string[] = [];
    if (characterImageUrl) refs.push(characterImageUrl);
    // Single-scene mode: include product refs whenever the prompt references
    // the product (no fixed-category gate — every shot is free-form). If no
    // product picked, refs stay empty.
    if (selectedProduct && promptReferencesProduct(prompt || scene.description)) {
      for (const u of collectProductImageUrls()) {
        if (!refs.includes(u)) refs.push(u);
      }
    }
    return Array.from(new Set(refs));
  }

  // ── Durable batch jobs (images + videos) ────────────────────────

  // Builds the fal payload for one scene's image — used by both the batch
  // (generateAllImages) and single-scene (regenerateImage) durable jobs.
  // References go through the same collector the direct calls used: character
  // portrait always first, product refs only when the prompt references the
  // product (see collectImageRefs above) — the jobs path must not change
  // which scenes see the product.
  function buildImageItemInput(scene: UiScene, prompt: string): Record<string, unknown> {
    const imageUrls = collectImageRefs(scene, prompt);
    const hasImages = imageUrls.length > 0;
    return {
      shotId: scene.id,
      kind: "image",
      model: hasImages ? IMAGE_MODEL_ID : "fal-ai/flux-pro/v1.1",
      falInput: hasImages
        ? { prompt, image_urls: imageUrls, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" }
        : { prompt, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" },
    };
  }

  // Builds the fal payload for one scene's video — used by both the batch
  // (generateAllVideos) and single-scene (regenerateVideo) durable jobs.
  //
  // Kling Video v3 (image-to-video). The starting frame already contains the
  // character and the full scene — Kling animates from that single frame.
  // Identity comes from the frame. When the prompt references the product we
  // ALSO supply Kling's `elements` parameter — one element bundling every
  // product reference we have — so the model has visual ground truth if the
  // camera turns the product mid-clip. (The single_scene_videos job executor
  // has NO Seedance→Kling fallback: this app runs on Kling natively.)
  function buildVideoItemInput(scene: UiScene, prompt: string): Record<string, unknown> {
    const productUrls = collectProductImageUrls();
    const wantsProduct = productUrls.length > 0 && promptReferencesProduct(prompt);
    const falInput: Record<string, unknown> = {
      prompt,
      start_image_url: scene.imageUrl!,
      // 8 seconds (was 5): standard tier accepts 3-15. 8s is enough room for
      // a real scene beat — a stretch, a sip, a turn — without paying for
      // 10s+. Cost scales linearly per-second.
      duration: "8",
      // Audio off: we never use the generated audio. Drops Kling v3 cost from
      // $0.126/s → $0.084/s (~33%) and shaves time off generation.
      generate_audio: false,
    };
    if (wantsProduct) {
      falInput.elements = [
        {
          reference_image_urls: productUrls,
          frontal_image_url: selectedProduct?.productImageUrl ?? productUrls[0],
        },
      ];
    }
    return {
      shotId: scene.id,
      kind: "video",
      // Standard tier (~40% faster + ~33% cheaper than /pro). Combined with
      // generate_audio:false above, this is the cost/speed sweet spot for
      // first-draft review. Swap back to /pro for final-delivery quality.
      model: "fal-ai/kling-video/v3/standard/image-to-video",
      falInput,
    };
  }

  /** Full working-state snapshot stored on the job so a reload can restore the session. */
  function buildSessionPayload(): Record<string, unknown> {
    return {
      productId: selectedProductId,
      productName: selectedProduct?.name ?? null,
      // Character context — collectImageRefs() anchors every image call on
      // characterImageUrl, so post-resume regenerates need it; characterId
      // re-highlights the picker tile; the video ref URL rides along for a
      // potential Seedance re-switch.
      characterId: selectedCharacterId,
      characterImageUrl,
      characterVideoRefUrl,
      // The raw setup-step inputs — restoring them keeps step 0 editable
      // after a resume (each line maps 1:1 onto a UiScene).
      sceneLines: sceneLines.map((l) => ({ id: l.id, text: l.text })),
      // Read via the ref (not the closure) so the poll-driven sanitize retry
      // snapshots the latest scene results, not the state as of job creation.
      scenes: uiShotsRef.current.map((s) => ({
        id: s.id, shot_id: s.shot_id, description: s.description,
        imagePrompt: s.imagePrompt ?? null, imageUrl: s.imageUrl ?? null,
        imageApproval: s.imageApproval,
        videoPrompt: s.videoPrompt ?? null, videoUrl: s.videoUrl ?? null,
        videoApproval: s.videoApproval,
      })),
    };
  }

  /** Mirror a job item's state onto its scene. */
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

  /**
   * Content-safety auto-retry — the durable-jobs edition of the old
   * callImageModel catch block. When an IMAGE item comes back failed with
   * the Gemini classifier's rejection text, rewrite the prompt via the
   * image_prompt_safety_rewrite master prompt (adds ~5-8s on Haiku, but
   * turns a hard failure into a success in the majority of body-image /
   * clothing scenes that trip the classifier) and re-run the scene as a
   * fresh 1-item job — ONCE per scene (sanitizedOnceRef); a second rejection
   * surfaces SAFETY_REJECTION_HELP instead of looping spend.
   *
   * Slot discipline: the page tracks ONE image job at a time (B-roll's
   * one-id-per-kind pattern). This flow only fires after its source job has
   * gone terminal — the poll frees the slot before invoking us — but the
   * sanitize call leaves a window where a manual regenerate / batch /
   * banner resume can claim the slot first. In that case we do NOT queue a
   * second job: the scene is marked failed with the sanitized prompt staged
   * on it, so a manual "Regen" retries with the softened language.
   */
  async function autoSanitizeRetry(it: JobItem) {
    const input = it.input as { shotId?: string; kind?: string; model?: string; falInput?: Record<string, unknown> };
    const shotId = input.shotId;
    if (!shotId || !activeBrandId) return;
    // Consume the one-retry budget synchronously so duplicate poll ticks
    // can't double-fire for the same scene.
    sanitizedOnceRef.current.add(shotId);
    const epoch = hydrationEpochRef.current;
    // Keep the scene spinning while the rewrite runs — from the user's view
    // this is still the same generation attempt.
    patchShot(shotId, { imageStatus: "generating", imageError: undefined });
    try {
      console.warn("[single-scene] content-safety rejection — sanitizing and retrying once");
      const originalPrompt = String(input.falInput?.prompt ?? "");
      const rewrite = await generateText("image_prompt_safety_rewrite", { original_prompt: originalPrompt });
      const sanitized = rewrite.text.trim();
      // Sanitizer returned empty → surface the original rejection.
      if (!sanitized) throw new Error(it.error ?? "Content-safety rejection (sanitizer returned an empty rewrite)");
      if (activeImageJobIdRef.current) {
        // Slot got claimed while we were sanitizing — don't queue a second
        // job behind it. Stage the sanitized prompt so a manual Regen
        // (fresh path reuses imagePrompt) retries with the soft language.
        patchShot(shotId, {
          imageStatus: "failed",
          imagePrompt: sanitized,
          imageError:
            "Rejected by the content-safety filter. A softened prompt is staged, but another image job is already running — click Regen to retry manually once it finishes.",
        });
        return;
      }
      // Resume-banner race: a hydration landed during the sanitize await — stage the softened prompt for a manual Regen instead of stomping the adopted session with a new job.
      if (hydrationEpochRef.current !== epoch) {
        patchShot(shotId, {
          imageStatus: "failed",
          imagePrompt: sanitized,
          imageError:
            "Rejected by the content-safety filter. A softened prompt is staged — click Regen to retry with the softened language.",
        });
        return;
      }
      // Claim the slot BEFORE the createJob await so parallel safety
      // retries from the same terminal batch can't both create a job.
      activeImageJobIdRef.current = "pending:sanitize-retry";
      try {
        const { job } = await createJob({
          app: "single_scene",
          type: "single_scene_images",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Single scene image safety retry — ${it.label}`,
          payload: buildSessionPayload(),
          // Same item shape as the rejected attempt with ONLY the prompt
          // swapped — refs/model stay exactly what the original pass used
          // (mirrors the old direct-call retry, which reused its computed
          // image_urls for the sanitized attempt).
          items: [{ label: it.label, input: { ...input, falInput: { ...(input.falInput ?? {}), prompt: sanitized } } }],
        });
        patchShot(shotId, { imagePrompt: sanitized });
        trackImageJob(job.id);
      } catch (err) {
        activeImageJobIdRef.current = null;
        throw err;
      }
    } catch (err) {
      patchShot(shotId, {
        imageStatus: "failed",
        imageError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Poll the active job(s) every 2.5s (the app's standard cadence) and mirror
  // item states onto scenes; stop when a job reaches a terminal status. Image
  // and video jobs are polled independently — the user can step back and
  // start an image batch while a video job is still running.
  useEffect(() => {
    if (!activeImageJobId && !activeVideoJobId) return;
    let cancelled = false;
    const pollOne = async (jobId: string, isImage: boolean) => {
      try {
        const { job, items } = await getJob(jobId);
        if (cancelled) return;
        const jobActive = job.status === "queued" || job.status === "running";
        // Free the slot BEFORE processing items: the content-safety
        // auto-retry below may claim it for its 1-item follow-up job, and
        // its occupancy check must not see this (finished) job.
        if (!jobActive) {
          if (isImage) trackImageJob(null);
          else setActiveVideoJobId(null);
        }
        for (const it of items) {
          const shotId = (it.input as { shotId?: string }).shotId;
          if (isImage && shotId && it.status === "failed" && isContentSafetyErrorText(it.error ?? "")) {
            // IMAGE item rejected by the content-safety classifier:
            //  - first rejection for this scene AND the job is done → run the
            //    automatic sanitize-and-retry (fire-and-forget; it patches
            //    the scene itself). While the job is still running we leave
            //    the raw failure on screen and let the terminal tick retry
            //    it — the single image-job slot is occupied until then
            //    anyway.
            //  - already sanitize-retried once → keep it failed, but swap
            //    the raw fal message for actionable guidance.
            if (!jobActive && !sanitizedOnceRef.current.has(shotId)) {
              void autoSanitizeRetry(it);
              continue;
            }
            if (sanitizedOnceRef.current.has(shotId)) {
              patchShot(shotId, { imageStatus: "failed", imageError: SAFETY_REJECTION_HELP });
              continue;
            }
          }
          applyItemToShot(it, isImage);
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
   * (buildSessionPayload) provides the scene list — prompts/urls/approvals as
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
      characterId?: string | null;
      characterImageUrl?: string | null;
      characterVideoRefUrl?: string | null;
      sceneLines?: Array<{ id?: string; text?: string }>;
      scenes?: Array<Record<string, unknown>>;
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
    // Character context: collectImageRefs() anchors every image call on
    // characterImageUrl — without restoring it, a post-resume regenerate
    // would silently drop the character from the frame.
    if (payload.characterId) setSelectedCharacterId(payload.characterId);
    if (payload.characterImageUrl) setCharacterImageUrl(payload.characterImageUrl);
    if (payload.characterVideoRefUrl) setCharacterVideoRefUrl(payload.characterVideoRefUrl);
    // Restore the raw setup inputs so stepping back to Setup shows the lines
    // that produced this session instead of a single empty row.
    if (payload.sceneLines && payload.sceneLines.length > 0) {
      setSceneLines(
        payload.sceneLines.map((l, i) => ({
          id: l.id ?? `line-restored-${i}`,
          text: l.text ?? "",
        })),
      );
    }
    const isImage = job.type === "single_scene_images";
    // A job can be adopted well after it ended (e.g. deep link opened later,
    // or a dev-server restart marked queued/running jobs failed). If the job
    // itself is no longer active, any item still "pending"/"running" will
    // never be picked up by a worker — mapping those to "generating" would
    // leave the scene spinning forever. Only map to "generating" while the
    // job itself is still active; otherwise treat unfinished items as failed.
    const jobIsActive = job.status === "queued" || job.status === "running";
    const byScene = new Map(items.map((it) => [(it.input as { shotId?: string }).shotId, it] as const));
    const restored: UiScene[] = (payload.scenes ?? []).map((s) => {
      const base: UiScene = {
        id: s.id as string,
        shot_id: s.shot_id as number,
        description: (s.description as string) ?? "",
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
      const it = byScene.get(s.id as string);
      if (!it) return base;
      const url = it.output?.url;
      if (isImage) {
        if (it.status === "complete" && url) return { ...base, imageStatus: "ready" as const, imageUrl: url };
        if (it.status === "failed") return { ...base, imageStatus: "failed" as const, imageError: it.error ?? undefined };
        return {
          ...base,
          imageStatus: jobIsActive ? ("generating" as const) : ("failed" as const),
          ...(jobIsActive ? {} : { imageError: "Interrupted — job ended before this scene finished. Regenerate to retry." }),
        };
      }
      if (it.status === "complete" && url) return { ...base, videoStatus: "ready" as const, videoUrl: url };
      if (it.status === "failed") return { ...base, videoStatus: "failed" as const, videoError: it.error ?? undefined };
      return {
        ...base,
        videoStatus: jobIsActive ? ("generating" as const) : ("failed" as const),
        ...(jobIsActive ? {} : { videoError: "Interrupted — job ended before this scene finished. Regenerate to retry." }),
      };
    });
    // Restored ids came from a previous session's newSceneId() sequence, but
    // this session's module-level counter restarts at 0 on a fresh page load.
    // Bump it past the highest restored suffix so a post-resume scene build
    // can't mint an id (and React key) that collides with a restored scene.
    for (const s of restored) {
      const m = /^scene-(\d+)$/.exec(s.id);
      if (m) sceneIdCounter = Math.max(sceneIdCounter, Number(m[1]));
    }
    // Restored ids may repeat ids from an earlier run or hydration in this
    // visit — give every restored session a fresh sanitize-retry budget.
    sanitizedOnceRef.current.clear();
    setUiShots(restored);
    if (job.status === "queued" || job.status === "running") {
      if (isImage) trackImageJob(job.id);
      else setActiveVideoJobId(job.id);
    }
    // Mark the restored step's auto-kick as already fired BEFORE navigating —
    // otherwise the step-entry effect would immediately create a new batch
    // over the restored scenes. A videos job implies images are done too.
    imagesAutoKickedRef.current = true;
    if (!isImage) videosAutoKickedRef.current = true;
    setCurrentStep(isImage ? 1 : 2);
  }

  /** Returns true when an unfinished single-scene job of the given type
   *  for the current product was handled — adopted (session hydrated, poll
   *  target set), or found but adoption failed (error surfaced; never fall
   *  through to creating a duplicate over a live job). Returns false only
   *  when there is nothing to adopt, so a normal create may proceed. */
  async function adoptUnfinishedJob(type: "single_scene_images" | "single_scene_videos"): Promise<boolean> {
    if (!activeBrandId) return false;
    let candidate: Job | undefined;
    try {
      const { jobs } = await listJobs(activeBrandId);
      candidate = jobs.find(
        (x) =>
          x.app === "single_scene" &&
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

  // Session-resume banner source: prefer the newest queued/running
  // single-scene job; with none, fall back to the newest single-scene job of
  // ANY status so users can jump straight back into their LAST session even
  // after it finished (hydrateFromJob handles terminal jobs — spinners end
  // as failed/complete). The server lists running/queued first, then newest,
  // so within the single-scene subset the first entry of each group is the
  // right pick.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    void listJobs(activeBrandId)
      .then(({ jobs }) => {
        if (cancelled) return;
        const mine = jobs.filter((x) => x.app === "single_scene");
        const running = mine.find((x) => x.status === "queued" || x.status === "running");
        setResumableJob(running ?? mine[0] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeBrandId]);

  // Parallel: one Claude call per scene. Was a single batched call where
  // Claude wrote all prompts sequentially inside its response. Parallelizing
  // cuts the wall-clock to roughly max(individual times).
  async function writeImagePrompts(targets: UiScene[]): Promise<string[]> {
    if (targets.length === 0) return [];
    setImagePromptsLoading(true);
    setImagePromptsWritten(0);
    try {
      const m = await ensureMechanism().catch(() => [] as ProductMechanism[]);
      const results = await Promise.all(
        targets.map(async (t) => {
          const { prompts } = await generateSingleSceneImagePrompts({
            product: productLine,
            mechanism: m,
            scenes: [t.description],
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

  async function generateAllImages() {
    const queue = uiShots.filter((s) => s.imageStatus === "idle" || s.imageStatus === "failed");
    if (queue.length === 0 || !activeBrandId || activeImageJobId) return;
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
      if (await adoptUnfinishedJob("single_scene_images")) return;
      setPipelineError(null);
      try {
        const prompts = await writeImagePrompts(queue);
        // Resume-banner race: a hydration landed during the prompt-writing await — drop this stale batch so it can't stomp the adopted session.
        if (hydrationEpochRef.current !== epoch) return;
        queue.forEach((s, i) => patchShot(s.id, { imageStatus: "generating", imageError: undefined, imagePrompt: prompts[i] ?? "" }));
        const { job } = await createJob({
          app: "single_scene",
          type: "single_scene_images",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Single scene images — ${selectedProduct?.name ?? "no product"} · ${queue.length} scene(s)`,
          payload: buildSessionPayload(),
          items: queue.map((s, i) => ({ label: sceneJobLabel(s), input: buildImageItemInput(s, prompts[i] ?? "") })),
        });
        trackImageJob(job.id);
      } catch (err) {
        setPipelineError(err instanceof Error ? err.message : String(err));
        // Roll the optimistic "generating" state back so scenes stay actionable.
        // `queue` is the pre-patch snapshot, so each scene's imageStatus is its
        // pre-call value ("idle" or "failed").
        queue.forEach((s) => patchShot(s.id, { imageStatus: s.imageStatus === "failed" ? "failed" : "idle" }));
      }
    } finally {
      imagesBatchInFlightRef.current = false;
    }
  }

  /**
   * Image regen with optional feedback. Mirrors the b-roll page exactly:
   *   - With feedback: route through prompts/character_broll_image_feedback.md,
   *     pass [priorImage, characterRef, ...productRefs] so NBP/edit treats
   *     the prior image as the source-to-edit and applies the feedback.
   *   - Without feedback: just re-fire the original scene prompt for a fresh
   *     take. (For single-scene mode we re-run the prompt writer to get a
   *     slightly different rendering of the same scene line.)
   */
  async function regenerateImage(sceneId: string, feedback?: string) {
    // Can't run two image jobs at once — mirrors the batch guard, and keeps
    // the regenerate buttons effectively inert while a batch is in flight.
    if (activeImageJobId) return;
    const target = uiShots.find((s) => s.id === sceneId);
    if (!target) return;
    // Double-click guard: without a live job id yet (e.g. this very call is
    // mid-flight through its awaits), a second click on the same scene would
    // re-enter and fire a duplicate regenerate for a scene already in flight.
    if (target.imageStatus === "generating") return;
    setPipelineError(null);
    const epoch = hydrationEpochRef.current;
    const feedbackText = (feedback ?? target.imageFeedback ?? "").trim();
    if (feedbackText) closeImageFeedback(sceneId);
    patchShot(sceneId, {
      imageStatus: "generating",
      imageError: undefined,
      imageApproval: "pending",
      ...(feedbackText ? { imageFeedback: feedbackText } : {}),
    });
    try {
      if (feedbackText && target.imageUrl) {
        // Shared image-feedback rework — same helper drives Character
        // B-Roll and Product B-Roll. The helper prepends the source
        // image; extraRefs order follows the model's reference priority
        // (identity first, then product).
        //
        // This path stays a direct call (not a durable job): it goes through
        // the server's prompt-template route (action + vars.feedback), which
        // the job executor's flat `falInput` shape has no equivalent for.
        const extraRefs: string[] = [];
        if (characterImageUrl && characterImageUrl !== target.imageUrl) {
          extraRefs.push(characterImageUrl);
        }
        if (selectedProduct && promptReferencesProduct(target.imagePrompt ?? target.description)) {
          for (const u of collectProductImageUrls()) extraRefs.push(u);
        }
        const newUrl = await regenImageWithFeedback({
          feedback: feedbackText,
          sourceImageUrl: target.imageUrl,
          extraRefs,
          action: "character_broll_image_feedback",
        });
        patchShot(sceneId, { imageStatus: "ready", imageUrl: newUrl });
        return;
      }
      // FRESH-REGEN PATH — no feedback (or no prior image yet). Re-run the
      // scene prompt for a different take, no prior image as ref. Runs as a
      // 1-item durable job so it survives reload the same way the batch
      // generations do.
      let basePrompt = target.imagePrompt;
      if (!basePrompt) {
        const [written] = await writeImagePrompts([target]);
        basePrompt = written ?? "";
      }
      patchShot(sceneId, { imagePrompt: basePrompt });
      if (!activeBrandId) throw new Error("No active brand selected.");
      // Resume-banner race: a hydration landed during the awaits above — roll back this scene's optimistic spinner instead of stomping the adopted session with a stale job.
      if (hydrationEpochRef.current !== epoch) {
        patchShot(sceneId, { imageStatus: target.imageStatus, imageApproval: target.imageApproval, imageError: target.imageError });
        return;
      }
      try {
        const { job } = await createJob({
          app: "single_scene",
          type: "single_scene_images",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Single scene image regenerate — ${sceneJobLabel(target)}`,
          payload: buildSessionPayload(),
          items: [{ label: sceneJobLabel(target), input: buildImageItemInput(target, basePrompt) }],
        });
        trackImageJob(job.id);
      } catch (err) {
        // A failed job CREATION must not leave the scene stuck "generating" —
        // mirrors the batch fns' rollback style.
        patchShot(sceneId, {
          imageStatus: "failed",
          imageError: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      patchShot(sceneId, { imageStatus: "failed", imageError: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Video generation ────────────────────────────────────────────
  /**
   * Video prompt writer. We reuse the b-roll video prompt master because
   * Kling v3 Pro doesn't care about the upstream entry point — it just
   * needs a motion description for one scene. Our synthetic shot here
   * carries `category: "Lifestyle / Context"` as a default so the b-roll
   * writer treats it as a free-form ambient motion (no @Element1, no
   * product-rotation directive) unless the prompt itself references the
   * product, which the prompt-content heuristic handles.
   */
  async function writeVideoPrompts(targets: UiScene[]): Promise<string[]> {
    if (targets.length === 0) return [];
    setVideoPromptsLoading(true);
    setVideoPromptsWritten(0);
    try {
      const m = await ensureMechanism().catch(() => [] as ProductMechanism[]);
      const results = await Promise.all(
        targets.map(async (s) => {
          const { prompts } = await generateCharacterBrollVideoPrompts({
            product: productLine,
            mechanism: m,
            shots: [{
              id: s.shot_id,
              category: "Lifestyle / Context",
              shot_type: "Environmental Mood",
              action: s.description,
              location: "(unspecified — infer from action)",
              visual_example: s.description,
              ...(s.imagePrompt ? { image_prompt: s.imagePrompt } : {}),
            }],
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

  async function generateAllVideos() {
    const approved = uiShots.filter((s) => s.imageApproval === "approved" && s.imageUrl);
    const queue = approved.filter((s) => s.videoStatus === "idle" || s.videoStatus === "failed");
    if (queue.length === 0 || !activeBrandId || activeVideoJobId) return;
    // Synchronous in-flight guard — see generateAllImages; same race window.
    if (videosBatchInFlightRef.current) return;
    videosBatchInFlightRef.current = true;
    const epoch = hydrationEpochRef.current;
    try {
      // Duplicate-guard — see generateAllImages; same reload/double-spend risk.
      if (await adoptUnfinishedJob("single_scene_videos")) return;
      setPipelineError(null);
      try {
        const prompts = await writeVideoPrompts(queue);
        // Resume-banner race: a hydration landed during the prompt-writing await — drop this stale batch so it can't stomp the adopted session.
        if (hydrationEpochRef.current !== epoch) return;
        queue.forEach((s, i) => patchShot(s.id, { videoStatus: "generating", videoError: undefined, videoPrompt: prompts[i] ?? "" }));
        const { job } = await createJob({
          app: "single_scene",
          type: "single_scene_videos",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Single scene videos — ${selectedProduct?.name ?? "no product"} · ${queue.length} scene(s)`,
          payload: buildSessionPayload(),
          items: queue.map((s, i) => ({ label: sceneJobLabel(s), input: buildVideoItemInput(s, prompts[i] ?? "") })),
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

  async function regenerateVideo(sceneId: string, feedback?: string) {
    // Can't run two video jobs at once — mirrors the batch guard, and keeps
    // the regenerate buttons effectively inert while a batch is in flight.
    if (activeVideoJobId) return;
    const target = uiShots.find((s) => s.id === sceneId);
    if (!target || !target.imageUrl) return;
    // Double-click guard: mirrors regenerateImage — without a live job id yet,
    // a second click on the same scene would re-enter and fire a duplicate
    // regenerate for a scene already in flight.
    if (target.videoStatus === "generating") return;
    setPipelineError(null);
    const epoch = hydrationEpochRef.current;
    const feedbackText = (feedback ?? target.videoFeedback ?? "").trim();
    if (feedbackText) closeVideoFeedback(sceneId);
    patchShot(sceneId, {
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
      patchShot(sceneId, { videoPrompt: finalPrompt });
      if (!activeBrandId) throw new Error("No active brand selected.");
      // Resume-banner race: a hydration landed during the awaits above — roll back this scene's optimistic spinner instead of stomping the adopted session with a stale job.
      if (hydrationEpochRef.current !== epoch) {
        patchShot(sceneId, { videoStatus: target.videoStatus, videoApproval: target.videoApproval, videoError: target.videoError });
        return;
      }
      try {
        const { job } = await createJob({
          app: "single_scene",
          type: "single_scene_videos",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Single scene video regenerate — ${sceneJobLabel(target)}`,
          payload: buildSessionPayload(),
          items: [{ label: sceneJobLabel(target), input: buildVideoItemInput(target, finalPrompt) }],
        });
        setActiveVideoJobId(job.id);
      } catch (err) {
        // A failed job CREATION must not leave the scene stuck "generating" —
        // mirrors the batch fns' rollback style.
        patchShot(sceneId, {
          videoStatus: "failed",
          videoError: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      patchShot(sceneId, { videoStatus: "failed", videoError: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Step transitions ────────────────────────────────────────────
  async function handleGenerateScenes() {
    const cleaned = sceneLines
      .map((l) => l.text.trim())
      .filter((t) => t.length > 0);
    if (cleaned.length === 0) {
      setPipelineError("Add at least one scene line.");
      return;
    }
    if (!selectedCharacterId || !characterImageUrl) {
      setPipelineError("Select a character before generating.");
      return;
    }
    setGenerating(true);
    setPipelineError(null);
    try {
      const built: UiScene[] = cleaned.map((text, idx) => ({
        id: newSceneId(),
        shot_id: idx + 1,
        description: text,
        imageStatus: "idle",
        imageApproval: "pending",
        imageFeedback: "",
        videoStatus: "idle",
        videoApproval: "pending",
        videoFeedback: "",
      }));
      setUiShots(built);
      setProductLine(selectedProduct?.name ?? "");
      // Pre-cache mechanism so the first image-prompt call doesn't block on it.
      if (selectedProduct) void ensureMechanism().catch(() => undefined);
      imagesAutoKickedRef.current = false;
      videosAutoKickedRef.current = false;
      setCurrentStep(1);
    } finally {
      setGenerating(false);
    }
  }

  function handleAdvanceToVideos() {
    const approved = uiShots.filter((s) => s.imageApproval === "approved" && s.imageUrl);
    if (approved.length === 0) {
      setPipelineError("Approve at least one image to advance to videos.");
      return;
    }
    videosAutoKickedRef.current = false;
    setCurrentStep(2);
  }

  // Auto-kick image gen when entering step 1
  useEffect(() => {
    if (currentStep !== 1) return;
    if (imagesAutoKickedRef.current) return;
    if (uiShots.length === 0) return;
    imagesAutoKickedRef.current = true;
    void generateAllImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, uiShots.length]);

  // Auto-kick video gen when entering step 2
  useEffect(() => {
    if (currentStep !== 2) return;
    if (videosAutoKickedRef.current) return;
    const approved = uiShots.filter((s) => s.imageApproval === "approved" && s.imageUrl);
    if (approved.length === 0) return;
    videosAutoKickedRef.current = true;
    void generateAllVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  function setImageApproval(id: string, approval: Approval) {
    patchShot(id, { imageApproval: approval });
  }
  function setVideoApproval(id: string, approval: Approval) {
    patchShot(id, { videoApproval: approval });
  }

  /**
   * Bulk-approve helpers — mirrors the Character B-Roll page. Only flips
   * scenes whose media is `ready` and whose approval is not already
   * `approved` (so the action is idempotent and explicitly rejected scenes
   * stay rejected unless the user re-approves them individually).
   */
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

  async function downloadVideo(scene: UiScene) {
    if (!scene.videoUrl) return;
    const filename = `single-scene-${scene.shot_id}-${(scene.description || "scene").slice(0, 40).replace(/\s+/g, "-")}.mp4`;
    await downloadViaBlob(scene.videoUrl, filename);
  }

  async function saveApprovedToBrandAssets() {
    if (!activeBrandId) {
      setPipelineError("Pick a brand before saving to Brand Assets.");
      return;
    }
    const approved = uiShots.filter((s) => s.videoApproval === "approved" && s.videoUrl);
    if (approved.length === 0) return;
    setSavingToBrandAssets(true);
    setBrandAssetsSavedCount(0);
    setPipelineError(null);
    const downloadPromise = Promise.all(approved.map(downloadVideo)).catch(() => undefined);
    try {
      const payload = approved.map((scene) => ({
        kind: "video" as const,
        url: scene.videoUrl!,
        title: `Single scene #${scene.shot_id} — ${scene.description.slice(0, 60)}`,
        sourceApp: "single-scene",
        productId: selectedProductId || null,
        metadata: {
          shot_id: scene.shot_id,
          description: scene.description,
          imagePrompt: scene.imagePrompt ?? null,
          videoPrompt: scene.videoPrompt ?? null,
        },
      }));
      const { assets } = await saveBrandAssets(activeBrandId, payload);
      setBrandAssetsSavedCount(assets.length);
    } catch (err) {
      setPipelineError(`Saved locally but failed to write to Brand Assets: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await downloadPromise;
      setSavingToBrandAssets(false);
    }
  }

  // ── Derived state ──────────────────────────────────────────────
  const setupReady =
    !!selectedCharacterId &&
    !!characterImageUrl &&
    sceneLines.some((l) => l.text.trim().length > 0);

  const imagesReady = uiShots.filter((s) => s.imageStatus === "ready").length;
  const imagesFailed = uiShots.filter((s) => s.imageStatus === "failed").length;
  const imagesGenerating = uiShots.filter((s) => s.imageStatus === "generating").length;
  const imagesApproved = uiShots.filter((s) => s.imageApproval === "approved").length;
  const imagesProgressPct = uiShots.length === 0
    ? 0
    : Math.round(((imagesReady + imagesFailed) / uiShots.length) * 100);

  // Two-phase progress (prompts → images). Each scene counts as 2 work units.
  const twoPhaseImagesPct = uiShots.length === 0
    ? 0
    : Math.round(
        ((Math.min(imagePromptsWritten, uiShots.length) + imagesReady + imagesFailed)
          / (uiShots.length * 2)) * 100,
      );

  const approvedImages = uiShots.filter((s) => s.imageApproval === "approved");
  const videosReady = approvedImages.filter((s) => s.videoStatus === "ready").length;
  const videosFailed = approvedImages.filter((s) => s.videoStatus === "failed").length;
  const videosGenerating = approvedImages.filter((s) => s.videoStatus === "generating").length;
  const videosApproved = uiShots.filter((s) => s.videoApproval === "approved").length;
  const videosProgressPct = approvedImages.length === 0
    ? 0
    : Math.round(((videosReady + videosFailed) / approvedImages.length) * 100);

  const twoPhaseVideosPct = approvedImages.length === 0
    ? 0
    : Math.round(
        ((Math.min(videoPromptsWritten, approvedImages.length) + videosReady + videosFailed)
          / (approvedImages.length * 2)) * 100,
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
          <div className="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center">
            <Wand2 size={12} className="text-violet-400" />
          </div>
          <span className="font-mono text-xs text-white/60 tracking-wider">SINGLE SCENE GENERATOR</span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {STEPS.map((step, i) => (
            <button
              key={step}
              onClick={() => {
                if (i === 0 || uiShots.length > 0) setCurrentStep(i);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ${
                currentStep === i ? "text-violet-400 bg-violet-500/10" : "text-white/40 hover:text-white/70"
              }`}
            >
              <span className="opacity-50">{i + 1}</span>
              {step}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden" style={{ background: "#0A0B0E" }}>
        <main className="flex-1 overflow-auto">
          {/* Session-resume banner — running jobs resume live, finished jobs
              restore the last session. Hidden while the page is already
              mirroring a job (then the progress UI covers it). Not a single
              <button> because the dismiss X needs its own button (nested
              buttons are invalid HTML). */}
          {resumableJob && !activeImageJobId && !activeVideoJobId && (
            <div className="max-w-7xl mx-auto px-6 md:px-10 pt-6">
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
            </div>
          )}
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div
                key="setup"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-3xl mx-auto p-6 md:p-10 space-y-5"
              >
                <div>
                  <h1 className="text-xl font-medium text-white/90 mb-1.5">Single Scene Generator</h1>
                  <p className="text-[12px] text-white/40 font-mono leading-relaxed">
                    Pick a character, optionally a product, then write one scene per line. Each line becomes one image, then one video. No shot-list architect — you direct the scenes yourself.
                  </p>
                </div>

                {pipelineError && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-300 font-mono flex items-start gap-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>{pipelineError}</span>
                  </div>
                )}

                {/* 1 — Character */}
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest">1 — Character</label>
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-white/[0.12] bg-white/[0.03] hover:border-violet-500/30 hover:text-violet-400 transition-all cursor-pointer text-[10px] font-mono uppercase tracking-wider text-white/70">
                      {characterImageUploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      Upload new
                      <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCharacterImageFile(f); e.target.value = ""; }} className="hidden" />
                    </label>
                  </div>

                  {charactersError && (
                    <p className="text-[10px] text-rose-400 font-mono mb-3 flex items-center gap-2">
                      <AlertTriangle size={11} /> {charactersError}
                    </p>
                  )}
                  {characterImageError && (
                    <p className="text-[10px] text-rose-400 font-mono mb-3">{characterImageError}</p>
                  )}

                  <div className="mb-4">
                    <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-2">Default Library</div>
                    {charactersLoading && defaultCharacters.length === 0 ? (
                      <div className="text-[11px] text-white/30 font-mono flex items-center gap-2 py-3">
                        <Loader2 size={11} className="animate-spin" /> Loading characters...
                      </div>
                    ) : defaultCharacters.length === 0 ? (
                      <div className="text-[11px] text-white/30 font-mono py-3">
                        No default characters yet. Drop images into <span className="text-white/50">client/public/characters/library/</span> and restart the server.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {defaultCharacters.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => pickCharacter(c)}
                            className={`relative aspect-square rounded-lg overflow-hidden border transition-all ${
                              selectedCharacterId === c.id ? "border-violet-500/60 ring-2 ring-violet-500/20" : "border-white/[0.08] hover:border-violet-500/30"
                            }`}
                            title={c.title}
                          >
                            <img src={c.imageUrl} alt={c.title} className="w-full h-full object-cover" />
                            {selectedCharacterId === c.id && (
                              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-violet-500/90 flex items-center justify-center">
                                <Check size={11} className="text-black" />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-2">Your Brand Library</div>
                    {brandCharacters.length === 0 ? (
                      <div className="text-[11px] text-white/30 font-mono py-3">
                        None yet. Click <span className="text-white/50">Upload new</span> to add a character only this brand will see.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {brandCharacters.map((c) => (
                          <div key={c.id} className="relative group">
                            <button
                              onClick={() => pickCharacter(c)}
                              className={`relative w-full aspect-square rounded-lg overflow-hidden border transition-all ${
                                selectedCharacterId === c.id ? "border-violet-500/60 ring-2 ring-violet-500/20" : "border-white/[0.08] hover:border-violet-500/30"
                              }`}
                              title={c.title}
                            >
                              <img src={c.imageUrl} alt={c.title} className="w-full h-full object-cover" />
                              {selectedCharacterId === c.id && (
                                <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-violet-500/90 flex items-center justify-center">
                                  <Check size={11} className="text-black" />
                                </div>
                              )}
                            </button>
                            <button
                              onClick={() => void handleDeleteBrandCharacter(c)}
                              className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-rose-500/80 transition-all"
                              title="Delete from brand library"
                            >
                              <Trash2 size={10} className="text-white" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2 — Product (optional) */}
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                    2 — Product <span className="text-white/30 normal-case tracking-normal">(optional — used as context when scenes mention it)</span>
                  </label>
                  {productsError ? (
                    <div className="text-[11px] text-rose-400 font-mono flex items-center gap-2"><AlertTriangle size={11} /> {productsError}</div>
                  ) : (
                    <div className="relative">
                      <button
                        onClick={() => setProductDropdownOpen((p) => !p)}
                        className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 hover:border-white/[0.15] transition-all text-left"
                      >
                        {selectedProduct?.productImageUrl ? (
                          <img src={selectedProduct.productImageUrl} alt={selectedProduct.name} className="w-7 h-7 rounded object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded bg-white/[0.04] flex items-center justify-center">
                            <Package size={12} className="text-white/30" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white/80 truncate">{selectedProduct?.name ?? "(none)"}</div>
                          <div className="text-[10px] font-mono text-white/30 truncate">
                            {selectedProduct ? selectedProduct.category : productsLoading ? "Loading..." : "Pick a product to send the model its visual references"}
                          </div>
                        </div>
                        <ChevronDown size={14} className={`text-white/30 transition-transform ${productDropdownOpen ? "rotate-180" : ""}`} />
                      </button>
                      {productDropdownOpen && (
                        <div className="absolute top-full mt-2 inset-x-0 z-10 bg-[#13151a] border border-white/[0.08] rounded-lg overflow-hidden shadow-xl max-h-72 overflow-y-auto">
                          <button
                            onClick={() => { setSelectedProductId(""); setProductDropdownOpen(false); }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors ${selectedProductId === "" ? "text-violet-400" : "text-white/80"}`}
                          >
                            <div className="w-6 h-6 rounded bg-white/[0.04] flex items-center justify-center">
                              <X size={11} className="text-white/40" />
                            </div>
                            <div className="text-sm">(none)</div>
                            {selectedProductId === "" && <Check size={12} className="ml-auto" />}
                          </button>
                          {researchedProducts.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => { setSelectedProductId(p.id); setProductDropdownOpen(false); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
                            >
                              {p.productImageUrl ? (
                                <img src={p.productImageUrl} alt={p.name} className="w-6 h-6 rounded object-cover" />
                              ) : (
                                <Package size={14} className="text-white/20" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-white/80 truncate">{p.name}</div>
                                <div className="text-[10px] font-mono text-white/30 truncate">{p.category}</div>
                              </div>
                              {selectedProductId === p.id && <Check size={12} className="text-violet-400 shrink-0" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3 — Scene lines */}
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                    3 — Scenes <span className="text-rose-300/60 normal-case tracking-normal">required</span>
                  </label>
                  <p className="text-[11px] text-white/40 font-mono leading-relaxed mb-3">
                    One line per scene. Describe what Character is doing in that single shot — Claude will turn each line into a polished image prompt.
                  </p>
                  <div className="space-y-2">
                    {sceneLines.map((line, idx) => (
                      <div key={line.id} className="flex items-start gap-2">
                        <span className="text-[10px] font-mono text-white/30 mt-2.5 w-6 text-right shrink-0">{idx + 1}.</span>
                        <textarea
                          value={line.text}
                          onChange={(e) => updateSceneLine(line.id, e.target.value)}
                          rows={2}
                          placeholder="e.g. Character at her kitchen counter making coffee in pajamas, soft morning light through the window"
                          className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none resize-y leading-relaxed focus:border-violet-500/30 transition-colors font-mono"
                        />
                        <button
                          onClick={() => removeSceneLine(line.id)}
                          disabled={sceneLines.length === 1}
                          className="mt-1 px-2 py-2 rounded text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                          title={sceneLines.length === 1 ? "Keep at least one scene line" : "Remove this line"}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addSceneLine}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/[0.08] bg-white/[0.03] hover:border-violet-500/30 hover:text-violet-400 transition-all text-[11px] font-mono uppercase tracking-wider text-white/60"
                  >
                    <Plus size={12} /> Add scene
                  </button>
                </div>

                {/* Generate */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => void handleGenerateScenes()}
                    disabled={!setupReady || generating || Boolean(activeImageJobId)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border bg-violet-500/15 text-violet-300 border-violet-500/40 hover:bg-violet-500/25 transition-all text-sm font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {generating ? "Generating..." : "Generate scenes"}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 1 — Images */}
            {currentStep === 1 && (
              <motion.div
                key="images"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-6 md:p-10"
              >
                <div className="max-w-7xl mx-auto">
                  <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                    <div>
                      <h1 className="text-lg font-medium text-white/90 mb-0.5">Images</h1>
                      <p className="text-[11px] text-white/40 font-mono">
                        {imagesReady} ready · {imagesGenerating} generating · {imagesFailed} failed · {imagesApproved} approved · {uiShots.length} total
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] font-mono text-white/40 whitespace-nowrap">
                        {imagePromptsWritten < uiShots.length && imagesReady === 0 && uiShots.length > 0
                          ? `Prompts ${imagePromptsWritten}/${uiShots.length}`
                          : `${twoPhaseImagesPct}%`}
                      </div>
                      <div className="w-32 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <motion.div
                          className="h-full bg-violet-500/60"
                          animate={{ width: `${twoPhaseImagesPct}%` }}
                          transition={{ duration: 0.4 }}
                        />
                      </div>
                      <button
                        onClick={approveAllReadyImages}
                        disabled={imagesReady === 0 || imagesReady === imagesApproved}
                        className="ml-3 flex items-center gap-1.5 px-3 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Check size={10} /> Approve All
                      </button>
                      <button
                        onClick={handleAdvanceToVideos}
                        disabled={imagesApproved === 0 || Boolean(activeVideoJobId)}
                        className="px-4 py-2 rounded text-xs font-mono uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-500/40 hover:bg-violet-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        <Video size={11} /> Generate videos ({imagesApproved})
                      </button>
                    </div>
                  </div>

                  {pipelineError && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-300 font-mono mb-4 flex items-start gap-2">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>{pipelineError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {uiShots.map((scene) => (
                      <div key={scene.id} className="rounded-lg overflow-hidden border border-white/[0.08] bg-white/[0.02]">
                        <div className="relative aspect-[9/16] bg-black/40 flex items-center justify-center">
                          {scene.imageStatus === "ready" && scene.imageUrl ? (
                            <img src={scene.imageUrl} alt={scene.description} className="w-full h-full object-cover" />
                          ) : scene.imageStatus === "generating" ? (
                            <div className="flex flex-col items-center gap-2 text-violet-400">
                              <Loader2 size={26} className="animate-spin" />
                              <span className="text-[10px] font-mono uppercase tracking-wider">Generating...</span>
                            </div>
                          ) : scene.imageStatus === "failed" ? (
                            <div className="flex flex-col items-center gap-1 text-rose-400 px-3 text-center">
                              <AlertTriangle size={22} />
                              <span className="text-[9px] font-mono break-words">{scene.imageError}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); void regenerateImage(scene.id); }}
                                className="mt-1 text-[9px] font-mono text-violet-400 hover:underline"
                              >
                                Retry
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1 text-white/30">
                              <Loader2 size={20} className="animate-spin" />
                              <span className="text-[9px] font-mono uppercase tracking-wider">Queued...</span>
                            </div>
                          )}
                          <div className="absolute top-2 right-2"><ApprovalBadge approval={scene.imageApproval} /></div>
                          <div className="absolute top-2 left-2 text-[9px] font-mono text-white/60 bg-black/60 border border-white/10 px-1.5 py-0.5 rounded">#{scene.shot_id}</div>
                        </div>
                        <div className="p-3">
                          <div className="text-[11px] text-white/70 line-clamp-2 leading-snug">{scene.description}</div>
                          {scene.imageStatus === "ready" && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-1 mt-3">
                                <button
                                  onClick={() => setImageApproval(scene.id, scene.imageApproval === "approved" ? "pending" : "approved")}
                                  className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${
                                    scene.imageApproval === "approved"
                                      ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                                      : "bg-emerald-500/10 text-emerald-400/70 border-emerald-500/20 hover:bg-emerald-500/20"
                                  }`}
                                >
                                  <Check size={9} /> {scene.imageApproval === "approved" ? "Approved" : "Approve"}
                                </button>
                                <button
                                  onClick={() => void regenerateImage(scene.id)}
                                  className="flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-violet-500/10 text-violet-400/70 border border-violet-500/20 hover:bg-violet-500/20 transition-all flex items-center justify-center gap-1"
                                  title="Regenerate from scratch — fresh take"
                                >
                                  <RefreshCw size={9} /> Regen
                                </button>
                                <button
                                  onClick={() => toggleImageFeedback(scene.id)}
                                  className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${
                                    imageFeedbackOpen.has(scene.id)
                                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                      : "bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]"
                                  }`}
                                  title="Refine this image with written direction"
                                >
                                  <MessageSquare size={9} /> Feedback
                                </button>
                                <button
                                  onClick={() => setImageApproval(scene.id, "rejected")}
                                  className="py-1.5 px-2 rounded text-[9px] font-mono uppercase tracking-wider bg-rose-500/10 text-rose-400/70 border border-rose-500/20 hover:bg-rose-500/20 transition-all"
                                  title="Reject"
                                >
                                  <X size={9} />
                                </button>
                              </div>

                              {imageFeedbackOpen.has(scene.id) && (
                                <div className="mt-2 space-y-1.5">
                                  <textarea
                                    value={scene.imageFeedback}
                                    onChange={(e) => patchShot(scene.id, { imageFeedback: e.target.value })}
                                    rows={3}
                                    placeholder="What should change? e.g. 'warmer light on her face', 'tighter crop', 'no mirror reflection'..."
                                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[10px] text-white/80 placeholder:text-white/25 outline-none resize-none font-mono leading-relaxed focus:border-amber-500/30"
                                    autoFocus
                                  />
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => { const t = scene.imageFeedback.trim(); if (t) void regenerateImage(scene.id, t); }}
                                      disabled={!scene.imageFeedback.trim()}
                                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      <RefreshCw size={9} /> Regen w/ Feedback
                                    </button>
                                    <button
                                      onClick={() => closeImageFeedback(scene.id)}
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
                </div>
              </motion.div>
            )}

            {/* Step 2 — Videos */}
            {currentStep === 2 && (
              <motion.div
                key="videos"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-6 md:p-10"
              >
                <div className="max-w-7xl mx-auto">
                  <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                    <div>
                      <h1 className="text-lg font-medium text-white/90 mb-0.5">Videos</h1>
                      <p className="text-[11px] text-white/40 font-mono">
                        {videosReady} ready · {videosGenerating} generating · {videosFailed} failed · {videosApproved} approved · {approvedImages.length} total
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] font-mono text-white/40 whitespace-nowrap">
                        {videoPromptsWritten < approvedImages.length && videosReady === 0 && approvedImages.length > 0
                          ? `Prompts ${videoPromptsWritten}/${approvedImages.length}`
                          : `${twoPhaseVideosPct}%`}
                      </div>
                      <div className="w-32 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <motion.div
                          className="h-full bg-violet-500/60"
                          animate={{ width: `${twoPhaseVideosPct}%` }}
                          transition={{ duration: 0.4 }}
                        />
                      </div>
                      <button
                        onClick={approveAllReadyVideos}
                        disabled={videosReady === 0 || videosReady === videosApproved}
                        className="ml-3 flex items-center gap-1.5 px-3 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Check size={10} /> Approve All
                      </button>
                      <button
                        onClick={() => void saveApprovedToBrandAssets()}
                        disabled={savingToBrandAssets || videosApproved === 0}
                        className="flex items-center gap-1.5 px-3 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-500/40 hover:bg-violet-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Download every approved MP4 locally AND write a brand_assets row for each so they appear in the Asset Library."
                      >
                        {savingToBrandAssets ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                        Download All &amp; Save to Brand Assets ({videosApproved})
                      </button>
                      {brandAssetsSavedCount > 0 && (
                        <span className="text-[10px] font-mono text-emerald-400/80">
                          ✓ {brandAssetsSavedCount} saved to Brand Assets
                        </span>
                      )}
                    </div>
                  </div>

                  {pipelineError && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-300 font-mono mb-4 flex items-start gap-2">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>{pipelineError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {approvedImages.map((scene) => (
                      <div key={scene.id} className="rounded-lg overflow-hidden border border-white/[0.08] bg-white/[0.02]">
                        <div className="relative aspect-[9/16] bg-black/40 flex items-center justify-center">
                          {scene.videoStatus === "ready" && scene.videoUrl ? (
                            <video src={scene.videoUrl} className="w-full h-full object-cover" controls loop muted playsInline />
                          ) : scene.videoStatus === "generating" ? (
                            <>
                              {scene.imageUrl && <img src={scene.imageUrl} alt={scene.description} className="w-full h-full object-cover opacity-40" />}
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-violet-400 bg-black/40">
                                <Loader2 size={26} className="animate-spin" />
                                <span className="text-[10px] font-mono uppercase tracking-wider">Generating video...</span>
                              </div>
                            </>
                          ) : scene.videoStatus === "failed" ? (
                            <div className="flex flex-col items-center gap-1 text-rose-400 px-3 text-center">
                              <AlertTriangle size={22} />
                              <span className="text-[9px] font-mono break-words">{scene.videoError}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); void regenerateVideo(scene.id); }}
                                className="mt-1 text-[9px] font-mono text-violet-400 hover:underline"
                              >
                                Retry
                              </button>
                            </div>
                          ) : (
                            <>
                              {scene.imageUrl && <img src={scene.imageUrl} alt={scene.description} className="w-full h-full object-cover opacity-60" />}
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60 bg-black/30">
                                <Loader2 size={22} className="animate-spin" />
                                <span className="text-[9px] font-mono uppercase tracking-wider">Queued...</span>
                              </div>
                            </>
                          )}
                          <div className="absolute top-2 right-2"><ApprovalBadge approval={scene.videoApproval} /></div>
                          <div className="absolute top-2 left-2 text-[9px] font-mono text-white/60 bg-black/60 border border-white/10 px-1.5 py-0.5 rounded">#{scene.shot_id}</div>
                        </div>
                        <div className="p-3">
                          <div className="text-[11px] text-white/70 line-clamp-2 leading-snug">{scene.description}</div>
                          {scene.videoStatus === "ready" && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-1 mt-3">
                                <button
                                  onClick={() => setVideoApproval(scene.id, scene.videoApproval === "approved" ? "pending" : "approved")}
                                  className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${
                                    scene.videoApproval === "approved"
                                      ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                                      : "bg-emerald-500/10 text-emerald-400/70 border-emerald-500/20 hover:bg-emerald-500/20"
                                  }`}
                                >
                                  <Check size={9} /> {scene.videoApproval === "approved" ? "Approved" : "Approve"}
                                </button>
                                <button
                                  onClick={() => void regenerateVideo(scene.id)}
                                  className="flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-violet-500/10 text-violet-400/70 border border-violet-500/20 hover:bg-violet-500/20 transition-all flex items-center justify-center gap-1"
                                  title="Regenerate from scratch"
                                >
                                  <RefreshCw size={9} /> Regen
                                </button>
                                <button
                                  onClick={() => toggleVideoFeedback(scene.id)}
                                  className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${
                                    videoFeedbackOpen.has(scene.id)
                                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                      : "bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]"
                                  }`}
                                  title="Refine motion with written direction"
                                >
                                  <MessageSquare size={9} /> Feedback
                                </button>
                                <button
                                  onClick={() => downloadVideo(scene)}
                                  disabled={scene.videoApproval !== "approved"}
                                  className="py-1.5 px-2 rounded text-[9px] font-mono uppercase tracking-wider bg-violet-500/10 text-violet-400/70 border border-violet-500/20 hover:bg-violet-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                  title={scene.videoApproval === "approved" ? "Download MP4" : "Approve first to enable download"}
                                >
                                  <Download size={9} />
                                </button>
                              </div>

                              {videoFeedbackOpen.has(scene.id) && (
                                <div className="mt-2 space-y-1.5">
                                  <textarea
                                    value={scene.videoFeedback}
                                    onChange={(e) => patchShot(scene.id, { videoFeedback: e.target.value })}
                                    rows={3}
                                    placeholder="What should change? e.g. 'slower head turn', 'no wince', 'camera should pan instead of being still'..."
                                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[10px] text-white/80 placeholder:text-white/25 outline-none resize-none font-mono leading-relaxed focus:border-amber-500/30"
                                    autoFocus
                                  />
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => { const t = scene.videoFeedback.trim(); if (t) void regenerateVideo(scene.id, t); }}
                                      disabled={!scene.videoFeedback.trim()}
                                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      <RefreshCw size={9} /> Regen w/ Feedback
                                    </button>
                                    <button
                                      onClick={() => closeVideoFeedback(scene.id)}
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

                  {mechanismLoading && (
                    <div className="text-[11px] text-white/40 font-mono mt-3 flex items-center gap-2">
                      <Loader2 size={11} className="animate-spin" /> Loading product specs...
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
