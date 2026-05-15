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
  ExternalLink, FileText, Globe, Image as ImageIcon, Loader2, MessageSquare, Package,
  Pencil, RefreshCw, Send, Sparkles, Wand2, X,
} from "lucide-react";
import {
  listProducts,
  createListicle, getListicle, patchListicle, extractListicleOffer,
  generateListicleCopy, generateListicleImagePrompts, generateListicleImage,
  patchListicleImage, renderListicleHtml, deployListicle,
  type Product, type ProductAngle, type ListicleRow, type ListicleImageRow,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";

const STEPS = ["Setup", "Copy", "Images", "Deploy"];

type Mode = "generate" | "paste";

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
  const [guidance, setGuidance] = useState("");
  const [pastedCopy, setPastedCopy] = useState("");

  // ── Pipeline state ──
  const [listicle, setListicle] = useState<ListicleRow | null>(null);
  const [images, setImages] = useState<ListicleImageRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Copy editing
  const [editingCopy, setEditingCopy] = useState(false);
  const [copyDraft, setCopyDraft] = useState("");

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

  // ── Helpers ──
  const setupReady =
    !!selectedProductId &&
    !!destinationUrl.trim() &&
    (mode === "paste" ? !!pastedCopy.trim() : true);

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

  // ── Step 0 → Step 1 (Setup → Confirm copy) ──
  // UX rule: jump to the destination step IMMEDIATELY, then run the slow
  // work in the background. The destination step's render handles the
  // "data not ready yet" case with a progress UI. This matches the user's
  // ask: "When clicking to generate, always jump to next screen and show
  // progress bar so user knows it's working and something is being
  // processed."
  async function handleGenerateOrPaste() {
    if (!setupReady || !activeBrandId) return;
    setGenerating(true);
    setPipelineError(null);
    try {
      const angle = useCustomAngle ? customAngle.trim() : selectedAngleName;
      const { listicle: created } = await createListicle({
        brandId: activeBrandId,
        productId: selectedProductId,
        source: mode!,
        language: selectedLanguage,
        destinationUrl: destinationUrl.trim(),
        angleName: angle || undefined,
        guidance: guidance.trim() || undefined,
        copyMarkdown: mode === "paste" ? pastedCopy.trim() : undefined,
      });
      setListicle(created);
      setImages([]);
      setCurrentStep(1); // ← jump immediately; the step 1 view shows progress while copy generates

      // Offer extraction runs async, no await
      void extractListicleOffer(created.id).then((r) => {
        setListicle((prev) => prev ? { ...prev, offerExtract: r.offer as Record<string, unknown> } : prev);
      }).catch(() => undefined);

      if (mode === "generate") {
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

  async function regenerateCopy() {
    if (!listicle) return;
    setGenerating(true);
    setPipelineError(null);
    try {
      const { copyMarkdown } = await generateListicleCopy(listicle.id);
      await refreshListicle(listicle.id);
      setCopyDraft(copyMarkdown);
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                </div>
              </motion.div>
            )}

            {/* Step 0 — Setup */}
            {mode && currentStep === 0 && (
              <motion.div key="setup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-3xl mx-auto p-6 md:p-10 space-y-5">
                <div>
                  <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Step 1</div>
                  <h1 className="text-xl font-medium text-white/90">{mode === "generate" ? "Configure & generate" : "Configure & paste"}</h1>
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
                {mode === "generate" ? (
                  <Card label={`5 — Optional guidance`}>
                    <textarea
                      rows={3}
                      value={guidance}
                      onChange={(e) => setGuidance(e.target.value)}
                      placeholder="Optional. e.g. 'Open with a Cambridge research hook.' or 'Lean into pharma-skeptical framing.'"
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none font-mono leading-relaxed resize-y"
                    />
                  </Card>
                ) : (
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

                <div className="pt-2">
                  <button
                    onClick={() => void handleGenerateOrPaste()}
                    disabled={!setupReady || generating || (mode === "generate" && (!selectedAngleName && !customAngle.trim()))}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border bg-orange-500/15 text-orange-300 border-orange-500/40 hover:bg-orange-500/25 transition-all text-sm font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {generating ? (mode === "generate" ? "Writing your listicle..." : "Saving listicle...") : (mode === "generate" ? "Generate listicle copy" : "Continue with this copy")}
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
                          <button onClick={() => void regenerateCopy()} disabled={generating} className="px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/60 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white/80 transition-all flex items-center gap-1.5 disabled:opacity-30">
                            {generating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Regenerate
                          </button>
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
                    <button onClick={() => setShowHtmlFeedback((p) => !p)} disabled={rendering || deploying} className={`px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider border transition-all flex items-center gap-1.5 ${showHtmlFeedback ? "bg-amber-500/20 text-amber-300 border-amber-500/40" : "bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]"}`}>
                      <MessageSquare size={11} /> Regenerate w/ Feedback
                    </button>
                    <button
                      onClick={() => void handleDeploy()}
                      disabled={deploying || !listicle.renderedHtml || listicle.status === "deployed"}
                      className="px-4 py-2 rounded text-xs font-mono uppercase tracking-wider bg-orange-500/15 text-orange-300 border border-orange-500/40 hover:bg-orange-500/25 transition-all flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deploying ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                      {listicle.status === "deployed" ? "Deployed" : (deploying ? "Deploying..." : "Deploy to LanderLab")}
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

                {/* iframe preview */}
                {listicle.renderedHtml ? (
                  <div className="rounded-lg overflow-hidden border border-white/[0.08] bg-white">
                    <iframe srcDoc={listicle.renderedHtml} title="Listicle preview" className="w-full" style={{ minHeight: "80vh", border: 0 }} sandbox="allow-same-origin" />
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

function Card({ label, children, required, hint }: { label: string; children: React.ReactNode; required?: boolean; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
      <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3 flex items-center gap-1.5">
        {label}
        {required && <span className="ml-auto text-rose-300/60 normal-case tracking-normal">required</span>}
      </label>
      {hint && <p className="text-[11px] text-white/40 font-mono leading-relaxed mb-3">{hint}</p>}
      {children}
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-300 font-mono flex items-start gap-2 mb-3">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

function Dropdown({ open, setOpen, icon, label, sublabel, thumb, children }: { open: boolean; setOpen: (b: boolean) => void; icon?: React.ReactNode; label: string; sublabel?: string; thumb?: string | null; children: React.ReactNode }) {
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 hover:border-white/[0.15] transition-all text-left">
        {thumb ? (
          <img src={thumb} alt="" className="w-7 h-7 rounded object-cover" />
        ) : icon ? (
          <div className="w-7 h-7 rounded bg-white/[0.04] flex items-center justify-center shrink-0">{icon}</div>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white/80 truncate">{label}</div>
          {sublabel && <div className="text-[10px] font-mono text-white/30 truncate">{sublabel}</div>}
        </div>
        <ChevronDown size={14} className={`text-white/30 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-2 inset-x-0 z-10 bg-[#13151a] border border-white/[0.08] rounded-lg overflow-hidden shadow-xl max-h-72 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownItem({ onClick, selected, label, sublabel, thumb }: { onClick: () => void; selected?: boolean; label: string; sublabel?: string; thumb?: string | null }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors">
      {thumb && <img src={thumb} alt="" className="w-6 h-6 rounded object-cover" />}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white/80 truncate">{label}</div>
        {sublabel && <div className="text-[10px] font-mono text-white/30 truncate">{sublabel}</div>}
      </div>
      {selected && <Check size={12} className="text-orange-400 shrink-0" />}
    </button>
  );
}

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
