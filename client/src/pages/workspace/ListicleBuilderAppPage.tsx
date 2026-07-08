/**
 * Listicle Builder — generates a listicle (or accepts a pasted one),
 * generates images per section, renders an HTML lander, and deploys to
 * LanderLab. Five steps:
 *
 *   0. Mode picker (Generate from scratch / Have a listicle already)
 *   1. Configure — product + angle (gen mode) + language + destination URL +
 *      optional guidance, or product + destination URL + pasted markdown
 *   2. Confirm copy — markdown preview + edit
 *   3. Images — one card per numbered section. Approve / Regen / Regen w/ Feedback.
 *   4. Render + Deploy — iframe preview of the rendered HTML, then deploy
 *      to LanderLab. Output: Published URL + Preview URL + Editor URL.
 *
 * Reuses patterns from CopyEngineAppPage (mode picker, product/angle/language
 * pickers, markdown render) and SingleSceneAppPage (per-image
 * approve/regen/feedback card UI, Approve All).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { marked } from "marked";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BadgePercent, Check, ChevronDown, Copy, Edit3,
  ExternalLink, FileText, Film, Globe, Image as ImageIcon, Loader2, MessageSquare, Package,
  Pencil, RefreshCw, Send, Sparkles, TrendingUp, Upload, Wand2, X,
} from "lucide-react";
import {
  listProducts,
  createListicle, getListicle, patchListicle, extractListicleOffer, analyzeListicleAd,
  generateListicleCopy, generateListicleImagePrompts, generateListicleImage,
  patchListicleImage, renderListicleHtml, deployListicle,
  type Product, type ProductAngle, type ListicleRow, type ListicleImageRow,
  type WinningAdAnalysis,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { Card, Dropdown, DropdownItem, ErrorRow } from "@/components/FormBits";

const STEPS = ["Setup", "Copy", "Images", "Deploy"];

type Mode = "generate" | "paste" | "winning_ad";

// MIME prefixes accepted by the "winning ad" file picker. Anything else
// gets rejected at the input level + server.
const WINNING_AD_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-m4v,image/jpeg,image/png,image/webp";

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "nl", label: "Nederlands", flag: "🇳🇱" },
];

function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

export default function ListicleBuilderAppPage() {
  const { activeBrandId } = useBrand();

  const [currentStep, setCurrentStep] = useState(0);

  // ── Mode ──
  const [mode, setMode] = useState<Mode | null>(null);

  // ── Setup state ──
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  const [selectedAngleName, setSelectedAngleName] = useState("");
  const [angleDropdownOpen, setAngleDropdownOpen] = useState(false);
  const [customAngle, setCustomAngle] = useState("");
  const [useCustomAngle, setUseCustomAngle] = useState(false);

  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  const [destinationUrl, setDestinationUrl] = useState("");
  // Tracks the product URL the destinationUrl field was last auto-prefilled
  // from. We only overwrite the field when (a) it's still empty, OR (b) it
  // still matches a previous prefill — so a user who manually typed their
  // own destination doesn't lose it when they switch products.
  const lastPrefilledProductUrl = useRef<string>("");
  const [guidance, setGuidance] = useState("");
  const [pastedCopy, setPastedCopy] = useState("");

  // ── Winning-ad mode state ──
  // Mirror of the file the user selected in the upload input. We keep it
  // around just for the filename/size preview — once they click "Analyze",
  // it gets base64-encoded and uploaded immediately.
  const [winningAdFile, setWinningAdFile] = useState<File | null>(null);
  // Once analysis returns, the resulting WinningAdAnalysis is held here
  // and rendered as editable fields. Saved back to the row via
  // patchListicle so the generate-copy step picks up the user's edits.
  const [winningAdAnalysis, setWinningAdAnalysis] = useState<WinningAdAnalysis | null>(null);
  // The fal.storage URL of the uploaded ad — used to render a preview
  // (video <video> tag or <img>) in the analysis review card.
  const [winningAdUrl, setWinningAdUrl] = useState<string | null>(null);
  const [winningAdType, setWinningAdType] = useState<"video" | "static" | null>(null);
  const [winningAdTranscript, setWinningAdTranscript] = useState<string | null>(null);
  const [analyzingAd, setAnalyzingAd] = useState(false);
  const [adAnalysisError, setAdAnalysisError] = useState<string | null>(null);
  // Track the listicle id we created at "Analyze" time so the subsequent
  // "Generate listicle copy" click reuses it (instead of creating a new row).
  const [pendingListicleId, setPendingListicleId] = useState<string | null>(null);

  // ── Pipeline state ──
  const [listicle, setListicle] = useState<ListicleRow | null>(null);
  const [images, setImages] = useState<ListicleImageRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Copy editing
  const [editingCopy, setEditingCopy] = useState(false);
  const [copyDraft, setCopyDraft] = useState("");
  // "Regenerate with feedback" — the user opens a textarea, types
  // specific notes ("punch the angle harder on section 3", "drop the
  // medical jargon", etc.), and submits. The server passes the
  // feedback + the current draft into the listicle_copy prompt so the
  // model REVISES the existing copy rather than starting from scratch.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState("");

  // Images UX
  const [imageFeedbackOpen, setImageFeedbackOpen] = useState<Set<string>>(new Set());
  function toggleImageFeedback(id: string) {
    setImageFeedbackOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function closeImageFeedback(id: string) {
    setImageFeedbackOpen((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; });
  }
  const [feedbackInputs, setFeedbackInputs] = useState<Record<string, string>>({});

  // HTML render UX
  const [rendering, setRendering] = useState(false);
  const [htmlFeedback, setHtmlFeedback] = useState("");
  const [showHtmlFeedback, setShowHtmlFeedback] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{
    publishedUrl: string;
    previewUrl: string;
    editorUrl: string;
  } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // ── Load products ──
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
  const selectedProduct = researchedProducts.find((p) => p.id === selectedProductId) ?? null;
  const productAngles: ProductAngle[] = selectedProduct?.research?.angles ?? [];
  const selectedAngle = productAngles.find((a) => a.name === selectedAngleName) ?? null;
  const selectedLang = LANGUAGES.find((l) => l.code === selectedLanguage) ?? LANGUAGES[0];

  // Prefill the destination URL with the selected product's productUrl
  // when (a) the URL field is empty, OR (b) it still matches a previous
  // prefill. This way the offer extraction has a working URL by default
  // — every product page is the canonical "where this listicle sends
  // people". Users who paste their own destination URL keep it on
  // product switches.
  useEffect(() => {
    const productUrl = selectedProduct?.productUrl?.trim() ?? "";
    if (!productUrl) return;
    const current = destinationUrl.trim();
    if (current === "" || current === lastPrefilledProductUrl.current) {
      setDestinationUrl(productUrl);
      lastPrefilledProductUrl.current = productUrl;
    }
  }, [selectedProduct?.productUrl, destinationUrl]);

  // ── Helpers ──
  const setupReady =
    !!selectedProductId &&
    !!destinationUrl.trim() &&
    (mode === "paste"
      ? !!pastedCopy.trim()
      : mode === "winning_ad"
        ? !!winningAdAnalysis // analysis must be present + edited
        : true);

  function resetMode() {
    setMode(null);
    setListicle(null);
    setImages([]);
    setSelectedProductId("");
    setSelectedAngleName("");
    setUseCustomAngle(false);
    setCustomAngle("");
    setDestinationUrl("");
    setGuidance("");
    setPastedCopy("");
    setWinningAdFile(null);
    setWinningAdAnalysis(null);
    setWinningAdUrl(null);
    setWinningAdType(null);
    setWinningAdTranscript(null);
    setAnalyzingAd(false);
    setAdAnalysisError(null);
    setPendingListicleId(null);
    setEditingCopy(false);
    setCopyDraft("");
    setHtmlFeedback("");
    setShowHtmlFeedback(false);
    setDeployResult(null);
    setPipelineError(null);
    setCurrentStep(0);
  }

  async function refreshListicle(id: string) {
    const { listicle: l, images: imgs } = await getListicle(id);
    setListicle(l);
    setImages(imgs);
    return { l, imgs };
  }

  // Deep link from the dashboard: ?listicle=<id> reopens an existing listicle
  // (the dashboard projects listicle builds as read-only job rows). Reuses
  // refreshListicle — the page's existing loader — then seeds the wizard's
  // setup state from the row and lands on the furthest step the pipeline has
  // reached. Mount-only, matching the ?job= deep-link pattern in BrollAppPage.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("listicle");
    if (!id) return;
    void (async () => {
      try {
        const { l, imgs } = await refreshListicle(id);
        setMode(l.source);
        setSelectedProductId(l.productId);
        setSelectedLanguage(l.language || "en");
        if (l.destinationUrl) setDestinationUrl(l.destinationUrl);
        if (l.angleName) setSelectedAngleName(l.angleName);
        setCopyDraft(l.copyMarkdown ?? "");
        if (l.source === "winning_ad") {
          // Rehydrate the analysis-review state so setup renders complete if
          // the build never got past step 0.
          setPendingListicleId(l.id);
          setWinningAdAnalysis(l.winningAdAnalysis);
          setWinningAdUrl(l.winningAdUrl);
          setWinningAdType(l.winningAdType);
          setWinningAdTranscript(l.winningAdTranscript);
        }
        if (l.status === "deployed" && l.publishedUrl && l.previewUrl && l.editorUrl) {
          setDeployResult({ publishedUrl: l.publishedUrl, previewUrl: l.previewUrl, editorUrl: l.editorUrl });
        }
        setCurrentStep(
          l.status === "rendering" || l.status === "ready" || l.status === "deployed" ? 3
            : l.status === "images" || imgs.length > 0 ? 2
            : l.copyMarkdown ? 1
            : 0,
        );
      } catch (err) {
        setPipelineError(err instanceof Error ? err.message : String(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 0 → Step 1 (Setup → Confirm copy) ──
  // UX rule: jump to the destination step IMMEDIATELY, then run the slow
  // work in the background. The destination step's render handles the
  // "data not ready yet" case with a progress UI. This matches the user's
  // ask: "When clicking to generate, always jump to next screen and show
  // progress bar so user knows it's working and something is being
  // processed."
  /**
   * Winning-ad workflow: upload the user's selected ad file to the
   * server, which uploads it to fal.storage, transcribes (video) or
   * passes to Claude vision (static), and runs the angle-extract prompt.
   * We create the listicle row first so we have a stable id to attach
   * everything to — the subsequent "Generate listicle copy" click reuses
   * the same row instead of creating a new one.
   */
  async function handleAnalyzeAd() {
    if (!activeBrandId || !selectedProductId || !winningAdFile) return;
    setAnalyzingAd(true);
    setAdAnalysisError(null);
    setPipelineError(null);
    try {
      // 1) Create (or reuse) the listicle row with source="winning_ad".
      let listicleId = pendingListicleId;
      if (!listicleId) {
        const { listicle: created } = await createListicle({
          brandId: activeBrandId,
          productId: selectedProductId,
          source: "winning_ad",
          language: selectedLanguage,
          destinationUrl: destinationUrl.trim() || undefined,
        });
        listicleId = created.id;
        setPendingListicleId(created.id);
      }

      // 2) Encode file → dataUrl and ship to /analyze-ad.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(r.error);
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(winningAdFile);
      });

      const { adUrl, adType, transcript, analysis } = await analyzeListicleAd(listicleId, {
        dataUrl,
        filename: winningAdFile.name,
      });
      setWinningAdUrl(adUrl);
      setWinningAdType(adType);
      setWinningAdTranscript(transcript);
      setWinningAdAnalysis(analysis);
    } catch (err) {
      setAdAnalysisError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzingAd(false);
    }
  }

  /**
   * Save the user's edits to the winning-ad analysis back to the row, so
   * generate-copy reads the edited values (not the raw Claude output).
   * Debounced — every field change triggers a patch.
   */
  async function persistWinningAdAnalysis(next: WinningAdAnalysis) {
    setWinningAdAnalysis(next);
    if (!pendingListicleId) return;
    try {
      await patchListicle(pendingListicleId, { winningAdAnalysis: next });
    } catch {
      // Non-fatal — user can still continue; the generate-copy step will
      // fall back to whatever's persisted (possibly the un-edited version).
    }
  }

  async function handleGenerateOrPaste() {
    if (!setupReady || !activeBrandId) return;
    setGenerating(true);
    setPipelineError(null);
    try {
      const angle = useCustomAngle ? customAngle.trim() : selectedAngleName;
      // Winning-ad mode already created the listicle row at analyze time,
      // so we just patch it with the final setup fields and skip create.
      let created: ListicleRow;
      if (mode === "winning_ad" && pendingListicleId) {
        const { listicle: patched } = await patchListicle(pendingListicleId, {
          destinationUrl: destinationUrl.trim(),
          language: selectedLanguage,
          // The primary angle name from the analysis is already mirrored
          // onto angleName by the analyze-ad endpoint, but if the user
          // edited the name we re-mirror it here for safety.
          angleName: winningAdAnalysis?.primary_angle_name || undefined,
        });
        created = patched;
      } else {
        const { listicle: row } = await createListicle({
          brandId: activeBrandId,
          productId: selectedProductId,
          source: mode!,
          language: selectedLanguage,
          destinationUrl: destinationUrl.trim(),
          angleName: angle || undefined,
          guidance: guidance.trim() || undefined,
          copyMarkdown: mode === "paste" ? pastedCopy.trim() : undefined,
        });
        created = row;
      }
      setListicle(created);
      setImages([]);
      setCurrentStep(1); // ← jump immediately; the step 1 view shows progress while copy generates

      // Offer extraction runs async, no await
      void extractListicleOffer(created.id).then((r) => {
        setListicle((prev) => prev ? { ...prev, offerExtract: r.offer as Record<string, unknown> } : prev);
      }).catch(() => undefined);

      if (mode === "generate" || mode === "winning_ad") {
        const { copyMarkdown } = await generateListicleCopy(created.id);
        await refreshListicle(created.id);
        setCopyDraft(copyMarkdown);
      } else {
        setCopyDraft(pastedCopy.trim());
      }
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function regenerateCopy(feedback?: string) {
    if (!listicle) return;
    setGenerating(true);
    setPipelineError(null);
    try {
      const { copyMarkdown } = await generateListicleCopy(listicle.id, feedback ? { feedback } : {});
      await refreshListicle(listicle.id);
      setCopyDraft(copyMarkdown);
      // Close the feedback panel after a successful revise.
      if (feedback) {
        setFeedbackOpen(false);
        setFeedbackDraft("");
      }
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function saveCopyEdits() {
    if (!listicle) return;
    setGenerating(true);
    setPipelineError(null);
    try {
      await patchListicle(listicle.id, { copyMarkdown: copyDraft });
      await refreshListicle(listicle.id);
      setEditingCopy(false);
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  // ── Step 1 → Step 2 (Confirm copy → Images) ──
  // Same jump-then-work UX as the Step 0 → 1 transition. The images step
  // renders a "creating image prompts..." placeholder until the prompts
  // come back, then shows the per-image cards in their generating state.
  async function advanceToImages() {
    if (!listicle) return;
    setGenerating(true);
    setPipelineError(null);
    setImages([]); // clear so the step 2 view shows the "preparing prompts" loader
    setCurrentStep(2); // ← jump immediately
    try {
      const { images: created } = await generateListicleImagePrompts(listicle.id);
      setImages(created);
      // Fire all image generations in parallel — each card updates itself
      // via setImages on completion so the user sees them stream in.
      await Promise.all(created.map((img) => generateOneImage(img.id)));
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function generateOneImage(imageId: string, feedback?: string) {
    if (!listicle) return;
    setImages((prev) =>
      prev.map((i) => i.id === imageId ? { ...i, imageStatus: "generating", imageError: null } : i),
    );
    try {
      const { image } = await generateListicleImage(listicle.id, imageId, feedback);
      setImages((prev) => prev.map((i) => i.id === imageId ? image : i));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImages((prev) =>
        prev.map((i) => i.id === imageId ? { ...i, imageStatus: "failed", imageError: msg } : i),
      );
    }
  }

  async function setImageApproval(imageId: string, approval: "approved" | "rejected" | "pending") {
    if (!listicle) return;
    try {
      const { image } = await patchListicleImage(listicle.id, imageId, { imageApproval: approval });
      setImages((prev) => prev.map((i) => i.id === imageId ? image : i));
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    }
  }

  function approveAllReady() {
    images.filter((i) => i.imageStatus === "ready" && i.imageApproval !== "approved")
      .forEach((i) => void setImageApproval(i.id, "approved"));
  }

  // Bulk-fire generate for every section that's idle or failed, in parallel.
  // This mirrors the B-roll page's Promise.all pattern — instead of waiting
  // 15-25s × N sections sequentially, all section gens happen concurrently
  // and the whole batch returns in ~25-30s regardless of section count.
  // Already-ready images aren't regenerated; user can use per-card "Regen"
  // for that.
  async function generateAllPending() {
    if (!listicle) return;
    const pending = images.filter(
      (i) => i.imageStatus !== "ready" && i.imageStatus !== "generating",
    );
    if (pending.length === 0) return;
    await Promise.all(pending.map((i) => generateOneImage(i.id)));
  }

  // ── Step 2 → Step 3 (Images → Deploy) ──
  // Same jump-then-work UX. The deploy step shows the "Rendering full
  // HTML page..." placeholder until renderListicleHtml resolves.
  async function advanceToDeploy() {
    if (!listicle) return;
    setRendering(true);
    setPipelineError(null);
    setShowHtmlFeedback(false);
    // Clear any prior renderedHtml so the step 3 view doesn't briefly show
    // the OLD render before the new one is ready.
    setListicle((prev) => prev ? { ...prev, renderedHtml: null } : prev);
    setCurrentStep(3); // ← jump immediately
    try {
      if (htmlFeedback.trim()) {
        await patchListicle(listicle.id, { htmlFeedback: htmlFeedback.trim() });
      }
      await renderListicleHtml(listicle.id);
      await refreshListicle(listicle.id);
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }

  async function regenerateHtmlWithFeedback() {
    if (!listicle || !htmlFeedback.trim()) return;
    setRendering(true);
    setPipelineError(null);
    try {
      await patchListicle(listicle.id, { htmlFeedback: htmlFeedback.trim() });
      await renderListicleHtml(listicle.id);
      await refreshListicle(listicle.id);
      setShowHtmlFeedback(false);
      setHtmlFeedback("");
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }

  // Plain re-render — no feedback, just re-run the HTML render with the
  // FRESHEST possible offer data + the current prompt template. Used
  // when the prompt template or the extract-offer logic has been
  // updated server-side and the user wants to retry without typing.
  //
  // Order matters: we re-run extract-offer FIRST so the discount %,
  // free-gift list, scarcity, etc. all reflect the latest fact-checked
  // Shopify data. Then re-render the HTML on top of the refreshed
  // offer.
  async function regenerateHtmlFresh() {
    if (!listicle) return;
    setRendering(true);
    setPipelineError(null);
    setShowHtmlFeedback(false);
    setListicle((prev) => prev ? { ...prev, renderedHtml: null } : prev);
    try {
      await patchListicle(listicle.id, { htmlFeedback: "" });
      // Re-fetch the offer from the destination URL so stale fields
      // (like a hallucinated discount %) get corrected. Tolerated as
      // best-effort — if it fails, we still render with whatever's
      // already in the row.
      try {
        if (listicle.destinationUrl) {
          await extractListicleOffer(listicle.id);
        }
      } catch (err) {
        console.warn("[regen] extract-offer refresh failed (non-fatal):", err);
      }
      await renderListicleHtml(listicle.id);
      await refreshListicle(listicle.id);
      setHtmlFeedback("");
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }

  async function handleDeploy() {
    if (!listicle) return;
    setDeploying(true);
    setPipelineError(null);
    try {
      const result = await deployListicle(listicle.id);
      setDeployResult(result);
      await refreshListicle(listicle.id);
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeploying(false);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      // ignore clipboard failures
    }
  }

  // Derived counts for the images header
  const imagesReady = images.filter((i) => i.imageStatus === "ready").length;
  const imagesApproved = images.filter((i) => i.imageApproval === "approved").length;
  const imagesPending = images.filter(
    (i) => i.imageStatus !== "ready" && i.imageStatus !== "generating",
  ).length;
  const imagesGenerating = images.filter((i) => i.imageStatus === "generating").length;

  return (
    <div className="min-h-screen flex flex-col" style={{ color: "#E2E8F0" }}>
      {/* Top Bar */}
      <header className="h-12 border-b border-white/[0.06] flex items-center px-4 gap-4 shrink-0" style={{ background: "#0D0F12" }}>
        <Link href="/workspace/apps">
          <button className="flex items-center gap-2 text-white/40 hover:text-orange-400 transition-colors text-sm">
            <ArrowLeft size={14} />
            <span className="font-mono text-xs">APPS</span>
          </button>
        </Link>
        <div className="w-px h-5 bg-white/10" />
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-orange-500/20 flex items-center justify-center">
            <FileText size={12} className="text-orange-400" />
          </div>
          <span className="font-mono text-xs text-white/60 tracking-wider">LISTICLE BUILDER</span>
        </div>

        {mode && (
          <div className="ml-auto flex items-center gap-1">
            {STEPS.map((step, i) => (
              <button
                key={step}
                onClick={() => {
                  // Only allow jumping back, not forward
                  if (i < currentStep) setCurrentStep(i);
                }}
                disabled={i > currentStep}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ${
                  currentStep === i ? "text-orange-400 bg-orange-500/10" : i < currentStep ? "text-white/40 hover:text-white/70" : "text-white/20"
                }`}
              >
                <span className="opacity-50">{i + 1}</span>
                {step}
              </button>
            ))}
            <button
              onClick={resetMode}
              className="ml-2 px-2 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider text-white/30 hover:text-rose-400 transition-colors"
              title="Start over"
            >
              <X size={11} />
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-hidden" style={{ background: "#0A0B0E" }}>
        <main className="h-full overflow-auto">
          <AnimatePresence mode="wait">
            {/* Mode picker */}
            {!mode && (
              <motion.div key="mode" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-3xl mx-auto p-6 md:p-10">
                <h1 className="text-xl font-medium text-white/90 mb-2">Listicle Builder</h1>
                <p className="text-[12px] text-white/40 font-mono leading-relaxed mb-6">
                  Build a long-form advertorial-style listicle landing page. Generate the copy here or paste an existing one, then images and a full LanderLab page get rendered + deployed.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    onClick={() => setMode("generate")}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5 text-left hover:border-orange-500/40 hover:bg-white/[0.04] transition-all group"
                  >
                    <div className="flex items-start gap-3 mb-2">
                      <div className="w-9 h-9 rounded bg-orange-500/15 border border-orange-500/30 flex items-center justify-center shrink-0">
                        <Wand2 size={16} className="text-orange-400" />
                      </div>
                      <div>
                        <div className="text-sm text-white/90 font-medium">Generate a listicle</div>
                        <div className="text-[11px] font-mono text-white/40 mt-0.5">From product + angle</div>
                      </div>
                    </div>
                    <p className="text-[12px] text-white/55 leading-relaxed">
                      Pick a product, angle, and language. Claude writes the listicle. Then images and a full landing page get built.
                    </p>
                  </button>

                  <button
                    onClick={() => setMode("paste")}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5 text-left hover:border-orange-500/40 hover:bg-white/[0.04] transition-all group"
                  >
                    <div className="flex items-start gap-3 mb-2">
                      <div className="w-9 h-9 rounded bg-orange-500/15 border border-orange-500/30 flex items-center justify-center shrink-0">
                        <Edit3 size={16} className="text-orange-400" />
                      </div>
                      <div>
                        <div className="text-sm text-white/90 font-medium">I have a listicle copy</div>
                        <div className="text-[11px] font-mono text-white/40 mt-0.5">Paste your own markdown</div>
                      </div>
                    </div>
                    <p className="text-[12px] text-white/55 leading-relaxed">
                      You already wrote the listicle. Paste it in. Images and the lander get built around it.
                    </p>
                  </button>

                  <button
                    onClick={() => setMode("winning_ad")}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5 text-left hover:border-orange-500/40 hover:bg-white/[0.04] transition-all group"
                  >
                    <div className="flex items-start gap-3 mb-2">
                      <div className="w-9 h-9 rounded bg-orange-500/15 border border-orange-500/30 flex items-center justify-center shrink-0">
                        <TrendingUp size={16} className="text-orange-400" />
                      </div>
                      <div>
                        <div className="text-sm text-white/90 font-medium">Build for a winning ad</div>
                        <div className="text-[11px] font-mono text-white/40 mt-0.5">Upload an ad → tied post-click</div>
                      </div>
                    </div>
                    <p className="text-[12px] text-white/55 leading-relaxed">
                      Upload your scaling video or static ad. Inana transcribes, extracts the angle, and writes a listicle whose first sections continue the ad's exact message.
                    </p>
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 0 — Setup */}
            {mode && currentStep === 0 && (
              <motion.div key="setup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-3xl mx-auto p-6 md:p-10 space-y-5">
                <div>
                  <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Step 1</div>
                  <h1 className="text-xl font-medium text-white/90">{mode === "generate" ? "Configure & generate" : mode === "paste" ? "Configure & paste" : "Configure & analyze ad"}</h1>
                </div>

                {pipelineError && <ErrorRow message={pipelineError} />}

                {/* Product */}
                <Card label="1 — Product" required>
                  {productsError ? (
                    <div className="text-[11px] text-rose-400 font-mono flex items-center gap-2"><AlertTriangle size={11} /> {productsError}</div>
                  ) : (
                    <Dropdown
                      open={productDropdownOpen}
                      setOpen={setProductDropdownOpen}
                      icon={<Package size={14} className="text-orange-400" />}
                      label={selectedProduct?.name ?? "Pick a researched product"}
                      sublabel={selectedProduct?.category ?? (productsLoading ? "Loading..." : "Need a product with completed research")}
                      thumb={selectedProduct?.productImageUrl}
                    >
                      {researchedProducts.map((p) => (
                        <DropdownItem
                          key={p.id}
                          onClick={() => { setSelectedProductId(p.id); setProductDropdownOpen(false); setSelectedAngleName(""); setUseCustomAngle(false); }}
                          selected={selectedProductId === p.id}
                          thumb={p.productImageUrl}
                          label={p.name}
                          sublabel={p.category}
                        />
                      ))}
                      {researchedProducts.length === 0 && !productsLoading && (
                        <div className="px-3 py-2 text-[11px] text-white/30 font-mono">No researched products yet. Add one in the Products tab.</div>
                      )}
                    </Dropdown>
                  )}
                </Card>

                {/* Angle — generate mode only */}
                {mode === "generate" && selectedProduct && (
                  <Card label="2 — Strategic angle" required>
                    {productAngles.length > 0 ? (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {productAngles.map((a, i) => (
                          <button
                            key={i}
                            onClick={() => { setUseCustomAngle(false); setSelectedAngleName(a.name); }}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-mono border transition-all ${!useCustomAngle && selectedAngleName === a.name ? "bg-orange-500/20 text-orange-300 border-orange-500/40" : "bg-white/[0.03] text-white/50 border-white/[0.08] hover:text-white/80"}`}
                          >
                            {a.name}
                          </button>
                        ))}
                        <button
                          onClick={() => { setUseCustomAngle(true); setSelectedAngleName(""); }}
                          className={`px-3 py-1.5 rounded-full text-[11px] font-mono border transition-all flex items-center gap-1 ${useCustomAngle ? "bg-orange-500/20 text-orange-300 border-orange-500/40" : "bg-white/[0.03] text-white/50 border-dashed border-white/[0.12] hover:text-white/80"}`}
                        >
                          + Custom
                        </button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/30 font-mono mb-3">No pre-researched angles. Write a custom one below.</p>
                    )}
                    {(useCustomAngle || productAngles.length === 0) && (
                      <textarea
                        rows={3}
                        value={customAngle}
                        onChange={(e) => setCustomAngle(e.target.value)}
                        placeholder="e.g. The cortisol-driven belly fat angle — for dad-bod men over 40 who can't shift visceral fat..."
                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none font-mono leading-relaxed resize-y"
                      />
                    )}
                    {!useCustomAngle && selectedAngle && (
                      <div className="rounded-md border border-white/[0.06] bg-black/30 p-3 text-[11px] text-white/60 font-mono leading-relaxed whitespace-pre-wrap max-h-40 overflow-auto">
                        {selectedAngle.block}
                      </div>
                    )}
                  </Card>
                )}

                {/* Destination URL */}
                <Card label={`${mode === "generate" ? "3" : "2"} — Destination URL`} required hint='Where the listicle CTA clicks send people. We also extract the offer terms from this URL automatically.'>
                  <div className="flex items-center gap-2 rounded border border-white/[0.08] bg-white/[0.03] px-3 focus-within:border-orange-500/40 transition-colors">
                    <Globe size={13} className="text-white/40" />
                    <input
                      type="url"
                      value={destinationUrl}
                      onChange={(e) => setDestinationUrl(e.target.value)}
                      placeholder="https://wellbe.com/products/collafe?utm_source=listicle"
                      className="flex-1 bg-transparent py-2 text-sm text-white/85 placeholder:text-white/25 outline-none"
                    />
                  </div>
                </Card>

                {/* Language */}
                <Card label={`${mode === "generate" ? "4" : "3"} — Language`}>
                  <Dropdown
                    open={langDropdownOpen}
                    setOpen={setLangDropdownOpen}
                    icon={<span className="text-base">{selectedLang.flag}</span>}
                    label={selectedLang.label}
                    sublabel="Output language for the entire listicle + page"
                  >
                    {LANGUAGES.map((l) => (
                      <DropdownItem
                        key={l.code}
                        onClick={() => { setSelectedLanguage(l.code); setLangDropdownOpen(false); }}
                        selected={selectedLanguage === l.code}
                        label={`${l.flag}  ${l.label}`}
                      />
                    ))}
                  </Dropdown>
                </Card>

                {/* Mode-specific extras */}
                {mode === "generate" && (
                  <Card label={`5 — Optional guidance`}>
                    <textarea
                      rows={3}
                      value={guidance}
                      onChange={(e) => setGuidance(e.target.value)}
                      placeholder="Optional. e.g. 'Open with a Cambridge research hook.' or 'Lean into pharma-skeptical framing.'"
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none font-mono leading-relaxed resize-y"
                    />
                  </Card>
                )}
                {mode === "paste" && (
                  <Card label={`4 — Paste your listicle (Markdown)`} required>
                    <textarea
                      rows={10}
                      value={pastedCopy}
                      onChange={(e) => setPastedCopy(e.target.value)}
                      placeholder="Paste the listicle markdown here — must include the H1 and numbered ### N. Headline sections."
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none font-mono leading-relaxed resize-y"
                    />
                  </Card>
                )}

                {/* Winning-ad workflow: upload + analysis preview ─────── */}
                {mode === "winning_ad" && (
                  <>
                    <Card
                      label={`4 — Upload the winning ad`}
                      required
                      hint="MP4/MOV video or JPG/PNG static. Inana transcribes audio (videos) or reads the image (statics), then extracts the angle so the listicle continues your ad's exact message."
                    >
                      {!winningAdFile && !winningAdAnalysis && (
                        <label className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.04] hover:border-orange-500/40 px-4 py-8 cursor-pointer transition-all">
                          <Upload size={20} className="text-white/40" />
                          <div className="text-[12px] text-white/70 font-medium">Pick a video or image</div>
                          <div className="text-[10px] text-white/30 font-mono">.mp4 · .mov · .jpg · .png · up to ~50MB</div>
                          <input
                            type="file"
                            accept={WINNING_AD_ACCEPT}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) setWinningAdFile(file);
                            }}
                          />
                        </label>
                      )}
                      {winningAdFile && !winningAdAnalysis && (
                        <div className="rounded border border-white/[0.08] bg-white/[0.03] p-3">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div className="flex items-center gap-2 min-w-0">
                              {winningAdFile.type.startsWith("video/") ? (
                                <Film size={14} className="text-orange-400 shrink-0" />
                              ) : (
                                <ImageIcon size={14} className="text-orange-400 shrink-0" />
                              )}
                              <div className="text-[12px] text-white/85 truncate">{winningAdFile.name}</div>
                              <div className="text-[10px] text-white/30 font-mono shrink-0">
                                {(winningAdFile.size / (1024 * 1024)).toFixed(1)} MB
                              </div>
                            </div>
                            <button
                              onClick={() => setWinningAdFile(null)}
                              className="text-[10px] text-white/40 hover:text-rose-400 font-mono uppercase tracking-wider"
                              disabled={analyzingAd}
                            >
                              Remove
                            </button>
                          </div>
                          {adAnalysisError && <ErrorRow message={adAnalysisError} />}
                          <button
                            onClick={() => void handleAnalyzeAd()}
                            disabled={analyzingAd || !selectedProductId}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border bg-orange-500/15 text-orange-300 border-orange-500/40 hover:bg-orange-500/25 transition-all text-[12px] font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            {analyzingAd ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                            {analyzingAd
                              ? winningAdFile.type.startsWith("video/")
                                ? "Transcribing audio + extracting angle..."
                                : "Reading the ad + extracting angle..."
                              : "Analyze ad"}
                          </button>
                          {!selectedProductId && (
                            <p className="text-[10px] text-amber-400/80 font-mono mt-2">Pick a product first.</p>
                          )}
                        </div>
                      )}
                      {winningAdAnalysis && winningAdUrl && (
                        <div className="space-y-3">
                          <div className="rounded border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2 flex items-center gap-2">
                            <Check size={12} className="text-emerald-400" />
                            <span className="text-[11px] text-emerald-300 font-mono">
                              Ad analyzed · {winningAdType === "video" ? "transcribed + extracted" : "vision-read + extracted"}
                            </span>
                            <button
                              onClick={() => {
                                setWinningAdAnalysis(null);
                                setWinningAdUrl(null);
                                setWinningAdType(null);
                                setWinningAdTranscript(null);
                              }}
                              className="ml-auto text-[10px] text-white/40 hover:text-white/80 font-mono uppercase tracking-wider"
                            >
                              Re-upload
                            </button>
                          </div>
                          {/* Ad preview */}
                          <div className="rounded overflow-hidden border border-white/[0.08] bg-black">
                            {winningAdType === "video" ? (
                              <video src={winningAdUrl} controls className="w-full max-h-72 object-contain bg-black" />
                            ) : (
                              <img src={winningAdUrl} alt="Uploaded ad" className="w-full max-h-72 object-contain bg-black" />
                            )}
                          </div>
                        </div>
                      )}
                    </Card>

                    {winningAdAnalysis && (
                      <Card
                        label={`5 — Review the extracted angle`}
                        required
                        hint="Edit any field if Claude misread the ad. These values prime the opening of your listicle so it continues the ad's exact conversation."
                      >
                        <div className="space-y-3">
                          <AnalysisField
                            label="Primary angle name"
                            value={winningAdAnalysis.primary_angle_name ?? ""}
                            onChange={(v) => void persistWinningAdAnalysis({ ...winningAdAnalysis, primary_angle_name: v })}
                            placeholder="e.g. Pain-free mornings without painkillers"
                          />
                          <AnalysisField
                            label="Hook (first 5 seconds / above-the-fold)"
                            value={winningAdAnalysis.hook ?? ""}
                            onChange={(v) => void persistWinningAdAnalysis({ ...winningAdAnalysis, hook: v })}
                            placeholder="The line that makes the viewer stop scrolling"
                            multiline
                          />
                          <AnalysisField
                            label="Mechanism"
                            value={winningAdAnalysis.mechanism ?? ""}
                            onChange={(v) => void persistWinningAdAnalysis({ ...winningAdAnalysis, mechanism: v })}
                            placeholder="How the product is positioned to solve the problem"
                            multiline
                          />
                          <AnalysisField
                            label="Target pain"
                            value={winningAdAnalysis.target_pain ?? ""}
                            onChange={(v) => void persistWinningAdAnalysis({ ...winningAdAnalysis, target_pain: v })}
                            placeholder="The specific pain the ad hooks on, in the customer's voice"
                          />
                          <AnalysisListField
                            label="Key claims (one per line)"
                            values={winningAdAnalysis.key_claims ?? []}
                            onChange={(v) => void persistWinningAdAnalysis({ ...winningAdAnalysis, key_claims: v })}
                            placeholder="e.g. 87% improvement in clinical study"
                          />
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <AnalysisField
                              label="Tone"
                              value={winningAdAnalysis.tone ?? ""}
                              onChange={(v) => void persistWinningAdAnalysis({ ...winningAdAnalysis, tone: v })}
                              placeholder="urgent, empathetic, science-led"
                            />
                            <AnalysisField
                              label="Creative format"
                              value={winningAdAnalysis.creative_format ?? ""}
                              onChange={(v) => void persistWinningAdAnalysis({ ...winningAdAnalysis, creative_format: v })}
                              placeholder="before/after, talking-head UGC, etc."
                            />
                          </div>
                          <AnalysisField
                            label="Plain-English summary"
                            value={winningAdAnalysis.summary ?? ""}
                            onChange={(v) => void persistWinningAdAnalysis({ ...winningAdAnalysis, summary: v })}
                            placeholder="One paragraph: what the ad says, who it's for, what action it asks for"
                            multiline
                            rows={4}
                          />
                          {winningAdType === "video" && winningAdTranscript && (
                            <details className="rounded border border-white/[0.06] bg-black/30">
                              <summary className="px-3 py-2 cursor-pointer text-[11px] font-mono text-white/40 hover:text-white/70">
                                Show full transcript ({winningAdTranscript.length} chars)
                              </summary>
                              <div className="px-3 pb-3 text-[12px] text-white/60 leading-relaxed whitespace-pre-wrap max-h-60 overflow-auto">
                                {winningAdTranscript}
                              </div>
                            </details>
                          )}
                        </div>
                      </Card>
                    )}
                  </>
                )}

                <div className="pt-2">
                  <button
                    onClick={() => void handleGenerateOrPaste()}
                    disabled={!setupReady || generating || (mode === "generate" && (!selectedAngleName && !customAngle.trim()))}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border bg-orange-500/15 text-orange-300 border-orange-500/40 hover:bg-orange-500/25 transition-all text-sm font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {generating
                      ? mode === "paste"
                        ? "Saving listicle..."
                        : "Writing your listicle..."
                      : mode === "generate"
                        ? "Generate listicle copy"
                        : mode === "winning_ad"
                          ? "Generate listicle tied to this ad"
                          : "Continue with this copy"}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 1 — Confirm copy */}
            {mode && currentStep === 1 && listicle && (
              <motion.div key="copy" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-4xl mx-auto p-6 md:p-10">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Step 2</div>
                    <h1 className="text-xl font-medium text-white/90">Confirm copy</h1>
                  </div>
                  <div className="flex items-center gap-2">
                    {!editingCopy ? (
                      <>
                        <button onClick={() => { setCopyDraft(listicle.copyMarkdown ?? ""); setEditingCopy(true); }} className="px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/60 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white/80 transition-all flex items-center gap-1.5">
                          <Pencil size={11} /> Edit
                        </button>
                        {mode === "generate" && (
                          <>
                            <button onClick={() => void regenerateCopy()} disabled={generating} className="px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/60 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white/80 transition-all flex items-center gap-1.5 disabled:opacity-30">
                              {generating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Regenerate
                            </button>
                            {listicle.copyMarkdown && (
                              <button
                                onClick={() => setFeedbackOpen((v) => !v)}
                                disabled={generating}
                                className={`px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider border transition-all flex items-center gap-1.5 disabled:opacity-30 ${
                                  feedbackOpen
                                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                    : "bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08] hover:text-white/80"
                                }`}
                              >
                                <MessageSquare size={11} /> {feedbackOpen ? "Hide feedback" : "Regenerate w/ feedback"}
                              </button>
                            )}
                          </>
                        )}
                        <button onClick={() => void advanceToImages()} disabled={generating || !listicle.copyMarkdown} className="px-4 py-2 rounded text-xs font-mono uppercase tracking-wider bg-orange-500/15 text-orange-300 border border-orange-500/40 hover:bg-orange-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30">
                          {generating ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />} Approve & continue
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setEditingCopy(false); setCopyDraft(""); }} className="px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/60 border border-white/[0.08] hover:bg-white/[0.08] transition-all">
                          Cancel
                        </button>
                        <button onClick={() => void saveCopyEdits()} disabled={generating} className="px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30">
                          {generating ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save edits
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {pipelineError && <ErrorRow message={pipelineError} />}

                {/* Regenerate-with-feedback panel. Opens above the copy
                    preview so the user can read the draft and write
                    notes side-by-side. Sending re-runs generate-copy
                    with the feedback + the current draft as a previous-
                    draft block, so the model revises rather than
                    restarts. */}
                {feedbackOpen && !editingCopy && listicle.copyMarkdown && (
                  <div className="max-w-3xl mx-auto mb-6 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-mono text-amber-300/80 uppercase tracking-widest flex items-center gap-1.5">
                        <MessageSquare size={11} /> Feedback for revision
                      </div>
                      <button
                        onClick={() => { setFeedbackOpen(false); setFeedbackDraft(""); }}
                        className="text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors uppercase tracking-wider"
                      >
                        Cancel
                      </button>
                    </div>
                    <textarea
                      value={feedbackDraft}
                      onChange={(e) => setFeedbackDraft(e.target.value)}
                      placeholder="What should change? e.g. 'Section 3 feels generic — tie it back to the jawline-cyst angle harder. Cut the medical jargon in section 7. Punchier H1.'"
                      rows={4}
                      className="w-full bg-black/30 border border-amber-500/20 rounded-md px-3 py-2 text-[13px] text-white/85 outline-none font-mono leading-relaxed resize-y placeholder:text-white/30"
                    />
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] font-mono text-white/30">
                        Sends your notes + the current draft back to Claude. Keeps everything you don't call out.
                      </span>
                      <button
                        onClick={() => void regenerateCopy(feedbackDraft.trim())}
                        disabled={generating || feedbackDraft.trim().length === 0}
                        className="px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-wider bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 transition-all flex items-center gap-1.5 disabled:opacity-30"
                      >
                        {generating ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Regenerate
                      </button>
                    </div>
                  </div>
                )}

                {editingCopy ? (
                  <textarea
                    value={copyDraft}
                    onChange={(e) => setCopyDraft(e.target.value)}
                    className="w-full min-h-[60vh] bg-white/[0.03] border border-white/[0.08] rounded-md px-4 py-3 text-[13px] text-white/85 outline-none font-mono leading-relaxed resize-y"
                  />
                ) : !listicle.copyMarkdown ? (
                  // Progress UI — the user just hit Generate, we jumped here
                  // immediately, and the copy is being written in the background.
                  // Matches the "jump-to-next + progress" UX rule.
                  <article className="prose-copy max-w-3xl mx-auto bg-white/[0.02] border border-white/[0.06] rounded-lg p-12 md:p-16 text-center">
                    <Loader2 size={28} className="animate-spin text-orange-400 mx-auto mb-4" />
                    <h2 className="text-base font-medium text-white/85 mb-2">Writing your listicle…</h2>
                    <p className="text-[12px] text-white/40 font-mono leading-relaxed max-w-md mx-auto">
                      Claude is reading the angle, the product research, and the offer details from your destination URL. This usually takes 30–60 seconds.
                    </p>
                    <div className="mt-6 max-w-md mx-auto h-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <div className="h-full w-1/3 bg-orange-400/60 animate-pulse" />
                    </div>
                  </article>
                ) : (
                  <article className="prose-copy max-w-3xl mx-auto bg-white/[0.02] border border-white/[0.06] rounded-lg p-6 md:p-8">
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(listicle.copyMarkdown) }} />
                  </article>
                )}
              </motion.div>
            )}

            {/* Step 2 — Images */}
            {mode && currentStep === 2 && listicle && (
              <motion.div key="images" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-7xl mx-auto p-6 md:p-10">
                <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                  <div>
                    <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Step 3</div>
                    <h1 className="text-xl font-medium text-white/90">Images</h1>
                    <p className="text-[11px] text-white/40 font-mono mt-1">
                      {imagesReady} ready · {imagesApproved} approved · {images.length} total
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void generateAllPending()}
                      disabled={imagesPending === 0 || imagesGenerating > 0}
                      className="flex items-center gap-1.5 px-3 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-orange-500/10 text-orange-300 border border-orange-500/20 hover:bg-orange-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {imagesGenerating > 0
                        ? <Loader2 size={10} className="animate-spin" />
                        : <Sparkles size={10} />}
                      Generate All ({imagesPending})
                    </button>
                    <button
                      onClick={approveAllReady}
                      disabled={imagesReady === 0 || imagesReady === imagesApproved}
                      className="flex items-center gap-1.5 px-3 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Check size={10} /> Approve All
                    </button>
                    <button
                      onClick={() => void advanceToDeploy()}
                      disabled={rendering || imagesApproved === 0}
                      className="px-4 py-2 rounded text-xs font-mono uppercase tracking-wider bg-orange-500/15 text-orange-300 border border-orange-500/40 hover:bg-orange-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {rendering ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                      Render lander ({imagesApproved})
                    </button>
                  </div>
                </div>

                {pipelineError && <ErrorRow message={pipelineError} />}

                {/* Progress UI — Step 1 → 2 transition jumps here immediately
                    while the image-prompt generator runs. Shows while the
                    image cards don't exist yet. Once the prompts come back,
                    the cards render in their per-card "generating" state. */}
                {images.length === 0 && generating ? (
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-12 md:p-16 text-center">
                    <Loader2 size={28} className="animate-spin text-orange-400 mx-auto mb-4" />
                    <h2 className="text-base font-medium text-white/85 mb-2">Preparing image prompts…</h2>
                    <p className="text-[12px] text-white/40 font-mono leading-relaxed max-w-md mx-auto">
                      Reading the listicle to figure out one image prompt per numbered section. Image generation kicks off automatically right after.
                    </p>
                    <div className="mt-6 max-w-md mx-auto h-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <div className="h-full w-1/3 bg-orange-400/60 animate-pulse" />
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {images.map((img) => (
                    <div key={img.id} className="rounded-lg overflow-hidden border border-white/[0.08] bg-white/[0.02]">
                      <div className="relative aspect-square bg-black/40 flex items-center justify-center">
                        {img.imageStatus === "ready" && img.imageUrl ? (
                          <img src={img.imageUrl} alt={img.sectionHeadline ?? ""} className="w-full h-full object-cover" />
                        ) : img.imageStatus === "generating" ? (
                          <div className="flex flex-col items-center gap-2 text-orange-400">
                            <Loader2 size={26} className="animate-spin" />
                            <span className="text-[10px] font-mono uppercase tracking-wider">Generating...</span>
                          </div>
                        ) : img.imageStatus === "failed" ? (
                          <div className="flex flex-col items-center gap-1 text-rose-400 px-3 text-center">
                            <AlertTriangle size={22} />
                            <span className="text-[9px] font-mono break-words">{img.imageError}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); void generateOneImage(img.id); }}
                              className="mt-1 text-[9px] font-mono text-orange-400 hover:underline"
                            >Retry</button>
                          </div>
                        ) : (
                          <ImageIcon size={32} className="text-white/20" />
                        )}
                        <div className="absolute top-2 left-2 text-[9px] font-mono text-white/60 bg-black/60 border border-white/10 px-1.5 py-0.5 rounded">
                          #{img.sectionIdx}
                        </div>
                        {img.imageApproval === "approved" && (
                          <div className="absolute top-2 right-2 px-2 py-0.5 rounded border bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px] font-mono uppercase tracking-wider">Approved</div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="text-[11px] text-white/70 line-clamp-2 leading-snug">{img.sectionHeadline}</div>
                        {img.imageStatus === "ready" && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1 mt-3">
                              <button
                                onClick={() => void setImageApproval(img.id, img.imageApproval === "approved" ? "pending" : "approved")}
                                className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${img.imageApproval === "approved" ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40" : "bg-emerald-500/10 text-emerald-400/70 border-emerald-500/20 hover:bg-emerald-500/20"}`}
                              >
                                <Check size={9} /> {img.imageApproval === "approved" ? "Approved" : "Approve"}
                              </button>
                              <button
                                onClick={() => void generateOneImage(img.id)}
                                className="flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-orange-500/10 text-orange-400/70 border border-orange-500/20 hover:bg-orange-500/20 transition-all flex items-center justify-center gap-1"
                                title="Regenerate — fresh take"
                              >
                                <RefreshCw size={9} /> Regen
                              </button>
                              <button
                                onClick={() => toggleImageFeedback(img.id)}
                                className={`flex-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider border transition-all flex items-center justify-center gap-1 ${imageFeedbackOpen.has(img.id) ? "bg-amber-500/20 text-amber-300 border-amber-500/40" : "bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]"}`}
                              >
                                <MessageSquare size={9} /> Feedback
                              </button>
                            </div>
                            {imageFeedbackOpen.has(img.id) && (
                              <div className="mt-2 space-y-1.5">
                                <textarea
                                  rows={3}
                                  value={feedbackInputs[img.id] ?? ""}
                                  onChange={(e) => setFeedbackInputs((p) => ({ ...p, [img.id]: e.target.value }))}
                                  placeholder="What should change? 'tighter crop', 'no text', 'warmer lighting'..."
                                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[10px] text-white/80 placeholder:text-white/25 outline-none resize-none font-mono leading-relaxed focus:border-amber-500/30"
                                  autoFocus
                                />
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => { const t = (feedbackInputs[img.id] ?? "").trim(); if (t) { closeImageFeedback(img.id); void generateOneImage(img.id, t); } }}
                                    disabled={!(feedbackInputs[img.id] ?? "").trim()}
                                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <RefreshCw size={9} /> Regen w/ Feedback
                                  </button>
                                  <button onClick={() => closeImageFeedback(img.id)} className="px-2 py-1.5 rounded text-[9px] font-mono uppercase tracking-wider bg-white/[0.03] text-white/50 border border-white/[0.08] hover:bg-white/[0.06] transition-all">
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
              </motion.div>
            )}

            {/* Step 3 — Render + Deploy */}
            {mode && currentStep === 3 && listicle && (
              <motion.div key="deploy" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-7xl mx-auto p-6 md:p-10">
                <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                  <div>
                    <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Step 4</div>
                    <h1 className="text-xl font-medium text-white/90">Preview & deploy</h1>
                    <p className="text-[11px] text-white/40 font-mono mt-1">{listicle.status === "deployed" ? "Lander deployed." : "Preview the lander, regenerate with feedback if needed, then deploy."}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void regenerateHtmlFresh()}
                      disabled={rendering || deploying}
                      title="Re-render the full HTML from scratch with the latest prompt + offer data"
                      className="px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider border transition-all flex items-center gap-1.5 bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {rendering ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Regenerate
                    </button>
                    <button onClick={() => setShowHtmlFeedback((p) => !p)} disabled={rendering || deploying} className={`px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider border transition-all flex items-center gap-1.5 ${showHtmlFeedback ? "bg-amber-500/20 text-amber-300 border-amber-500/40" : "bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]"}`}>
                      <MessageSquare size={11} /> Regenerate w/ Feedback
                    </button>
                    <button
                      onClick={() => void handleDeploy()}
                      disabled={deploying || !listicle.renderedHtml || listicle.status === "deployed"}
                      className="px-4 py-2 rounded text-xs font-mono uppercase tracking-wider bg-orange-500/15 text-orange-300 border border-orange-500/40 hover:bg-orange-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deploying ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                      {listicle.status === "deployed" ? "Deployed" : (deploying ? "Deploying..." : "Deploy & save to Assets")}
                    </button>
                  </div>
                </div>

                {pipelineError && <ErrorRow message={pipelineError} />}

                {showHtmlFeedback && (
                  <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-4 space-y-2">
                    <label className="text-[10px] font-mono text-amber-300 uppercase tracking-widest">Tell Claude what to change</label>
                    <textarea
                      rows={3}
                      value={htmlFeedback}
                      onChange={(e) => setHtmlFeedback(e.target.value)}
                      placeholder="e.g. 'Move the announcement bar to the very top.' or 'Make the hook callout more punchy.' or 'Drop the secondary CTA.'"
                      className="w-full bg-white/[0.03] border border-amber-500/30 rounded px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none resize-y font-mono leading-relaxed"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => void regenerateHtmlWithFeedback()} disabled={rendering || !htmlFeedback.trim()} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-40">
                        {rendering ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Re-render with feedback
                      </button>
                      <button onClick={() => { setShowHtmlFeedback(false); setHtmlFeedback(""); }} className="px-3 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.03] text-white/50 border border-white/[0.08] hover:bg-white/[0.06] transition-all">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Deploy result */}
                {deployResult && (
                  <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] p-4 space-y-2">
                    <div className="text-[10px] font-mono text-emerald-300 uppercase tracking-widest flex items-center gap-1.5">
                      <Check size={11} /> Deployed
                    </div>
                    <UrlRow label="Published" url={deployResult.publishedUrl} onCopy={() => void copyToClipboard(deployResult.publishedUrl)} copied={copiedUrl === deployResult.publishedUrl} />
                    <UrlRow label="Preview" url={deployResult.previewUrl} onCopy={() => void copyToClipboard(deployResult.previewUrl)} copied={copiedUrl === deployResult.previewUrl} />
                    <UrlRow label="Edit in LanderLab" url={deployResult.editorUrl} onCopy={() => void copyToClipboard(deployResult.editorUrl)} copied={copiedUrl === deployResult.editorUrl} />
                  </div>
                )}

                {/* iframe preview — two iframes side-by-side so the user
                    can review both breakpoints simultaneously. On wide
                    viewports (≥1280px) they sit horizontally; on narrow
                    viewports they stack. */}
                {listicle.renderedHtml ? (
                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_440px] gap-4">
                    {/* Desktop preview — full-width responsive iframe */}
                    <div className="flex flex-col gap-2 min-w-0">
                      <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-2">
                        <span>Desktop preview</span>
                        <span className="text-white/20">·</span>
                        <span className="text-white/30 normal-case">full-width responsive</span>
                      </div>
                      <div className="rounded-lg overflow-hidden border border-white/[0.08] bg-white">
                        <iframe
                          srcDoc={listicle.renderedHtml}
                          title="Listicle preview (desktop)"
                          className="w-full block"
                          style={{ minHeight: "80vh", border: 0 }}
                          sandbox="allow-same-origin allow-scripts"
                        />
                      </div>
                    </div>

                    {/* Mobile preview — constrained to 414px so the iframe's
                        internal CSS media queries trigger the mobile layout.
                        On xl screens this sits to the right of the desktop
                        view; on smaller screens it stacks below. Centered
                        in its grid cell so it looks like a phone frame. */}
                    <div className="flex flex-col gap-2 min-w-0">
                      <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-2">
                        <span>Mobile preview</span>
                        <span className="text-white/20">·</span>
                        <span className="text-white/30 normal-case">414 px wide</span>
                      </div>
                      <div className="rounded-lg overflow-hidden border border-white/[0.08] bg-white mx-auto" style={{ width: "100%", maxWidth: "414px" }}>
                        <iframe
                          srcDoc={listicle.renderedHtml}
                          title="Listicle preview (mobile)"
                          className="block"
                          style={{ width: "414px", minHeight: "80vh", border: 0 }}
                          sandbox="allow-same-origin allow-scripts"
                        />
                      </div>
                    </div>
                  </div>
                ) : rendering ? (
                  // Step 2 → 3 transition jumps here immediately, before the
                  // HTML is rendered. Big, friendly loader so the user
                  // doesn't think the deploy button was a no-op.
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-12 md:p-16 text-center">
                    <Loader2 size={28} className="animate-spin text-orange-400 mx-auto mb-4" />
                    <h2 className="text-base font-medium text-white/85 mb-2">Rendering full HTML page…</h2>
                    <p className="text-[12px] text-white/40 font-mono leading-relaxed max-w-md mx-auto">
                      Claude is composing the entire LanderLab page from your listicle copy, the approved images, brand colors, and the offer details. ~30–60 seconds.
                    </p>
                    <div className="mt-6 max-w-md mx-auto h-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <div className="h-full w-1/3 bg-orange-400/60 animate-pulse" />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-12 text-center text-white/40 font-mono text-sm">
                    No HTML rendered yet.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// ── Tiny shared sub-components ─────────────────────────────────────

function UrlRow({ label, url, onCopy, copied }: { label: string; url: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-white/40 font-mono uppercase tracking-wider w-32 shrink-0">{label}</span>
      <a href={url} target="_blank" rel="noreferrer" className="flex-1 text-white/80 font-mono truncate hover:text-orange-400 flex items-center gap-1">
        {url} <ExternalLink size={10} className="shrink-0" />
      </a>
      <button onClick={onCopy} className="p-1.5 rounded text-white/40 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all" title="Copy">
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  );
}

/**
 * Single editable field for the winning-ad analysis review step.
 * Wraps a labelled text input (or textarea) with the same dark-form
 * styling as the rest of the setup view.
 */
function AnalysisField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  return (
    <div>
      <label className="block text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1.5">{label}</label>
      {multiline ? (
        <textarea
          rows={rows ?? 2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none font-mono leading-relaxed resize-y focus:border-orange-500/40 transition-colors"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none font-mono leading-relaxed focus:border-orange-500/40 transition-colors"
        />
      )}
    </div>
  );
}

/**
 * Editable list-of-strings field — used for `key_claims`. The user
 * sees one line per claim, edits the textarea, and we split on newlines
 * back to an array. Empty lines are filtered.
 */
function AnalysisListField({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1.5">{label}</label>
      <textarea
        rows={Math.max(3, values.length + 1)}
        value={values.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
        placeholder={placeholder}
        className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none font-mono leading-relaxed resize-y focus:border-orange-500/40 transition-colors"
      />
    </div>
  );
}
