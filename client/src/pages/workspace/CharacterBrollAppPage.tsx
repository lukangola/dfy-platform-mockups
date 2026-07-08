/**
 * DESIGN: Studio Control Room — Character B-Roll App Wrapper
 *
 * Flow (4 steps):
 *   0. Input — product + character image + input mode (angle or script) + asset limits
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
  AlertTriangle, Plus, Trash2, Download, RotateCcw, User, Upload, FileText,
} from "lucide-react";
import {
  listProducts, getProductMechanism, getProductAngles,
  listCharacters, createCharacter, deleteCharacter, prepareCharacterForSeedance,
  generateCharacterBrollShots, generateCharacterBrollImagePrompts,
  generateCharacterBrollVideoPrompts, generateText, saveBrandAssets,
  createJob, getJob, listJobs,
  type Product, type CharacterBrollShot, type CharacterBrollShotList,
  type CharacterBrollCategory, type ProductMechanism, type ProductAngle,
  type CharacterRef, type Job, type JobItem,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { downloadViaBlob } from "@/lib/download";
import { regenImageWithFeedback } from "@/lib/imageFeedbackRegen";

const STEPS = ["Input", "Shot List", "Images", "Videos"];

// Seven categories emitted by the Character UGC B-Roll Shot-List Architect V1.
// Order here drives rendering order in filter chips, grouped image/video views,
// and the add-shot dropdown.
const CATEGORY_ORDER: CharacterBrollCategory[] = [
  "Hook / Scroll-Stopper",
  "Problem",
  "Failed Solution",
  "Product",
  "Authority / Credibility",
  "Emotional Payoff / Transformation",
  "Lifestyle / Context",
];

const CATEGORY_META: Record<CharacterBrollCategory, { label: string; color: string }> = {
  "Hook / Scroll-Stopper": { label: "Hook", color: "#F472B6" },
  "Problem": { label: "Problem", color: "#F87171" },
  "Failed Solution": { label: "Failed Solution", color: "#FB923C" },
  "Product": { label: "Product", color: "#00D4FF" },
  "Authority / Credibility": { label: "Authority", color: "#A78BFA" },
  "Emotional Payoff / Transformation": { label: "Payoff", color: "#34D399" },
  "Lifestyle / Context": { label: "Lifestyle", color: "#FBBF24" },
};

function metaFor(category: string): { label: string; color: string } {
  return CATEGORY_META[category as CharacterBrollCategory] ?? { label: category, color: "#64748B" };
}

type MediaStatus = "idle" | "generating" | "ready" | "failed";
type Approval = "pending" | "approved" | "rejected";

type UiShot = {
  id: string;        // stable React key / worker id
  shot_id: number;   // numeric shot number used in API shape
  category: string;  // one of the 7 categories (free-form fallback tolerated)
  shot_type: string; // original shot_type string from the architect (kept for prompt writers)
  scriptBeat?: string; // quoted VO line in script mode
  /** True for shots the user added on the shot-list step; false for engine-generated ones. */
  userAdded: boolean;
  title: string;       // editable — maps to API `action`
  description: string; // editable — maps to API `visual_example`
  location: string;    // editable
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

function uiShotToApi(s: UiShot): CharacterBrollShot {
  return {
    id: s.shot_id,
    category: s.category,
    shot_type: s.shot_type || s.category,
    action: s.title,
    location: s.location,
    visual_example: s.description,
    ...(s.scriptBeat ? { script_beat: s.scriptBeat } : {}),
    // Pass the latest image prompt (with any feedback baked in) so the video
    // prompt writer aligns motion with the actual still.
    ...(s.imagePrompt ? { image_prompt: s.imagePrompt } : {}),
  };
}

let uiShotCounter = 0;
function newUiShotId(): string {
  uiShotCounter += 1;
  return `ui-shot-${uiShotCounter}`;
}

