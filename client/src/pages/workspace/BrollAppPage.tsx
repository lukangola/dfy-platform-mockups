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
  AlertTriangle, Plus, Trash2, Download,
} from "lucide-react";
import {
  listProducts, getProductMechanism, generateBrollShots,
  generateBrollImagePrompts, generateBrollVideoPrompts,
  generateImage, generateVideo, saveBrandAssets,
  type Product, type BrollShot, type BrollShotList,
  type ProductMechanism,
} from "@/lib/api";
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
  const { activeBrandId } = useBrand();
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

  // Review state
  const [selectedType, setSelectedType] = useState<ShotType | "all">("all");
  const [selectedShot, setSelectedShot] = useState<UiShot | null>(null);

  // Brand assets export state
  const [savingToBrandAssets, setSavingToBrandAssets] = useState(false);
  const [brandAssetsSavedCount, setBrandAssetsSavedCount] = useState(0);

  // Track whether we've already auto-kicked generation for a step, so that
  // navigating back and forth doesn't re-fire for already-generated shots.
  const imagesAutoKickedRef = useRef(false);
  const videosAutoKickedRef = useRef(false);

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

  // ---------- Image generation ----------

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

  async function callImageModel(prompt: string): Promise<string> {
    const imageUrls = collectProductImageUrls();
    const hasImages = imageUrls.length > 0;
    const input: Record<string, unknown> = hasImages
      ? { prompt, image_urls: imageUrls, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" }
      : { prompt, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" };
    const model = hasImages ? "fal-ai/nano-banana-pro/edit" : "fal-ai/flux-pro/v1.1";
    const res = await generateImage("broll_image", { input, model });
    const url = res.urls[0];
    if (!url) throw new Error("No image URL returned");
    return url;
  }

  async function generateImageForShot(shot: UiShot, prompt: string) {
    patchShot(shot.id, { imageStatus: "generating", imageError: undefined, imagePrompt: prompt });
    try {
      const url = await callImageModel(prompt);
      patchShot(shot.id, { imageStatus: "ready", imageUrl: url });
    } catch (err) {
      patchShot(shot.id, {
        imageStatus: "failed",
        imageError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function generateAllImages() {
    const queue = uiShots.filter(
      (s) => s.imageStatus === "idle" || s.imageStatus === "failed",
    );
    if (queue.length === 0) return;
    setPipelineError(null);
    try {
      const prompts = await writeImagePrompts(queue);
      await Promise.all(
        queue.map((s, i) => generateImageForShot(s, prompts[i] ?? "")),
      );
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    }
  }

  async function regenerateImage(shotId: string, feedback?: string) {
    const target = uiShots.find((s) => s.id === shotId);
    if (!target) return;
    setPipelineError(null);
    const feedbackText = (feedback ?? target.imageFeedback ?? "").trim();
    patchShot(shotId, {
      imageStatus: "generating",
      imageError: undefined,
      imageApproval: "pending",
      ...(feedbackText ? { imageFeedback: feedbackText } : {}),
    });
    try {
      let basePrompt = target.imagePrompt;
      if (!basePrompt) {
        const [written] = await writeImagePrompts([target]);
        basePrompt = written ?? "";
      }
      const finalPrompt = feedbackText
        ? `${basePrompt}\n\nAdditional direction from user: ${feedbackText}`
        : basePrompt;
      // Stash the updated image prompt AND invalidate any stale video prompt
      // for this shot. If the user changed something about the still (e.g.
      // "make the lighting warmer", "tighter framing"), the existing video
      // prompt was written against the OLD still and will no longer match.
      // Clearing videoPrompt forces writeVideoPrompts to regenerate it from
      // the new image_prompt on the next video pass.
      patchShot(shotId, {
        imagePrompt: finalPrompt,
        ...(feedbackText ? { videoPrompt: undefined } : {}),
      });
      const url = await callImageModel(finalPrompt);
      patchShot(shotId, { imageStatus: "ready", imageUrl: url });
    } catch (err) {
      patchShot(shotId, {
        imageStatus: "failed",
        imageError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------- Video generation ----------

  // Seedance 2.0 reference-to-video takes `image_urls` (up to 9) and references
  // them inside the prompt as @Image1, @Image2, etc. @Image1 is the B-roll
  // starting frame; subsequent entries are the product hero / content image /
  // reference sheet so the model can match packaging + angles across the clip.
  async function callVideoModel(prompt: string, imageUrl: string): Promise<string> {
    const productRefs = collectProductImageUrls();
    // Starting frame first, then product references (de-duped in case the
    // broll still is somehow one of the product URLs).
    const imageUrls = [imageUrl, ...productRefs.filter((u) => u !== imageUrl)];
    const res = await generateVideo("broll_video", {
      input: {
        prompt,
        image_urls: imageUrls,
        duration: "4",
        aspect_ratio: "9:16",
        resolution: "720p",
        // Audio off: we never use the generated audio track, and disabling it
        // shaves generation time + drops Seedance/Kling cost noticeably.
        generate_audio: false,
      },
      model: "bytedance/seedance-2.0/reference-to-video",
    });
    const url = res.urls[0];
    if (!url) throw new Error("No video URL returned");
    return url;
  }

  async function generateVideoForShot(shot: UiShot, prompt: string) {
    if (!shot.imageUrl) return;
    patchShot(shot.id, { videoStatus: "generating", videoError: undefined, videoPrompt: prompt });
    try {
      const url = await callVideoModel(prompt, shot.imageUrl);
      patchShot(shot.id, { videoStatus: "ready", videoUrl: url });
    } catch (err) {
      patchShot(shot.id, {
        videoStatus: "failed",
        videoError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function generateAllVideos() {
    const queue = uiShots.filter(
      (s) =>
        s.imageApproval === "approved" &&
        s.imageUrl &&
        s.videoStatus !== "generating" &&
        s.videoStatus !== "ready",
    );
    if (queue.length === 0) return;
    setPipelineError(null);
    try {
      const prompts = await writeVideoPrompts(queue);
      await Promise.all(
        queue.map((s, i) => generateVideoForShot(s, prompts[i] ?? "")),
      );
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    }
  }

  async function regenerateVideo(shotId: string, feedback?: string) {
    const target = uiShots.find((s) => s.id === shotId);
    if (!target || !target.imageUrl) return;
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
      const url = await callVideoModel(finalPrompt, target.imageUrl);
      patchShot(shotId, { videoStatus: "ready", videoUrl: url });
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
                    disabled={uiShots.length === 0}
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
                      disabled={imagesApprovedCount === 0}
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
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
                                <div className="flex gap-1 mt-3" onClick={(e) => e.stopPropagation()}>
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
                                  >
                                    <RefreshCw size={9} /> Regen
                                  </button>
                                  <button
                                    onClick={() => setImageApproval(shot.id, "rejected")}
                                    className="py-1.5 px-2 rounded text-[9px] font-mono uppercase tracking-wider bg-rose-500/10 text-rose-400/70 border border-rose-500/20 hover:bg-rose-500/20 transition-all"
                                  >
                                    <X size={9} />
                                  </button>
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
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
                                <div className="flex gap-1 mt-3" onClick={(e) => e.stopPropagation()}>
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
                                  >
                                    <RefreshCw size={9} /> Regen
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
