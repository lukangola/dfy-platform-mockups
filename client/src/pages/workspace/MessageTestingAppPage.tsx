/**
 * DESIGN: Studio Control Room — Message Testing Ads Creator
 * 5-step workflow:
 *   1. Select Product & Angles
 *   2. Review Messages (edit / confirm per angle)
 *   3. Review Template (single reference template, live nano-banana-pro preview + feedback loop)
 *   4. Review All Generated Ads
 *   5. Export
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ChevronRight, Check, X, RefreshCw, Send,
  Download, MessageSquare, Package, Layers, Eye,
  CheckCircle2, Sparkles, FolderDown, RotateCcw,
  ChevronDown, ChevronUp, Loader2, AlertTriangle,
  Plus,
} from "lucide-react";
import {
  createJob, getJob, listJobs,
  listProducts, getProductAngles, generateMessageTestingCopy, generateImage,
  getReferenceStyle, saveBrandAssets,
  type Job, type JobItem,
  type Product, type ProductAngle, type MessageAngleGroup,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { MOCK_CHAT_MESSAGES, LANGUAGES } from "@/lib/mockData";
import { toast } from "sonner";

const STEPS = [
  { id: 1, label: "Product & Angles", icon: Package },
  { id: 2, label: "Review Messages", icon: MessageSquare },
  { id: 3, label: "Review Template", icon: Layers },
  { id: 4, label: "Review Ads", icon: Eye },
  { id: 5, label: "Export", icon: Download },
];

// ── Single reference template ─────────────────────────────────
// Two-stage flow:
//   1. PREVIEW (step 3): recreate the editorial-quote reference for THIS product
//      using [reference image + product image]. The user tweaks with feedback
//      until satisfied, then approves.
//   2. BATCH (step 4): use the approved preview as the canonical reference. Every
//      subsequent ad reproduces it exactly — only the headline quote text changes.
const REFERENCE_TEMPLATE = {
  name: "Editorial Quote",
  layout: "editorial-quote" as const,

  /** Step 3 preview: recreate the reference layout for the product's brand. */
  previewComposition: (
    message: string,
    feedback: string,
    style: Record<string, unknown> | null,
  ) => {
    const styleBlock = style
      ? `\n\nReference spec (for style guidance only — the first attached image is the canonical reference):\n${JSON.stringify(style, null, 2)}\n`
      : "";
    const base =
      `Recreate the editorial-quote advertisement shown in the FIRST reference image, but as a new 1:1 square ad for the product shown in the SECOND reference image. Match the first image's layout, typography, composition, product placement, and pill-badge style. Adapt the background color and pill-badge color to this product's own brand palette (extract from the product's label and cap). Keep the product at approximately the same relative size as in the reference. Keep the "#1" pill badge at approximately the same size and position — adapt its claim text to fit the product (short, two lines max). Replace the headline quote with exactly: "${message}" — wrap in the same curly quotation marks, near-black editorial serif, oversized, left-aligned, natural phrase-based line breaks that fill the upper-left area without overlapping the product. Headline and product must not overlap. No watermarks, no logos, no extra captions. 2K resolution, sharp focus.` +
      styleBlock;
    const trimmed = feedback.trim();
    return trimmed ? `${base}\n\nAdditional direction from user: ${trimmed}` : base;
  },

  /** Step 4 batch: the approved preview is the reference. Only the headline changes. */
  batchComposition: (message: string, feedback: string) => {
    const base =
      `Reproduce the attached reference image EXACTLY. The ONLY thing that changes is the headline quote text — replace it with exactly: "${message}" (wrap in the same curly quotation marks shown in the reference). Everything else is identical: same background color, same product and product size, same product position, same "#1" pill badge with the same text and same size, same typography, same lighting, same layout, same composition. Use natural phrase-based line breaks for the new headline so it fills the same headline area as the reference without overlapping the product. 1:1 square, 2K resolution, sharp focus. Do not add, remove, or alter any element except the headline text.`;
    const trimmed = feedback.trim();
    return trimmed ? `${base}\n\nAdditional direction from user: ${trimmed}` : base;
  },
};

function buildAdInput(
  prompt: string,
  imageUrls: (string | null | undefined)[],
): { model: string; input: Record<string, unknown> } {
  const cleaned = imageUrls.filter((u): u is string => Boolean(u));
  if (cleaned.length > 0) {
    return {
      model: "fal-ai/nano-banana-pro/edit",
      input: {
        prompt,
        image_urls: cleaned,
        aspect_ratio: "1:1",
        resolution: "2K",
        num_images: 1,
        output_format: "jpeg",
      },
    };
  }
  return {
    model: "fal-ai/flux-pro/v1.1",
    input: { prompt, aspect_ratio: "1:1", num_images: 1, output_format: "jpeg" },
  };
}

const TEMPLATE_BG = "linear-gradient(135deg, #EFE6D4 0%, #E2D3B6 100%)";

// ── Types ──────────────────────────────────────────────────────
type AdStatus = "pending" | "approved" | "rejected" | "generating" | "failed";

type LiveAd = {
  id: string;
  angleName: string;
  message: string;
  status: AdStatus;
  imageUrl?: string;
  error?: string;
};

/** LiveAd fields snapshotted into the job payload (null instead of undefined
 *  so the shape survives JSON round-trips) — enough for hydrateFromJob to
 *  rebuild the review grid without any other fetch. Includes angleName so the
 *  Dashboard's item labels and the restored grid both know their angle. */
type AdSnapshot = {
  id: string;
  angleName: string;
  message: string;
  status: AdStatus;
  imageUrl: string | null;
  error: string | null;
};

