/**
 * DESIGN: Studio Control Room — Static Ads Recreator
 * Step 1: Select Product + Angle (dropdown from research or custom)
 * Step 2: Select references from library + upload custom references
 * Step 3: Review recreated ads with approve/regenerate/chat feedback
 */
import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, X, RefreshCw, MessageSquare, ChevronRight, ChevronDown,
  Send, ArrowLeft, Package, Sparkles, ImagePlus, Upload,
  Layers, PenLine, Eye, CheckCircle2,
} from "lucide-react";
import {
  MOCK_PRODUCTS, STATIC_AD_LIBRARY, MOCK_RECREATED_ADS, MOCK_CHAT_MESSAGES,
  type StaticAdReference, type RecreatedAd,
} from "@/lib/mockData";

const STEPS = ["Product & Angle", "Select References", "Review Recreations"];

function StatusBadge({ status }: { status: RecreatedAd["status"] }) {
  const styles: Record<string, string> = {
    approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    rejected: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    generating: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-mono uppercase tracking-wider ${styles[status]}`}>
      {status === "generating" ? "Generating..." : status}
    </span>
  );
}

export default function StaticAdsAppPage() {
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1 state
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [angleMode, setAngleMode] = useState<"select" | "custom">("select");
  const [selectedAngle, setSelectedAngle] = useState("");
  const [customAngle, setCustomAngle] = useState("");
  const [angleDropdownOpen, setAngleDropdownOpen] = useState(false);

  // Step 2 state
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());

  // Step 3 state
  const [selectedAd, setSelectedAd] = useState<RecreatedAd | null>(null);
  const [chatInput, setChatInput] = useState("");

  const selectedProduct = MOCK_PRODUCTS.find((p) => p.id === selectedProductId);
  const researchedProducts = MOCK_PRODUCTS.filter((p) => p.researchStatus === "complete");
  const contentAngles = selectedProduct?.research?.contentAngles || [];
  const activeAngle = angleMode === "custom" ? customAngle : selectedAngle;

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
              onClick={() => {
                if (i <= currentStep) setCurrentStep(i);
              }}
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
          <AnimatePresence mode="wait">

            {/* ============================================ */}
            {/* STEP 0: PRODUCT & ANGLE SELECTION            */}
            {/* ============================================ */}
            {currentStep === 0 && (
              <motion.div key="product-angle" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="max-w-2xl mx-auto py-12">
                <h2 className="text-xl font-bold font-mono text-amber-400 mb-2 flex items-center gap-2">
                  <Sparkles size={18} />
                  SELECT PRODUCT & ANGLE
                </h2>
                <p className="text-xs text-white/30 mb-8 font-mono">Choose a product and the content angle for your static ad recreations.</p>

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
                              <img src={selectedProduct.productImage} alt={selectedProduct.name} className="w-full h-full object-contain" />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm text-white/80">{selectedProduct.name}</div>
                              <div className="text-[10px] font-mono text-white/30">{selectedProduct.category} · {selectedProduct.research?.pricePoint || "—"}</div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="w-10 h-10 rounded-lg border border-dashed border-white/[0.12] flex items-center justify-center shrink-0">
                              <Package size={16} className="text-white/20" />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm text-white/30">Choose a product...</div>
                              <div className="text-[10px] font-mono text-white/15">Only researched products available</div>
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
                                    <img src={product.productImage} alt={product.name} className="w-full h-full object-contain" />
                                  </div>
                                  <div className="flex-1">
                                    <div className="text-xs text-white/80">{product.name}</div>
                                    <div className="text-[10px] font-mono text-white/30">{product.category}</div>
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

                      {/* Toggle: Select from Research vs Custom */}
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
                                  {contentAngles.map((angle, i) => (
                                    <button
                                      key={i}
                                      onClick={() => { setSelectedAngle(angle); setAngleDropdownOpen(false); }}
                                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all ${
                                        selectedAngle === angle
                                          ? "bg-amber-500/10 border border-amber-500/20"
                                          : "hover:bg-white/[0.04] border border-transparent"
                                      }`}
                                    >
                                      <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold bg-white/[0.05] text-white/30 shrink-0">
                                        {i + 1}
                                      </div>
                                      <span className="text-xs text-white/70">{angle}</span>
                                      {selectedAngle === angle && <Check size={12} className="text-amber-400 shrink-0 ml-auto" />}
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
                    onClick={() => selectedRefs.size > 0 && setCurrentStep(2)}
                    disabled={selectedRefs.size === 0}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
                      selectedRefs.size > 0
                        ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 cursor-pointer"
                        : "bg-white/[0.03] text-white/20 border border-white/[0.06] cursor-not-allowed"
                    }`}
                  >
                    <Sparkles size={12} />
                    Recreate ({selectedRefs.size})
                  </button>
                </div>

                {/* Upload Area */}
                <div className="mb-6 rounded-lg border-2 border-dashed border-white/[0.08] p-6 flex flex-col items-center gap-3 hover:border-amber-500/30 transition-colors cursor-pointer group" style={{ background: "rgba(255,255,255,0.01)" }}>
                  <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center group-hover:bg-amber-500/10 transition-colors">
                    <Upload size={20} className="text-white/20 group-hover:text-amber-400 transition-colors" />
                  </div>
                  <div className="text-xs font-mono text-white/30 group-hover:text-white/50 transition-colors">
                    Drop your own ad references here or click to upload
                  </div>
                  <div className="text-[10px] font-mono text-white/15">PNG, JPG, WEBP · Max 10MB each</div>
                </div>

                {/* Library Grid */}
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-amber-400" style={{ boxShadow: "0 0 8px rgba(245,158,11,0.5)" }} />
                    <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Reference Library</span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                    <button
                      onClick={() => {
                        if (selectedRefs.size === STATIC_AD_LIBRARY.length) {
                          setSelectedRefs(new Set());
                        } else {
                          setSelectedRefs(new Set(STATIC_AD_LIBRARY.map((r) => r.id)));
                        }
                      }}
                      className="text-[10px] font-mono text-white/30 hover:text-amber-400 transition-colors"
                    >
                      {selectedRefs.size === STATIC_AD_LIBRARY.length ? "Deselect All" : "Select All"}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {STATIC_AD_LIBRARY.map((ref) => {
                      const isSelected = selectedRefs.has(ref.id);
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
                          {/* Selection Indicator */}
                          <div className={`absolute top-3 right-3 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                            isSelected
                              ? "bg-amber-500 text-black"
                              : "bg-black/40 backdrop-blur-sm border border-white/20 text-white/40"
                          }`}>
                            {isSelected ? <Check size={14} /> : <span className="text-[10px]">+</span>}
                          </div>

                          <div className="aspect-square overflow-hidden">
                            <img
                              src={ref.image}
                              alt={ref.title}
                              className={`w-full h-full object-cover transition-all ${isSelected ? "brightness-100" : "brightness-75 group-hover:brightness-90"}`}
                            />
                          </div>
                          <div className="p-3">
                            <div className="text-xs font-medium text-white/80 truncate">{ref.title}</div>
                            <div className="text-[10px] text-white/30 font-mono mt-0.5">{ref.style}</div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ============================================ */}
            {/* STEP 2: REVIEW RECREATIONS                   */}
            {/* ============================================ */}
            {currentStep === 2 && (
              <motion.div key="review" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-sm font-mono text-white/60 uppercase tracking-widest flex items-center gap-2">
                      <ImagePlus size={14} className="text-amber-400" />
                      Recreated Ads <span className="text-amber-400">({MOCK_RECREATED_ADS.length})</span>
                    </h2>
                    <p className="text-[10px] text-white/25 font-mono mt-1">
                      Review, approve, or regenerate each recreation. Click on an ad to give specific feedback.
                    </p>
                  </div>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all">
                    <CheckCircle2 size={10} /> Approve All
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {MOCK_RECREATED_ADS.map((ad) => (
                    <motion.div
                      key={ad.id}
                      whileHover={{ scale: 1.01 }}
                      onClick={() => setSelectedAd(ad)}
                      className={`rounded-xl border overflow-hidden cursor-pointer group transition-all ${
                        selectedAd?.id === ad.id
                          ? "border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.15)]"
                          : "border-white/[0.06] hover:border-white/[0.12]"
                      }`}
                      style={{ background: "#13161F" }}
                    >
                      <div className="relative aspect-square overflow-hidden">
                        <img src={ad.image} alt={ad.title} className="w-full h-full object-cover" />
                        {ad.status === "generating" && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <RefreshCw size={24} className="text-amber-400 animate-spin" />
                          </div>
                        )}
                        <div className="absolute top-3 right-3"><StatusBadge status={ad.status} /></div>

                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <button className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-colors">
                            <Check size={16} />
                          </button>
                          <button className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 hover:bg-amber-500/30 transition-colors">
                            <RefreshCw size={16} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedAd(ad); }}
                            className="w-9 h-9 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/60 hover:bg-white/20 transition-colors"
                          >
                            <MessageSquare size={16} />
                          </button>
                          <button className="w-9 h-9 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 hover:bg-rose-500/30 transition-colors">
                            <X size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="p-3">
                        <div className="text-xs font-medium text-white/80 truncate">{ad.title}</div>
                        <div className="text-[10px] text-white/30 font-mono mt-1 truncate">{ad.angle}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Right Panel — Ad Details + Chat (Step 2 only) */}
        <AnimatePresence>
          {selectedAd && currentStep === 2 && (
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
                  <button onClick={() => setSelectedAd(null)} className="text-white/30 hover:text-white/60"><X size={14} /></button>
                </div>
                <div className="rounded-lg overflow-hidden border border-white/[0.06]">
                  <img src={selectedAd.image} alt={selectedAd.title} className="w-full aspect-square object-cover" />
                </div>
                <div className="mt-3">
                  <div className="text-sm font-medium text-white/80">{selectedAd.title}</div>
                  <div className="text-[10px] text-white/40 mt-1">{selectedAd.angle}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <StatusBadge status={selectedAd.status} />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="flex-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all flex items-center justify-center gap-1">
                    <Check size={10} /> Approve
                  </button>
                  <button className="flex-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all flex items-center justify-center gap-1">
                    <RefreshCw size={10} /> Regenerate
                  </button>
                </div>
              </div>

              {/* Prompt */}
              <div className="p-3 border-b border-white/[0.06]">
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-2">Prompt</div>
                <div className="text-[11px] text-white/50 font-mono leading-relaxed bg-white/[0.02] rounded p-2 border border-white/[0.04]">
                  {selectedAd.prompt}
                </div>
              </div>

              {/* Chat */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-white/[0.06] flex items-center gap-2">
                  <MessageSquare size={12} className="text-amber-400" />
                  <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Feedback Chat</span>
                </div>
                <div className="flex-1 overflow-auto p-3 space-y-3">
                  {MOCK_CHAT_MESSAGES.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
                          msg.role === "user"
                            ? "bg-amber-500/15 text-amber-100 border border-amber-500/20"
                            : "bg-white/[0.04] text-white/60 border border-white/[0.06]"
                        }`}
                        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-white/[0.06]">
                  <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Give feedback on this ad..."
                      className="bg-transparent text-[11px] text-white/80 placeholder:text-white/20 outline-none flex-1 font-mono"
                    />
                    <button className="text-amber-400 hover:text-amber-300 transition-colors"><Send size={14} /></button>
                  </div>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
