/**
 * DESIGN: Studio Control Room — Message Testing Ads Creator
 * 5-step workflow:
 *   1. Select Product & Angles (from research, all preselected, can deselect)
 *   2. Choose Template (3 variants generated, pick one, can regenerate/reprompt)
 *   3. Review All Generated Ads (grouped by angle, approve/regenerate/reprompt)
 *   4. Export (download by angle folders, saved to assets)
 */
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ChevronRight, Check, X, RefreshCw, Send,
  Download, MessageSquare, Package, Layers, Eye,
  CheckCircle2, Sparkles, FolderDown, RotateCcw,
  ChevronDown, ChevronUp,
} from "lucide-react";
import {
  MOCK_PRODUCTS,
  MOCK_MESSAGE_ANGLES,
  MOCK_MESSAGE_TEMPLATES,
  generateMockMessageAds,
  MOCK_CHAT_MESSAGES,
  IMAGES,
  type MessageAngle,
  type MessageTemplate,
  type MessageTestingAd,
} from "@/lib/mockData";
import { toast } from "sonner";

const STEPS = [
  { id: 1, label: "Product & Angles", icon: Package },
  { id: 2, label: "Choose Template", icon: Layers },
  { id: 3, label: "Review Ads", icon: Eye },
  { id: 4, label: "Export", icon: Download },
];