// ── Ad Card ────────────────────────────────────────────────────
function AdCard({
  ad,
  onApprove,
  onRegenerate,
  onChat,
  isSelected,
}: {
  ad: LiveAd;
  onApprove: () => void;
  onRegenerate: () => void;
  onChat: () => void;
  isSelected: boolean;
}) {
  const statusColors: Record<AdStatus, string> = {
    approved: "#10B981",
    pending: "#F59E0B",
    rejected: "#EF4444",
    generating: "#A855F7",
    failed: "#EF4444",
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
      <div
        className="relative overflow-hidden"
        style={{ aspectRatio: "1/1", background: TEMPLATE_BG }}
      >
        {ad.imageUrl ? (
          <img src={ad.imageUrl} alt={ad.message} className="w-full h-full object-cover" />
        ) : ad.status === "generating" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={22} className="text-[#2D2D2D]/40 animate-spin" />
          </div>
        ) : ad.status === "failed" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2">
            <AlertTriangle size={18} className="text-rose-400" />
            <p className="text-[9px] text-rose-400/80 text-center line-clamp-3">{ad.error ?? "Failed"}</p>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-3">
            <p className="text-[#2D2D2D] font-serif text-[10px] italic text-center leading-relaxed max-w-[160px]">
              "{ad.message}"
            </p>
          </div>
        )}

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

      <div className="p-3 border-t border-white/[0.06]">
        <p className="text-[10px] text-white/50 mb-2 line-clamp-2 leading-relaxed">{ad.message}</p>
        <div className="flex items-center gap-1">
          <button
            onClick={onApprove}
            disabled={ad.status === "generating" || !ad.imageUrl}
            className={`flex-1 flex items-center justify-center gap-1 text-[9px] font-mono py-1.5 rounded-md transition-all disabled:opacity-30 ${
              ad.status === "approved"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-white/[0.04] text-white/40 hover:bg-emerald-500/10 hover:text-emerald-400 border border-white/[0.06]"
            }`}
          >
            <Check size={10} />
          </button>
          <button
            onClick={onRegenerate}
            disabled={ad.status === "generating"}
            className="flex-1 flex items-center justify-center gap-1 text-[9px] font-mono py-1.5 rounded-md bg-white/[0.04] text-white/40 hover:bg-amber-500/10 hover:text-amber-400 border border-white/[0.06] transition-all disabled:opacity-30"
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
function ChatPanel({ ad, onClose }: { ad: LiveAd; onClose: () => void }) {
  const [chatInput, setChatInput] = useState("");

  return (
    <motion.div
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 400, opacity: 0 }}
      className="fixed top-0 right-0 w-[380px] h-full z-50 border-l border-white/[0.08] flex flex-col"
      style={{ background: "#0D0F12" }}
    >
      <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white/90">Refine Ad</h3>
          <p className="text-[10px] text-white/30 font-mono mt-0.5">{ad.angleName}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/40">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 border-b border-white/[0.06]">
        <div className="rounded-lg border border-white/[0.06] p-3" style={{ background: "#13161F" }}>
          <p className="text-[11px] text-white/60 leading-relaxed">"{ad.message}"</p>
        </div>
      </div>

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
              toast("Chat refinement not yet wired — regenerating uses the current prompt.");
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
  const { activeBrandId } = useBrand();
  const [step, setStep] = useState(1);

  // Live products
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  // Output language for the generated messages.
  const [selectedLanguage, setSelectedLanguage] = useState("en");

  // Research angles (name+block) for the selected product
  const [angles, setAngles] = useState<ProductAngle[]>([]);
  const [anglesLoading, setAnglesLoading] = useState(false);
  const [anglesError, setAnglesError] = useState<string | null>(null);
  const [selectedAngleNames, setSelectedAngleNames] = useState<string[]>([]);

  // Messages generated from message_testing_copy (editable + confirmable per angle)
  const [messageGroups, setMessageGroups] = useState<MessageAngleGroup[] | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [confirmedAngleNames, setConfirmedAngleNames] = useState<Set<string>>(new Set());
  const [regeneratingAngles, setRegeneratingAngles] = useState<Set<string>>(new Set());

  // Template preview + feedback loop
  const [templateFeedback, setTemplateFeedback] = useState("");
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState<string | null>(null);
  const [templatePreviewLoading, setTemplatePreviewLoading] = useState(false);
  const [templatePreviewError, setTemplatePreviewError] = useState<string | null>(null);

  // Reference image + extracted style (used by nano-banana-pro/edit at 1:1 2K).
  // When the reference file at client/public/templates/editorial-quote-reference.jpg
  // is missing, these stay null and the hand-authored prompt is used.
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceStyle, setReferenceStyle] = useState<Record<string, unknown> | null>(null);

  // Approved preview: captured at the moment the user clicks "Generate All Ads".
  // Every batch / single regeneration uses this as the ONLY reference so the
  // whole set stays visually consistent — only the headline text changes.
  const [approvedReferenceUrl, setApprovedReferenceUrl] = useState<string | null>(null);

  // Generated ads (live fal.ai results)
  const [generatedAds, setGeneratedAds] = useState<LiveAd[]>([]);
  const [chatAd, setChatAd] = useState<LiveAd | null>(null);
  const [exported, setExported] = useState(false);
  const [collapsedAngles, setCollapsedAngles] = useState<Set<string>>(new Set());

  // Durable jobs: ad-image batches run server-side (survive reload + deploys).
  // The page tracks the active job ids and mirrors item state onto ads via
  // the poll effect below. Multiple ids can be live at once — the batch plus
  // single-ad regenerates fired off already-finished cards.
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  // Unfinished-session banner: newest queued/running message_testing job for
  // this brand, offered as a one-click resume when the page isn't tracking a job.
  const [resumableJob, setResumableJob] = useState<Job | null>(null);
  // Job orchestration errors (create/hydrate failures) — per-ad generation
  // errors still render on the cards themselves.
  const [jobError, setJobError] = useState<string | null>(null);
  // Synchronous re-entrancy guard for the batch creator: activeJobIds only
  // gains the id once createJob returns, so without this a second click
  // during the awaits (adoptUnfinishedJob, createJob) double-creates a job.
  const generateInFlightRef = useRef(false);
  // adId → id of the job that most recently targeted it. Two live jobs can
  // both hold an item for the same ad (the original batch + a later single-ad
  // regenerate); without this the still-polled batch item would stomp the
  // regenerate's spinner/result with the old output every tick.
  const jobOwnerRef = useRef<Map<string, string>>(new Map());
  // Set by hydrateFromJob just before it switches the product, so the
  // product-change effect below keeps the restored session state instead of
  // resetting it for a fresh product.
  const hydratingRef = useRef(false);

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

  // Fetch the reference-style spec once (cached server-side).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await getReferenceStyle();
        if (cancelled) return;
        if ("missing" in r && r.missing) {
          // Reference file not dropped yet — use the hand-authored fallback prompt.
          return;
        }
        setReferenceImageUrl(r.referenceImageUrl);
        setReferenceStyle(r.style);
      } catch (err) {
        // Non-fatal: downstream calls will fall back to the hand-authored prompt.
        console.warn("Reference style unavailable:", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const researchedProducts = useMemo(
    () => products.filter((p) => p.researchStatus === "complete" && p.research?.markdown),
    [products]
  );
  const selectedProduct = researchedProducts.find((p) => p.id === selectedProductId);

  // Fetch angles whenever the selected product changes.
  useEffect(() => {
    if (!selectedProductId) {
      setAngles([]);
      setSelectedAngleNames([]);
      setAnglesError(null);
      setMessageGroups(null);
      setCopyError(null);
      setConfirmedAngleNames(new Set());
      setTemplateFeedback("");
      setTemplatePreviewUrl(null);
      setTemplatePreviewError(null);
      return;
    }
    // hydrateFromJob switches the product as part of restoring a saved
    // session — keep the restored messages/preview/angle selection instead of
    // resetting them for a fresh product (still fetch the angle list so the
    // step-1/2 UIs work if the user navigates back).
    const hydrating = hydratingRef.current;
    hydratingRef.current = false;
    let cancelled = false;
    setAnglesLoading(true);
    setAnglesError(null);
    if (!hydrating) {
      setMessageGroups(null);
      setCopyError(null);
      setConfirmedAngleNames(new Set());
      setTemplateFeedback("");
      setTemplatePreviewUrl(null);
      setTemplatePreviewError(null);
    }
    (async () => {
      try {
        const { angles: fetched } = await getProductAngles(selectedProductId);
        if (!cancelled) {
          setAngles(fetched);
          if (!hydrating) setSelectedAngleNames(fetched.map((a) => a.name));
        }
      } catch (err) {
        if (!cancelled) setAnglesError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setAnglesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProductId]);

  const selectedAngles = useMemo(
    () => angles.filter((a) => selectedAngleNames.includes(a.name)),
    [angles, selectedAngleNames]
  );

  // Auto-generate template preview when entering step 3 without one.
  useEffect(() => {
    if (step !== 3) return;
    if (templatePreviewUrl || templatePreviewLoading || templatePreviewError) return;
    if (!selectedProduct) return;
    const firstGroup = messageGroups?.find((g) => selectedAngleNames.includes(g.name));
    if (!firstGroup?.messages[0]) return;
    void regenerateTemplatePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Group ads by angle name
  const adsByAngle = useMemo(() => {
    const groups: Record<string, LiveAd[]> = {};
    generatedAds.forEach((ad) => {
      if (!groups[ad.angleName]) groups[ad.angleName] = [];
      groups[ad.angleName].push(ad);
    });
    return groups;
  }, [generatedAds]);

  const approvedCount = generatedAds.filter((a) => a.status === "approved").length;
  const readyCount = generatedAds.filter((a) => a.imageUrl).length;
  const totalCount = generatedAds.length;

  const handleProductSelect = (productId: string) => {
    // A manual pick always resets: clear any hydrate latch a still-in-flight
    // hydrateFromJob may have set (its restore would target the same product,
    // so the ref would otherwise stay latched and skip one future reset).
    hydratingRef.current = false;
    setSelectedProductId(productId);
    setProductDropdownOpen(false);
  };

  const toggleAngle = (name: string) => {
    setSelectedAngleNames((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  // Switching language invalidates any already-generated messages (they were
  // written in the previous language), so the next "Next" regenerates them.
  const handleLanguageChange = (code: string) => {
    setSelectedLanguage(code);
    setMessageGroups(null);
    setConfirmedAngleNames(new Set());
  };

  // Step 1 → 2: run the copy writer, land on the message review screen.
  const handleAdvanceToMessageReview = async () => {
    if (!selectedProduct || selectedAngles.length === 0) return;
    const haveAll =
      messageGroups &&
      selectedAngleNames.every((n) => messageGroups.some((g) => g.name === n));
    if (haveAll) {
      setStep(2);
      return;
    }
    setCopyLoading(true);
    setCopyError(null);
    try {
      const selectedLang = LANGUAGES.find((l) => l.code === selectedLanguage) ?? LANGUAGES[0];
      const { groups } = await generateMessageTestingCopy({
        productId: selectedProductId,
        angles: selectedAngles,
        language: selectedLang.label,
      });
      setMessageGroups(groups);
      setConfirmedAngleNames(new Set());
      setStep(2);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCopyError(msg);
      toast.error(`Copy writer failed: ${msg}`);
    } finally {
      setCopyLoading(false);
    }
  };

  const updateMessage = (angleName: string, idx: number, text: string) => {
    setMessageGroups((prev) => {
      if (!prev) return prev;
      return prev.map((g) =>
        g.name === angleName
          ? { ...g, messages: g.messages.map((m, i) => (i === idx ? text : m)) }
          : g
      );
    });
  };

  const removeMessage = (angleName: string, idx: number) => {
    setMessageGroups((prev) => {
      if (!prev) return prev;
      return prev.map((g) =>
        g.name === angleName
          ? { ...g, messages: g.messages.filter((_, i) => i !== idx) }
          : g
      );
    });
  };

  const addMessage = (angleName: string) => {
    setMessageGroups((prev) => {
      if (!prev) return prev;
      return prev.map((g) =>
        g.name === angleName ? { ...g, messages: [...g.messages, ""] } : g
      );
    });
  };

  const toggleConfirmAngle = (angleName: string) => {
    setConfirmedAngleNames((prev) => {
      const next = new Set(prev);
      if (next.has(angleName)) next.delete(angleName);
      else next.add(angleName);
      return next;
    });
  };

  const regenerateAngle = async (angleName: string) => {
    if (!selectedProduct) return;
    const angle = angles.find((a) => a.name === angleName);
    if (!angle) return;
    setRegeneratingAngles((prev) => new Set(prev).add(angleName));
    try {
      const selectedLang = LANGUAGES.find((l) => l.code === selectedLanguage) ?? LANGUAGES[0];
      const { groups } = await generateMessageTestingCopy({
        productId: selectedProductId,
        angles: [angle],
        language: selectedLang.label,
        force: true,
      });
      const fresh = groups.find((g) => g.name === angleName) ?? groups[0];
      if (fresh) {
        setMessageGroups((prev) =>
          prev ? prev.map((g) => (g.name === angleName ? fresh : g)) : prev
        );
        setConfirmedAngleNames((prev) => {
          const next = new Set(prev);
          next.delete(angleName);
          return next;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Regenerate failed: ${msg}`);
    } finally {
      setRegeneratingAngles((prev) => {
        const next = new Set(prev);
        next.delete(angleName);
        return next;
      });
    }
  };

  // Render a single-message preview using the current template + feedback.
  // Deliberately a DIRECT call, not a durable job: it's a quick, iterative
  // step-3 loop that auto-kicks on step entry — jobs would spam the dashboard.
  async function regenerateTemplatePreview() {
    if (!selectedProduct) return;
    const firstGroup = messageGroups?.find((g) => selectedAngleNames.includes(g.name));
    const sampleMessage = firstGroup?.messages[0];
    if (!sampleMessage) {
      toast.error("Need at least one message to preview the template.");
      return;
    }
    setTemplatePreviewLoading(true);
    setTemplatePreviewError(null);
    const productImageUrl = selectedProduct.productImageUrl
      ? selectedProduct.productImageUrl.replace(/^http:\/\//, "https://")
      : null;
    try {
      const prompt = REFERENCE_TEMPLATE.previewComposition(sampleMessage, templateFeedback, referenceStyle);
      const { model, input } = buildAdInput(prompt, [referenceImageUrl, productImageUrl]);
      const res = await generateImage("message_ad", { input, model });
      setTemplatePreviewUrl(res.urls[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTemplatePreviewError(msg);
      toast.error(`Preview failed: ${msg}`);
    } finally {
      setTemplatePreviewLoading(false);
    }
  }

  // ---------- Durable-job machinery (mirrors StaticAdsAppPage) ----------

  /** Session snapshot stored on every job — enough for hydrateFromJob to
   *  restore the review grid (config chips + ad cards) without any other
   *  fetch. Item outputs overlay whatever finished after the snapshot.
   *  `approvedRef` is passed explicitly: at batch kick the state setter for
   *  approvedReferenceUrl hasn't committed yet. */
  function buildSessionPayload(ads: LiveAd[], approvedRef: string | null) {
    return {
      productId: selectedProductId,
      productName: selectedProduct?.name ?? null,
      angleNames: selectedAngleNames,
      language: selectedLanguage,
      messageGroups,
      approvedReferenceUrl: approvedRef,
      templatePreviewUrl,
      // Frozen alongside the approved reference: post-resume single-ad
      // reworks re-append the same feedback suffix the batch rendered with.
      templateFeedback,
      // Snapshots are always taken from (or headed to) the review grid.
      step: 4,
      ads: ads.map((a): AdSnapshot => ({
        id: a.id,
        angleName: a.angleName,
        message: a.message,
        status: a.status,
        imageUrl: a.imageUrl ?? null,
        error: a.error ?? null,
      })),
    };
  }

  /** item.input for the message_testing_images executor: a generic
   *  model+falInput passthrough, plus adId so poll ticks can map the item
   *  back onto its card. */
  function buildJobItem(ad: LiveAd, approvedRef: string) {
    const prompt = REFERENCE_TEMPLATE.batchComposition(ad.message, templateFeedback);
    const { model, input } = buildAdInput(prompt, [approvedRef]);
    return {
      label: `${ad.message.slice(0, 60)} (${ad.angleName})`,
      input: { adId: ad.id, kind: "image", model, falInput: input },
    };
  }

  /** Mirror a job item's state onto its ad card. A finished generation lands
   *  in "pending" (awaiting review) with the image URL — exactly the status
   *  the old direct-call path assigned. */
  function applyItemToAd(it: JobItem) {
    const adId = (it.input as { adId?: string }).adId;
    if (!adId) return;
    // Only the job that most recently targeted this ad may write to it — see
    // jobOwnerRef. (An owner is recorded on every create/adopt, so a missing
    // owner just means "apply".)
    const owner = jobOwnerRef.current.get(adId);
    if (owner && owner !== it.jobId) return;
    const out = (it.output ?? {}) as { url?: string };
    if (it.status === "complete" && out.url) {
      setGeneratedAds((prev) =>
        prev.map((a) =>
          a.id === adId && a.status === "generating"
            ? { ...a, status: "pending", imageUrl: out.url, error: undefined }
            : a,
        ),
      );
    } else if (it.status === "failed") {
      setGeneratedAds((prev) =>
        prev.map((a) =>
          a.id === adId && a.status === "generating"
            ? { ...a, status: "failed", error: it.error ?? "Generation failed" }
            : a,
        ),
      );
    }
  }

  // Poll all active jobs every 2.5s (the app's standard cadence) and mirror
  // item states onto ads; drop each job from the active set once it reaches a
  // terminal status.
  useEffect(() => {
    if (activeJobIds.length === 0) return;
    let cancelled = false;
    const pollOne = async (jobId: string) => {
      try {
        const { job, items } = await getJob(jobId);
        if (cancelled) return;
        for (const it of items) applyItemToAd(it);
        if (job.status !== "queued" && job.status !== "running") {
          setActiveJobIds((prev) => prev.filter((id) => id !== jobId));
        }
      } catch {
        /* transient — next tick retries */
      }
    };
    const tick = () => {
      for (const id of activeJobIds) void pollOne(id);
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobIds]);

  /**
   * Restore the full review session from a job: the payload snapshot provides
   * the config + ad cards as of trigger time; item outputs overlay whatever
   * finished after the snapshot. Adopts the job as a poll target when it is
   * still running and moves the user to the review step.
   */
  async function hydrateFromJob(jobId: string) {
    const { job, items } = await getJob(jobId);
    const payload = job.payload as {
      productId?: string | null;
      productName?: string | null;
      angleNames?: string[];
      language?: string;
      messageGroups?: MessageAngleGroup[];
      approvedReferenceUrl?: string | null;
      templatePreviewUrl?: string | null;
      templateFeedback?: string;
      step?: number;
      ads?: AdSnapshot[];
    };
    // Restore the step-1..3 config so the summary chips render and
    // post-resume regenerates aren't product/template-blind. hydratingRef
    // stops the product-change effect from wiping the state set below.
    if (payload.productId && payload.productId !== selectedProductId) {
      hydratingRef.current = true;
      setSelectedProductId(payload.productId);
    }
    if (payload.angleNames?.length) {
      setSelectedAngleNames(payload.angleNames);
      // Reaching the review grid implies every restored angle was confirmed.
      setConfirmedAngleNames(new Set(payload.angleNames));
    }
    // Restore the message language so a post-resume angle regenerate writes
    // copy in the session's language instead of the default (English).
    if (payload.language) setSelectedLanguage(payload.language);
    // Restore the frozen feedback (may be empty — restore that too so a
    // stale draft doesn't leak into post-resume reworks).
    if (typeof payload.templateFeedback === "string") setTemplateFeedback(payload.templateFeedback);
    if (payload.messageGroups?.length) setMessageGroups(payload.messageGroups);
    if (payload.approvedReferenceUrl) setApprovedReferenceUrl(payload.approvedReferenceUrl);
    if (payload.templatePreviewUrl) setTemplatePreviewUrl(payload.templatePreviewUrl);
    // A job can be adopted well after it ended. If the job is no longer
    // active, any item still pending/running will never be picked up by a
    // worker — mapping those to "generating" would spin forever, so treat
    // them as failed with a retry hint instead.
    const jobIsActive = job.status === "queued" || job.status === "running";
    const byAdId = new Map(items.map((it) => [(it.input as { adId?: string }).adId, it] as const));
    const restored: LiveAd[] = (payload.ads ?? []).map((snap) => {
      const base: LiveAd = {
        id: snap.id,
        angleName: snap.angleName,
        message: snap.message,
        status: snap.status,
        imageUrl: snap.imageUrl ?? undefined,
        error: snap.error ?? undefined,
      };
      const it = byAdId.get(snap.id);
      if (it) {
        const out = (it.output ?? {}) as { url?: string };
        if (it.status === "complete" && out.url) {
          return { ...base, status: "pending" as const, imageUrl: out.url, error: undefined };
        }
        if (it.status === "failed") {
          return { ...base, status: "failed" as const, imageUrl: undefined, error: it.error ?? "Generation failed" };
        }
        return jobIsActive
          ? { ...base, status: "generating" as const, error: undefined }
          : { ...base, status: "failed" as const, imageUrl: undefined, error: "Interrupted — job ended before this ad finished. Regenerate to retry." };
      }
      // Not an item of THIS job — the snapshot state stands, except an ad
      // that was generating under some other job can no longer be tracked.
      if (base.status === "generating") {
        return { ...base, status: "failed" as const, imageUrl: undefined, error: "Interrupted — this ad was still generating when the session was saved. Regenerate to retry." };
      }
      return base;
    });
    setGeneratedAds(restored);
    setChatAd(null);
    setExported(false);
    setCollapsedAngles(new Set());
    if (jobIsActive) {
      for (const it of items) {
        const aid = (it.input as { adId?: string }).adId;
        if (aid) jobOwnerRef.current.set(aid, job.id);
      }
      setActiveJobIds([job.id]);
    } else {
      setActiveJobIds([]);
    }
    setStep(typeof payload.step === "number" ? payload.step : 4);
  }

  /** Returns true when an unfinished message_testing job for the current
   *  product was handled — adopted (session hydrated, poll target set), or
   *  found but adoption failed (error surfaced; never fall through to
   *  creating a duplicate over a live job). Returns false only when there is
   *  nothing to adopt, so a normal create may proceed. */
  async function adoptUnfinishedJob(): Promise<boolean> {
    if (!activeBrandId) return false;
    let candidate: Job | undefined;
    try {
      const { jobs } = await listJobs(activeBrandId);
      candidate = jobs.find(
        (x) =>
          x.app === "message_testing" &&
          x.type === "message_testing_images" &&
          (x.status === "queued" || x.status === "running") &&
          (((x.payload as { productId?: string | null }).productId ?? null) === (selectedProductId || null)),
      );
    } catch {
      // Couldn't check — proceed with a normal create rather than blocking the user.
      return false;
    }
    if (!candidate) return false;
    try {
      await hydrateFromJob(candidate.id);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  // Deep link from the dashboard: ?job=<id> restores that session.
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (jobId) {
      void hydrateFromJob(jobId).catch((err) =>
        setJobError(err instanceof Error ? err.message : String(err)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unfinished-session banner source: newest queued/running message_testing job.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    void listJobs(activeBrandId)
      .then(({ jobs }) => {
        if (cancelled) return;
        const j = jobs.find(
          (x) => x.app === "message_testing" && x.type === "message_testing_images" && (x.status === "queued" || x.status === "running"),
        );
        setResumableJob(j ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeBrandId]);

  // Step 3 → 4: kick off batch generation as ONE durable job (was: a
  // client-side worker pool of direct calls). CRITICAL: snapshot the approved
  // preview image — every batch ad is generated from THAT exact image, only
  // the headline changes. Guarantees visual consistency across the whole set.
  const handleGenerateAll = async () => {
    if (!selectedProduct || !messageGroups || !activeBrandId) return;
    if (!templatePreviewUrl) {
      toast.error("Regenerate the template preview before generating all ads.");
      return;
    }
    if (activeJobIds.length > 0) return;
    // Synchronous in-flight guard — activeJobIds only gains the id once
    // createJob returns, so a concurrent second click would race through the
    // awaits below and create a duplicate job.
    if (generateInFlightRef.current) return;
    generateInFlightRef.current = true;
    try {
      // Duplicate-guard: a reload loses activeJobIds, and re-walking the flow
      // re-enters this path while the original batch may still be running
      // server-side. Adopt that job instead of paying for a second one.
      if (await adoptUnfinishedJob()) return;

      const seeds: LiveAd[] = [];
      for (const group of messageGroups) {
        if (!selectedAngleNames.includes(group.name)) continue;
        group.messages.forEach((message, idx) => {
          seeds.push({
            id: `${group.name}-${idx}`,
            angleName: group.name,
            message,
            status: "generating",
          });
        });
      }
      if (seeds.length === 0) {
        toast.error("No messages to generate.");
        return;
      }

      // Freeze the approved preview as the canonical reference for this batch.
      const approved = templatePreviewUrl;
      setApprovedReferenceUrl(approved);
      setGeneratedAds(seeds);
      setJobError(null);
      setStep(4);

      try {
        const { job } = await createJob({
          app: "message_testing",
          type: "message_testing_images",
          brandId: activeBrandId,
          productId: selectedProductId || null,
          title: `Message testing — ${seeds.length} ad${seeds.length === 1 ? "" : "s"}`,
          payload: buildSessionPayload(seeds, approved),
          items: seeds.map((ad) => buildJobItem(ad, approved)),
        });
        for (const ad of seeds) jobOwnerRef.current.set(ad.id, job.id);
        setActiveJobIds((prev) => [...prev, job.id]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setJobError(msg);
        // Roll the optimistic "generating" cards into failed so they stay
        // actionable — each card's Regenerate fires a fresh single-item job.
        setGeneratedAds((prev) =>
          prev.map((a) => (a.status === "generating" ? { ...a, status: "failed", error: msg } : a)),
        );
      }
    } finally {
      generateInFlightRef.current = false;
    }
  };

  const handleApproveAd = (adId: string) => {
    setGeneratedAds((prev) =>
      prev.map((ad) =>
        ad.id === adId ? { ...ad, status: ad.status === "approved" ? "pending" : "approved" } : ad
      )
    );
  };

  const handleApproveAll = () => {
    setGeneratedAds((prev) =>
      prev.map((ad) => (ad.imageUrl ? { ...ad, status: "approved" as AdStatus } : ad))
    );
    toast.success("All ready ads approved");
  };

  // Single-ad regenerate → a 1-item durable job. Runs alongside a still-active
  // batch (each card is independent), which is why activeJobIds is a set-like
  // array rather than a single id.
  const handleRegenerateAd = async (adId: string) => {
    if (!selectedProduct || !activeBrandId) return;
    const target = generatedAds.find((a) => a.id === adId);
    if (!target) return;
    // Double-click guard: the ad flips to "generating" synchronously below,
    // so a re-entrant click can't fire a duplicate job while createJob is
    // still in flight.
    if (target.status === "generating") return;
    const approvedRef = approvedReferenceUrl ?? templatePreviewUrl;
    if (!approvedRef) {
      toast.error("No approved template reference — go back to step 3 and regenerate the preview.");
      return;
    }
    setJobError(null);
    // Claim ownership BEFORE flipping the ad to "generating": during the
    // createJob round-trip the batch job (if still polled) would otherwise
    // still own this ad, and one of its ticks could re-apply the OLD terminal
    // item to the just-flipped card — after which the rework's output never
    // lands (applies only touch "generating" ads). The placeholder matches no
    // job id, so batch ticks are ignored immediately.
    jobOwnerRef.current.set(adId, `pending:${Date.now()}`);
    const flip = (a: LiveAd): LiveAd =>
      a.id === adId ? { ...a, status: "generating", error: undefined } : a;
    setGeneratedAds((prev) => prev.map(flip));
    try {
      const { job } = await createJob({
        app: "message_testing",
        type: "message_testing_images",
        brandId: activeBrandId,
        productId: selectedProductId || null,
        title: "Message testing — 1 ad",
        // Snapshot the WHOLE review grid (with this ad flipped), not just the
        // reworked card — resuming this job must restore every card.
        payload: buildSessionPayload(generatedAds.map(flip), approvedRef),
        items: [buildJobItem(target, approvedRef)],
      });
      jobOwnerRef.current.set(adId, job.id);
      setActiveJobIds((prev) => [...prev, job.id]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Hygiene: drop the placeholder — harmless if left (applies skip
      // non-"generating" ads), but no job ever claimed this ad.
      jobOwnerRef.current.delete(adId);
      setGeneratedAds((prev) =>
        prev.map((a) => (a.id === adId ? { ...a, status: "failed", error: msg } : a))
      );
      toast.error(`Regenerate failed: ${msg}`);
    }
  };

  const toggleCollapseAngle = (angleName: string) => {
    setCollapsedAngles((prev) => {
      const next = new Set(prev);
      if (next.has(angleName)) next.delete(angleName);
      else next.add(angleName);
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
          Choose a product and select which strategic research angles to generate message testing ads for.
        </p>
      </div>

      {productsError && (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/[0.04] p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-rose-300 font-mono mb-1">Failed to load products</div>
            <div className="text-[11px] text-rose-200/70">{productsError}</div>
          </div>
        </div>
      )}

      {/* Product Selector */}
      <div className="rounded-xl border border-white/[0.08] p-5 mb-6" style={{ background: "#13161F" }}>
        <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3 block">
          Select Product
        </label>
        <div className="relative">
          <button
            onClick={() => setProductDropdownOpen(!productDropdownOpen)}
            disabled={productsLoading}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-left disabled:opacity-50"
          >
            {productsLoading ? (
              <span className="text-sm text-white/40 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading products...
              </span>
            ) : selectedProduct ? (
              <>
                {selectedProduct.productImageUrl && (
                  <img src={selectedProduct.productImageUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-white/5" />
                )}
                <div className="flex-1">
                  <div className="text-sm text-white/90">{selectedProduct.name}</div>
                  <div className="text-[10px] text-white/30 font-mono">{selectedProduct.category}</div>
                </div>
              </>
            ) : (
              <span className="text-sm text-white/30">
                {researchedProducts.length === 0 ? "No researched products yet" : "Choose a product..."}
              </span>
            )}
            <ChevronDown size={14} className="text-white/30" />
          </button>

          <AnimatePresence>
            {productDropdownOpen && researchedProducts.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-30"
                style={{ background: "#1A1D28" }}
              >
                {researchedProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => handleProductSelect(product.id)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-white/[0.04] transition-colors text-left"
                  >
                    {product.productImageUrl && (
                      <img src={product.productImageUrl} alt="" className="w-8 h-8 rounded-lg object-contain bg-white/5" />
                    )}
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

      {/* Language Selector */}
      <div className="rounded-xl border border-white/[0.08] p-5 mb-6" style={{ background: "#13161F" }}>
        <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3 block">
          Message Language
        </label>
        <select
          value={selectedLanguage}
          onChange={(e) => handleLanguageChange(e.target.value)}
          className="w-full p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm text-white/90 focus:outline-none focus:border-white/20"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code} className="bg-[#1A1D28] text-white">
              {lang.flag} {lang.label}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-white/25 font-mono mt-2">
          The generated messages will be written in this language.
        </p>
      </div>

      {/* Angles Selection */}
      {selectedProductId && (
        <div className="rounded-xl border border-white/[0.08] p-5 mb-6" style={{ background: "#13161F" }}>
          <div className="flex items-center justify-between mb-4">
            <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
              Research Angles{angles.length > 0 && ` (${selectedAngleNames.length}/${angles.length} selected)`}
            </label>
            {angles.length > 0 && (
              <button
                onClick={() =>
                  setSelectedAngleNames(
                    selectedAngleNames.length === angles.length ? [] : angles.map((a) => a.name)
                  )
                }
                className="text-[10px] font-mono text-purple-400 hover:text-purple-300 transition-colors"
              >
                {selectedAngleNames.length === angles.length ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>

          {anglesLoading && (
            <div className="flex items-center gap-2 text-xs text-white/40 py-4">
              <Loader2 size={14} className="animate-spin" />
              Extracting angles from research...
            </div>
          )}

          {anglesError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.04] p-3 text-[11px] text-rose-300">
              {anglesError}
            </div>
          )}

          {!anglesLoading && !anglesError && angles.length > 0 && (
            <div className="space-y-2">
              {angles.map((angle) => {
                const isSelected = selectedAngleNames.includes(angle.name);
                return (
                  <button
                    key={angle.name}
                    onClick={() => toggleAngle(angle.name)}
                    className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-all text-left ${
                      isSelected
                        ? "border-purple-500/30 bg-purple-500/[0.06]"
                        : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all mt-0.5 ${
                        isSelected
                          ? "bg-purple-500 border-purple-500"
                          : "border border-white/[0.15] bg-white/[0.02]"
                      }`}
                    >
                      {isSelected && <Check size={12} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white/80">{angle.name}</div>
                      <div className="text-[10px] text-white/30 font-mono line-clamp-2 mt-0.5">
                        {angle.block.slice(0, 160)}{angle.block.length > 160 ? "…" : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {copyError && (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/[0.04] p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-rose-300 font-mono mb-1">Copy writer failed</div>
            <div className="text-[11px] text-rose-200/70">{copyError}</div>
          </div>
        </div>
      )}

      {selectedProductId && selectedAngleNames.length > 0 && (
        <div className="rounded-xl border border-purple-500/20 p-4 mb-6" style={{ background: "rgba(168,85,247,0.04)" }}>
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Angles selected:</span>
            <span className="text-purple-400 font-mono font-semibold">{selectedAngleNames.length}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-white/50 mt-1">
            <span>Expected messages:</span>
            <span className="text-white/60 font-mono">up to {selectedAngleNames.length * 10}</span>
          </div>
        </div>
      )}

      <button
        onClick={handleAdvanceToMessageReview}
        disabled={!selectedProductId || selectedAngleNames.length === 0 || copyLoading}
        className="w-full py-3.5 rounded-xl font-mono text-sm uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{
          background: selectedProductId && selectedAngleNames.length > 0 && !copyLoading
            ? "linear-gradient(135deg, #A855F7, #7C3AED)"
            : "#1A1D28",
          color: selectedProductId && selectedAngleNames.length > 0 ? "white" : "#555",
        }}
      >
        {copyLoading ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Writing Messages...
          </>
        ) : (
          <>Next: Review Messages</>
        )}
      </button>
    </div>
  );

  // ── Step 2: Review Messages ──────────────────────────────────
  const renderStep2 = () => {
    const visibleGroups = (messageGroups ?? []).filter((g) => selectedAngleNames.includes(g.name));
    const allConfirmed =
      visibleGroups.length > 0 &&
      visibleGroups.every((g) => confirmedAngleNames.has(g.name));
    const totalMessages = visibleGroups.reduce((n, g) => n + g.messages.length, 0);

    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-base font-semibold text-white/90 flex items-center gap-2 mb-1">
            <MessageSquare size={16} className="text-purple-400" />
            REVIEW MESSAGES
          </h2>
          <p className="text-xs text-white/40">
            Edit any message inline, regenerate an angle if the copy misses, then confirm each angle before picking a template.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
            ✦ {selectedProduct?.name}
          </span>
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
            ◎ {visibleGroups.length} angles
          </span>
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
            ✉ {totalMessages} messages
          </span>
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            {confirmedAngleNames.size}/{visibleGroups.length} confirmed
          </span>
        </div>

        {visibleGroups.length === 0 && (
          <div className="rounded-xl border border-white/[0.08] p-6 text-center text-xs text-white/40" style={{ background: "#13161F" }}>
            No messages yet. Go back and pick at least one angle.
          </div>
        )}

        <div className="space-y-5">
          {visibleGroups.map((group) => {
            const isConfirmed = confirmedAngleNames.has(group.name);
            const isRegenerating = regeneratingAngles.has(group.name);
            return (
              <div
                key={group.name}
                className={`rounded-xl border p-5 transition-all ${
                  isConfirmed
                    ? "border-emerald-500/30 bg-emerald-500/[0.03]"
                    : "border-white/[0.08]"
                }`}
                style={{ background: isConfirmed ? undefined : "#13161F" }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: isConfirmed ? "#10B981" : "#A855F7",
                      boxShadow: `0 0 8px ${isConfirmed ? "rgba(16,185,129,0.5)" : "rgba(168,85,247,0.5)"}`,
                    }}
                  />
                  <span className="text-xs font-mono text-white/80 uppercase tracking-widest flex-1">
                    {group.name}
                  </span>
                  <span className="text-[10px] font-mono text-white/30">
                    {group.messages.length} messages
                  </span>
                  <button
                    onClick={() => regenerateAngle(group.name)}
                    disabled={isRegenerating}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-mono bg-white/[0.04] text-white/40 hover:bg-amber-500/10 hover:text-amber-400 border border-white/[0.06] transition-all disabled:opacity-40"
                  >
                    {isRegenerating ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <RefreshCw size={10} />
                    )}
                    Regenerate
                  </button>
                  <button
                    onClick={() => toggleConfirmAngle(group.name)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-mono border transition-all ${
                      isConfirmed
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : "bg-white/[0.04] text-white/40 hover:bg-emerald-500/10 hover:text-emerald-400 border-white/[0.06]"
                    }`}
                  >
                    <CheckCircle2 size={10} />
                    {isConfirmed ? "Confirmed" : "Confirm"}
                  </button>
                </div>

                <div className="space-y-2">
                  {group.messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                    >
                      <span className="text-[10px] font-mono text-white/30 mt-1.5 w-5 flex-shrink-0">
                        {idx + 1}
                      </span>
                      <textarea
                        value={msg}
                        onChange={(e) => updateMessage(group.name, idx, e.target.value)}
                        rows={1}
                        className="flex-1 bg-transparent border-0 text-xs text-white/80 leading-relaxed resize-none focus:outline-none focus:ring-0 placeholder:text-white/20"
                        placeholder="Message text..."
                      />
                      <button
                        onClick={() => removeMessage(group.name, idx)}
                        className="p-1 rounded text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-all flex-shrink-0"
                        aria-label="Remove message"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => addMessage(group.name)}
                  className="mt-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-mono bg-white/[0.04] text-white/40 hover:bg-purple-500/10 hover:text-purple-400 border border-white/[0.06] transition-all"
                >
                  <Plus size={10} />
                  Add message
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={() => setStep(1)}
            className="px-5 py-3 rounded-xl font-mono text-xs uppercase tracking-wider bg-white/[0.04] text-white/40 hover:bg-white/[0.08] border border-white/[0.06] transition-all"
          >
            Back
          </button>
          <button
            onClick={() => setStep(3)}
            disabled={!allConfirmed}
            className="flex-1 py-3 rounded-xl font-mono text-sm uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: allConfirmed ? "linear-gradient(135deg, #A855F7, #7C3AED)" : "#1A1D28",
              color: allConfirmed ? "white" : "#555",
            }}
          >
            {allConfirmed
              ? "Next: Review Template"
              : `Confirm ${visibleGroups.length - confirmedAngleNames.size} more angle${visibleGroups.length - confirmedAngleNames.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    );
  };

  // ── Step 3: Review Template ──────────────────────────────────
  const renderStep3 = () => {
    const firstSelectedGroup = messageGroups?.find((g) => selectedAngleNames.includes(g.name));
    const sampleMessage = firstSelectedGroup?.messages[0] ?? "";
    const totalMessages = (messageGroups ?? []).reduce(
      (n, g) => n + (selectedAngleNames.includes(g.name) ? g.messages.length : 0),
      0
    );
    const canGenerate =
      Boolean(templatePreviewUrl) && !templatePreviewLoading && totalMessages > 0 &&
      // A live job (batch or single regenerate) blocks a new batch — mirrors
      // the synchronous guard inside handleGenerateAll.
      activeJobIds.length === 0;

    return (
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h2 className="text-base font-semibold text-white/90 flex items-center gap-2 mb-1">
            <Layers size={16} className="text-purple-400" />
            REVIEW TEMPLATE
          </h2>
          <p className="text-xs text-white/40">
            One template will be applied to every message. Preview below uses the first message of the first angle. Give feedback to adjust the layout, then regenerate. Confirm to generate all ads.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
            ✦ {selectedProduct?.name}
          </span>
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
            ◎ {selectedAngleNames.length} angles
          </span>
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
            ✉ {totalMessages} messages
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-start mb-8">
          {/* Live preview */}
          <div className="rounded-xl border border-white/[0.08] overflow-hidden mx-auto lg:mx-0" style={{ background: "#13161F" }}>
            <div
              className="relative flex items-center justify-center overflow-hidden"
              style={{ background: TEMPLATE_BG, width: 320, aspectRatio: "1/1" }}
            >
              {templatePreviewLoading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#2D2D2D]/70">
                  <Loader2 size={22} className="animate-spin" />
                  <span className="text-[10px] font-mono uppercase tracking-wider">Rendering preview…</span>
                </div>
              ) : templatePreviewUrl ? (
                <img src={templatePreviewUrl} alt="Template preview" className="w-full h-full object-cover" />
              ) : templatePreviewError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                  <AlertTriangle size={20} className="text-rose-500" />
                  <span className="text-[10px] text-rose-600 text-center leading-relaxed">{templatePreviewError}</span>
                </div>
              ) : (
                <p className="text-[#2D2D2D] font-serif italic text-sm leading-relaxed text-center max-w-[230px] px-4">
                  "{sampleMessage || "Sample message preview"}"
                </p>
              )}
            </div>
            <div className="p-3 border-t border-white/[0.06]">
              <p className="text-[10px] font-mono text-white/50 uppercase tracking-wider text-center">
                {REFERENCE_TEMPLATE.name}
              </p>
              <p className="text-[9px] font-mono text-white/30 mt-0.5 text-center">
                {referenceImageUrl
                  ? "1:1 · 2K · reference-locked"
                  : "1:1 · 2K · hand-authored prompt"}
              </p>
              {sampleMessage && (
                <p className="text-[9px] text-white/30 mt-1 text-center line-clamp-2">
                  Preview uses: "{sampleMessage}"
                </p>
              )}
            </div>
          </div>

          {/* Feedback panel */}
          <div className="space-y-4">
            <div className="rounded-xl border border-white/[0.08] p-4" style={{ background: "#13161F" }}>
              <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2 block">
                Feedback (optional)
              </label>
              <textarea
                value={templateFeedback}
                onChange={(e) => setTemplateFeedback(e.target.value)}
                placeholder="e.g. make the product larger, move the quote higher, softer lighting, add a subtle shadow under the product…"
                rows={6}
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-purple-500/40 resize-none leading-relaxed"
              />
              <div className="mt-3">
                <button
                  onClick={() => regenerateTemplatePreview()}
                  disabled={templatePreviewLoading || !selectedProduct || !sampleMessage}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[11px] font-mono uppercase tracking-wider bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {templatePreviewLoading ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  {templateFeedback.trim() ? "Apply Feedback & Regenerate" : "Regenerate Preview"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-purple-500/20 p-4" style={{ background: "rgba(168,85,247,0.04)" }}>
              <p className="text-[11px] text-white/60 leading-relaxed">
                Once the layout feels right, hit{" "}
                <span className="font-semibold text-purple-300">Generate All Ads</span> — every confirmed message will be rendered with this exact template and any feedback you've provided.
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setStep(2)}
            className="px-5 py-3 rounded-xl font-mono text-xs uppercase tracking-wider bg-white/[0.04] text-white/40 hover:bg-white/[0.08] border border-white/[0.06] transition-all"
          >
            Back
          </button>
          <button
            onClick={handleGenerateAll}
            disabled={!canGenerate}
            className="flex-1 py-3 rounded-xl font-mono text-sm uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: canGenerate ? "linear-gradient(135deg, #A855F7, #7C3AED)" : "#1A1D28",
              color: canGenerate ? "white" : "#555",
            }}
          >
            GENERATE ALL ADS
          </button>
        </div>
      </div>
    );
  };

  // ── Step 4: Review Ads ───────────────────────────────────────
  const renderStep4 = () => (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-white/90 flex items-center gap-2 mb-1">
            <Eye size={16} className="text-purple-400" />
            REVIEW ADS ({readyCount}/{totalCount} ready)
          </h2>
          <p className="text-xs text-white/40">
            Review, approve, or regenerate each ad. Chat for more specific feedback.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleApproveAll}
            disabled={readyCount === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-30"
          >
            <CheckCircle2 size={12} />
            APPROVE ALL
          </button>
          <button
            onClick={() => setStep(5)}
            disabled={approvedCount === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider transition-all disabled:opacity-30"
            style={{ background: "linear-gradient(135deg, #A855F7, #7C3AED)", color: "white" }}
          >
            <Download size={12} />
            EXPORT
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/50">
          ✦ {selectedProduct?.name}
        </span>
        <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">
          {approvedCount}/{totalCount} approved
        </span>
      </div>

      <div className="space-y-8">
        {Object.entries(adsByAngle).map(([angleName, ads]) => {
          const isCollapsed = collapsedAngles.has(angleName);
          const angleApproved = ads.filter((a) => a.status === "approved").length;

          return (
            <div key={angleName}>
              <button
                onClick={() => toggleCollapseAngle(angleName)}
                className="w-full flex items-center gap-3 mb-4 group"
              >
                <div className="w-2 h-2 rounded-full bg-purple-400" style={{ boxShadow: "0 0 8px rgba(168,85,247,0.5)" }} />
                <span className="text-xs font-mono text-white/60 uppercase tracking-widest">{angleName}</span>
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
                        onApprove={() => handleApproveAd(ad.id)}
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

      <AnimatePresence>
        {chatAd && <ChatPanel ad={chatAd} onClose={() => setChatAd(null)} />}
      </AnimatePresence>
    </div>
  );

  // ── Step 5: Export ───────────────────────────────────────────
  const renderStep5 = () => {
    if (!exported) {
      return (
        <div className="max-w-3xl mx-auto">
          <div className="mb-8">
            <h2 className="text-base font-semibold text-white/90 flex items-center gap-2 mb-1">
              <FolderDown size={16} className="text-purple-400" />
              EXPORT ADS
            </h2>
            <p className="text-xs text-white/40">
              Download your approved ads organized by angle.
            </p>
          </div>

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
                <span className="text-white/70">{REFERENCE_TEMPLATE.name}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-white/50">
                <span>Total Ads</span>
                <span className="text-white/70">{approvedCount} files</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] p-5 mb-6" style={{ background: "#13161F" }}>
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-4 block">
              Download Structure (by Angle)
            </span>

            <div className="space-y-3">
              {Object.entries(adsByAngle).map(([angleName, ads]) => {
                const approvedInAngle = ads.filter((a) => a.status === "approved");

                return (
                  <div
                    key={angleName}
                    className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02]"
                  >
                    <FolderDown size={16} className="text-purple-400 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs text-white/70">{angleName}</div>
                      <div className="text-[10px] text-white/30 font-mono">
                        {approvedInAngle.length} approved ads
                      </div>
                    </div>
                    <div className="flex -space-x-2">
                      {approvedInAngle.slice(0, 4).map((ad, i) => (
                        <div
                          key={ad.id}
                          className="w-8 h-8 rounded border border-white/[0.1] overflow-hidden"
                          style={{ zIndex: 4 - i }}
                        >
                          {ad.imageUrl && <img src={ad.imageUrl} alt="" className="w-full h-full object-cover" />}
                        </div>
                      ))}
                      {approvedInAngle.length > 4 && (
                        <div className="w-8 h-8 rounded border border-white/[0.1] bg-white/[0.04] flex items-center justify-center text-[9px] text-white/40 font-mono">
                          +{approvedInAngle.length - 4}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={async () => {
              const approvedAds = generatedAds.filter(
                (a) => a.status === "approved" && a.imageUrl,
              );
              if (approvedAds.length === 0) {
                toast.error("No approved ads to export");
                return;
              }
              // Kick off downloads (staggered to avoid browser drops).
              approvedAds.forEach((ad, i) => {
                setTimeout(() => {
                  const el = document.createElement("a");
                  el.href = ad.imageUrl!;
                  const safe = (ad.message || `ad-${ad.id}`).slice(0, 60).replace(/\s+/g, "-");
                  el.download = `${safe}.jpg`;
                  el.target = "_blank";
                  el.rel = "noopener";
                  document.body.appendChild(el);
                  el.click();
                  el.remove();
                }, i * 350);
              });
              // Persist to Brand Assets.
              if (!activeBrandId) {
                toast.error("No active brand selected.");
                return;
              }
              try {
                await saveBrandAssets(
                  activeBrandId,
                  approvedAds.map((ad) => ({
                    kind: "image" as const,
                    url: ad.imageUrl!,
                    title: ad.message?.slice(0, 120) || `Ad ${ad.id}`,
                    sourceApp: "message_testing",
                    productId: selectedProduct?.id ?? null,
                    metadata: {
                      angleName: ad.angleName,
                      message: ad.message,
                      template: REFERENCE_TEMPLATE.name,
                    },
                  })),
                );
                setExported(true);
                toast.success(`${approvedAds.length} ads saved to Brand Assets`);
              } catch (err) {
                toast.error(
                  `Downloaded locally but failed to save to Brand Assets: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              }
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

    return (
      <div className="max-w-3xl mx-auto">
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
            {approvedCount} ads marked for export.
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.08] p-5 mb-8" style={{ background: "#13161F" }}>
          <div className="flex items-center gap-2 mb-4">
            <FolderDown size={14} className="text-purple-400" />
            <span className="text-xs font-mono text-white/50 uppercase tracking-widest">Approved Ads</span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2">
            {generatedAds
              .filter((a) => a.status === "approved" && a.imageUrl)
              .slice(0, 8)
              .map((ad) => (
                <div key={ad.id} className="w-20 h-20 rounded-lg border border-white/[0.08] overflow-hidden flex-shrink-0">
                  <img src={ad.imageUrl} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            {approvedCount > 8 && (
              <div className="w-20 h-20 rounded-lg border border-white/[0.08] flex items-center justify-center flex-shrink-0 bg-white/[0.02]">
                <span className="text-xs text-white/30 font-mono">+{approvedCount - 8}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-amber-400" style={{ boxShadow: "0 0 8px rgba(245,158,11,0.5)" }} />
            <span className="text-xs font-mono text-white/40 uppercase tracking-widest">What's Next?</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => {
                setStep(3);
                setTemplateFeedback("");
                setTemplatePreviewUrl(null);
                setTemplatePreviewError(null);
                setGeneratedAds([]);
                setExported(false);
                toast("Adjust the template and regenerate");
              }}
              className="rounded-xl border border-white/[0.08] p-5 text-left hover:border-purple-500/30 hover:bg-purple-500/[0.02] transition-all group"
              style={{ background: "#13161F" }}
            >
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3">
                <RotateCcw size={18} className="text-purple-400" />
              </div>
              <h4 className="text-sm font-semibold text-white/80 mb-1">Adjust Template</h4>
              <p className="text-[11px] text-white/35 leading-relaxed">
                Keep the same product and messages but regenerate with a different layout or feedback.
              </p>
              <span className="text-[10px] font-mono text-purple-400 mt-3 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                CHANGE TEMPLATE <ChevronRight size={10} />
              </span>
            </button>

            <button
              onClick={() => {
                setStep(1);
                setSelectedAngleNames([]);
                setTemplateFeedback("");
                setTemplatePreviewUrl(null);
                setTemplatePreviewError(null);
                setGeneratedAds([]);
                setMessageGroups(null);
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
                Go back and select different research angles to generate a new batch.
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
        {/* Unfinished-session resume banner — hidden while the page is
            already mirroring a job (then the cards' spinners cover it). */}
        {resumableJob && activeJobIds.length === 0 && (
          <div className="mb-4 max-w-5xl mx-auto rounded-md border border-cyan-400/30 bg-cyan-400/10 p-3 flex items-start gap-2">
            <RotateCcw size={14} className="text-cyan-400 shrink-0 mt-0.5" />
            <button
              type="button"
              onClick={() => {
                const j = resumableJob;
                setResumableJob(null);
                if (j) {
                  void hydrateFromJob(j.id).catch((err) =>
                    setJobError(err instanceof Error ? err.message : String(err)),
                  );
                }
              }}
              className="flex-1 text-left hover:opacity-80 transition-opacity"
            >
              <p className="text-[11px] font-mono text-cyan-200/80 break-words">
                <span className="font-medium text-cyan-200">A generation is still running: {resumableJob.title}</span>
                {" "}— click to resume this session.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setResumableJob(null)}
              className="p-1 rounded text-cyan-400/60 hover:text-cyan-300 hover:bg-cyan-400/10 transition-colors shrink-0"
              aria-label="Dismiss resume banner"
            >
              <X size={12} />
            </button>
          </div>
        )}
        {jobError && (
          <div className="mb-4 max-w-5xl mx-auto rounded-md border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[11px] font-mono text-rose-400">
            {jobError}
          </div>
        )}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
      </div>
    </div>
  );
}
