/**
 * Static Ads Iterations — spin up headline alternates for a winning static ad,
 * then generate image variations that swap ONLY the headline.
 *
 *   Step 0: Select source ad (library pick OR upload) + angle (from a researched
 *           product OR free-text).
 *   Step 1: Review ten generated headlines. Add manually, regenerate with
 *           feedback, approve individually or all at once.
 *   Step 2: Generate image variations for each approved headline. Download
 *           them or push them into the Brand Assets library.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, Copy as CopyIcon, Download,
  Image as ImageIcon, Loader2, Package, Plus, RefreshCw, Sparkles, Upload,
  CheckCircle2, X, MessageSquare, Trash2,
} from "lucide-react";
import {
  generateIterationsHeadlines, generateIterationsVariation,
  listBrandAssets, listProducts, saveBrandAssets, uploadIterationsSource,
  type BrandAsset, type Product, type ProductAngle,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { toast } from "sonner";

type SourceMode = "library" | "upload";

type Headline = {
  id: string;
  text: string;
  selected: boolean;
  manual: boolean;
};

type VariationStatus = "generating" | "done" | "failed";
type VariationUserStatus = "pending" | "approved" | "rejected";

type Variation = {
  headlineId: string;
  headline: string;
  status: VariationStatus;
  userStatus: VariationUserStatus;
  url?: string;
  error?: string;
};

// Friendly labels for the `sourceApp` field on brand-asset rows. Keep in sync
// with the app ids in WORKSPACE_APPS (mockData.ts).
function formatSourceAppLabel(app: string): string {
  const map: Record<string, string> = {
    "static-ads": "Static Ads Recreator",
    "static-ads-iterations": "Iterations",
    "message-testing": "Message Testing",
    broll: "B-Roll",
  };
  return map[app] ?? app;
}

const STEPS = ["Source & Angle", "Headlines", "Variations"];
const ACCENT = "#EC4899"; // pink/rose to distinguish from recreator (amber) & message-testing (purple)

export default function StaticAdsIterationsAppPage() {
  const { activeBrandId } = useBrand();
  const [currentStep, setCurrentStep] = useState(0);

  // ─── Data loads ─────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);

  // ─── Step 0 state ───────────────────────────────────────
  const [sourceMode, setSourceMode] = useState<SourceMode>("library");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sourceAppFilter, setSourceAppFilter] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [selectedAngleIdx, setSelectedAngleIdx] = useState<number | "custom" | null>(null);
  const [customAngle, setCustomAngle] = useState<string>("");

  const [generatingHeadlines, setGeneratingHeadlines] = useState(false);
  const [headlineError, setHeadlineError] = useState<string | null>(null);

  // ─── Step 1 state (headlines) ───────────────────────────
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [manualDraft, setManualDraft] = useState("");

  // ─── Step 2 state (variations) ──────────────────────────
  const [variations, setVariations] = useState<Variation[]>([]);
  const [feedbackOpen, setFeedbackOpen] = useState<Set<string>>(new Set());
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ─── Initial fetches ────────────────────────────────────
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    setAssetsLoading(true);
    (async () => {
      try {
        const { products } = await listProducts(activeBrandId);
        if (!cancelled) setProducts(products);
      } catch { /* non-fatal — angle picker just won't populate */ }
    })();
    (async () => {
      try {
        const { assets } = await listBrandAssets(activeBrandId);
        if (!cancelled) setAssets(assets.filter((a) => a.kind === "image"));
      } finally {
        if (!cancelled) setAssetsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeBrandId]);

  // ─── Derived ────────────────────────────────────────────
  const researchedProducts = useMemo(
    () => products.filter((p) => p.researchStatus === "complete" && p.research?.markdown),
    [products],
  );

  const selectedProduct = researchedProducts.find((p) => p.id === selectedProductId);
  const productAngles: ProductAngle[] = selectedProduct?.research?.angles ?? [];

  const sourceAppCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) m.set(a.sourceApp, (m.get(a.sourceApp) ?? 0) + 1);
    return m;
  }, [assets]);
  const availableSourceApps = useMemo(
    () => Array.from(sourceAppCounts.keys()).sort(),
    [sourceAppCounts],
  );
  const filteredAssets = useMemo(() => {
    if (sourceAppFilter.size === 0) return assets;
    return assets.filter((a) => sourceAppFilter.has(a.sourceApp));
  }, [assets, sourceAppFilter]);

  const selectedAsset = assets.find((a) => a.id === selectedAssetId) ?? null;
  const sourceImageUrl =
    sourceMode === "library" ? selectedAsset?.url ?? null : uploadedUrl;

  const activeAngleText = (() => {
    if (selectedAngleIdx === "custom") return customAngle.trim();
    if (typeof selectedAngleIdx === "number") {
      const a = productAngles[selectedAngleIdx];
      if (!a) return "";
      return `${a.name}\n\n${a.block}`;
    }
    return "";
  })();

  const canGenerate = Boolean(sourceImageUrl) && activeAngleText.length > 0 && !generatingHeadlines;

  const approvedHeadlines = headlines.filter((h) => h.selected);
  const approvedVariations = variations.filter(
    (v) => v.status === "done" && v.userStatus === "approved",
  );

  // ─── File upload (Step 0) ───────────────────────────────
  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const handleFilesSelected = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const file = list[0];
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const { url } = await uploadIterationsSource({ dataUrl, filename: file.name });
      setUploadedUrl(url);
      setUploadedFilename(file.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  // ─── Step 0 → Step 1 ────────────────────────────────────
  const handleGenerateHeadlines = async () => {
    if (!sourceImageUrl || !activeAngleText) return;
    setGeneratingHeadlines(true);
    setHeadlineError(null);
    try {
      const productSummary = selectedProduct
        ? `Name: ${selectedProduct.name}\nCategory: ${selectedProduct.category}${
            selectedProduct.research?.markdown
              ? `\n\nResearch:\n${selectedProduct.research.markdown.slice(0, 3000)}`
              : ""
          }`
        : undefined;

      const result = await generateIterationsHeadlines({
        sourceImageUrl,
        angle: activeAngleText,
        product: productSummary,
        existingHeadlines: [],
        count: 10,
      });

      const fresh: Headline[] = result.headlines.map((text, i) => ({
        id: `auto-${Date.now()}-${i}`,
        text,
        selected: false,
        manual: false,
      }));
      setHeadlines(fresh);
      setCurrentStep(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHeadlineError(msg);
    } finally {
      setGeneratingHeadlines(false);
    }
  };

  // ─── Step 1: headline list actions ──────────────────────
  const toggleHeadline = (id: string) => {
    setHeadlines((prev) =>
      prev.map((h) => (h.id === id ? { ...h, selected: !h.selected } : h)),
    );
  };

  const approveAll = () => {
    setHeadlines((prev) => prev.map((h) => ({ ...h, selected: true })));
  };

  const clearAll = () => {
    setHeadlines((prev) => prev.map((h) => ({ ...h, selected: false })));
  };

  const addManualHeadline = () => {
    const text = manualDraft.trim();
    if (!text) return;
    setHeadlines((prev) => [
      { id: `manual-${Date.now()}`, text, selected: true, manual: true },
      ...prev,
    ]);
    setManualDraft("");
  };

  const removeHeadline = (id: string) => {
    setHeadlines((prev) => prev.filter((h) => h.id !== id));
  };

  // ─── Step 1 → Step 2 (variations) ───────────────────────
  const runVariation = async (headlineId: string, headline: string, feedback?: string) => {
    if (!sourceImageUrl) return;
    try {
      const result = await generateIterationsVariation({
        sourceImageUrl,
        headline,
        feedback,
      });
      setVariations((prev) =>
        prev.map((v) =>
          v.headlineId === headlineId
            ? { ...v, status: "done", url: result.url, error: undefined }
            : v,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setVariations((prev) =>
        prev.map((v) =>
          v.headlineId === headlineId ? { ...v, status: "failed", error: msg } : v,
        ),
      );
    }
  };

  const handleGenerateVariations = async () => {
    if (!sourceImageUrl || approvedHeadlines.length === 0) return;
    const initial: Variation[] = approvedHeadlines.map((h) => ({
      headlineId: h.id,
      headline: h.text,
      status: "generating",
      userStatus: "pending",
    }));
    setVariations(initial);
    setFeedbackOpen(new Set());
    setFeedbackDrafts({});
    setSavedCount(0);
    setSaveError(null);
    setCurrentStep(2);

    await Promise.all(
      approvedHeadlines.map((h) => runVariation(h.id, h.text)),
    );
  };

  const handleRegenerateVariation = (headlineId: string, feedback?: string) => {
    const entry = variations.find((v) => v.headlineId === headlineId);
    if (!entry) return;
    setVariations((prev) =>
      prev.map((v) =>
        v.headlineId === headlineId
          ? { ...v, status: "generating", url: undefined, error: undefined, userStatus: "pending" }
          : v,
      ),
    );
    if (feedback) {
      setFeedbackOpen((prev) => {
        const next = new Set(prev);
        next.delete(headlineId);
        return next;
      });
      setFeedbackDrafts((prev) => {
        const next = { ...prev };
        delete next[headlineId];
        return next;
      });
    }
    void runVariation(headlineId, entry.headline, feedback);
  };

  const toggleVariationFeedback = (headlineId: string) => {
    setFeedbackOpen((prev) => {
      const next = new Set(prev);
      if (next.has(headlineId)) next.delete(headlineId);
      else next.add(headlineId);
      return next;
    });
  };

  const setVariationFeedbackDraft = (headlineId: string, text: string) => {
    setFeedbackDrafts((prev) => ({ ...prev, [headlineId]: text }));
  };

  const setVariationUserStatus = (headlineId: string, status: VariationUserStatus) => {
    setVariations((prev) =>
      prev.map((v) => (v.headlineId === headlineId ? { ...v, userStatus: status } : v)),
    );
  };

  const approveAllVariations = () => {
    setVariations((prev) =>
      prev.map((v) => (v.status === "done" ? { ...v, userStatus: "approved" } : v)),
    );
  };

  // Fetch each approved variation, trigger a browser download, and save the
  // whole set to Brand Assets in one batch.
  const handleDownloadAndSave = async () => {
    if (approvedVariations.length === 0 || saving) return;
    if (!activeBrandId) {
      setSaveError("No active brand selected.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveBrandAssets(
        activeBrandId,
        approvedVariations.map((v) => ({
          kind: "image" as const,
          url: v.url!,
          title: v.headline.split("\n")[0].slice(0, 80),
          sourceApp: "static-ads-iterations",
          productId: selectedProductId || null,
          metadata: {
            headline: v.headline,
            angle: activeAngleText,
            sourceImageUrl,
          },
        })),
      );
      for (const v of approvedVariations) {
        if (!v.url) continue;
        try {
          const blob = await (await fetch(v.url)).blob();
          const href = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = href;
          a.download = `iteration-${v.headlineId}.jpg`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(href);
        } catch {
          // Download is best-effort; save already succeeded.
        }
      }
      setSavedCount(approvedVariations.length);
      toast.success(`Saved ${approvedVariations.length} to Brand Assets`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    setCurrentStep(0);
    setSelectedAssetId(null);
    setUploadedUrl(null);
    setUploadedFilename(null);
    setCustomAngle("");
    setSelectedAngleIdx(null);
    setHeadlines([]);
    setVariations([]);
    setManualDraft("");
    setHeadlineError(null);
    setFeedbackOpen(new Set());
    setFeedbackDrafts({});
    setSavedCount(0);
    setSaveError(null);
  };

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ color: "#E2E8F0" }}>
      {/* ── Top bar ─────────────────────────────────── */}
      <header className="h-12 border-b border-white/[0.06] flex items-center px-4 gap-4 shrink-0" style={{ background: "#0D0F12" }}>
        <Link href="/workspace/apps">
          <button className="flex items-center gap-2 text-white/40 hover:text-pink-400 transition-colors text-sm">
            <ArrowLeft size={14} />
            <span className="font-mono text-xs">APPS</span>
          </button>
        </Link>
        <div className="w-px h-5 bg-white/10" />
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: `${ACCENT}20` }}>
            <CopyIcon size={12} style={{ color: ACCENT }} />
          </div>
          <span className="font-mono text-xs text-white/60 tracking-wider">STATIC ADS ITERATIONS</span>
        </div>

        {/* Step indicator */}
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
                    ? "text-pink-400 shadow-[0_0_12px_rgba(236,72,153,0.3)]"
                    : i < currentStep
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-white/5 text-white/30"
                }`}
                style={i === currentStep ? { background: `${ACCENT}33` } : undefined}
              >
                {i < currentStep ? <Check size={10} /> : i + 1}
              </div>
              <span
                className={`text-[10px] font-mono tracking-wider hidden md:block ${
                  i === currentStep ? "text-pink-400" : "text-white/30"
                }`}
              >
                {step}
              </span>
              {i < STEPS.length - 1 && <ChevronRight size={10} className="text-white/10 mx-1" />}
            </button>
          ))}
        </div>
      </header>

      {/* ── Main ────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-auto p-4">
          <AnimatePresence mode="wait">

            {/* ============================================== */}
            {/* STEP 0 — Source & Angle                         */}
            {/* ============================================== */}
            {currentStep === 0 && (
              <motion.div
                key="source-angle"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="max-w-4xl mx-auto py-8"
              >
                <h2 className="text-xl font-bold font-mono mb-2 flex items-center gap-2" style={{ color: ACCENT }}>
                  <Sparkles size={18} />
                  SELECT SOURCE AD & ANGLE
                </h2>
                <p className="text-xs text-white/30 mb-8 font-mono">
                  Pick a winning static ad and the angle you want the new headlines to speak to.
                </p>

                {/* Source selector */}
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5 mb-5">
                  <div className="flex items-center gap-4 mb-4">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                      Source ad
                    </label>
                    <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.08] rounded p-0.5">
                      {(["library", "upload"] as SourceMode[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => setSourceMode(m)}
                          className={`px-3 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-all ${
                            sourceMode === m
                              ? "bg-white/[0.08] text-white/90"
                              : "text-white/40 hover:text-white/60"
                          }`}
                        >
                          {m === "library" ? "From Library" : "Upload"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Library grid — image assets the user has already generated */}
                  {sourceMode === "library" && (
                    <>
                      {availableSourceApps.length > 1 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {availableSourceApps.map((app) => {
                            const active = sourceAppFilter.has(app);
                            return (
                              <button
                                key={app}
                                onClick={() => {
                                  setSourceAppFilter((p) => {
                                    const next = new Set(p);
                                    if (next.has(app)) next.delete(app);
                                    else next.add(app);
                                    return next;
                                  });
                                }}
                                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-all ${
                                  active
                                    ? "bg-pink-500/15 border-pink-500/40 text-pink-300"
                                    : "bg-white/[0.02] border-white/[0.08] text-white/40 hover:text-white/70"
                                }`}
                              >
                                {formatSourceAppLabel(app)} <span className="opacity-60">({sourceAppCounts.get(app)})</span>
                              </button>
                            );
                          })}
                          {sourceAppFilter.size > 0 && (
                            <button
                              onClick={() => setSourceAppFilter(new Set())}
                              className="text-[10px] font-mono px-2 py-0.5 rounded text-white/40 hover:text-white/70"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      )}

                      {assetsLoading ? (
                        <div className="flex items-center justify-center py-10 text-white/40 text-xs font-mono">
                          <Loader2 size={14} className="animate-spin mr-2" /> Loading asset library…
                        </div>
                      ) : assets.length === 0 ? (
                        <div className="text-center py-10 text-white/30 text-xs font-mono">
                          No generated assets yet. Produce a static ad in one of the other apps first, or switch to Upload.
                        </div>
                      ) : filteredAssets.length === 0 ? (
                        <div className="text-center py-10 text-white/30 text-xs font-mono">
                          No assets match this filter.
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-2 max-h-[380px] overflow-y-auto">
                          {filteredAssets.map((a) => {
                            const picked = selectedAssetId === a.id;
                            return (
                              <button
                                key={a.id}
                                onClick={() => setSelectedAssetId(a.id)}
                                className={`relative aspect-square rounded border overflow-hidden transition-all ${
                                  picked
                                    ? "border-pink-500/60 shadow-[0_0_12px_rgba(236,72,153,0.3)]"
                                    : "border-white/[0.08] hover:border-white/[0.2]"
                                }`}
                              >
                                <img src={a.thumbnailUrl ?? a.url} alt={a.title} className="w-full h-full object-cover" />
                                {picked && (
                                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-pink-500 flex items-center justify-center">
                                    <Check size={12} className="text-white" />
                                  </div>
                                )}
                                <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1.5 py-1">
                                  <div className="text-[9px] font-mono text-white/90 truncate">{a.title}</div>
                                  <div className="text-[8px] font-mono text-white/40 truncate">{formatSourceAppLabel(a.sourceApp)}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {/* Upload */}
                  {sourceMode === "upload" && (
                    <div>
                      <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                        onDragLeave={() => setIsDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDragOver(false);
                          void handleFilesSelected(e.dataTransfer.files);
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
                          isDragOver
                            ? "border-pink-500/60 bg-pink-500/5"
                            : "border-white/[0.15] hover:border-white/[0.3] bg-white/[0.02]"
                        }`}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => void handleFilesSelected(e.target.files)}
                        />
                        {uploading ? (
                          <div className="flex flex-col items-center gap-2 text-white/60 text-xs font-mono">
                            <Loader2 size={18} className="animate-spin" />
                            Uploading…
                          </div>
                        ) : uploadedUrl ? (
                          <div className="flex flex-col items-center gap-2">
                            <img src={uploadedUrl} alt="uploaded" className="max-h-32 rounded border border-white/[0.1]" />
                            <div className="text-[10px] font-mono text-white/50">{uploadedFilename}</div>
                            <div className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 size={10} /> Ready
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-white/40">
                            <Upload size={20} />
                            <div className="text-xs font-mono">Drop a static ad or click to browse</div>
                            <div className="text-[10px] text-white/25 font-mono">PNG / JPG</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Product selector */}
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5 mb-5">
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                    Select Product
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setProductDropdownOpen((v) => !v)}
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
                            <div className="text-sm text-white/30">Choose a product…</div>
                            <div className="text-[10px] font-mono text-white/15">
                              {researchedProducts.length} researched product{researchedProducts.length === 1 ? "" : "s"} available
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
                                No researched products yet. Research a product first to pull angles.
                              </div>
                            ) : (
                              researchedProducts.map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => {
                                    setSelectedProductId(p.id);
                                    setSelectedAngleIdx(null);
                                    setProductDropdownOpen(false);
                                  }}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all ${
                                    selectedProductId === p.id
                                      ? "bg-pink-500/10 border border-pink-500/20"
                                      : "hover:bg-white/[0.04] border border-transparent"
                                  }`}
                                >
                                  <div className="w-9 h-9 rounded-lg overflow-hidden border border-white/[0.06] shrink-0 bg-white/[0.02] flex items-center justify-center">
                                    {p.productImageUrl ? (
                                      <img src={p.productImageUrl} alt={p.name} className="max-h-full max-w-full object-contain" />
                                    ) : (
                                      <Package size={14} className="text-white/20" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-white/80 truncate">{p.name}</div>
                                    <div className="text-[10px] font-mono text-white/30">{p.category}</div>
                                  </div>
                                  {selectedProductId === p.id && (
                                    <Check size={14} className="shrink-0" style={{ color: ACCENT }} />
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Angle selector — visible once a product is picked */}
                {selectedProduct && (
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5 mb-5">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">
                      Angle
                    </label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {productAngles.map((angle, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedAngleIdx(idx)}
                          className={`px-3 py-2 rounded-lg text-[11px] font-mono border transition-all text-left max-w-xs ${
                            selectedAngleIdx === idx
                              ? "bg-pink-500/15 text-pink-300 border-pink-500/40 shadow-[0_0_10px_rgba(236,72,153,0.15)]"
                              : "bg-white/[0.03] text-white/60 border-white/[0.08] hover:border-white/[0.18]"
                          }`}
                        >
                          <span className="text-white/30 mr-1">#{idx + 1}</span>
                          {angle.name}
                        </button>
                      ))}
                      <button
                        onClick={() => setSelectedAngleIdx("custom")}
                        className={`px-3 py-2 rounded-lg text-[11px] font-mono border transition-all ${
                          selectedAngleIdx === "custom"
                            ? "bg-pink-500/15 text-pink-300 border-pink-500/40"
                            : "bg-white/[0.03] text-white/60 border-white/[0.08] hover:border-white/[0.18] border-dashed"
                        }`}
                      >
                        + Custom angle
                      </button>
                    </div>

                    {typeof selectedAngleIdx === "number" && productAngles[selectedAngleIdx] && (
                      <div className="rounded-md bg-black/30 border border-white/[0.04] p-3 max-h-48 overflow-auto">
                        <pre className="text-[11px] text-white/60 font-mono whitespace-pre-wrap leading-relaxed">
                          {productAngles[selectedAngleIdx].block.slice(0, 600)}
                          {productAngles[selectedAngleIdx].block.length > 600 ? "..." : ""}
                        </pre>
                      </div>
                    )}

                    {selectedAngleIdx === "custom" && (
                      <textarea
                        rows={5}
                        value={customAngle}
                        onChange={(e) => setCustomAngle(e.target.value)}
                        placeholder="Describe your angle — audience, pain / desire, positioning, hook territory..."
                        className="w-full bg-black/30 border border-pink-500/20 rounded-md px-3 py-2 text-[12px] text-white/80 placeholder:text-white/20 outline-none font-mono leading-relaxed resize-y"
                      />
                    )}
                  </div>
                )}

                {/* Generate button */}
                {headlineError && (
                  <div className="text-xs text-rose-400 font-mono mb-3 bg-rose-500/5 border border-rose-500/20 rounded px-3 py-2">
                    {headlineError}
                  </div>
                )}
                <button
                  onClick={() => { void handleGenerateHeadlines(); }}
                  disabled={!canGenerate}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-mono text-sm uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: canGenerate ? ACCENT : "#2a1b24",
                    color: canGenerate ? "white" : "#6b5862",
                  }}
                >
                  {generatingHeadlines ? (
                    <><Loader2 size={14} className="animate-spin" /> Generating headlines…</>
                  ) : (
                    <>Generate Headlines <ArrowRight size={14} /></>
                  )}
                </button>
              </motion.div>
            )}

            {/* ============================================== */}
            {/* STEP 1 — Headlines                              */}
            {/* ============================================== */}
            {currentStep === 1 && (
              <motion.div
                key="headlines"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="max-w-5xl mx-auto py-6"
              >
                <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
                  {/* Source preview rail */}
                  <aside className="space-y-3">
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Source ad</div>
                    {sourceImageUrl && (
                      <img src={sourceImageUrl} alt="source" className="w-full rounded border border-white/[0.08]" />
                    )}
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mt-4">Angle</div>
                    <div className="text-xs text-white/70 whitespace-pre-wrap bg-white/[0.02] border border-white/[0.06] rounded p-3 max-h-48 overflow-y-auto">
                      {activeAngleText}
                    </div>
                  </aside>

                  {/* Headlines */}
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-bold font-mono" style={{ color: ACCENT }}>
                          HEADLINES
                        </h2>
                        <p className="text-[11px] text-white/30 font-mono mt-0.5">
                          {approvedHeadlines.length} of {headlines.length} selected
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={approvedHeadlines.length === headlines.length ? clearAll : approveAll}
                          className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded bg-white/[0.04] border border-white/[0.1] text-white/70 hover:text-white hover:border-white/[0.2]"
                        >
                          {approvedHeadlines.length === headlines.length ? "Clear All" : "Approve All"}
                        </button>
                      </div>
                    </div>

                    {/* Add manual */}
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="text"
                        value={manualDraft}
                        onChange={(e) => setManualDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); addManualHeadline(); }
                        }}
                        placeholder="Add your own headline…"
                        className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-sm text-white/80 placeholder:text-white/20 focus:border-pink-500/40 focus:outline-none"
                      />
                      <button
                        onClick={addManualHeadline}
                        disabled={!manualDraft.trim()}
                        className="px-3 py-2 rounded bg-white/[0.04] border border-white/[0.1] text-white/70 hover:text-white disabled:opacity-40"
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Headlines list */}
                    <div className="space-y-2 mb-5">
                      {headlines.map((h) => (
                        <div
                          key={h.id}
                          onClick={() => toggleHeadline(h.id)}
                          className={`group flex items-start gap-3 p-3 rounded border cursor-pointer transition-all ${
                            h.selected
                              ? "bg-pink-500/5 border-pink-500/40"
                              : "bg-white/[0.02] border-white/[0.08] hover:border-white/[0.2]"
                          }`}
                        >
                          <div
                            className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center mt-0.5 ${
                              h.selected ? "bg-pink-500 border-pink-500" : "border-white/30"
                            }`}
                          >
                            {h.selected && <Check size={12} className="text-white" />}
                          </div>
                          <div className="flex-1 text-sm whitespace-pre-wrap text-white/90 leading-snug">
                            {h.text}
                            {h.manual && (
                              <span className="ml-2 text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-white/40 uppercase tracking-wider">
                                Manual
                              </span>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeHeadline(h.id); }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-rose-400 transition-all"
                            aria-label="Remove"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Next */}
                    <button
                      onClick={() => void handleGenerateVariations()}
                      disabled={approvedHeadlines.length === 0}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-mono text-sm uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: approvedHeadlines.length > 0 ? ACCENT : "#2a1b24",
                        color: approvedHeadlines.length > 0 ? "white" : "#6b5862",
                      }}
                    >
                      Generate {approvedHeadlines.length} Variation{approvedHeadlines.length === 1 ? "" : "s"}
                      <ArrowRight size={14} />
                    </button>
                  </section>
                </div>
              </motion.div>
            )}

            {/* ============================================== */}
            {/* STEP 2 — Variations                             */}
            {/* ============================================== */}
            {currentStep === 2 && (
              <motion.div
                key="variations"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="max-w-6xl mx-auto py-6"
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-bold font-mono" style={{ color: ACCENT }}>
                      VARIATIONS
                    </h2>
                    <p className="text-[11px] text-white/30 font-mono mt-0.5">
                      {variations.filter((v) => v.status === "done").length} / {variations.length} complete
                      {approvedVariations.length > 0 && (
                        <> · <span className="text-emerald-400">{approvedVariations.length} approved</span></>
                      )}
                      {savedCount > 0 && (
                        <> · <span className="text-emerald-400">{savedCount} saved</span></>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={approveAllVariations}
                      disabled={variations.filter((v) => v.status === "done").length === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-xs font-mono text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                    >
                      <CheckCircle2 size={12} /> Approve All
                    </button>
                    <button
                      onClick={() => void handleDownloadAndSave()}
                      disabled={approvedVariations.length === 0 || saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all disabled:opacity-40"
                      style={{
                        background: approvedVariations.length > 0 ? ACCENT : "#2a1b24",
                        color: approvedVariations.length > 0 ? "white" : "#6b5862",
                      }}
                    >
                      {saving ? (
                        <><Loader2 size={12} className="animate-spin" /> Saving…</>
                      ) : savedCount > 0 ? (
                        <><CheckCircle2 size={12} /> Saved {savedCount} to Brand Assets</>
                      ) : (
                        <><Download size={12} /> Download & Save to Brand Assets ({approvedVariations.length})</>
                      )}
                    </button>
                    <button
                      onClick={resetAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/[0.04] border border-white/[0.1] text-xs font-mono text-white/70 hover:text-white"
                    >
                      New batch
                    </button>
                  </div>
                </div>

                {saveError && (
                  <div className="mb-4 text-xs text-rose-400 font-mono bg-rose-500/5 border border-rose-500/20 rounded px-3 py-2">
                    Save failed: {saveError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {variations.map((v) => {
                    const isGenerating = v.status === "generating";
                    const isFailed = v.status === "failed";
                    const isComplete = v.status === "done";
                    const isApproved = isComplete && v.userStatus === "approved";
                    const isRejected = isComplete && v.userStatus === "rejected";
                    const showFeedback = feedbackOpen.has(v.headlineId);
                    const draft = feedbackDrafts[v.headlineId] ?? "";
                    return (
                      <motion.div
                        key={v.headlineId}
                        className={`rounded-xl border overflow-hidden transition-all ${
                          isApproved
                            ? "border-emerald-500/30"
                            : isRejected
                            ? "border-rose-500/25 opacity-70"
                            : "border-white/[0.08]"
                        }`}
                        style={{ background: "#13161F" }}
                      >
                        {/* Image */}
                        <div className="aspect-square bg-black/40 relative overflow-hidden">
                          {isComplete && v.url && (
                            <img src={v.url} alt={v.headline} className="w-full h-full object-cover" />
                          )}
                          {isGenerating && (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                              <RefreshCw size={22} className="animate-spin" style={{ color: ACCENT }} />
                              <div className="text-[10px] font-mono text-white/50 uppercase tracking-widest">Generating…</div>
                            </div>
                          )}
                          {isFailed && (
                            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2 p-4 text-center">
                              <X size={20} className="text-rose-400" />
                              <div className="text-[10px] font-mono text-rose-400 uppercase tracking-widest">Failed</div>
                              <div className="text-[10px] font-mono text-white/60 line-clamp-5 leading-relaxed">{v.error}</div>
                            </div>
                          )}
                        </div>

                        {/* Headline */}
                        <div className="px-3 pt-3">
                          <div className="text-[12px] text-white/85 whitespace-pre-wrap line-clamp-3 leading-snug">
                            {v.headline}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="p-3">
                          {isGenerating && (
                            <div className="flex items-center justify-center gap-1.5 py-2 text-[10px] font-mono text-white/30">
                              <RefreshCw size={10} className="animate-spin" />
                              Waiting for nano-banana-pro…
                            </div>
                          )}

                          {isFailed && (
                            <button
                              onClick={() => handleRegenerateVariation(v.headlineId)}
                              className="w-full flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-pink-500/15 border border-pink-500/30 hover:bg-pink-500/25 transition-all"
                              style={{ color: ACCENT }}
                            >
                              <RefreshCw size={10} /> Retry
                            </button>
                          )}

                          {isComplete && !showFeedback && (
                            <div className="grid grid-cols-3 gap-1.5">
                              <button
                                onClick={() =>
                                  setVariationUserStatus(v.headlineId, isApproved ? "pending" : "approved")
                                }
                                className={`flex items-center justify-center gap-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider border transition-all ${
                                  isApproved
                                    ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20"
                                }`}
                              >
                                <Check size={10} /> {isApproved ? "Approved" : "Approve"}
                              </button>
                              <button
                                onClick={() => handleRegenerateVariation(v.headlineId)}
                                className="flex items-center justify-center gap-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-pink-500/10 border border-pink-500/25 hover:bg-pink-500/20 transition-all"
                                style={{ color: ACCENT }}
                              >
                                <RefreshCw size={10} /> Regenerate
                              </button>
                              <button
                                onClick={() => toggleVariationFeedback(v.headlineId)}
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
                                onChange={(e) => setVariationFeedbackDraft(v.headlineId, e.target.value)}
                                rows={3}
                                placeholder="What should change? e.g. 'make the headline smaller', 'bolder weight', 'use the gold brand color'..."
                                className="w-full bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2 text-[11px] text-white/80 placeholder:text-white/25 outline-none resize-none font-mono focus:border-pink-500/30"
                                autoFocus
                              />
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => {
                                    const text = draft.trim();
                                    if (text) handleRegenerateVariation(v.headlineId, text);
                                  }}
                                  disabled={!draft.trim()}
                                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-pink-500/15 border border-pink-500/30 hover:bg-pink-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                  style={{ color: ACCENT }}
                                >
                                  <RefreshCw size={10} /> Regenerate with Feedback
                                </button>
                                <button
                                  onClick={() => toggleVariationFeedback(v.headlineId)}
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

                {variations.length === 0 && (
                  <div className="text-center py-12 text-white/30 text-sm font-mono flex flex-col items-center gap-2">
                    <ImageIcon size={24} />
                    No variations yet.
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
