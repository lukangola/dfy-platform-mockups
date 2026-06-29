/**
 * DESIGN: Studio Control Room — Copy Engine
 *
 * Two-screen app:
 *   1. Mode picker — pick how the user wants to start:
 *        - "generate": generate copy from scratch (with optional steering notes)
 *        - "rewrite":  paste existing copy and rewrite it for the product/angle
 *   2. Configure — pick copy type → product → angle → language (+ mode-specific
 *      extras) → Generate / Rewrite. The right pane streams the generated copy.
 *      From there:
 *        - chat-style feedback regen (sends current draft back with feedback note)
 *        - one-click copy to clipboard
 *        - save to brand assets as a "document" kind
 *
 * For v1 only "Listicle" is wired in the copy-type dropdown (used by generate
 * mode). The rewriter is format-agnostic — it preserves whatever shape the
 * source copy is in, so the copy-type dropdown is hidden in rewrite mode.
 * Each mode routes to its own prompt:
 *   - generate → prompts/listicle_copy.md   (with optional {{guidance}})
 *   - rewrite  → prompts/copy_rewrite.md    (with required {{source_copy}})
 * All run on claude-opus-4-7.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ChevronDown, Check, Loader2, Package, Layers, Type,
  Sparkles, Copy as CopyIcon, FolderDown, Send, RefreshCw, AlertTriangle,
  FileText, MessageSquare, Globe, Wand2, Lightbulb, Edit3, ArrowRight,
  BadgePercent,
} from "lucide-react";
import { marked } from "marked";
import {
  listProducts, generateText, saveBrandAssets,
  getAdPipelineCard, extractProductOffer,
  type Product, type ProductAngle,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { LANGUAGES } from "@/lib/mockData";
import { toast } from "sonner";

// `marked` defaults are fine for our use — Claude only emits the markdown
// flavors we asked it for in the prompt. Keep gfm on so tables / strikethrough
// render correctly if Claude ever uses them.
marked.setOptions({ gfm: true, breaks: false });

function renderMarkdown(md: string): string {
  // marked.parse can return Promise when async extensions are on; we never
  // enable async, so the sync overload is correct here.
  return marked.parse(md, { async: false }) as string;
}

// ── Modes ─────────────────────────────────────────────────────
// Two flows: "generate" (write from scratch, with optional steering notes)
// and "rewrite" (rebuild user-supplied source copy as a listicle).
type Mode = "generate" | "rewrite";

const MODES: Array<{
  id: Mode;
  name: string;
  tagline: string;
  description: string;
  Icon: typeof Wand2;
}> = [
  {
    id: "generate",
    name: "Generate Copy",
    tagline: "Write it from scratch.",
    description:
      "Pick a copy type, a product, and an angle — Claude writes the whole thing from zero, anchored on the angle and the brand voice. Optional: drop in steering notes (must-include phrases, tone tweaks) and Claude bakes them in.",
    Icon: Wand2,
  },
  {
    id: "rewrite",
    name: "Rewrite Existing",
    tagline: "Paste copy you already have.",
    description:
      "Drop in any source copy (a competitor's listicle, a UGC script, a Mini VSL, an old draft, a brain-dump). Claude detects the format and rebuilds it for your product + angle in the same shape.",
    Icon: Edit3,
  },
];

// ── Copy types ────────────────────────────────────────────────
// Each copy type maps to up to two prompts: `action` for from-scratch /
// guidance modes, `rewriteAction` for rewrite mode. The rewriter is
// format-agnostic (the same `copy_rewrite` action handles every type) so
// `rewriteAction` is identical across rows — kept on each row for dispatch
// simplicity, not because each type has its own rewriter.
type CopyTypeId = "listicle" | "mini_vsl";

const COPY_TYPES: Array<{
  id: CopyTypeId;
  name: string;
  description: string;
  action: string;            // /api/generate/text/<action> for scratch + guidance
  rewriteAction: string;     // /api/generate/text/<action> for rewrite mode
  available: boolean;
}> = [
  {
    id: "listicle",
    name: "Listicle",
    description: "Long-form advertorial-style listicle (11–13 numbered benefits, hook line, closing offer).",
    action: "listicle_copy",
    rewriteAction: "copy_rewrite",
    available: true,
  },
  {
    id: "mini_vsl",
    name: "Mini VSL Script",
    description: "Short-form video sales letter — 5–7 hook variants up top, then a 80–150-line spoken-prose body running hook → problem → mechanism → product → CTA → guarantee. Built for VO read on a 1.5–3 minute social ad.",
    action: "mini_vsl_copy",
    rewriteAction: "copy_rewrite",
    available: true,
  },
];

type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export default function CopyEngineAppPage() {
  const { activeBrandId, activeBrand } = useBrand();

  // ── Mode ──
  // null = mode picker showing; otherwise the configure UI is showing.
  const [mode, setMode] = useState<Mode | null>(null);

  // ── Step 1: copy type ──
  const [copyTypeId, setCopyTypeId] = useState<CopyTypeId | null>(null);
  const [copyTypeDropdownOpen, setCopyTypeDropdownOpen] = useState(false);
  const selectedCopyType = COPY_TYPES.find((c) => c.id === copyTypeId) ?? null;

  // ── Step 2: product ──
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  // ── Step 3: angle ──
  const [selectedAngleName, setSelectedAngleName] = useState("");
  const [angleDropdownOpen, setAngleDropdownOpen] = useState(false);

  // ── Step 4: output language ──
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const selectedLang = LANGUAGES.find((l) => l.code === selectedLanguage) ?? LANGUAGES[0];

  // ── Mode-specific extras ──
  // `guidance` is optional in both modes — steering notes Claude must respect.
  // `sourceCopy` is required in "rewrite" mode and unused in "generate" mode.
  // `offer` is REQUIRED in both modes — captures the front-end offer so the
  // closing CTA block uses real discount %, free gifts, and bonuses instead
  // of inventing them.
  const [guidance, setGuidance] = useState("");
  const [sourceCopy, setSourceCopy] = useState("");
  const [offer, setOffer] = useState("");

  // ── Generation state ──
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [savingToAssets, setSavingToAssets] = useState(false);
  const [savedToAssets, setSavedToAssets] = useState(false);

  const [pipelineCardId, setPipelineCardId] = useState<string | null>(null);
  // `autorun=1` deep-link flag — when set, the page fetches the transcript +
  // offer and kicks off the rewrite automatically once everything is ready.
  const [autorun, setAutorun] = useState(false);
  // Set to true when the auto-flow can't proceed (offer null or transcript
  // failed) — hides the "Preparing rewrite…" indicator and shows the normal
  // form so the user can fill the missing piece and rewrite manually.
  const [autorunStalled, setAutorunStalled] = useState(false);

  // Carries the deep-linked angle past the product-change reset effect (which
  // would otherwise wipe it the moment the prefill sets the product). Set in
  // the prefill, consumed (once) by the reset effect.
  const pendingAngleRef = useRef<string | null>(null);
  // Fire-once guards for the auto-flow effects.
  const offerExtractDoneRef = useRef<string | null>(null); // productId we ran extract for
  const autorunFiredRef = useRef(false);
  // Lets the angle-reset effect skip its mount run (see that effect for why).
  const angleResetReady = useRef(false);

  // Deep-link prefill from the Ad Pipeline ("Recreate now"). Runs once on mount.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("mode") === "rewrite") {
      setMode("rewrite");
      // The manual flow sets this when the user clicks the rewrite button
      // (the copy-type dropdown is hidden in rewrite mode — the rewriter is
      // format-agnostic). The deep-link skips that click, so set it here too,
      // otherwise selectedCopyType stays null and canGenerate never flips true.
      setCopyTypeId("listicle");
    }
    const product = p.get("product");
    const angle = p.get("angle");
    const language = p.get("language");
    const source = p.get("source");
    const card = p.get("pipelineCardId");
    const auto = p.get("autorun") === "1";
    if (product) setSelectedProductId(product);
    // Stash the prefilled angle in a ref so the product-change reset effect
    // (which fires right after setSelectedProductId) applies it instead of
    // clearing it. We don't call setSelectedAngleName directly here — the
    // reset effect owns that on the initial product set.
    if (angle) pendingAngleRef.current = angle;
    if (language) setSelectedLanguage(language);
    if (source) setSourceCopy(source);
    if (card) setPipelineCardId(card);
    if (auto) setAutorun(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftEndRef = useRef<HTMLDivElement>(null);

  // Load products for the active brand.
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

  // Reset angle when the product changes — but honor a deep-linked angle.
  // On the initial prefill the product is set programmatically; if an angle
  // was deep-linked it's waiting in pendingAngleRef, so apply it instead of
  // clearing. Manual product changes (no pending angle) still reset normally.
  useEffect(() => {
    // Skip the mount run. On mount selectedProductId is still "" — the deep-link
    // prefill sets it in a separate mount effect that applies on the NEXT render.
    // If we ran the reset on mount we'd consume pendingAngleRef while the product
    // is still empty, then clear the angle on the real change, wiping the
    // deep-linked angle. Only react to genuine product changes.
    if (!angleResetReady.current) {
      angleResetReady.current = true;
      return;
    }
    if (pendingAngleRef.current) {
      setSelectedAngleName(pendingAngleRef.current);
      pendingAngleRef.current = null;
    } else {
      setSelectedAngleName("");
    }
  }, [selectedProductId]);

  // Reset draft state when any selector changes — keeps the user honest:
  // changing inputs requires hitting Generate again. (We don't reset on
  // free-text fields like `offer`, `guidance`, `sourceCopy` because users
  // type into those incrementally and we'd flicker the right pane.)
  useEffect(() => {
    setDraft(null);
    setGenError(null);
    setChatHistory([]);
    setFeedbackInput("");
    setSavedToAssets(false);
  }, [mode, copyTypeId, selectedProductId, selectedAngleName, selectedLanguage]);

  // ── Auto-flow: pull the real ad transcript from the pipeline card ──
  // The "Recreate now" deep-link doesn't pass a `source` param — the transcript
  // lives on the card (often still being deconstructed in a background job).
  // Poll until `originalScript` lands, then use it as the rewrite source. Mirrors
  // the staticReferenceId poll in StaticAdsAppPage. Stops on success/failure.
  useEffect(() => {
    if (!pipelineCardId || !activeBrandId || sourceCopy.trim().length > 0) return;
    let cancelled = false;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const { card } = await getAdPipelineCard(activeBrandId, pipelineCardId);
        if (cancelled) return;
        if (card.originalScript && card.originalScript.trim().length > 0) {
          setSourceCopy(card.originalScript);
          stopped = true;
        } else if (card.bgJobStatus === "failed") {
          stopped = true;
          setAutorunStalled(true);
          toast.error("Couldn't fetch the ad transcript — paste the source copy manually to continue.");
        }
      } catch { /* ignore — keep polling; user can paste manually */ }
    };
    void tick();
    const iv = setInterval(() => {
      if (stopped) { clearInterval(iv); return; }
      void tick();
    }, 2500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [pipelineCardId, activeBrandId, sourceCopy]);

  // ── Auto-flow: auto-extract the front-end offer from the product URL ──
  // Runs once per product when arriving via the autorun deep-link with an empty
  // offer. extractProductOffer never throws on bad pages (returns null offer) —
  // if nothing extractable, we leave the field empty and the auto-run won't fire
  // (the user can type an offer to proceed).
  useEffect(() => {
    if (!autorun || !pipelineCardId || !selectedProductId) return;
    if (offer.trim().length > 0) return;
    if (offerExtractDoneRef.current === selectedProductId) return;
    offerExtractDoneRef.current = selectedProductId;
    let cancelled = false;
    (async () => {
      try {
        const result = await extractProductOffer(selectedProductId);
        if (cancelled) return;
        if (result.offer && result.offer.trim().length > 0) {
          setOffer(result.offer);
        } else {
          setAutorunStalled(true);
          toast.warning("Couldn't auto-detect an offer from the product page — add your front-end offer to generate.");
        }
      } catch { /* ignore — leave offer empty; user can type one */ }
    })();
    return () => { cancelled = true; };
  }, [autorun, pipelineCardId, selectedProductId, offer]);

  // When the user goes back to the mode picker, fully reset the side inputs
  // so re-entering a different mode starts clean.
  function handleChangeMode() {
    setMode(null);
    setCopyTypeId(null);
    setSelectedProductId("");
    setSelectedAngleName("");
    setGuidance("");
    setSourceCopy("");
    setOffer("");
    setDraft(null);
    setGenError(null);
    setChatHistory([]);
    setFeedbackInput("");
    setSavedToAssets(false);
  }

  // Build the brand_context blob from the active brand's guidelines.
  // Prefer the new guidelines markdown when present (single source of
  // truth — carries voice/tone/imagery/do's & don'ts). Fall back to the
  // legacy structured fields for brands not yet re-extracted.
  const brandContext = useMemo(() => {
    if (!activeBrand?.name) return "(no brand context available)";
    if (activeBrand.guidelinesMarkdown && activeBrand.guidelinesMarkdown.trim().length > 0) {
      return `Brand: ${activeBrand.name}\n\n${activeBrand.guidelinesMarkdown.trim()}`;
    }
    const parts: string[] = [`Brand: ${activeBrand.name}`];
    const r = activeBrand.research;
    if (r) {
      if (typeof r.tone === "string" && r.tone.trim()) parts.push(`Tone: ${r.tone.trim()}`);
      if (typeof r.description === "string" && r.description.trim())
        parts.push(`Description: ${r.description.trim()}`);
    }
    return parts.join("\n");
  }, [activeBrand]);

  const sourceCopyReady = mode !== "rewrite" || sourceCopy.trim().length > 0;
  const offerReady = offer.trim().length > 0;
  const canGenerate = Boolean(
    mode &&
      selectedCopyType?.available &&
      selectedProductId &&
      selectedAngleName &&
      offerReady &&
      sourceCopyReady &&
      !generating,
  );

  async function runGeneration(opts: { feedback?: string; previousDraft?: string } = {}) {
    if (!mode || !selectedCopyType || !selectedProduct || !selectedAngle) return;
    if (mode === "rewrite" && !sourceCopy.trim()) {
      toast.error("Paste the source copy you want rewritten before generating.");
      return;
    }
    if (!offer.trim()) {
      toast.error("Describe your front-end offer (discount %, free gifts, etc.) before generating.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const feedbackBlock = opts.feedback?.trim()
        ? [
            "Previous draft:",
            "```",
            (opts.previousDraft ?? draft ?? "").trim(),
            "```",
            "",
            "Apply ONLY this feedback on top of the previous draft — keep everything else (structure, voice, sections) intact:",
            opts.feedback.trim(),
          ].join("\n")
        : "";

      // Mode dispatch:
      //   scratch  → action,        guidance="(none)"
      //   guidance → action,        guidance=user's notes
      //   rewrite  → rewriteAction, guidance=user's optional notes, source_copy=user's pasted copy
      const action =
        mode === "rewrite" ? selectedCopyType.rewriteAction : selectedCopyType.action;

      const guidanceBlock = guidance.trim() || "(no extra guidance — follow the rules above)";

      const vars: Record<string, unknown> = {
        product: selectedProduct.name,
        angle: `${selectedAngle.name}\n\n${selectedAngle.block}`,
        brand_context: brandContext,
        offer: offer.trim(),
        language: selectedLang.label,
        guidance: guidanceBlock,
        feedback: feedbackBlock,
        // listicle_copy now expects {{destination_url}} for every CTA
        // link target. The Copy Engine doesn't collect a destination
        // URL (the Listicle Builder does), so we pass "#" as a safe
        // placeholder. The model is instructed to use this value
        // verbatim; the user can search-replace "#" later if they
        // want a real URL on the Copy Engine path.
        destination_url: "#",
        // Winning-ad routing vars — the Copy Engine path NEVER uses the
        // winning-ad workflow (that's Listicle Builder only), so always
        // pass "no" to keep the conditional rules in listicle_copy
        // dormant. The other slots get harmless placeholders.
        winning_ad_present: "no",
        winning_ad_angle_block: "(not applicable — Copy Engine doesn't use the winning-ad workflow)",
        winning_ad_summary: "(not applicable)",
        other_angles_block: "(not applicable)",
      };
      if (mode === "rewrite") {
        vars.source_copy = sourceCopy.trim();
      }

      const res = await generateText(action, vars, {
        maxTokens: 8000,
        ...(pipelineCardId ? { meta: { pipelineCardId } } : {}),
      });
      setDraft(res.text);
      setSavedToAssets(false);
      // Scroll the output to top after a fresh draft.
      requestAnimationFrame(() => {
        const el = document.getElementById("copy-engine-output");
        if (el) el.scrollTop = 0;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenError(msg);
      toast.error(`Copy generation failed: ${msg}`);
    } finally {
      setGenerating(false);
    }
  }

  const handleGenerate = () => { void runGeneration(); };

  // ── Auto-flow: fire the rewrite automatically once everything is ready ──
  // Waits for the existing canGenerate gate (product + angle + offer + source
  // all present, not already generating) plus the derived product/angle objects
  // to resolve. Fire-once guard prevents re-runs on subsequent renders.
  useEffect(() => {
    if (!autorun || autorunFiredRef.current) return;
    if (!canGenerate || !selectedProduct || !selectedAngle) return;
    autorunFiredRef.current = true;
    void runGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun, canGenerate, selectedProduct, selectedAngle]);

  // Safety net: if the auto-flow can't assemble every input within 90s (slow
  // transcription, an offer page we can't parse, a missing product, etc.), stop
  // showing "Preparing rewrite…" and fall back to the manual form so it can
  // never hang indefinitely. If the rewrite already fired, this is a no-op.
  useEffect(() => {
    if (!autorun) return;
    const t = setTimeout(() => {
      if (!autorunFiredRef.current) setAutorunStalled(true);
    }, 90_000);
    return () => clearTimeout(t);
  }, [autorun]);

  const handleSendFeedback = async () => {
    const feedback = feedbackInput.trim();
    if (!feedback || generating || !draft) return;
    const userMsg: ChatMsg = { role: "user", content: feedback, timestamp: Date.now() };
    setChatHistory((prev) => [...prev, userMsg]);
    setFeedbackInput("");
    await runGeneration({ feedback, previousDraft: draft });
    setChatHistory((prev) => [
      ...prev,
      { role: "assistant", content: "Regenerated the draft with your feedback applied.", timestamp: Date.now() },
    ]);
  };

  const handleCopyAll = async () => {
    if (!draft) return;
    // Write both rendered HTML *and* raw markdown to the clipboard. Apps that
    // accept rich text (Notion, Google Docs, Slack, Word, Gmail) paste with
    // headings/bold preserved; plain-text fields (terminal, .txt) fall back
    // to the markdown source. Best of both worlds.
    try {
      const html = renderMarkdown(draft);
      if (typeof window !== "undefined" && "ClipboardItem" in window && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([draft], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        // Older browsers — plain text only.
        await navigator.clipboard.writeText(draft);
      }
      toast.success("Copied — paste anywhere (rich text preserved)");
    } catch {
      // Last-ditch fallback: try writeText with the markdown source.
      try {
        await navigator.clipboard.writeText(draft);
        toast.success("Copied to clipboard");
      } catch {
        toast.error("Copy failed — your browser blocked clipboard access.");
      }
    }
  };

  const handleSaveToAssets = async () => {
    if (!draft || !activeBrandId || !selectedProduct || !selectedCopyType) return;
    setSavingToAssets(true);
    try {
      const langSuffix = selectedLang.code !== "en" ? ` · ${selectedLang.label}` : "";
      // In rewrite mode the format is dictated by the source — don't claim
      // the doc is a "Listicle" just because that's what the dropdown holds.
      const titlePrefix = mode === "rewrite" ? "Rewritten Copy" : selectedCopyType.name;
      const title = `${titlePrefix} — ${selectedProduct.name}${
        selectedAngle ? ` · ${selectedAngle.name}` : ""
      }${langSuffix}`;
      // url is required by the schema. We mark documents with a sentinel —
      // the actual content lives in metadata.content (read by AssetsPage and
      // the download helper).
      await saveBrandAssets(activeBrandId, [
        {
          kind: "document",
          url: `document:${selectedCopyType.id}`,
          title,
          sourceApp: "copy_engine",
          productId: selectedProduct.id,
          metadata: {
            content: draft,
            copyType: mode === "rewrite" ? "Rewritten Copy" : selectedCopyType.name,
            copyTypeId: mode === "rewrite" ? "rewrite" : selectedCopyType.id,
            mode: mode ?? "generate",
            angleName: selectedAngle?.name ?? null,
            language: selectedLang.label,
            languageCode: selectedLang.code,
            generatedAt: new Date().toISOString(),
            ...(pipelineCardId ? { pipelineCardId } : {}),
          },
        },
      ]);
      setSavedToAssets(true);
      toast.success("Saved to Brand Assets");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSavingToAssets(false);
    }
  };

  // ── Render ──
  return (
    <div className="min-h-screen flex flex-col" style={{ color: "#E2E8F0" }}>
      {/* Top Bar */}
      <header
        className="h-12 border-b border-white/[0.06] flex items-center px-4 gap-4 shrink-0"
        style={{ background: "#0D0F12" }}
      >
        <Link href="/workspace/apps">
          <button className="flex items-center gap-2 text-white/40 hover:text-rose-400 transition-colors text-sm">
            <ArrowLeft size={14} />
            <span className="font-mono text-xs">APPS</span>
          </button>
        </Link>
        <div className="w-px h-5 bg-white/10" />
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-rose-500/20 flex items-center justify-center">
            <Type size={12} className="text-rose-400" />
          </div>
          <span className="font-mono text-xs text-white/60 tracking-wider">COPY ENGINE</span>
        </div>
        {mode && (
          <button
            onClick={handleChangeMode}
            className="ml-4 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/40 hover:text-rose-300 transition-colors px-2 py-1 rounded border border-white/[0.06] hover:border-rose-500/30"
            title="Go back to mode picker"
          >
            <ArrowLeft size={10} />
            Change mode
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {mode && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-rose-300/80 bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded">
              {MODES.find((m) => m.id === mode)?.name}
            </span>
          )}
          <div className="flex items-center gap-2 text-[10px] font-mono text-white/30">
            <Sparkles size={11} className="text-rose-400/70" />
            <span>claude-opus-4-7</span>
          </div>
        </div>
      </header>

      {/* ─── Mode picker (shown when no mode is selected yet) ─── */}
      {!mode && (
        <div className="flex-1 overflow-auto p-8 flex items-center justify-center">
          <div className="w-full max-w-3xl">
            <div className="text-center mb-10">
              <div
                className="inline-flex w-12 h-12 rounded-2xl items-center justify-center mb-4"
                style={{
                  background: "linear-gradient(135deg, rgba(244,63,94,0.18), rgba(244,63,94,0.04))",
                  border: "1px solid rgba(244,63,94,0.3)",
                }}
              >
                <Type size={20} className="text-rose-400" />
              </div>
              <h1 className="text-2xl font-bold font-mono text-white/90 mb-2">
                How do you want to start?
              </h1>
              <p className="text-[12px] text-white/40 font-mono leading-relaxed max-w-xl mx-auto">
                Either generate fresh copy from scratch, or paste copy you
                already have and rewrite it for your product and angle.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {MODES.map((m) => {
                const ModeIcon = m.Icon;
                return (
                  <motion.button
                    key={m.id}
                    onClick={() => {
                      setMode(m.id);
                      // In rewrite mode the copy type is dictated by the
                      // source copy — we lock it to "listicle" (the only
                      // supported rewrite prompt for v1) and hide its picker.
                      if (m.id === "rewrite") setCopyTypeId("listicle");
                    }}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.2 }}
                    className="text-left rounded-2xl border border-white/[0.08] p-6 hover:border-rose-500/40 transition-all group relative overflow-hidden"
                    style={{
                      background: "linear-gradient(180deg, rgba(244,63,94,0.04) 0%, rgba(13,15,18,1) 60%)",
                    }}
                  >
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(244,63,94,0.18), rgba(244,63,94,0.04))",
                        border: "1px solid rgba(244,63,94,0.25)",
                      }}
                    >
                      <ModeIcon size={18} className="text-rose-400" />
                    </div>
                    <h3 className="text-base font-bold text-white/90 mb-1">{m.name}</h3>
                    <div className="text-[11px] font-mono text-rose-300/70 mb-3">
                      {m.tagline}
                    </div>
                    <p className="text-[12px] text-white/50 leading-relaxed">{m.description}</p>
                    <div className="mt-5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-rose-300/80 group-hover:text-rose-300 transition-colors">
                      Start
                      <ArrowRight
                        size={11}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Configure + Output (shown once a mode is picked) ─── */}
      {mode && (
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[420px_1fr] overflow-hidden">
        {/* ─── Left: configuration ─── */}
        <aside
          className="border-r border-white/[0.06] overflow-auto p-5 space-y-4"
          style={{ background: "#0D0F12" }}
        >
          <div>
            <h2 className="text-sm font-bold font-mono text-rose-400 flex items-center gap-2">
              <Sparkles size={14} />
              CONFIGURE
            </h2>
            <p className="text-[11px] text-white/30 mt-1.5 font-mono leading-relaxed">
              {mode === "rewrite"
                ? "Pick a product, an angle, and a language — then paste the source copy you want rewritten. Claude detects the format (listicle, Mini VSL, UGC script, email, ad copy, …) and rebuilds it in the same shape for this product."
                : "Pick a copy type, a product, and an angle. Drop in optional steering notes if you want to nudge the draft. Every generation is persisted."}
            </p>
          </div>

          {/* Step 1 in rewrite mode — paste the copy to be rewritten */}
          {mode === "rewrite" && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
              <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2.5 flex items-center gap-1.5">
                <Edit3 size={10} />
                1. Source Copy
                <span className="ml-auto text-rose-300/60 normal-case tracking-normal">required</span>
              </label>
              <textarea
                value={sourceCopy}
                onChange={(e) => setSourceCopy(e.target.value)}
                placeholder="Paste the copy you want rewritten — listicle, Mini VSL script, UGC video script, email, ad, brain-dump, anything. Claude detects the format and rebuilds it in the same shape for your product + angle."
                rows={8}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[12px] text-white/85 placeholder:text-white/25 outline-none resize-y leading-relaxed focus:border-rose-500/30 transition-colors font-mono"
                style={{ minHeight: "140px", maxHeight: "320px" }}
              />
              <div className="text-[10px] font-mono text-white/25 mt-2 leading-relaxed">
                Source language doesn't have to match output language — Claude
                translates as it rewrites.
              </div>
            </div>
          )}

          {/* Copy type dropdown — hidden in rewrite mode (format is dictated by the source) */}
          {mode !== "rewrite" && (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
            <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2.5">
              1. Copy Type
            </label>
            <div className="relative">
              <button
                onClick={() => setCopyTypeDropdownOpen((s) => !s)}
                className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 hover:border-white/[0.15] transition-all text-left"
              >
                <FileText size={14} className="text-white/30 shrink-0" />
                <div className="flex-1">
                  <div className={`text-sm ${selectedCopyType ? "text-white/80" : "text-white/30"}`}>
                    {selectedCopyType?.name ?? "Pick a copy type..."}
                  </div>
                  {selectedCopyType ? (
                    <div className="text-[10px] font-mono text-white/30 truncate mt-0.5">
                      {selectedCopyType.description}
                    </div>
                  ) : null}
                </div>
                <ChevronDown
                  size={14}
                  className={`text-white/30 transition-transform ${copyTypeDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {copyTypeDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-30"
                    style={{ background: "#1A1D28" }}
                  >
                    <div className="p-1.5 max-h-72 overflow-auto">
                      {COPY_TYPES.map((ct) => (
                        <button
                          key={ct.id}
                          disabled={!ct.available}
                          onClick={() => {
                            if (!ct.available) return;
                            setCopyTypeId(ct.id);
                            setCopyTypeDropdownOpen(false);
                          }}
                          className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left transition-all ${
                            !ct.available
                              ? "opacity-40 cursor-not-allowed"
                              : copyTypeId === ct.id
                                ? "bg-rose-500/10 border border-rose-500/20"
                                : "hover:bg-white/[0.04] border border-transparent"
                          }`}
                        >
                          <FileText size={12} className="text-white/40 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white/80 flex items-center gap-2">
                              {ct.name}
                              {!ct.available && (
                                <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/[0.05] text-white/30">
                                  soon
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-mono text-white/30 mt-0.5 leading-relaxed">
                              {ct.description}
                            </div>
                          </div>
                          {copyTypeId === ct.id && <Check size={12} className="text-rose-400 shrink-0 mt-1" />}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          )}

          {/* Product dropdown */}
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
            <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2.5">
              2. Product
            </label>
            <div className="relative">
              <button
                onClick={() => setProductDropdownOpen((s) => !s)}
                className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 hover:border-white/[0.15] transition-all text-left"
              >
                {selectedProduct ? (
                  <>
                    <div className="w-8 h-8 rounded-md overflow-hidden border border-white/[0.08] shrink-0 bg-white/[0.02]">
                      {selectedProduct.productImageUrl ? (
                        <img
                          src={selectedProduct.productImageUrl}
                          alt={selectedProduct.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package size={12} className="text-white/20" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white/80 truncate">{selectedProduct.name}</div>
                      <div className="text-[10px] font-mono text-white/30 truncate">{selectedProduct.category}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-8 h-8 rounded-md border border-dashed border-white/[0.12] flex items-center justify-center shrink-0">
                      {productsLoading ? (
                        <Loader2 size={12} className="text-white/30 animate-spin" />
                      ) : (
                        <Package size={14} className="text-white/20" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white/30">
                        {productsLoading
                          ? "Loading products..."
                          : productsError
                            ? "Failed to load products"
                            : researchedProducts.length === 0
                              ? "No researched products yet"
                              : "Choose a product..."}
                      </div>
                      <div className="text-[10px] font-mono text-white/15 truncate">
                        {productsError ?? "Only researched products available"}
                      </div>
                    </div>
                  </>
                )}
                <ChevronDown
                  size={14}
                  className={`text-white/30 transition-transform ${productDropdownOpen ? "rotate-180" : ""}`}
                />
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
                    <div className="p-1.5 max-h-64 overflow-auto">
                      {researchedProducts.length === 0 && (
                        <div className="px-3 py-6 text-center text-[11px] font-mono text-white/30">
                          No researched products. Add one from the Products page first.
                        </div>
                      )}
                      {researchedProducts.map((product) => (
                        <button
                          key={product.id}
                          onClick={() => {
                            setSelectedProductId(product.id);
                            setProductDropdownOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-all ${
                            selectedProductId === product.id
                              ? "bg-rose-500/10 border border-rose-500/20"
                              : "hover:bg-white/[0.04] border border-transparent"
                          }`}
                        >
                          <div className="w-8 h-8 rounded-md overflow-hidden border border-white/[0.06] shrink-0 bg-white/[0.02]">
                            {product.productImageUrl ? (
                              <img src={product.productImageUrl} alt={product.name} className="w-full h-full object-contain" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Package size={11} className="text-white/20" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white/80 truncate">{product.name}</div>
                            <div className="text-[10px] font-mono text-white/30 truncate">{product.category}</div>
                          </div>
                          {selectedProductId === product.id && (
                            <Check size={12} className="text-rose-400 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Angle dropdown */}
          <div
            className={`rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 transition-opacity ${
              selectedProduct ? "" : "opacity-50 pointer-events-none"
            }`}
          >
            <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2.5">
              3. Angle
            </label>
            <div className="relative">
              <button
                onClick={() => setAngleDropdownOpen((s) => !s)}
                disabled={!selectedProduct}
                className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 hover:border-white/[0.15] transition-all text-left disabled:cursor-not-allowed"
              >
                <Layers size={14} className="text-white/30 shrink-0" />
                <span className={`text-sm flex-1 truncate ${selectedAngleName ? "text-white/80" : "text-white/30"}`}>
                  {selectedAngleName || (selectedProduct ? "Pick an angle..." : "Pick a product first")}
                </span>
                <ChevronDown
                  size={14}
                  className={`text-white/30 transition-transform ${angleDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {angleDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-30"
                    style={{ background: "#1A1D28" }}
                  >
                    <div className="p-1.5 max-h-64 overflow-auto">
                      {productAngles.length === 0 && (
                        <div className="px-3 py-6 text-center text-[11px] font-mono text-white/30">
                          No angles extracted for this product yet.
                        </div>
                      )}
                      {productAngles.map((angle, i) => (
                        <button
                          key={angle.name}
                          onClick={() => {
                            setSelectedAngleName(angle.name);
                            setAngleDropdownOpen(false);
                          }}
                          className={`w-full flex items-start gap-3 px-3 py-2 rounded-md text-left transition-all ${
                            selectedAngleName === angle.name
                              ? "bg-rose-500/10 border border-rose-500/20"
                              : "hover:bg-white/[0.04] border border-transparent"
                          }`}
                        >
                          <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold bg-white/[0.05] text-white/30 shrink-0 mt-0.5">
                            {i + 1}
                          </div>
                          <span className="text-xs text-white/70 flex-1 leading-relaxed">{angle.name}</span>
                          {selectedAngleName === angle.name && (
                            <Check size={12} className="text-rose-400 shrink-0 mt-1" />
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Front-End Offer textarea — required. Drives the closing CTA block. */}
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
            <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2.5 flex items-center gap-1.5">
              <BadgePercent size={10} />
              4. Front-End Offer
              <span className="ml-auto text-rose-300/60 normal-case tracking-normal">required</span>
            </label>
            <textarea
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              placeholder={`e.g. "Up to 58% off + free shaker bottle + free shipping over $50 + 30-day money-back guarantee"`}
              rows={3}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[12px] text-white/85 placeholder:text-white/25 outline-none resize-y leading-relaxed focus:border-rose-500/30 transition-colors font-mono"
              style={{ minHeight: "70px", maxHeight: "200px" }}
            />
            <div className="text-[10px] font-mono text-white/25 mt-2 leading-relaxed">
              Discount %, free gifts, bonuses, guarantee — Claude weaves this
              into the closing CTA block instead of inventing numbers.
            </div>
          </div>

          {/* Language dropdown */}
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
            <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2.5 flex items-center gap-1.5">
              <Globe size={10} />
              5. Output Language
            </label>
            <div className="relative">
              <button
                onClick={() => setLangDropdownOpen((s) => !s)}
                className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 hover:border-white/[0.15] transition-all text-left"
              >
                <span className="text-base shrink-0">{selectedLang.flag}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white/80">{selectedLang.label}</div>
                  <div className="text-[10px] font-mono text-white/30">
                    The entire output is written in this language
                  </div>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-white/30 transition-transform ${langDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {langDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-30"
                    style={{ background: "#1A1D28" }}
                  >
                    <div className="p-1.5 max-h-64 overflow-auto">
                      {LANGUAGES.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => {
                            setSelectedLanguage(lang.code);
                            setLangDropdownOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-all ${
                            selectedLanguage === lang.code
                              ? "bg-rose-500/10 border border-rose-500/20"
                              : "hover:bg-white/[0.04] border border-transparent"
                          }`}
                        >
                          <span className="text-base shrink-0">{lang.flag}</span>
                          <span className="text-xs text-white/70 flex-1">{lang.label}</span>
                          {selectedLanguage === lang.code && (
                            <Check size={12} className="text-rose-400 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Guidance textarea — always optional, shown in both modes */}
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
            <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2.5 flex items-center gap-1.5">
              <Lightbulb size={10} />
              6. Guidance
              <span className="ml-auto text-white/30 normal-case tracking-normal">optional</span>
            </label>
            <textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder={
                mode === "rewrite"
                  ? "Optional: must-include phrases, tone tweaks, things to drop from the source..."
                  : "Optional: must-include phrases, claims to anchor on, tone tweaks, sections to emphasize, things to avoid..."
              }
              rows={5}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[12px] text-white/85 placeholder:text-white/25 outline-none resize-y leading-relaxed focus:border-rose-500/30 transition-colors font-mono"
              style={{ minHeight: "90px", maxHeight: "240px" }}
            />
            <div className="text-[10px] font-mono text-white/25 mt-2 leading-relaxed">
              Skip this for a clean run, or drop in steering notes Claude must respect.
            </div>
          </div>

          {/* Generate / Rewrite button */}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-mono text-xs uppercase tracking-wider transition-all ${
              canGenerate
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 cursor-pointer"
                : "bg-white/[0.03] text-white/25 border border-white/[0.06] cursor-not-allowed"
            }`}
            style={canGenerate ? { boxShadow: "0 0 18px rgba(244,63,94,0.18)" } : {}}
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {mode === "rewrite" ? "Rewriting..." : "Generating..."}
              </>
            ) : (
              <>
                <Sparkles size={14} />
                {mode === "rewrite"
                  ? draft
                    ? "Rewrite again"
                    : "Rewrite Copy"
                  : draft
                    ? "Regenerate from scratch"
                    : "Generate Copy"}
              </>
            )}
          </button>

          {genError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 flex items-start gap-2">
              <AlertTriangle size={12} className="text-rose-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-rose-300 font-mono break-words leading-relaxed">{genError}</p>
            </div>
          )}
        </aside>

        {/* ─── Right: output + chat ─── */}
        <main className="flex flex-col overflow-hidden" style={{ background: "#0A0C10" }}>
          {/* Output toolbar */}
          <div className="h-12 border-b border-white/[0.06] flex items-center px-5 gap-3 shrink-0">
            <div className="text-[11px] font-mono text-white/40 uppercase tracking-wider flex items-center gap-2">
              <FileText size={12} className="text-white/30" />
              {draft
                ? mode === "rewrite"
                  ? "Rewritten Copy"
                  : (selectedCopyType?.name ?? "Output")
                : "Output"}
            </div>
            {draft && selectedAngle && (
              <div className="text-[10px] font-mono text-white/25 truncate">
                · {selectedAngle.name}
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={handleCopyAll}
                disabled={!draft || generating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-white/50 border border-white/[0.06] hover:bg-white/[0.08] hover:text-white/80 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <CopyIcon size={11} />
                Copy
              </button>
              <button
                onClick={() => void handleSaveToAssets()}
                disabled={!draft || generating || savingToAssets || savedToAssets || !activeBrandId}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono uppercase tracking-wider transition-all disabled:cursor-not-allowed ${
                  savedToAssets
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    : "bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20 disabled:opacity-30"
                }`}
              >
                {savingToAssets ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : savedToAssets ? (
                  <Check size={11} />
                ) : (
                  <FolderDown size={11} />
                )}
                {savedToAssets ? "Saved" : "Save to Assets"}
              </button>
            </div>
          </div>

          {/* Output body */}
          <div id="copy-engine-output" className="flex-1 overflow-auto p-6">
            {/* Auto-flow status — shown while the deep-link prepares the rewrite
                (fetching transcript + offer) before generation kicks off.
                Hidden once stalled so the normal form is visible for manual entry. */}
            {autorun && !autorunStalled && !draft && !generating && (
              <div className="h-full flex items-center justify-center">
                <div className="max-w-md text-center">
                  <Loader2 size={24} className="text-rose-400 animate-spin mx-auto mb-3" />
                  <div className="text-[12px] font-mono text-white/50">
                    Preparing rewrite — fetching transcript &amp; offer…
                  </div>
                  <div className="text-[10px] font-mono text-white/25 mt-1.5">
                    The rewrite starts automatically once both are ready.
                  </div>
                </div>
              </div>
            )}

            {(!autorun || autorunStalled) && !draft && !generating && (
              <div className="h-full flex items-center justify-center">
                <div className="max-w-md text-center">
                  <div
                    className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                    style={{
                      background: "linear-gradient(135deg, rgba(244,63,94,0.15), rgba(244,63,94,0.02))",
                      border: "1px solid rgba(244,63,94,0.25)",
                    }}
                  >
                    <Type size={20} className="text-rose-400" />
                  </div>
                  <h3 className="text-base font-bold text-white/80 mb-2">Generate your first draft</h3>
                  <p className="text-[12px] text-white/40 leading-relaxed font-mono">
                    Pick a copy type, product, and angle on the left — then click
                    <span className="text-rose-300"> Generate</span>. The draft
                    appears here. Use the chat box at the bottom to iterate.
                  </p>
                </div>
              </div>
            )}

            {generating && !draft && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <Loader2 size={28} className="text-rose-400 animate-spin mx-auto mb-3" />
                  <div className="text-[12px] font-mono text-white/40">
                    {mode === "rewrite"
                      ? "Rewriting your copy..."
                      : `Drafting ${selectedCopyType?.name?.toLowerCase() ?? "copy"}...`}
                  </div>
                  <div className="text-[10px] font-mono text-white/25 mt-1.5">
                    claude-opus-4-7 · this can take 60–120 seconds
                  </div>
                </div>
              </div>
            )}

            {draft && (
              <article className="prose-copy max-w-3xl mx-auto">
                {/*
                 * Claude is the only writer here — its output is restricted
                 * to the markdown shapes we ask for in the prompt, with no
                 * raw HTML — so dangerouslySetInnerHTML is safe in this
                 * context.
                 */}
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }} />
                <div ref={draftEndRef} />
              </article>
            )}
          </div>

          {/* Chat / feedback bar */}
          {draft && (
            <div className="border-t border-white/[0.06] shrink-0" style={{ background: "#0D0F12" }}>
              {chatHistory.length > 0 && (
                <div className="px-5 pt-4 pb-2 max-h-[180px] overflow-auto space-y-2">
                  {chatHistory.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                          m.role === "user"
                            ? "bg-rose-500/15 text-rose-100 border border-rose-500/20"
                            : "bg-white/[0.04] text-white/60 border border-white/[0.06]"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="p-4 flex items-end gap-2">
                <div className="flex-1 flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 focus-within:border-rose-500/30">
                  <MessageSquare size={13} className="text-white/30 shrink-0" />
                  <textarea
                    value={feedbackInput}
                    onChange={(e) => setFeedbackInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void handleSendFeedback();
                      }
                    }}
                    placeholder="Suggest a change — e.g. 'make headline #3 punchier' or 'add a section about quick wins'"
                    rows={1}
                    className="flex-1 bg-transparent text-[12px] text-white/85 placeholder:text-white/25 outline-none resize-none leading-relaxed"
                    style={{ minHeight: "20px", maxHeight: "120px" }}
                  />
                </div>
                <button
                  onClick={() => void handleSendFeedback()}
                  disabled={!feedbackInput.trim() || generating}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 transition-all text-[11px] font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Send feedback (⌘/Ctrl + Enter)"
                >
                  {generating ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Send
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generating || !canGenerate}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-white/[0.04] text-white/50 border border-white/[0.06] hover:bg-white/[0.08] hover:text-white/80 transition-all text-[11px] font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Regenerate from scratch (ignores chat history)"
                >
                  <RefreshCw size={12} />
                  Reset
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
      )}
    </div>
  );
}
