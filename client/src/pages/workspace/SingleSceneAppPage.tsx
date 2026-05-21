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
  AlertTriangle, Plus, Trash2, Download, User, Upload, Wand2,
} from "lucide-react";
import {
  listProducts, getProductMechanism,
  listCharacters, createCharacter, deleteCharacter,
  generateSingleSceneImagePrompts, generateCharacterBrollVideoPrompts,
  generateImage, generateText, generateVideo, saveBrandAssets,
  ApiCallError,
  type Product, type ProductMechanism, type CharacterRef,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { downloadViaBlob } from "@/lib/download";

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

  // Detect Gemini-classifier rejection from the server (route returns 422 +
  // errorCode "content_safety_rejected"). Backstop on raw fal message in
  // case the typed error is missing.
  function isContentSafetyRejection(err: unknown): boolean {
    if (err instanceof ApiCallError) {
      if (err.status === 422) return true;
      if (err.errorCode === "content_safety_rejected") return true;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return /did not generate the expected output|unsafe content|content policy/i.test(msg);
  }

  async function callImageModel(scene: UiScene, prompt: string, extraRefs: string[] = []): Promise<string> {
    const baseRefs = collectImageRefs(scene, prompt);
    const imageUrls = Array.from(new Set([...extraRefs, ...baseRefs]));
    const model = imageUrls.length > 0 ? IMAGE_MODEL_ID : "fal-ai/flux-pro/v1.1";

    const buildInput = (p: string): Record<string, unknown> =>
      imageUrls.length > 0
        ? { prompt: p, image_urls: imageUrls, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" }
        : { prompt: p, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" };

    try {
      const res = await generateImage("single_scene_image", { input: buildInput(prompt), model });
      const url = res.urls[0];
      if (!url) throw new Error("No image URL returned");
      return url;
    } catch (err) {
      if (!isContentSafetyRejection(err)) throw err;
      // First attempt rejected by Gemini safety. Sanitize via the dedicated
      // rewrite prompt (Haiku, ~5-8s) and retry once. Most body-image /
      // clothing-fit prompts pass after softening "bra"→"fitted top",
      // dropping body-anatomy + struggle combos, and reframing the emotional
      // beat through face / posture instead of clothing-against-body.
      console.warn("[single-scene] content-safety rejection — sanitizing and retrying once");
      const rewrite = await generateText("image_prompt_safety_rewrite", { original_prompt: prompt });
      const sanitized = rewrite.text.trim();
      if (!sanitized) throw err;
      const res = await generateImage("single_scene_image", { input: buildInput(sanitized), model });
      const url = res.urls[0];
      if (!url) throw new Error("No image URL returned (after safety rewrite)");
      return url;
    }
  }

  async function generateImageForScene(scene: UiScene, prompt: string) {
    patchShot(scene.id, { imageStatus: "generating", imageError: undefined, imagePrompt: prompt });
    try {
      const url = await callImageModel(scene, prompt);
      patchShot(scene.id, { imageStatus: "ready", imageUrl: url });
    } catch (err) {
      const friendly = isContentSafetyRejection(err)
        ? "The image model rejected this prompt as potentially unsafe even after auto-softening the language. Try regenerating with feedback — soften wardrobe terms (e.g. 'bra' → 'fitted top'), avoid describing body parts pressing against clothing, and keep the emotional beat on the face / posture rather than on clothing struggle."
        : (err instanceof Error ? err.message : String(err));
      patchShot(scene.id, { imageStatus: "failed", imageError: friendly });
    }
  }

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
    if (queue.length === 0) return;
    setPipelineError(null);
    try {
      const prompts = await writeImagePrompts(queue);
      await Promise.all(queue.map((s, i) => generateImageForScene(s, prompts[i] ?? "")));
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
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
    const target = uiShots.find((s) => s.id === sceneId);
    if (!target) return;
    setPipelineError(null);
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
        const refs: string[] = [target.imageUrl];
        if (characterImageUrl && characterImageUrl !== target.imageUrl) refs.push(characterImageUrl);
        if (selectedProduct && promptReferencesProduct(target.imagePrompt ?? target.description)) {
          for (const u of collectProductImageUrls()) {
            if (!refs.includes(u)) refs.push(u);
          }
        }
        const res = await generateImage("character_broll_image_feedback", {
          vars: { feedback: feedbackText },
          input: { image_urls: refs, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" },
          model: "fal-ai/nano-banana-pro/edit",
        });
        const newUrl = res.urls[0];
        if (!newUrl) throw new Error("No image URL returned");
        patchShot(sceneId, { imageStatus: "ready", imageUrl: newUrl });
        return;
      }
      let basePrompt = target.imagePrompt;
      if (!basePrompt) {
        const [written] = await writeImagePrompts([target]);
        basePrompt = written ?? "";
      }
      patchShot(sceneId, { imagePrompt: basePrompt });
      const url = await callImageModel(target, basePrompt, []);
      patchShot(sceneId, { imageStatus: "ready", imageUrl: url });
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

  async function callVideoModel(scene: UiScene, prompt: string, imageUrl: string): Promise<string> {
    const productUrls = collectProductImageUrls();
    const wantsProduct = productUrls.length > 0 && promptReferencesProduct(prompt);
    const input: Record<string, unknown> = {
      prompt,
      start_image_url: imageUrl,
      duration: "5",
      // Audio off: we never use the generated audio. Drops Kling v3 cost from
      // $0.126/s → $0.084/s (~33%) and shaves time off generation.
      generate_audio: false,
    };
    if (wantsProduct) {
      input.elements = [
        {
          reference_image_urls: productUrls,
          frontal_image_url: selectedProduct?.productImageUrl ?? productUrls[0],
        },
      ];
    }
    const res = await generateVideo("single_scene_video", {
      input,
      // Standard tier (~40% faster + ~33% cheaper than /pro). Combined with
      // generate_audio:false above, this is the cost/speed sweet spot for
      // first-draft review. Swap back to /pro for final-delivery quality.
      model: "fal-ai/kling-video/v3/standard/image-to-video",
    });
    const url = res.urls[0];
    if (!url) throw new Error("No video URL returned");
    return url;
  }

  async function generateVideoForScene(scene: UiScene, prompt: string) {
    if (!scene.imageUrl) return;
    patchShot(scene.id, { videoStatus: "generating", videoError: undefined, videoPrompt: prompt });
    try {
      const url = await callVideoModel(scene, prompt, scene.imageUrl);
      patchShot(scene.id, { videoStatus: "ready", videoUrl: url });
    } catch (err) {
      patchShot(scene.id, { videoStatus: "failed", videoError: err instanceof Error ? err.message : String(err) });
    }
  }

  async function generateAllVideos() {
    const approved = uiShots.filter((s) => s.imageApproval === "approved" && s.imageUrl);
    const queue = approved.filter((s) => s.videoStatus === "idle" || s.videoStatus === "failed");
    if (queue.length === 0) return;
    setPipelineError(null);
    try {
      const prompts = await writeVideoPrompts(queue);
      await Promise.all(queue.map((s, i) => generateVideoForScene(s, prompts[i] ?? "")));
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    }
  }

  async function regenerateVideo(sceneId: string, feedback?: string) {
    const target = uiShots.find((s) => s.id === sceneId);
    if (!target || !target.imageUrl) return;
    setPipelineError(null);
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
      const url = await callVideoModel(target, finalPrompt, target.imageUrl);
      patchShot(sceneId, { videoStatus: "ready", videoUrl: url });
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
                    disabled={!setupReady || generating}
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
                        disabled={imagesApproved === 0}
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