// ── Template Preview Card ──────────────────────────────────────
function TemplatePreview({
  template,
  sampleMessage,
  selected,
  onSelect,
}: {
  template: MessageTemplate;
  sampleMessage: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const layoutStyles: Record<string, React.CSSProperties> = {
    "bold-headline": {
      background: "linear-gradient(180deg, #0A0C10 0%, #1A1D28 100%)",
    },
    "minimal-center": {
      background: "linear-gradient(135deg, #F5F0E8 0%, #E8E0D0 100%)",
    },
    "editorial-split": {
      background: "linear-gradient(90deg, #0A0C10 50%, #1A1D28 50%)",
    },
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      onClick={onSelect}
      className={`rounded-xl border overflow-hidden cursor-pointer transition-all ${
        selected
          ? "border-purple-500 ring-2 ring-purple-500/30"
          : "border-white/[0.08] hover:border-white/[0.15]"
      }`}
      style={{ background: "#13161F" }}
    >
      {/* Template Preview */}
      <div
        className="h-56 relative flex items-center justify-center p-6 overflow-hidden"
        style={layoutStyles[template.layout]}
      >
        {template.layout === "bold-headline" && (
          <div className="text-center z-10 px-4">
            <p className="text-white font-bold text-base leading-snug max-w-[260px] mx-auto">
              {sampleMessage}
            </p>
            <div className="mt-4 flex justify-center">
              <img
                src={template.previewImage}
                alt=""
                className="w-16 h-16 object-contain rounded-lg"
              />
            </div>
          </div>
        )}
        {template.layout === "minimal-center" && (
          <div className="text-center z-10 px-4">
            <p className="text-[#2D2D2D] font-serif text-sm italic leading-relaxed max-w-[240px] mx-auto">
              "{sampleMessage}"
            </p>
            <div className="mt-3 w-8 h-px bg-[#C8A84E] mx-auto" />
          </div>
        )}
        {template.layout === "editorial-split" && (
          <div className="flex w-full h-full z-10">
            <div className="w-1/2 flex items-center justify-center p-4">
              <p className="text-white text-xs leading-relaxed max-w-[140px]">
                {sampleMessage}
              </p>
            </div>
            <div className="w-1/2 flex items-center justify-center">
              <img
                src={template.previewImage}
                alt=""
                className="w-20 h-20 object-contain rounded-lg"
              />
            </div>
          </div>
        )}

        {/* Selection indicator */}
        {selected && (
          <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center z-20">
            <Check size={14} className="text-white" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 border-t border-white/[0.06]">
        <h4 className="text-sm font-semibold text-white/90 mb-1">{template.name}</h4>
        <p className="text-[11px] text-white/40 leading-relaxed">{template.description}</p>
      </div>
    </motion.div>
  );
}

// ── Ad Card ────────────────────────────────────────────────────
function AdCard({
  ad,
  templateLayout,
  onApprove,
  onReject,
  onRegenerate,
  onChat,
  isSelected,
}: {
  ad: MessageTestingAd;
  templateLayout: string;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  onChat: () => void;
  isSelected: boolean;
}) {
  const layoutStyles: Record<string, React.CSSProperties> = {
    "bold-headline": {
      background: "linear-gradient(180deg, #0A0C10 0%, #1A1D28 100%)",
    },
    "minimal-center": {
      background: "linear-gradient(135deg, #F5F0E8 0%, #E8E0D0 100%)",
    },
    "editorial-split": {
      background: "linear-gradient(90deg, #0A0C10 50%, #1A1D28 50%)",
    },
  };

  const statusColors: Record<string, string> = {
    approved: "#10B981",
    pending: "#F59E0B",
    rejected: "#EF4444",
    generating: "#A855F7",
  };

  return (
    <motion.div
      layout
      className={`rounded-xl border overflow-hidden transition-all ${
        isSelected
          ? "border-purple-500/50 ring-1 ring-purple-500/20"
          : "border-white/[0.06] hover:border-white/[0.12]"
      }`}
      style={{ background: "#13161F" }}
    >
      {/* Ad Preview */}
      <div
        className="h-40 relative flex items-center justify-center p-4 overflow-hidden"
        style={layoutStyles[templateLayout]}
      >
        {templateLayout === "bold-headline" && (
          <p className="text-white font-bold text-[11px] leading-snug text-center max-w-[200px]">
            {ad.message}
          </p>
        )}
        {templateLayout === "minimal-center" && (
          <p className="text-[#2D2D2D] font-serif text-[10px] italic text-center leading-relaxed max-w-[180px]">
            "{ad.message}"
          </p>
        )}
        {templateLayout === "editorial-split" && (
          <div className="flex w-full h-full">
            <div className="w-1/2 flex items-center p-2">
              <p className="text-white text-[9px] leading-relaxed">{ad.message}</p>
            </div>
            <div className="w-1/2 flex items-center justify-center">
              <img src={ad.image} alt="" className="w-12 h-12 object-contain rounded" />
            </div>
          </div>
        )}

        {/* Status badge */}
        <div
          className="absolute top-2 right-2 text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{
            background: `${statusColors[ad.status]}20`,
            color: statusColors[ad.status],
            border: `1px solid ${statusColors[ad.status]}30`,
          }}
        >
          {ad.status}
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 border-t border-white/[0.06]">
        <p className="text-[10px] text-white/50 mb-2 line-clamp-2 leading-relaxed">{ad.message}</p>
        <div className="flex items-center gap-1">
          <button
            onClick={onApprove}
            className={`flex-1 flex items-center justify-center gap-1 text-[9px] font-mono py-1.5 rounded-md transition-all ${
              ad.status === "approved"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-white/[0.04] text-white/40 hover:bg-emerald-500/10 hover:text-emerald-400 border border-white/[0.06]"
            }`}
          >
            <Check size={10} />
          </button>
          <button
            onClick={onRegenerate}
            className="flex-1 flex items-center justify-center gap-1 text-[9px] font-mono py-1.5 rounded-md bg-white/[0.04] text-white/40 hover:bg-amber-500/10 hover:text-amber-400 border border-white/[0.06] transition-all"
          >
            <RefreshCw size={10} />
          </button>
          <button
            onClick={onChat}
            className="flex-1 flex items-center justify-center gap-1 text-[9px] font-mono py-1.5 rounded-md bg-white/[0.04] text-white/40 hover:bg-purple-500/10 hover:text-purple-400 border border-white/[0.06] transition-all"
          >
            <MessageSquare size={10} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Chat Panel ─────────────────────────────────────────────────
function ChatPanel({
  ad,
  onClose,
}: {
  ad: MessageTestingAd;
  onClose: () => void;
}) {
  const [chatInput, setChatInput] = useState("");

  return (
    <motion.div
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 400, opacity: 0 }}
      className="fixed top-0 right-0 w-[380px] h-full z-50 border-l border-white/[0.08] flex flex-col"
      style={{ background: "#0D0F12" }}
    >
      {/* Header */}
      <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white/90">Refine Ad</h3>
          <p className="text-[10px] text-white/30 font-mono mt-0.5">{ad.angleName}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/40">
          <X size={16} />
        </button>
      </div>

      {/* Current Ad Preview */}
      <div className="p-4 border-b border-white/[0.06]">
        <div className="rounded-lg border border-white/[0.06] p-3" style={{ background: "#13161F" }}>
          <p className="text-[11px] text-white/60 leading-relaxed">"{ad.message}"</p>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {MOCK_CHAT_MESSAGES.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-purple-500/15 text-purple-200 border border-purple-500/20"
                  : "bg-white/[0.04] text-white/60 border border-white/[0.06]"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/[0.06]">
        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Describe changes..."
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 placeholder:text-white/20 focus:outline-none focus:border-purple-500/40"
          />
          <button
            onClick={() => {
              toast("Regenerating with feedback...");
              setChatInput("");
            }}
            className="px-3 py-2 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────
export default function MessageTestingAppPage() {
  const [step, setStep] = useState(1);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedAngles, setSelectedAngles] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [generatedAds, setGeneratedAds] = useState<MessageTestingAd[]>([]);
  const [chatAd, setChatAd] = useState<MessageTestingAd | null>(null);
  const [exported, setExported] = useState(false);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [collapsedAngles, setCollapsedAngles] = useState<Set<string>>(new Set());

  const completedProducts = MOCK_PRODUCTS.filter((p) => p.researchStatus === "complete");
  const selectedProduct = MOCK_PRODUCTS.find((p) => p.id === selectedProductId);
  const availableAngles = MOCK_MESSAGE_ANGLES[selectedProductId] || [];
  const selectedTemplate = MOCK_MESSAGE_TEMPLATES.find((t) => t.id === selectedTemplateId);

  // Group ads by angle
  const adsByAngle = useMemo(() => {
    const groups: Record<string, MessageTestingAd[]> = {};
    generatedAds.forEach((ad) => {
      if (!groups[ad.angleId]) groups[ad.angleId] = [];
      groups[ad.angleId].push(ad);
    });
    return groups;
  }, [generatedAds]);

  const approvedCount = generatedAds.filter((a) => a.status === "approved").length;
  const totalCount = generatedAds.length;

  // When product changes, preselect all angles
  const handleProductSelect = (productId: string) => {
    setSelectedProductId(productId);
    const angles = MOCK_MESSAGE_ANGLES[productId] || [];
    setSelectedAngles(angles.map((a) => a.id));
    setProductDropdownOpen(false);
  };

  const toggleAngle = (angleId: string) => {
    setSelectedAngles((prev) =>
      prev.includes(angleId) ? prev.filter((id) => id !== angleId) : [...prev, angleId]
    );
  };

  const handleGenerate = () => {
    const allAds = generateMockMessageAds(selectedProductId, selectedTemplateId);
    const filteredAds = allAds.filter((ad) => selectedAngles.includes(ad.angleId));
    setGeneratedAds(filteredAds);
    setStep(3);
  };

  const handleApproveAd = (adId: string) => {
    setGeneratedAds((prev) =>
      prev.map((ad) =>
        ad.id === adId ? { ...ad, status: ad.status === "approved" ? "pending" : "approved" } : ad
      )
    );
  };

  const handleApproveAll = () => {
    setGeneratedAds((prev) => prev.map((ad) => ({ ...ad, status: "approved" })));
    toast.success("All ads approved");
  };

  const handleRegenerateAd = (adId: string) => {
    setGeneratedAds((prev) =>
      prev.map((ad) => (ad.id === adId ? { ...ad, status: "generating" } : ad))
    );
    setTimeout(() => {
      setGeneratedAds((prev) =>
        prev.map((ad) => (ad.id === adId ? { ...ad, status: "pending" } : ad))
      );
      toast("Ad regenerated");
    }, 1200);
  };

  const toggleCollapseAngle = (angleId: string) => {
    setCollapsedAngles((prev) => {
      const next = new Set(prev);
      if (next.has(angleId)) next.delete(angleId);
      else next.add(angleId);
      return next;
    });
  };

  // ── Step 1: Product & Angles ─────────────────────────────────
  const renderStep1 = () => (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-base font-semibold text-white/90 flex items-center gap-2 mb-1">
          <Sparkles size={16} className="text-purple-400" />
          SELECT PRODUCT & ANGLES
        </h2>
        <p className="text-xs text-white/40">
          Choose a product and select which research angles to generate message testing ads for.
        </p>
      </div>

      {/* Product Selector */}
      <div className="rounded-xl border border-white/[0.08] p-5 mb-6" style={{ background: "#13161F" }}>
        <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3 block">
          Select Product
        </label>
        <div className="relative">
          <button
            onClick={() => setProductDropdownOpen(!productDropdownOpen)}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-left"
          >
            {selectedProduct ? (
              <>
                <img src={selectedProduct.productImage} alt="" className="w-10 h-10 rounded-lg object-contain bg-white/5" />
                <div className="flex-1">
                  <div className="text-sm text-white/90">{selectedProduct.name}</div>
                  <div className="text-[10px] text-white/30 font-mono">
                    {selectedProduct.category} · {selectedProduct.research?.pricePoint}
                  </div>
                </div>
              </>
            ) : (
              <span className="text-sm text-white/30">Choose a product...</span>
            )}
            <ChevronDown size={14} className="text-white/30" />
          </button>

          <AnimatePresence>
            {productDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-30"
                style={{ background: "#1A1D28" }}
              >
                {completedProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => handleProductSelect(product.id)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-white/[0.04] transition-colors text-left"
                  >
                    <img src={product.productImage} alt="" className="w-8 h-8 rounded-lg object-contain bg-white/5" />
                    <div>
                      <div className="text-sm text-white/80">{product.name}</div>
                      <div className="text-[10px] text-white/30 font-mono">{product.category}</div>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Angles Selection */}
      {selectedProductId && availableAngles.length > 0 && (
        <div className="rounded-xl border border-white/[0.08] p-5 mb-6" style={{ background: "#13161F" }}>
          <div className="flex items-center justify-between mb-4">
            <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
              Research Angles ({selectedAngles.length}/{availableAngles.length} selected)
            </label>
            <button
              onClick={() =>
                setSelectedAngles(
                  selectedAngles.length === availableAngles.length
                    ? []
                    : availableAngles.map((a) => a.id)
                )
              }
              className="text-[10px] font-mono text-purple-400 hover:text-purple-300 transition-colors"
            >
              {selectedAngles.length === availableAngles.length ? "Deselect All" : "Select All"}
            </button>
          </div>

          <div className="space-y-2">
            {availableAngles.map((angle) => {
              const isSelected = selectedAngles.includes(angle.id);
              return (
                <button
                  key={angle.id}
                  onClick={() => toggleAngle(angle.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                    isSelected
                      ? "border-purple-500/30 bg-purple-500/[0.06]"
                      : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all ${
                      isSelected
                        ? "bg-purple-500 border-purple-500"
                        : "border border-white/[0.15] bg-white/[0.02]"
                    }`}
                  >
                    {isSelected && <Check size={12} className="text-white" />}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-white/80">{angle.name}</div>
                    <div className="text-[10px] text-white/30 font-mono">
                      {angle.messages.length} messages
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary & Next */}
      {selectedProductId && selectedAngles.length > 0 && (
        <div className="rounded-xl border border-purple-500/20 p-4 mb-6" style={{ background: "rgba(168,85,247,0.04)" }}>
          <div className="flex items-center justify-between text-xs text-white/50 mb-1">
            <span>Total ads to generate:</span>
            <span className="text-purple-400 font-mono font-semibold">
              {selectedAngles.reduce((sum, id) => {
                const angle = availableAngles.find((a) => a.id === id);
                return sum + (angle?.messages.length || 0);
              }, 0)}{" "}
              ads
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Across angles:</span>
            <span className="text-white/60 font-mono">{selectedAngles.length} angles</span>
          </div>
        </div>
      )}

      <button
        onClick={() => setStep(2)}
        disabled={!selectedProductId || selectedAngles.length === 0}
        className="w-full py-3.5 rounded-xl font-mono text-sm uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        style={{
          background: selectedProductId && selectedAngles.length > 0
            ? "linear-gradient(135deg, #A855F7, #7C3AED)"
            : "#1A1D28",
          color: selectedProductId && selectedAngles.length > 0 ? "white" : "#555",
        }}
      >
        NEXT: CHOOSE TEMPLATE
      </button>
    </div>
  );

  // ── Step 2: Choose Template ──────────────────────────────────
  const renderStep2 = () => {
    const sampleMessage = availableAngles[0]?.messages[0] || "Sample message text";

    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="text-base font-semibold text-white/90 flex items-center gap-2 mb-1">
            <Layers size={16} className="text-purple-400" />
            CHOOSE TEMPLATE
          </h2>
          <p className="text-xs text-white/40">
            Select one template style for all your message testing ads. Preview uses the first message from your first angle.
          </p>
        </div>

        {/* Context Tags */}
        <div className="flex flex-wrap gap-2 mb-6">
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
            ✦ {selectedProduct?.name}
          </span>
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
            ◎ {selectedAngles.length} angles
          </span>
        </div>

        {/* Template Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
          {MOCK_MESSAGE_TEMPLATES.map((template) => (
            <TemplatePreview
              key={template.id}
              template={template}
              sampleMessage={sampleMessage}
              selected={selectedTemplateId === template.id}
              onSelect={() => setSelectedTemplateId(template.id)}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => setStep(1)}
            className="px-5 py-3 rounded-xl font-mono text-xs uppercase tracking-wider bg-white/[0.04] text-white/40 hover:bg-white/[0.08] border border-white/[0.06] transition-all"
          >
            Back
          </button>
          <button
            onClick={handleGenerate}
            disabled={!selectedTemplateId}
            className="flex-1 py-3 rounded-xl font-mono text-sm uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: selectedTemplateId
                ? "linear-gradient(135deg, #A855F7, #7C3AED)"
                : "#1A1D28",
              color: selectedTemplateId ? "white" : "#555",
            }}
          >
            GENERATE ALL ADS
          </button>
        </div>
      </div>
    );
  };

  // ── Step 3: Review Ads ───────────────────────────────────────
  const renderStep3 = () => (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-white/90 flex items-center gap-2 mb-1">
            <Eye size={16} className="text-purple-400" />
            REVIEW ADS ({totalCount})
          </h2>
          <p className="text-xs text-white/40">
            Review, approve, or regenerate each ad. Click the chat icon to give specific feedback.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleApproveAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
          >
            <CheckCircle2 size={12} />
            APPROVE ALL
          </button>
          <button
            onClick={() => setStep(4)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider transition-all"
            style={{ background: "linear-gradient(135deg, #A855F7, #7C3AED)", color: "white" }}
          >
            <Download size={12} />
            EXPORT
          </button>
        </div>
      </div>

      {/* Context Tags */}
      <div className="flex flex-wrap gap-2 mb-6">
        <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
          ✦ {selectedProduct?.name}
        </span>
        <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">
          {approvedCount}/{totalCount} approved
        </span>
      </div>

      {/* Ads grouped by angle */}
      <div className="space-y-8">
        {Object.entries(adsByAngle).map(([angleId, ads]) => {
          const angle = availableAngles.find((a) => a.id === angleId);
          const isCollapsed = collapsedAngles.has(angleId);
          const angleApproved = ads.filter((a) => a.status === "approved").length;

          return (
            <div key={angleId}>
              {/* Angle Header */}
              <button
                onClick={() => toggleCollapseAngle(angleId)}
                className="w-full flex items-center gap-3 mb-4 group"
              >
                <div className="w-2 h-2 rounded-full bg-purple-400" style={{ boxShadow: "0 0 8px rgba(168,85,247,0.5)" }} />
                <span className="text-xs font-mono text-white/60 uppercase tracking-widest">
                  {angle?.name || angleId}
                </span>
                <span className="text-[10px] font-mono text-white/30">
                  {angleApproved}/{ads.length} approved
                </span>
                <div className="flex-1 h-px bg-white/[0.06]" />
                {isCollapsed ? (
                  <ChevronDown size={14} className="text-white/30" />
                ) : (
                  <ChevronUp size={14} className="text-white/30" />
                )}
              </button>

              {/* Ads Grid */}
              <AnimatePresence>
                {!isCollapsed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3"
                  >
                    {ads.map((ad) => (
                      <AdCard
                        key={ad.id}
                        ad={ad}
                        templateLayout={selectedTemplate?.layout || "bold-headline"}
                        onApprove={() => handleApproveAd(ad.id)}
                        onReject={() => {
                          setGeneratedAds((prev) =>
                            prev.map((a) => (a.id === ad.id ? { ...a, status: "rejected" } : a))
                          );
                        }}
                        onRegenerate={() => handleRegenerateAd(ad.id)}
                        onChat={() => setChatAd(ad)}
                        isSelected={chatAd?.id === ad.id}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Chat Panel */}
      <AnimatePresence>
        {chatAd && <ChatPanel ad={chatAd} onClose={() => setChatAd(null)} />}
      </AnimatePresence>
    </div>
  );

  // ── Step 4: Export ───────────────────────────────────────────
  const renderStep4 = () => {
    if (!exported) {
      return (
        <div className="max-w-3xl mx-auto">
          <div className="mb-8">
            <h2 className="text-base font-semibold text-white/90 flex items-center gap-2 mb-1">
              <FolderDown size={16} className="text-purple-400" />
              EXPORT ADS
            </h2>
            <p className="text-xs text-white/40">
              Download your approved ads organized by angle folders and save them to the brand workspace assets.
            </p>
          </div>

          {/* Export Summary */}
          <div className="rounded-xl border border-white/[0.08] p-5 mb-6" style={{ background: "#13161F" }}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Export Summary</span>
              <span className="text-xs font-mono text-purple-400">{approvedCount} approved ads ready</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-white/50">
                <span>Product</span>
                <span className="text-white/70">{selectedProduct?.name}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-white/50">
                <span>Template</span>
                <span className="text-white/70">{selectedTemplate?.name}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-white/50">
                <span>Total Ads</span>
                <span className="text-white/70">{approvedCount} files</span>
              </div>
            </div>
          </div>

          {/* Folder Preview */}
          <div className="rounded-xl border border-white/[0.08] p-5 mb-6" style={{ background: "#13161F" }}>
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-4 block">
              Download Structure (by Angle)
            </span>

            <div className="space-y-3">
              {Object.entries(adsByAngle).map(([angleId, ads]) => {
                const angle = availableAngles.find((a) => a.id === angleId);
                const approvedInAngle = ads.filter((a) => a.status === "approved").length;

                return (
                  <div
                    key={angleId}
                    className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02]"
                  >
                    <FolderDown size={16} className="text-purple-400 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs text-white/70">{angle?.name || angleId}</div>
                      <div className="text-[10px] text-white/30 font-mono">
                        {approvedInAngle} approved ads
                      </div>
                    </div>
                    <div className="flex -space-x-2">
                      {ads.filter((a) => a.status === "approved").slice(0, 4).map((ad, i) => (
                        <div
                          key={ad.id}
                          className="w-8 h-8 rounded border border-white/[0.1] overflow-hidden"
                          style={{ zIndex: 4 - i }}
                        >
                          <img src={ad.image} alt="" className="w-full h-full object-cover" />
                        </div>
                      ))}
                      {approvedInAngle > 4 && (
                        <div className="w-8 h-8 rounded border border-white/[0.1] bg-white/[0.04] flex items-center justify-center text-[9px] text-white/40 font-mono">
                          +{approvedInAngle - 4}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => {
              setExported(true);
              toast.success(`${approvedCount} ads exported and saved to brand assets`);
            }}
            className="w-full py-3.5 rounded-xl font-mono text-sm uppercase tracking-wider transition-all"
            style={{ background: "linear-gradient(135deg, #A855F7, #7C3AED)", color: "white" }}
          >
            <span className="flex items-center justify-center gap-2">
              <Download size={16} />
              DOWNLOAD & SAVE TO BRAND ASSETS
            </span>
          </button>
        </div>
      );
    }

    // Post-export: What's Next
    return (
      <div className="max-w-3xl mx-auto">
        {/* Success */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.2), rgba(124,58,237,0.2))", border: "2px solid rgba(168,85,247,0.3)" }}
          >
            <CheckCircle2 size={28} className="text-purple-400" />
          </motion.div>
          <h2 className="text-lg font-semibold text-white/90 mb-1 font-mono uppercase tracking-wider">
            Export Complete
          </h2>
          <p className="text-xs text-white/40">
            {approvedCount} ads downloaded and saved to your brand workspace assets.
          </p>
        </div>

        {/* Saved Summary */}
        <div className="rounded-xl border border-white/[0.08] p-5 mb-8" style={{ background: "#13161F" }}>
          <div className="flex items-center gap-2 mb-4">
            <FolderDown size={14} className="text-purple-400" />
            <span className="text-xs font-mono text-white/50 uppercase tracking-widest">Saved to Assets</span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2">
            {generatedAds
              .filter((a) => a.status === "approved")
              .slice(0, 8)
              .map((ad) => (
                <div key={ad.id} className="w-20 h-20 rounded-lg border border-white/[0.08] overflow-hidden flex-shrink-0">
                  <img src={ad.image} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            {approvedCount > 8 && (
              <div className="w-20 h-20 rounded-lg border border-white/[0.08] flex items-center justify-center flex-shrink-0 bg-white/[0.02]">
                <span className="text-xs text-white/30 font-mono">+{approvedCount - 8}</span>
              </div>
            )}
          </div>

          <div className="mt-3 text-right">
            <Link href="/workspace/assets">
              <span className="text-[10px] font-mono text-purple-400 hover:text-purple-300 transition-colors cursor-pointer">
                View in Assets →
              </span>
            </Link>
          </div>
        </div>

        {/* What's Next */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-amber-400" style={{ boxShadow: "0 0 8px rgba(245,158,11,0.5)" }} />
            <span className="text-xs font-mono text-white/40 uppercase tracking-widest">What's Next?</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => {
                setStep(2);
                setSelectedTemplateId("");
                setGeneratedAds([]);
                setExported(false);
                toast("Choose a new template for the same angles");
              }}
              className="rounded-xl border border-white/[0.08] p-5 text-left hover:border-purple-500/30 hover:bg-purple-500/[0.02] transition-all group"
              style={{ background: "#13161F" }}
            >
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3">
                <RotateCcw size={18} className="text-purple-400" />
              </div>
              <h4 className="text-sm font-semibold text-white/80 mb-1">Try a Different Template</h4>
              <p className="text-[11px] text-white/35 leading-relaxed">
                Keep the same product and angles but generate with a different template style.
              </p>
              <span className="text-[10px] font-mono text-purple-400 mt-3 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                CHANGE TEMPLATE <ChevronRight size={10} />
              </span>
            </button>

            <button
              onClick={() => {
                setStep(1);
                setSelectedAngles([]);
                setSelectedTemplateId("");
                setGeneratedAds([]);
                setExported(false);
                toast("Select different angles for the same product");
              }}
              className="rounded-xl border border-white/[0.08] p-5 text-left hover:border-amber-500/30 hover:bg-amber-500/[0.02] transition-all group"
              style={{ background: "#13161F" }}
            >
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-3">
                <Layers size={18} className="text-amber-400" />
              </div>
              <h4 className="text-sm font-semibold text-white/80 mb-1">Different Angles</h4>
              <p className="text-[11px] text-white/35 leading-relaxed">
                Go back and select different research angles to generate a new batch of message testing ads.
              </p>
              <span className="text-[10px] font-mono text-amber-400 mt-3 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                CHANGE ANGLES <ChevronRight size={10} />
              </span>
            </button>
          </div>
        </div>

        <Link href="/workspace/apps">
          <span className="block w-full py-3 rounded-xl font-mono text-xs uppercase tracking-wider text-center bg-white/[0.04] text-white/40 hover:bg-white/[0.08] border border-white/[0.06] transition-all cursor-pointer">
            BACK TO APPS
          </span>
        </Link>
      </div>
    );
  };

  return (
    <div className="min-h-screen" style={{ background: "#0A0C10" }}>
      {/* Top Bar */}
      <div
        className="border-b border-white/[0.06] px-4 py-3 flex items-center gap-3"
        style={{ background: "#0D0F12" }}
      >
        <Link href="/workspace/apps">
          <span className="text-[10px] font-mono text-white/30 hover:text-white/50 transition-colors flex items-center gap-1 cursor-pointer">
            <ArrowLeft size={12} />
            APPS
          </span>
        </Link>
        <span className="text-white/10">|</span>
        <MessageSquare size={14} className="text-purple-400" />
        <span className="text-xs font-mono text-white/60 uppercase tracking-wider">
          Message Testing Ads Creator
        </span>
      </div>

      {/* Step Indicator */}
      <div className="border-b border-white/[0.06] px-6 py-3 flex items-center gap-1 overflow-x-auto" style={{ background: "#0D0F12" }}>
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = step === s.id;
          const isDone = step > s.id;

          return (
            <div key={s.id} className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (isDone) setStep(s.id);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-purple-500/15 text-purple-400 border border-purple-500/25"
                    : isDone
                    ? "text-white/40 hover:text-white/60 cursor-pointer"
                    : "text-white/15"
                }`}
              >
                {isDone ? (
                  <CheckCircle2 size={12} className="text-emerald-400" />
                ) : (
                  <span className={isActive ? "text-purple-400" : "text-white/15"}>{s.id}</span>
                )}
                {s.label}
              </button>
              {i < STEPS.length - 1 && <ChevronRight size={12} className="text-white/10 mx-1" />}
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className="p-6">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>
    </div>
  );
}