function toUiShots(list: CharacterBrollShotList): UiShot[] {
  return list.shots.map((s) => ({
    id: newUiShotId(),
    shot_id: s.id,
    category: s.category,
    shot_type: s.shot_type,
    scriptBeat: s.script_beat,
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
 * Detect a Gemini-classifier rejection in a job item's error string.
 *
 * The old direct-call flow detected this via ApiCallError{status:422,
 * errorCode:"content_safety_rejected"}; durable-job items only surface the
 * raw fal message text (FalContentSafetyError.message → item.error), so we
 * match the same phrases the server groups under content safety. A 422 that
 * is a genuine validation error carries field-level `detail[]` text instead
 * and won't match — string matching is actually tighter than the old
 * status check here.
 *
 * The alternates mirror fal.ts's isTransientGenerationRefusal phrase set
 * (same source of truth): any of those Gemini-refusal phrasings can land
 * verbatim in item.error once fal's bounded retries are exhausted, and
 * fal.ts promises the client soften-and-retry flow kicks in for them.
 */
function isContentSafetyErrorText(msg: string): boolean {
  return /did not generate the expected output|could not generate images with the given|try again with different inputs|model did not generate|unsafe content|content policy/i.test(msg);
}

/**
 * Shown when a shot fails the safety classifier even after its one automatic
 * sanitize-retry — the raw fal message is useless to the user; this tells
 * them what actually works.
 */
const SAFETY_REJECTION_HELP =
  "The image model rejected this prompt as potentially unsafe even after auto-softening the language. Try regenerating with feedback — soften wardrobe terms (e.g. 'bra' → 'fitted top'), avoid describing body parts pressing against clothing, and keep the emotional beat on the face / posture rather than on clothing struggle.";

/**
 * Time-estimated progress bar for the shot-list architect step. Asymptotes
 * toward 95% over ~25s; parent unmounts when shots land.
 */
function ShotListProgressBar() {
  const [pct, setPct] = useState(0);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
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

/**
 * Small status pill rendered on the bottom-left of each character tile while
 * the Seedance prep is in flight or has failed.
 *
 * Currently hidden — we ship Kling Video v3 Pro for character B-roll, which
 * does not need the synthetic portrait. The Seedance prep machinery still
 * runs in the background to preserve the data (per the "save both
 * reference images always" instruction) but the user should not see a
 * "Preparing…" badge for a step that doesn't gate any generation. Restore
 * the body of this component if we ever revert to Seedance ref-to-video.
 */
function CharacterPrepBadge(_props: {
  character: CharacterRef;
  onRetry: (id: string) => void;
}) {
  return null;
}

export default function CharacterBrollAppPage() {
  const { activeBrandId } = useBrand();
  const [currentStep, setCurrentStep] = useState(0);

  // Input state
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  // Character library state — two tiers fetched together. `defaultCharacters`
  // is shared across every brand (seeded from client/public/characters/library/);
  // `brandCharacters` is private to the active brand. The currently selected
  // character is identified by id (so we can highlight the picked card) and by
  // url (the existing downstream pipeline already references images by URL).
  const [defaultCharacters, setDefaultCharacters] = useState<CharacterRef[]>([]);
  const [brandCharacters, setBrandCharacters] = useState<CharacterRef[]>([]);
  const [charactersLoading, setCharactersLoading] = useState(false);
  const [charactersError, setCharactersError] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  /**
   * The character has TWO image URLs we care about, kept in separate state
   * because each one feeds a different model:
   *
   *   characterImageUrl       — the original uploaded photo. This goes into
   *                             Nano-Banana-Pro/2 image generation as the
   *                             character reference (NBP accepts realistic
   *                             photos fine).
   *   characterVideoRefUrl    — the synthetic close-up portrait produced by
   *                             the 2-step Seedance prep pipeline. This is
   *                             what we pass to Seedance ref-to-video as
   *                             `@Image2`. Falls back to characterImageUrl if
   *                             the prep hasn't completed yet (in which case
   *                             Seedance may flag the request — the UI shows
   *                             a "preparing…" badge so the user knows).
   */
  const [characterImageUrl, setCharacterImageUrl] = useState<string | null>(null);
  const [characterVideoRefUrl, setCharacterVideoRefUrl] = useState<string | null>(null);
  const [characterImageUploading, setCharacterImageUploading] = useState(false);
  const [characterImageError, setCharacterImageError] = useState<string | null>(null);

  // Input-mode state
  const [inputMode, setInputMode] = useState<"angle" | "script">("angle");
  const [scriptText, setScriptText] = useState("");
  const [angles, setAngles] = useState<ProductAngle[]>([]);
  const [anglesLoading, setAnglesLoading] = useState(false);
  const [anglesError, setAnglesError] = useState<string | null>(null);
  const [selectedAngleIdx, setSelectedAngleIdx] = useState<number | null>(null);
  const [customAngle, setCustomAngle] = useState("");
  const [useCustomAngle, setUseCustomAngle] = useState(false);

  const [assetLimits, setAssetLimits] = useState("");

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [shotList, setShotList] = useState<CharacterBrollShotList | null>(null);
  const [uiShots, setUiShots] = useState<UiShot[]>([]);
  const [productLine, setProductLine] = useState("");

  // Mechanism + prompt-writer caches (shared across a run).
  const [mechanism, setMechanism] = useState<ProductMechanism[] | null>(null);
  const [mechanismLoading, setMechanismLoading] = useState(false);
  const [imagePromptsLoading, setImagePromptsLoading] = useState(false);
  const [videoPromptsLoading, setVideoPromptsLoading] = useState(false);
  // Counters for the determinate two-phase progress bar (prompt writing →
  // image/video generation). Incremented as each parallel Claude call lands.
  const [imagePromptsWritten, setImagePromptsWritten] = useState(0);
  const [videoPromptsWritten, setVideoPromptsWritten] = useState(0);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Durable-jobs pilot: batch generation runs server-side (survives reload +
  // deploys). The page holds only the active job ids and mirrors item state
  // onto shots via the poll effect below.
  const [activeImageJobId, setActiveImageJobId] = useState<string | null>(null);
  const [activeVideoJobId, setActiveVideoJobId] = useState<string | null>(null);
  // Session-resume banner: newest queued/running character-broll job for this
  // brand — or, when none is live, the newest character-broll job of any
  // status — offered as a one-click resume/restore when the page isn't
  // already tracking a job. Dismissible (null) for the rest of the visit via
  // the banner's X.
  const [resumableJob, setResumableJob] = useState<Job | null>(null);

  // Review state
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedShot, setSelectedShot] = useState<UiShot | null>(null);

  // Inline feedback UX — mirrors StaticAds. Each shot id can have its own
  // "feedback open" state on the image card, letting the user type direction
  // and fire "Regenerate with Feedback" without opening the right-side panel.
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

  // Mirror of the image feedback UX, applied to the video card. Each shot id
  // can have its own "feedback open" state so the user can write direction
  // ("less head turn", "slower camera drift", "no wince") and fire
  // "Regenerate with Feedback" without opening the right-side panel. The
  // underlying regenerateVideo() already supports a feedback string — we're
  // just exposing the second entry point in the card UI.
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

  const imagesAutoKickedRef = useRef(false);
  const videosAutoKickedRef = useRef(false);

  // Synchronous re-entrancy guards for the batch creators. During their
  // multi-second awaits (adoptUnfinishedJob, prompt writing) the active job
  // id is still null, so a second trigger (stepper back + re-approve, banner
  // click) could double-create a job — and double the fal spend.
  const imagesBatchInFlightRef = useRef(false);
  const videosBatchInFlightRef = useRef(false);

  // Synchronous mirror of activeImageJobId (plus a "claiming" sentinel while
  // a create is in flight). The poll's content-safety auto-retry runs from an
  // effect closure and must check-and-claim the single image-job slot without
  // waiting for a render — state alone can't do that. Every image-job id
  // change goes through trackImageJob() so the mirror never drifts. Video
  // jobs have no async claimant, so they keep the plain state setter.
  const activeImageJobIdRef = useRef<string | null>(null);
  // Shots that already consumed their one automatic sanitize-retry — a
  // second safety rejection surfaces SAFETY_REJECTION_HELP instead of
  // looping rewrite+generate spend.
  const sanitizedOnceRef = useRef<Set<string>>(new Set());
  // Latest uiShots for the poll-driven sanitize retry: its effect closure
  // goes stale as batch items land, but the session payload it snapshots
  // onto the follow-up job must not lose those results.
  const uiShotsRef = useRef<UiShot[]>([]);
  useEffect(() => { uiShotsRef.current = uiShots; }, [uiShots]);

  function trackImageJob(id: string | null) {
    activeImageJobIdRef.current = id;
    setActiveImageJobId(id);
  }

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

  // Fetch angles when the selected product changes. Angles are cached server-side.
  useEffect(() => {
    if (!selectedProductId) {
      setAngles([]);
      setSelectedAngleIdx(null);
      return;
    }
    let cancelled = false;
    setAnglesLoading(true);
    setAnglesError(null);
    (async () => {
      try {
        const { angles: a } = await getProductAngles(selectedProductId);
        if (!cancelled) {
          setAngles(a);
          setSelectedAngleIdx(a.length > 0 ? 0 : null);
        }
      } catch (err) {
        if (!cancelled) setAnglesError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setAnglesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProductId]);

  const handleProductSelect = (productId: string) => {
    setSelectedProductId(productId);
    setProductDropdownOpen(false);
  };

  // Load the character library (default + brand-private) whenever the active
  // brand changes. The picker shows defaults to every brand and brand-private
  // characters only to that brand.
  //
  // After the initial load, if any character is still mid-prep (status=running
  // or pending), poll every 5s until everything settles. The poll terminates
  // automatically once no row is in flight, so it costs nothing on idle pages.
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

        // If any selected character just got a portrait, transparently swap in
        // the synthetic URL so the next video call uses the safe ref.
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
    // Prefer the synthetic portrait for video; fall back to the original if
    // prep hasn't completed yet (Seedance may flag, but the UI badge tells
    // the user why).
    setCharacterVideoRefUrl(c.seedancePortraitUrl ?? c.imageUrl);
    setCharacterImageError(null);
  }

  /**
   * Uploading a file does two things at once:
   *   1. Persists it as a brand-private character (so it's reusable later).
   *   2. Selects it as the active character for this generation.
   * That mirrors how users expect "upload + use" to behave on first try.
   */
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
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const { character } = await createCharacter({
        brandId: activeBrandId,
        dataUrl,
        filename: file.name,
      });
      setBrandCharacters((prev) => [character, ...prev]);
      pickCharacter(character);
    } catch (err) {
      setCharacterImageError(err instanceof Error ? err.message : String(err));
    } finally {
      setCharacterImageUploading(false);
    }
  }

  /**
   * Removes a brand-private character from the library and clears the
   * selection if it was the active one. Default-library rows are protected
   * server-side (the API returns 403) and the UI never shows a delete button
   * on those tiles.
   */
  /**
   * Force-retry the Seedance prep for one character. Optimistically flips the
   * row's status to "running" so the badge updates instantly; the poll
   * effect will sync the real status back from the server.
   */
  async function handleRetryPrep(id: string) {
    try {
      await prepareCharacterForSeedance(id);
      const flip = (list: CharacterRef[]) =>
        list.map((c) =>
          c.id === id
            ? { ...c, seedancePrepStatus: "running" as const, seedancePrepError: null }
            : c,
        );
      setDefaultCharacters(flip);
      setBrandCharacters(flip);
    } catch (err) {
      setCharactersError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteBrandCharacter(c: CharacterRef) {
    try {
      await deleteCharacter(c.id);
      setBrandCharacters((prev) => prev.filter((x) => x.id !== c.id));
      if (selectedCharacterId === c.id) {
        setSelectedCharacterId(null);
        setCharacterImageUrl(null);
      }
    } catch (err) {
      setCharactersError(err instanceof Error ? err.message : String(err));
    }
  }

  // Resolve the angle text (block) to send to the shot architect.
  function resolveAngleResearch(): string {
    if (useCustomAngle && customAngle.trim()) return customAngle.trim();
    if (selectedAngleIdx !== null && angles[selectedAngleIdx]) {
      const a = angles[selectedAngleIdx];
      return `Angle: ${a.name}\n\n${a.block}`;
    }
    return selectedProduct?.research?.markdown ?? "";
  }

  const angleReady = useCustomAngle ? !!customAngle.trim() : selectedAngleIdx !== null;
  const scriptReady = !!scriptText.trim();
  const canGenerate =
    !!selectedProduct &&
    !!characterImageUrl &&
    (inputMode === "angle" ? angleReady : scriptReady) &&
    !generating;

  async function handleGenerate() {
    if (!selectedProduct || !characterImageUrl) return;
    setGenerating(true);
    setGenerationError(null);
    // Jump-then-work: move to step 1 immediately so the user sees a loading
    // skeleton instead of waiting on an unresponsive button. Shot-list gen
    // takes 15-30s on the architect prompt.
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
      const { shots } = await generateCharacterBrollShots({
        product: line,
        inputMode,
        research: inputMode === "angle" ? resolveAngleResearch() : "",
        script: inputMode === "script" ? scriptText.trim() : "",
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

  function updateShotField(id: string, patch: Partial<Pick<UiShot, "title" | "description" | "location" | "category" | "scriptBeat">>) {
    patchShot(id, patch);
  }

  function removeShot(id: string) {
    setUiShots((prev) => prev.filter((s) => s.id !== id));
    setSelectedShot((prev) => (prev && prev.id === id ? null : prev));
  }

  function addShot(category: CharacterBrollCategory = "Product") {
    setUiShots((prev) => {
      const next: UiShot = {
        id: newUiShotId(),
        shot_id: nextShotNumber(prev),
        category,
        shot_type: category,
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

  // Parallel prompt writing — one Claude call per shot, all in flight at once.
  // Previously a single batched call had Claude write all prompts sequentially
  // inside its response (~25s for 10 shots). Now total time ≈ max(individual
  // times), typically 5-7s. Master prompt is cached (ephemeral), so cost
  // barely changes on repeat parallel calls.
  async function writeImagePrompts(targets: UiShot[]): Promise<string[]> {
    if (targets.length === 0) return [];
    setImagePromptsLoading(true);
    setImagePromptsWritten(0);
    try {
      const m = await ensureMechanism().catch(() => [] as ProductMechanism[]);
      const results = await Promise.all(
        targets.map(async (t) => {
          const { prompts } = await generateCharacterBrollImagePrompts({
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
          const { prompts } = await generateCharacterBrollVideoPrompts({
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

  // nano-banana-pro/edit takes an array of reference images. For character B-roll
  // we pass the character portrait first (identity anchor) and — only when the
  // shot is a Product-category shot — the product visuals as additional anchors.
  // For every other category (Hook, Problem, Failed Solution, Authority, Payoff,
  // Lifestyle) the product reference images are OMITTED from image_urls so the
  // model cannot leak the packaging into the frame. This matches the master
  // prompt's "DEFAULT IS D ONLY" rule: if no product reference is provided, the
  // product is simply not in that shot.
  function collectProductImageUrls(): string[] {
    if (!selectedProduct) return [];
    // Order matters: front image first (the canonical hero shot), then back,
    // then content (interior/contents shot), then the multi-angle reference
    // sheet. Order is preserved into Kling's `elements.reference_image_urls`
    // and into Nano-Banana-Pro's `image_urls` — front-first gives the model
    // the strongest identity anchor when the prompt doesn't specify which
    // angle is needed.
    const urls = [
      selectedProduct.productImageUrl,
      selectedProduct.productBackImageUrl,
      selectedProduct.contentImageUrl,
      selectedProduct.research?.referenceSheetUrl ?? null,
    ].filter((u): u is string => !!u);
    return Array.from(new Set(urls));
  }

  /**
   * Heuristic: does this rendered prompt actually reference the product?
   *
   * The category-based filter (`shouldIncludeProductRefs`) is a hard gate
   * that says "Category D shots should always show the product." But the
   * upstream image/video prompt writers occasionally drift and describe a
   * product in a non-D shot ("Character lifts the bottle" sneaking into a
   * Lifestyle frame). When that happens, we want to give the model the
   * product references so it doesn't have to invent the packaging from
   * memory.
   *
   * Match priority:
   *   1. Product-name tokens (split on whitespace, drop short words) —
   *      the strongest signal.
   *   2. Generic packaging nouns ("bottle", "jar", "the product", etc.).
   *   3. Marker tokens we use in master prompts ("@Element1", "@Image3").
   *
   * Returns true if any signal matches, false otherwise. False positives
   * are cheap (we send refs the model didn't strictly need); false
   * negatives are expensive (model invents wrong packaging).
   */
  function promptReferencesProduct(prompt: string): boolean {
    if (!prompt) return false;
    const text = prompt.toLowerCase();

    // Product-name tokens — the strongest, most specific signal.
    // Word-boundary match so "alcami" doesn't match "alcamiform" etc.
    const productName = (productLine || selectedProduct?.name || "").toLowerCase();
    const nameTokens = productName
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length >= 4); // skip "the", "and", short words
    if (nameTokens.some((t) => new RegExp(`\\b${t}\\b`, "i").test(text))) return true;

    // Generic packaging nouns. Curated to avoid substring collisions with
    // common English words — historic bugs from naive substring matching
    // forced product refs into Lifestyle/Hook shots whenever prompts
    // contained words like "can" ("she can see"), "tin" ("waiting"),
    // "cap"/"capture", "lid"/"valid", "box"/"boxing", "tube"/"youtube".
    // Every entry below is matched with word boundaries so the false
    // positives don't recur. Ambiguous single-syllable nouns (can, tin,
    // cap, lid, box, tube, trigger, pump) are intentionally dropped — if a
    // shot legitimately needs them, the Category-D hard gate or the
    // @Element/@Image marker fallback will still catch it.
    const generic = [
      "the product", "bottle", "jar", "pouch", "sachet", "spray bottle",
      "container", "dropper", "packaging", "package", "wrapper",
    ];
    if (generic.some((g) => new RegExp(`\\b${g}\\b`, "i").test(text))) return true;

    // Marker tokens we use in master prompts (least ambiguous fallback).
    if (/@element\d/i.test(prompt) || /@image[3-9]/i.test(prompt)) return true;
    return false;
  }

  // Only Category D shots should have the product reference image passed to the
  // image model. Everything else: character ref only. This is the hard gate
  // that prevents the product from leaking into Problem / Hook / Lifestyle /
  // Authority / Payoff / Failed-Solution frames.
  function shouldIncludeProductRefs(category: string): boolean {
    return category === "Product";
  }

  /**
   * Hard-blacklist categories that MUST NEVER receive our product reference
   * images, even if the rendered prompt happens to mention product-y words
   * (the prompt-text fallback in `promptReferencesProduct` would otherwise
   * trigger and leak refs in).
   *
   * Failed Solution: the shot is supposed to depict an OLD / COMPETITOR
   * routine — a different product that didn't work. The master prompt allows
   * a generic branded-but-blurred competitor stand-in to be described, but
   * if we ALSO pass our actual product reference images alongside, Kling
   * (and to a lesser extent Nano-Banana) glitches and morphs the competitor
   * stand-in into OUR product mid-clip. Hard exclude — even if the prompt
   * says "the bottle" or "the jar," those refer to the competitor and the
   * model should invent it from scratch, never anchor to our refs.
   */
  function categoryBlocksProductRefs(category: string): boolean {
    return category === "Failed Solution";
  }

  /**
   * Build the reference-image list to pass to nano-banana-pro/edit for one
   * shot. Always includes the character portrait. Includes product
   * references when EITHER:
   *   (a) the shot's category is Product (Category D — the hard rule), OR
   *   (b) the rendered prompt explicitly references the product (defensive
   *       — handles upstream prompt drift where a Lifestyle shot's prompt
   *       sneakily describes a bottle).
   */
  function collectImageRefsForShot(shot: UiShot, prompt: string): string[] {
    const refs: string[] = [];
    if (characterImageUrl) refs.push(characterImageUrl);
    // Hard blacklist (Failed Solution) overrides both the category check AND
    // the prompt-text fallback. See `categoryBlocksProductRefs` for why.
    const wantsProduct =
      !categoryBlocksProductRefs(shot.category) &&
      (shouldIncludeProductRefs(shot.category) || promptReferencesProduct(prompt));
    if (wantsProduct) {
      refs.push(...collectProductImageUrls());
    }
    return Array.from(new Set(refs));
  }

  // ---------- Durable batch jobs (images + videos) ----------

  // Builds the fal payload for one shot's image — used by both the batch
  // (generateAllImages) and single-shot (regenerateImage) durable jobs.
  // References go through the same gated collector the direct calls used:
  // Category D hard gate + prompt heuristics + the Failed Solution blacklist
  // (see collectImageRefsForShot above) — the jobs path must not change
  // which shots see the product.
  function buildImageItemInput(shot: UiShot, prompt: string): Record<string, unknown> {
    const imageUrls = collectImageRefsForShot(shot, prompt);
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
  // Kling Video v3 (image-to-video). The starting frame already contains
  // the character and the full scene — Kling animates from that single
  // frame. Identity comes from the frame.
  //
  // For shots where the product is in motion (Category D, OR any shot whose
  // prompt references the product), we ALSO supply Kling's `elements`
  // parameter — one element bundling every product reference we have
  // (front, back, content, multi-angle reference sheet). This gives Kling
  // visual ground truth when the camera turns the product mid-clip and
  // would otherwise have to invent the unseen side. The prompt cites the
  // product as `@Element1`.
  //
  // We previously used Seedance 2.0 ref-to-video here, which accepted up to
  // 9 reference images cited as @Image1/@Image2/@Image3 in the prompt. Its
  // likeness detector rejected ~35% of requests when realistic character
  // refs were attached, even after a 2-step Nano-Banana-2 synthetic-portrait
  // pre-pass. Kling's moderator does not flag realistic faces, gives
  // comparable motion quality, and supports multi-angle product refs via
  // `elements` — so we ship the simpler pipeline. (The character_broll_videos
  // job executor accordingly has NO Seedance→Kling fallback: this app runs
  // on Kling natively.)
  //
  // The Seedance synthetic-portrait prep machinery (turnaround sheet +
  // close-up portrait) is still running on every character in the
  // background — preserved per the user's instruction to "save both
  // reference images always" — and is available if we ever switch back.
  function buildVideoItemInput(shot: UiShot, prompt: string): Record<string, unknown> {
    const productUrls = collectProductImageUrls();
    // Same hard blacklist as the image step (Failed Solution never gets refs)
    // PLUS the existing category+prompt OR check. Without the blacklist, Kling
    // morphs the competitor stand-in described in the prompt into OUR product
    // by frame 60+ — the user reports this consistently on Failed Solution
    // shots.
    const wantsProduct =
      productUrls.length > 0 &&
      !categoryBlocksProductRefs(shot.category) &&
      (shouldIncludeProductRefs(shot.category) || promptReferencesProduct(prompt));

    const falInput: Record<string, unknown> = {
      prompt,
      start_image_url: shot.imageUrl!,
      // 8 seconds (was 5): the standard tier accepts any integer from 3 to 15;
      // 8s is the sweet spot for character B-roll — long enough to land a
      // gesture or expression beat that 5s tends to clip, still much cheaper
      // than 10s+. Cost scales linearly per-second.
      duration: "8",
      // Audio off: we never use the generated audio track. On Kling v3 this
      // also drops the cost from $0.126/s → $0.084/s (~33%) and shaves a few
      // seconds off generation time.
      generate_audio: false,
    };

    if (wantsProduct) {
      falInput.elements = [
        {
          // Multi-angle bundle: front-first ordering matches the frontal_image_url
          // pick below. Kling treats `reference_image_urls` as the source of
          // truth for `@Element1` across angles; `frontal_image_url` is its
          // canonical hero shot.
          reference_image_urls: productUrls,
          frontal_image_url: selectedProduct?.productImageUrl ?? productUrls[0],
        },
      ];
    }

    return {
      shotId: shot.id,
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
      // Character context — collectImageRefsForShot() anchors every image
      // call on characterImageUrl, so post-resume regenerates need it;
      // characterId re-highlights the picker tile; the video ref URL rides
      // along for a potential Seedance re-switch.
      characterId: selectedCharacterId,
      characterImageUrl,
      characterVideoRefUrl,
      // Drives the step-1 script-beat field visibility after a restore.
      inputMode,
      // Read via the ref (not the closure) so the poll-driven sanitize retry
      // snapshots the latest shot results, not the state as of job creation.
      shots: uiShotsRef.current.map((s) => ({
        id: s.id, shot_id: s.shot_id, category: s.category, shot_type: s.shot_type,
        scriptBeat: s.scriptBeat ?? null, userAdded: s.userAdded,
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

  /**
   * Content-safety auto-retry — the durable-jobs edition of the old
   * callImageModel catch block. When an IMAGE item comes back failed with
   * the Gemini classifier's rejection text, rewrite the prompt via the
   * image_prompt_safety_rewrite master prompt (adds ~5-8s on Haiku, but
   * turns a hard failure into a success in the majority of body-image /
   * clothing scenes that trip the classifier) and re-run the shot as a
   * fresh 1-item job — ONCE per shot (sanitizedOnceRef); a second rejection
   * surfaces SAFETY_REJECTION_HELP instead of looping spend.
   *
   * Slot discipline: the page tracks ONE image job at a time (B-roll's
   * one-id-per-kind pattern). This flow only fires after its source job has
   * gone terminal — the poll frees the slot before invoking us — but the
   * sanitize call leaves a window where a manual regenerate / batch /
   * banner resume can claim the slot first. In that case we do NOT queue a
   * second job: the shot is marked failed with the sanitized prompt staged
   * on it, so a manual "Regen" retries with the softened language.
   */
  async function autoSanitizeRetry(it: JobItem) {
    const input = it.input as { shotId?: string; kind?: string; model?: string; falInput?: Record<string, unknown> };
    const shotId = input.shotId;
    if (!shotId || !activeBrandId) return;
    // Consume the one-retry budget synchronously so duplicate poll ticks
    // can't double-fire for the same shot.
    sanitizedOnceRef.current.add(shotId);
    // Keep the shot spinning while the rewrite runs — from the user's view
    // this is still the same generation attempt.
    patchShot(shotId, { imageStatus: "generating", imageError: undefined });
    try {
      console.warn("[character-broll] content-safety rejection — sanitizing and retrying once");
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
      // Claim the slot BEFORE the createJob await so parallel safety
      // retries from the same terminal batch can't both create a job.
      activeImageJobIdRef.current = "pending:sanitize-retry";
      try {
        const { job } = await createJob({
          app: "character_broll",
          type: "character_broll_images",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Character b-roll image safety retry — ${it.label}`,
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
            //  - first rejection for this shot AND the job is done → run the
            //    automatic sanitize-and-retry (fire-and-forget; it patches
            //    the shot itself). While the job is still running we leave
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
   * (buildSessionPayload) provides the shot list — prompts/urls/approvals as
   * of trigger time; item outputs overlay whatever finished after the
   * snapshot. Adopts the job as the active poll target when it is still
   * running, marks the matching auto-kick ref(s) as fired so entering the
   * step below can't fire a duplicate batch, and moves the user to the step
   * that matches the job type.
   */
  async function hydrateFromJob(jobId: string) {
    const { job, items } = await getJob(jobId);
    const payload = job.payload as {
      productId?: string | null;
      productName?: string | null;
      characterId?: string | null;
      characterImageUrl?: string | null;
      characterVideoRefUrl?: string | null;
      inputMode?: "angle" | "script";
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
    // Character context: collectImageRefsForShot() anchors every image call
    // on characterImageUrl — without restoring it, a post-resume regenerate
    // would silently drop the character from the frame.
    if (payload.characterId) setSelectedCharacterId(payload.characterId);
    if (payload.characterImageUrl) setCharacterImageUrl(payload.characterImageUrl);
    if (payload.characterVideoRefUrl) setCharacterVideoRefUrl(payload.characterVideoRefUrl);
    if (payload.inputMode) setInputMode(payload.inputMode);
    const isImage = job.type === "character_broll_images";
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
        category: (s.category as string) ?? "Product",
        shot_type: (s.shot_type as string) ?? "",
        scriptBeat: (s.scriptBeat as string | null) ?? undefined,
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
    // over the restored shots. A videos job implies images are done too.
    imagesAutoKickedRef.current = true;
    if (!isImage) videosAutoKickedRef.current = true;
    setCurrentStep(isImage ? 2 : 3);
  }

  /** Returns true when an unfinished character-broll job of the given type
   *  for the current product was handled — adopted (session hydrated, poll
   *  target set), or found but adoption failed (error surfaced; never fall
   *  through to creating a duplicate over a live job). Returns false only
   *  when there is nothing to adopt, so a normal create may proceed. */
  async function adoptUnfinishedJob(type: "character_broll_images" | "character_broll_videos"): Promise<boolean> {
    if (!activeBrandId) return false;
    let candidate: Job | undefined;
    try {
      const { jobs } = await listJobs(activeBrandId);
      candidate = jobs.find(
        (x) =>
          x.app === "character_broll" &&
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
  // character-broll job; with none, fall back to the newest character-broll
  // job of ANY status so users can jump straight back into their LAST
  // session even after it finished (hydrateFromJob handles terminal jobs —
  // spinners end as failed/complete). The server lists running/queued first,
  // then newest, so within the character-broll subset the first entry of
  // each group is the right pick.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    void listJobs(activeBrandId)
      .then(({ jobs }) => {
        if (cancelled) return;
        const mine = jobs.filter((x) => x.app === "character_broll");
        const running = mine.find((x) => x.status === "queued" || x.status === "running");
        setResumableJob(running ?? mine[0] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeBrandId]);

  // ---------- Image generation (batch + single-shot jobs) ----------

  async function generateAllImages() {
    const queue = uiShots.filter(
      (s) => s.imageStatus === "idle" || s.imageStatus === "failed",
    );
    if (queue.length === 0 || !activeBrandId || activeImageJobId) return;
    // Synchronous in-flight guard — activeImageJobId only flips once createJob
    // returns, so without this a concurrent second call (auto-kick + banner
    // click, stepper back-and-re-approve) races through the awaits below and
    // creates a duplicate job.
    if (imagesBatchInFlightRef.current) return;
    imagesBatchInFlightRef.current = true;
    try {
      // Duplicate-guard: a reload loses activeImageJobId, and re-walking the
      // flow re-enters this path (auto-kick or button) while the original batch
      // may still be running server-side. Adopt that job instead of paying fal
      // for a second one.
      if (await adoptUnfinishedJob("character_broll_images")) return;
      setPipelineError(null);
      try {
        const prompts = await writeImagePrompts(queue);
        queue.forEach((s, i) => patchShot(s.id, { imageStatus: "generating", imageError: undefined, imagePrompt: prompts[i] ?? "" }));
        const { job } = await createJob({
          app: "character_broll",
          type: "character_broll_images",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Character b-roll images — ${selectedProduct?.name ?? "product"} · ${queue.length} shot(s)`,
          payload: buildSessionPayload(),
          items: queue.map((s, i) => ({ label: s.title, input: buildImageItemInput(s, prompts[i] ?? "") })),
        });
        trackImageJob(job.id);
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
    const feedbackText = (feedback ?? target.imageFeedback ?? "").trim();
    // Close the inline feedback panel as soon as the user fires a regen so
    // the UI snaps to the generating state without the textarea hanging around.
    if (feedbackText) closeImageFeedback(shotId);
    patchShot(shotId, {
      imageStatus: "generating",
      imageError: undefined,
      imageApproval: "pending",
      ...(feedbackText ? { imageFeedback: feedbackText } : {}),
    });
    try {
      // FEEDBACK PATH — when the user supplied feedback AND there is already a
      // generated image for this shot, route through the focused rework
      // prompt (`prompts/character_broll_image_feedback.md`). The rework
      // prompt is short, directive, and explicitly tells nano-banana-pro/edit
      // to treat the FIRST image as the source-to-edit and apply the
      // feedback as the only change.
      //
      // Why this exists: the previous approach took the original full-scene
      // image prompt (1500+ chars: lighting, pose, props, lens, color
      // science) and appended "\n\nAdditional direction from user: <feedback>"
      // at the end. NBP weighed the long original section more heavily than
      // the short user direction at the bottom, so the feedback often had
      // little visible effect. The new rework prompt inverts that — the
      // feedback IS the directive, and "preserve everything else from the
      // source" is the constraint.
      //
      // This path stays a direct call (not a durable job): it goes through
      // the server's prompt-template route (action + vars.feedback), which
      // the job executor's flat `falInput` shape has no equivalent for.
      if (feedbackText && target.imageUrl) {
        // extraRefs order is significant for nano-banana-pro/edit. The shared
        // `regenImageWithFeedback` helper prepends the source frame as
        // image_urls[0]; the order below becomes [1..n]:
        //   [1] character portrait (identity anchor)
        //   [2..] product references (when product is in frame)
        const extraRefs: string[] = [];
        if (characterImageUrl && characterImageUrl !== target.imageUrl) {
          extraRefs.push(characterImageUrl);
        }
        const includeProduct =
          shouldIncludeProductRefs(target.category) ||
          promptReferencesProduct(target.imagePrompt ?? "");
        if (includeProduct) {
          for (const u of collectProductImageUrls()) extraRefs.push(u);
        }
        const newUrl = await regenImageWithFeedback({
          feedback: feedbackText,
          sourceImageUrl: target.imageUrl,
          extraRefs,
          // Character variant keeps the existing prompt (face / iPhone-candid
          // rules). Product B-Roll passes "broll_image_feedback" here.
          action: "character_broll_image_feedback",
        });
        // Append the feedback to imagePrompt AND clear any stale videoPrompt.
        // Reason: the video prompt writer reads `image_prompt` to align motion
        // with the actual still. If we leave imagePrompt unchanged after a
        // feedback rework, the video prompt will describe motion for the OLD
        // still. Clearing videoPrompt forces a rewrite on the next video pass.
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

      // FRESH-REGEN PATH — no feedback (or no prior image yet). Use the
      // existing "rewrite the full scene prompt" flow, no prior image as
      // ref. This is the "give me a different take" button.
      // Runs as a 1-item durable job so it survives reload the same way the
      // batch generations do.
      let basePrompt = target.imagePrompt;
      if (!basePrompt) {
        const [written] = await writeImagePrompts([target]);
        basePrompt = written ?? "";
      }
      // If user gave feedback (but there was no prior image to edit), also
      // invalidate any stale video prompt.
      patchShot(shotId, {
        imagePrompt: basePrompt,
        ...(feedbackText ? { videoPrompt: undefined } : {}),
      });
      if (!activeBrandId) throw new Error("No active brand selected.");
      try {
        const { job } = await createJob({
          app: "character_broll",
          type: "character_broll_images",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Character b-roll image regenerate — ${target.title}`,
          payload: buildSessionPayload(),
          items: [{ label: target.title, input: buildImageItemInput(target, basePrompt) }],
        });
        trackImageJob(job.id);
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
    if (queue.length === 0 || !activeBrandId || activeVideoJobId) return;
    // Synchronous in-flight guard — see generateAllImages; same race window.
    if (videosBatchInFlightRef.current) return;
    videosBatchInFlightRef.current = true;
    try {
      // Duplicate-guard — see generateAllImages; same reload/double-spend risk.
      if (await adoptUnfinishedJob("character_broll_videos")) return;
      setPipelineError(null);
      try {
        const prompts = await writeVideoPrompts(queue);
        queue.forEach((s, i) => patchShot(s.id, { videoStatus: "generating", videoError: undefined, videoPrompt: prompts[i] ?? "" }));
        const { job } = await createJob({
          app: "character_broll",
          type: "character_broll_videos",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Character b-roll videos — ${selectedProduct?.name ?? "product"} · ${queue.length} shot(s)`,
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
      if (!activeBrandId) throw new Error("No active brand selected.");
      try {
        const { job } = await createJob({
          app: "character_broll",
          type: "character_broll_videos",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Character b-roll video regenerate — ${target.title}`,
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
    const filename = `character-broll-${shot.shot_id}-${(shot.title || "shot").slice(0, 40).replace(/\s+/g, "-")}.mp4`;
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
        title: shot.title || `Character B-Roll shot #${shot.shot_id}`,
        sourceApp: "character-broll",
        productId: selectedProduct?.id ?? null,
        metadata: {
          shot_id: shot.shot_id,
          category: shot.category,
          shot_type: shot.shot_type,
          location: shot.location,
          description: shot.description,
          scriptBeat: shot.scriptBeat ?? null,
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
      await downloadPromise;
      setSavingToBrandAssets(false);
    }
  }

  // ---------- Derived ----------

  const filteredShots = selectedCategory === "all" ? uiShots : uiShots.filter((s) => s.category === selectedCategory);
  const shotsByCategory = (category: string) => uiShots.filter((s) => s.category === category);
  const imagesApprovedCount = uiShots.filter((s) => s.imageApproval === "approved").length;
  const imagesReadyCount = uiShots.filter((s) => s.imageStatus === "ready").length;
  const imagesFailedCount = uiShots.filter((s) => s.imageStatus === "failed").length;
  const imagesGeneratingCount = uiShots.filter((s) => s.imageStatus === "generating").length;
  const imagesProgressPct = uiShots.length === 0
    ? 0
    : Math.round(((imagesReadyCount + imagesFailedCount) / uiShots.length) * 100);

  // Two-phase determinate progress for the image step: count both "prompt
  // written" and "image generated" as 1 unit each. 2N total work units.
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

  const twoPhaseVideosPct = approvedImageShots.length === 0
    ? 0
    : Math.round(
        ((Math.min(videoPromptsWritten, approvedImageShots.length) + videosReadyCount + videosFailedCount)
          / (approvedImageShots.length * 2)) * 100,
      );

  // Categories that actually appear in the current shot list, in canonical order,
  // with any unexpected categories appended so filters cover every shot.
  const displayedCategories: string[] = [
    ...CATEGORY_ORDER.filter((c) => uiShots.some((s) => s.category === c)),
    ...Array.from(new Set(uiShots.map((s) => s.category))).filter(
      (c) => !(CATEGORY_ORDER as string[]).includes(c),
    ),
  ];

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
          <div className="w-6 h-6 rounded bg-pink-500/20 flex items-center justify-center">
            <User size={12} className="text-pink-400" />
          </div>
          <span className="font-mono text-xs text-white/60 tracking-wider">CHARACTER B-ROLL</span>
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
        {/* Left Sidebar — Category Filter (hidden on input and shot-list steps) */}
        {currentStep > 1 && uiShots.length > 0 && (
          <aside className="w-52 border-r border-white/[0.06] p-3 flex flex-col gap-1 shrink-0" style={{ background: "#0D0F12" }}>
            <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest px-2 py-2 mb-1">
              Categories
            </div>
            <button
              onClick={() => setSelectedCategory("all")}
              className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-all ${
                selectedCategory === "all" ? "bg-cyan-500/10 text-cyan-400" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
              }`}
            >
              <Eye size={13} />
              <span className="font-mono">All Shots</span>
              <span className="ml-auto text-[10px] opacity-50">{uiShots.length}</span>
            </button>
            {displayedCategories.map((cat) => {
              const m = metaFor(cat);
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-all ${
                    selectedCategory === cat ? "bg-white/[0.06] text-white" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
                  }`}
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: m.color,
                      boxShadow: selectedCategory === cat ? `0 0 8px ${m.color}60` : "none",
                    }}
                  />
                  <span className="font-mono truncate">{m.label}</span>
                  <span className="ml-auto text-[10px] opacity-50">{shotsByCategory(cat).length}</span>
                </button>
              );
            })}

            {shotList && (
              <div className="mt-auto border-t border-white/[0.06] pt-3">
                <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest px-2 py-1 mb-2">Project</div>
                <div className="px-2">
                  <div className="text-[11px] text-white/70 truncate" title={shotList.project}>{shotList.project}</div>
                  <div className="text-[10px] font-mono text-white/30 mt-1 truncate" title={shotList.location_default}>
                    {shotList.location_default}
                  </div>
                  <div className="text-[10px] font-mono text-white/30 mt-1 uppercase tracking-wider">
                    Mode: {shotList.input_mode}
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
                  Pick a researched product, upload the character image, choose whether to work from an angle or a pasted script, then generate the shot list.
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

                  {/* Character library — default (shared) + brand-private */}
                  {selectedProduct && (
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                          2 — Choose Character
                        </label>
                        <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-white/[0.12] bg-white/[0.03] hover:border-cyan-500/30 hover:text-cyan-400 transition-all cursor-pointer text-[10px] font-mono uppercase tracking-wider text-white/70">
                          {characterImageUploading ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Upload size={11} />
                          )}
                          Upload new
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleCharacterImageFile(f);
                              e.target.value = "";
                            }}
                            className="hidden"
                          />
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

                      {/* Default Library — shared across every brand */}
                      <div className="mb-4">
                        <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-2">
                          Default Library
                        </div>
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
                                className={`relative aspect-square rounded-lg overflow-hidden border transition-all group ${
                                  selectedCharacterId === c.id
                                    ? "border-cyan-500/60 ring-2 ring-cyan-500/20"
                                    : "border-white/[0.08] hover:border-cyan-500/30"
                                }`}
                                title={c.title}
                              >
                                <img src={c.imageUrl} alt={c.title} className="w-full h-full object-cover" />
                                {selectedCharacterId === c.id && (
                                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-cyan-500/90 flex items-center justify-center">
                                    <Check size={11} className="text-black" />
                                  </div>
                                )}
                                <CharacterPrepBadge character={c} onRetry={handleRetryPrep} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Brand Library — private to the active brand */}
                      <div>
                        <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-2">
                          Your Brand Library
                        </div>
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
                                    selectedCharacterId === c.id
                                      ? "border-cyan-500/60 ring-2 ring-cyan-500/20"
                                      : "border-white/[0.08] hover:border-cyan-500/30"
                                  }`}
                                  title={c.title}
                                >
                                  <img src={c.imageUrl} alt={c.title} className="w-full h-full object-cover" />
                                  {selectedCharacterId === c.id && (
                                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-cyan-500/90 flex items-center justify-center">
                                      <Check size={11} className="text-black" />
                                    </div>
                                  )}
                                  <CharacterPrepBadge character={c} onRetry={handleRetryPrep} />
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

                      <p className="text-[10px] text-white/30 font-mono mt-4 leading-relaxed">
                        The on-camera subject. Prompts reference them as the literal label <span className="text-white/60">Character</span>.
                      </p>
                    </div>
                  )}

                  {/* Input Mode Toggle */}
                  {selectedProduct && characterImageUrl && (
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                      <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                        3 — Choose Input
                      </label>
                      <div className="flex items-center gap-2 mb-4">
                        <button
                          onClick={() => setInputMode("angle")}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded border text-xs font-mono uppercase tracking-wider transition-all ${
                            inputMode === "angle"
                              ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40"
                              : "bg-white/[0.03] text-white/40 border-white/[0.08] hover:text-white/70"
                          }`}
                        >
                          <Sparkles size={12} /> Angle
                        </button>
                        <button
                          onClick={() => setInputMode("script")}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded border text-xs font-mono uppercase tracking-wider transition-all ${
                            inputMode === "script"
                              ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40"
                              : "bg-white/[0.03] text-white/40 border-white/[0.08] hover:text-white/70"
                          }`}
                        >
                          <FileText size={12} /> Paste Script
                        </button>
                      </div>

                      {inputMode === "angle" ? (
                        <div>
                          {anglesError ? (
                            <div className="text-[11px] text-rose-400 font-mono flex items-center gap-2 mb-3">
                              <AlertTriangle size={12} /> {anglesError}
                            </div>
                          ) : anglesLoading ? (
                            <div className="text-[11px] text-white/30 font-mono flex items-center gap-2 mb-3">
                              <Loader2 size={12} className="animate-spin" /> Loading angles...
                            </div>
                          ) : angles.length > 0 ? (
                            <div className="flex flex-wrap gap-2 mb-3">
                              {angles.map((angle, idx) => (
                                <button
                                  key={`${angle.name}-${idx}`}
                                  onClick={() => {
                                    setUseCustomAngle(false);
                                    setSelectedAngleIdx(idx);
                                  }}
                                  className={`px-3 py-1.5 rounded-full text-[11px] font-mono border transition-all ${
                                    !useCustomAngle && selectedAngleIdx === idx
                                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                      : "bg-white/[0.03] text-white/50 border-white/[0.08] hover:text-white/80"
                                  }`}
                                >
                                  {angle.name}
                                </button>
                              ))}
                              <button
                                onClick={() => setUseCustomAngle(true)}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-mono border transition-all flex items-center gap-1 ${
                                  useCustomAngle
                                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                    : "bg-white/[0.03] text-white/50 border-dashed border-white/[0.12] hover:text-white/80"
                                }`}
                              >
                                <Plus size={10} /> Custom
                              </button>
                            </div>
                          ) : (
                            <p className="text-[11px] text-white/30 font-mono mb-3">
                              No angles found. Write a custom angle below.
                            </p>
                          )}

                          {(useCustomAngle || angles.length === 0) && (
                            <textarea
                              rows={4}
                              value={customAngle}
                              onChange={(e) => setCustomAngle(e.target.value)}
                              placeholder="Describe the angle — avatar, core pain, desired outcome, unique mechanism, tone..."
                              className="w-full bg-black/30 border border-white/[0.06] rounded-md px-3 py-2 text-[12px] text-white/80 placeholder:text-white/20 outline-none font-mono leading-relaxed resize-y"
                            />
                          )}

                          {!useCustomAngle && selectedAngleIdx !== null && angles[selectedAngleIdx] && (
                            <div className="rounded-md border border-white/[0.06] bg-black/30 p-3 text-[11px] text-white/60 font-mono leading-relaxed whitespace-pre-wrap max-h-40 overflow-auto">
                              {angles[selectedAngleIdx].block}
                            </div>
                          )}
                        </div>
                      ) : (
                        <textarea
                          rows={8}
                          value={scriptText}
                          onChange={(e) => setScriptText(e.target.value)}
                          placeholder="Paste the full UGC script here. Line breaks become beats. The architect will split the 20 shots to match the spoken flow."
                          className="w-full bg-black/30 border border-white/[0.06] rounded-md px-3 py-2 text-[12px] text-white/80 placeholder:text-white/20 outline-none font-mono leading-relaxed resize-y"
                        />
                      )}
                    </div>
                  )}

                  {/* Asset Limits (optional) */}
                  {selectedProduct && characterImageUrl && (
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                      <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                        4 — Asset Limits <span className="text-white/20 normal-case tracking-normal">(optional)</span>
                      </label>
                      <textarea
                        rows={2}
                        value={assetLimits}
                        onChange={(e) => setAssetLimits(e.target.value)}
                        placeholder="e.g. Vertical 9:16 only · Indoor locations only · No children · Keep all shots selfie-framed"
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
                      <>Generate Character B-Roll Shots</>
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

                {/* Time-estimated progress bar + skeleton rows while the
                    shot-list architect runs after step 0's Generate click. */}
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
                  {uiShots.map((shot, idx) => {
                    const m = metaFor(shot.category);
                    return (
                      <div
                        key={shot.id}
                        className="rounded-lg border border-white/[0.06] p-4"
                        style={{ background: "#13161F" }}
                      >
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className="text-[10px] font-mono text-white/40 bg-white/[0.04] border border-white/[0.06] rounded px-2 py-0.5">
                            #{idx + 1}
                          </span>
                          {shot.userAdded ? (
                            <select
                              value={shot.category}
                              onChange={(e) => updateShotField(shot.id, { category: e.target.value })}
                              className="text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/70 border border-white/[0.08] rounded px-2 py-1 outline-none hover:border-white/[0.18]"
                            >
                              {CATEGORY_ORDER.map((c) => (
                                <option key={c} value={c} style={{ background: "#1A1D28" }}>
                                  {CATEGORY_META[c].label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-[10px] font-mono uppercase tracking-wider text-white/60 bg-white/[0.02] border border-white/[0.06] rounded px-2 py-1">
                              {m.label}
                            </span>
                          )}
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: m.color,
                              boxShadow: `0 0 6px ${m.color}80`,
                            }}
                          />
                          {shot.shot_type && shot.shot_type !== shot.category && (
                            <span className="text-[10px] font-mono text-white/40 bg-white/[0.02] border border-white/[0.06] rounded px-2 py-0.5">
                              {shot.shot_type}
                            </span>
                          )}
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
                          className="w-full mt-1 mb-3 bg-black/30 border border-white/[0.06] rounded px-3 py-2 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-cyan-500/40 font-mono"
                        />

                        {(shot.scriptBeat !== undefined || inputMode === "script") && (
                          <>
                            <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Script Beat <span className="normal-case tracking-normal text-white/20">(VO line)</span></label>
                            <input
                              type="text"
                              value={shot.scriptBeat ?? ""}
                              onChange={(e) => updateShotField(shot.id, { scriptBeat: e.target.value })}
                              placeholder="Quoted line from the script"
                              className="w-full mt-1 bg-black/30 border border-white/[0.06] rounded px-3 py-2 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-cyan-500/40 font-mono"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}

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

                {/* Progress bar */}
                {/* Two-phase determinate progress bar (prompts → images). */}
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

                {(selectedCategory === "all" ? displayedCategories : [selectedCategory]).map((cat) => {
                  const shots = selectedCategory === "all" ? shotsByCategory(cat) : filteredShots;
                  if (shots.length === 0) return null;
                  const m = metaFor(cat);
                  return (
                    <div key={cat} className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color, boxShadow: `0 0 8px ${m.color}60` }} />
                        <span className="text-xs font-mono text-white/50 uppercase tracking-widest">{m.label}</span>
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
                              {shot.scriptBeat && (
                                <div className="text-[10px] text-cyan-400/70 mt-1 italic line-clamp-2">"{shot.scriptBeat}"</div>
                              )}
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
                                        placeholder="What should change? e.g. 'warmer light on her face', 'tighter crop on the shoulders', 'no mirror reflection'..."
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
                              <div className="text-[10px] text-white/30 font-mono truncate">{metaFor(shot.category).label}</div>
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
                                      title="Regenerate from scratch — same prompt, fresh roll"
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
                                      title="Refine this clip with written direction — reworks the prompt and re-runs Kling"
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
                                        placeholder="What should change? e.g. 'slower head turn', 'no wince', 'camera should pan instead of being still', 'remove the breath sound'..."
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
                          <span className="text-[10px] font-mono text-white/20 uppercase">{metaFor(shot.category).label}</span>
                        </div>
                        <div className="text-[10px] text-white/30 mt-2 font-mono">📍 {shot.location}</div>
                        {shot.scriptBeat && (
                          <div className="text-[10px] text-cyan-400/70 mt-2 italic leading-relaxed">"{shot.scriptBeat}"</div>
                        )}
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
                            ? "e.g. warmer light on the character's face, hold the product lower, no mirror reflection"
                            : "e.g. slower head turn, keep the product in frame for 2s, no slow motion"}
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
