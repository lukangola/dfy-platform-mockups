/**
 * DESIGN: Studio Control Room — Done For You Workflow
 * Full automated workflow: Product → Research → Angles → Message Testing → Creatives → Listicle → Analysis
 * Dark background, Cyan accent (#00D4FF), step-by-step pipeline
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, Search, Target, MessageSquare, Paintbrush, FileText, BarChart3,
  ChevronRight, ChevronLeft, Check, RefreshCw, Send, Play, Pause,
  Edit3, ThumbsUp, ThumbsDown, RotateCcw, Download, ArrowRight,
  Sparkles, Zap, Eye, X, ChevronDown, ChevronUp, Plus, Minus,
  Video, ImagePlus, Type, Megaphone, ListChecks,
} from "lucide-react";
import { IMAGES, MOCK_PRODUCTS, MOCK_MESSAGE_ANGLES } from "@/lib/mockData";

// ============================================================
// DFY WORKFLOW STEPS
// ============================================================

const DFY_STEPS = [
  { id: 0, key: "select", label: "Select Product", icon: Package, description: "Choose the product to run the DFY workflow for" },
  { id: 1, key: "research", label: "Research", icon: Search, description: "AI-powered product & market research" },
  { id: 2, key: "angles", label: "Angles & Messages", icon: Target, description: "Review angles, messages, and copy" },
  { id: 3, key: "message-testing", label: "Message Testing", icon: MessageSquare, description: "Generate & test message ads to find winning angle" },
  { id: 4, key: "creatives", label: "Produce Creatives", icon: Paintbrush, description: "100+ creatives for winning angle" },
  { id: 5, key: "listicle", label: "Build Listicle", icon: FileText, description: "Angle-specific listicle page" },
  { id: 6, key: "analysis", label: "Analyze & Report", icon: BarChart3, description: "Sprint results & next steps" },
];

// Mock research data
const MOCK_RESEARCH = {
  productOverview: "Golden Radiance Serum is a premium facial serum featuring 24K gold-infused formula with hyaluronic acid, vitamin C, and retinol. Targets women 28-55 seeking visible anti-aging results with a luxurious self-care experience.",
  targetAudience: "Women aged 28-55, mid-to-high income, interested in premium skincare. They value visible results, clean ingredients, and the ritual of self-care. Many have tried multiple products without satisfaction.",
  competitorAnalysis: [
    { brand: "La Mer", strength: "Heritage & luxury positioning", weakness: "Price point alienates mid-market", opportunity: "Position as accessible luxury" },
    { brand: "Drunk Elephant", strength: "Clean beauty pioneer", weakness: "Ingredient fatigue messaging", opportunity: "Focus on results over ingredients" },
    { brand: "Tatcha", strength: "Cultural storytelling", weakness: "Limited shade/skin type range", opportunity: "Inclusive messaging" },
    { brand: "Sunday Riley", strength: "Cult following", weakness: "Inconsistent results claims", opportunity: "Proof-driven content" },
  ],
  keyIngredients: [
    { name: "24K Gold Particles", benefit: "Anti-inflammatory, promotes collagen synthesis, gives visible radiance" },
    { name: "Hyaluronic Acid (3 molecular weights)", benefit: "Deep hydration at multiple skin layers" },
    { name: "Vitamin C (L-Ascorbic Acid 15%)", benefit: "Brightening, antioxidant protection, even skin tone" },
    { name: "Encapsulated Retinol 0.5%", benefit: "Anti-aging with reduced irritation" },
  ],
  customerPainPoints: [
    "Tried expensive serums that didn't deliver visible results",
    "Frustrated by products that cause irritation or breakouts",
    "Want luxury experience without the luxury price tag",
    "Overwhelmed by ingredient lists and marketing claims",
    "Looking for one product that does multiple things",
  ],
  resonanceStatements: [
    "\"I've spent hundreds on serums and my skin still looks tired\" — Reddit r/SkincareAddiction",
    "\"Why does every serum claim to be a miracle but none of them actually work?\" — Amazon Review",
    "\"I just want something that makes me look like I got 8 hours of sleep\" — Facebook Group",
    "\"The gold in skincare sounds gimmicky but my dermatologist actually recommended it\" — RealSelf Forum",
  ],
};

// Mock angles with detailed messages
const MOCK_DFY_ANGLES = [
  {
    id: "a1", name: "Visible Transformation", selected: true,
    description: "Focus on the dramatic, visible before/after transformation that users experience",
    messages: [
      "Your skin is aging faster than you think — here's the 30-second fix dermatologists are calling 'liquid gold'",
      "She looked 10 years younger in 14 days. Her secret? Not Botox.",
      "The #1 reason your expensive serum isn't working (and what to use instead)",
      "I tried 47 serums. This is the only one that actually changed my skin.",
      "Warning: Your mirror might not recognize you after 2 weeks",
      "The gold-infused serum that's replacing $300 facials",
      "Why your skin looks tired no matter how much you sleep",
      "Dermatologists are shocked by what this serum does in 14 days",
      "The anti-aging ingredient Big Skincare doesn't want you to know about",
      "Stop wasting money on serums that don't work. Try this instead.",
    ],
    copy: "Your skin deserves more than empty promises. Golden Radiance Serum combines 24K gold particles with clinical-grade actives to deliver the transformation you've been searching for. In just 14 days, see visibly firmer, brighter, more youthful skin — or your money back.",
  },
  {
    id: "a2", name: "Luxury Self-Care Ritual", selected: true,
    description: "Position the product as the centerpiece of a premium self-care routine",
    messages: [
      "The 60-second morning ritual that replaced my entire skincare shelf",
      "Why successful women are switching to gold-infused skincare",
      "Turn your bathroom into a spa with one product",
      "The self-care secret that A-list celebrities swear by",
      "You deserve a skincare routine that feels as good as it works",
      "Luxury skincare without the luxury price tag — finally",
      "The golden hour isn't just for photos anymore",
      "One pump. 60 seconds. The glow that lasts all day.",
      "Stop surviving your skincare routine. Start enjoying it.",
      "The serum that makes your morning routine feel like a spa day",
    ],
    copy: "Transform your daily routine into a luxurious ritual. Each drop of Golden Radiance Serum glides on like liquid silk, infusing your skin with 24K gold and potent actives. Because your skincare should be the best part of your morning, not a chore.",
  },
  {
    id: "a3", name: "Science-Backed Results", selected: true,
    description: "Lead with clinical data, ingredient science, and dermatologist endorsements",
    messages: [
      "The clinical study that's changing everything we know about anti-aging",
      "3 ingredients. 14 days. Results you can measure.",
      "Why dermatologists are recommending gold for your skin (it's not what you think)",
      "The science behind the glow: How 24K gold actually repairs your skin",
      "Clinically proven to reduce fine lines by 47% in 28 days",
      "Your dermatologist's secret weapon costs less than you'd expect",
      "The ingredient combination that outperformed retinol alone by 3x",
      "Lab-tested. Dermatologist-approved. Instagram-worthy results.",
      "The peer-reviewed ingredient that Big Skincare has been ignoring",
      "Finally: A serum backed by science, not just marketing",
    ],
    copy: "Don't take our word for it — take science's. Golden Radiance Serum is formulated with three clinically-proven actives at their optimal concentrations. In independent clinical trials, 94% of participants saw measurable improvement in skin firmness, brightness, and fine line reduction within 28 days.",
  },
  {
    id: "a4", name: "Ingredient Transparency", selected: true,
    description: "Appeal to ingredient-conscious consumers who want to know exactly what they're putting on their skin",
    messages: [
      "Read the label. We dare you.",
      "5 ingredients. Zero fillers. That's it.",
      "The serum with nothing to hide (literally — it's transparent)",
      "If you can't pronounce it, it shouldn't be on your face",
      "We spent 2 years perfecting 5 ingredients so you don't need 15 products",
      "Clean beauty that actually works (yes, both are possible)",
      "The ingredient list shorter than your grocery receipt",
      "No parabens. No sulfates. No BS. Just results.",
      "What's in your serum? (Spoiler: probably stuff you don't want)",
      "Transparency isn't our marketing strategy. It's our only strategy.",
    ],
    copy: "In a world of 30-ingredient serums with unpronounceable names, we chose a different path. Golden Radiance Serum contains exactly 5 active ingredients — each one clinically proven, ethically sourced, and at its optimal concentration. No fillers. No fragrance. No compromises.",
  },
  {
    id: "a5", name: "Problem-Solution (Tired Skin)", selected: true,
    description: "Directly address the pain point of tired, dull-looking skin despite adequate sleep and care",
    messages: [
      "You're not tired. Your skin is. Here's the fix.",
      "8 hours of sleep won't fix this. But 30 seconds will.",
      "The real reason you look exhausted (even when you're not)",
      "Dark circles? Dull skin? It's not your sleep schedule.",
      "Your skin is screaming for help. Are you listening?",
      "The exhaustion cure that doesn't require more sleep",
      "Why your face tells a different story than how you feel",
      "Tired of looking tired? There's a 30-second solution.",
      "The morning-after glow without the 10-step routine",
      "Wake up your skin (even when your alarm can't wake up you)",
    ],
    copy: "You eat well. You sleep well. You exercise. So why does your skin still look exhausted? The answer isn't another lifestyle change — it's cellular. Golden Radiance Serum works at the cellular level to restore your skin's natural radiance, so your face finally matches how you feel inside.",
  },
];

// Mock creative types for Step 4
const CREATIVE_TYPES = [
  { id: "founder", label: "Founder Ads", count: 15, description: "3 concepts × 5 hooks", icon: Megaphone, color: "#00D4FF" },
  { id: "mini-vsl", label: "Mini VSLs", count: 15, description: "3 concepts × 5 hooks", icon: Video, color: "#A855F7" },
  { id: "short-video", label: "Short Video Ads", count: 15, description: "3 concepts × 5 messages", icon: Play, color: "#F59E0B" },
  { id: "static-ads", label: "Static Ads", count: 50, description: "By awareness stage", icon: ImagePlus, color: "#10B981" },
  { id: "ugc-scripts", label: "UGC Scripts", count: 100, description: "20 scripts × 5 hooks", icon: Type, color: "#F43F5E" },
  { id: "broll", label: "B-Roll Shots", count: 30, description: "From script analysis", icon: Video, color: "#6366F1" },
];

// Mock listicle data
const MOCK_LISTICLE_POINTS = [
  { id: 1, headline: "Clinically Proven 24K Gold Formula", body: "Unlike cheap gold-flake products, our serum uses nano-sized 24K gold particles that actually penetrate the skin barrier to stimulate collagen production.", image: IMAGES.productSerum, approved: true },
  { id: 2, headline: "3-Layer Hydration Technology", body: "Three molecular weights of hyaluronic acid work at different skin depths, delivering hydration that lasts 72 hours — not just 72 minutes.", image: IMAGES.brollUsage, approved: true },
  { id: 3, headline: "Visible Results in 14 Days", body: "In independent clinical trials, 94% of participants saw measurable improvement in skin firmness and brightness within just two weeks.", image: IMAGES.brollPresentation, approved: false },
  { id: 4, headline: "Replaces 5 Products in Your Routine", body: "Serum, moisturizer, brightener, anti-aging treatment, and primer — all in one luxurious formula. Simplify your routine without sacrificing results.", image: IMAGES.productShampoo, approved: true },
  { id: 5, headline: "Clean Ingredients You Can Trust", body: "No parabens, no sulfates, no synthetic fragrances. Just 5 active ingredients at their optimal concentrations, ethically sourced and cruelty-free.", image: IMAGES.brollUnboxing, approved: true },
  { id: 6, headline: "The Texture That Changed Everything", body: "Lightweight, non-greasy, absorbs in seconds. The golden liquid glides on like silk and leaves zero residue — perfect under makeup or on its own.", image: IMAGES.brollUsage, approved: false },
  { id: 7, headline: "Dermatologist-Developed Formula", body: "Created in collaboration with board-certified dermatologists who specialize in anti-aging. Every ingredient is backed by peer-reviewed research.", image: IMAGES.productSerum, approved: true },
  { id: 8, headline: "Works on All Skin Types", body: "Whether you have oily, dry, combination, or sensitive skin, our pH-balanced formula adapts to your skin's unique needs without causing irritation.", image: IMAGES.brollPresentation, approved: true },
  { id: 9, headline: "The Morning Ritual You'll Actually Enjoy", body: "Turn your skincare routine from a chore into the best 60 seconds of your morning. The subtle golden shimmer and spa-like experience make every application a moment of luxury.", image: IMAGES.brollUsage, approved: false },
  { id: 10, headline: "90-Day Money-Back Guarantee", body: "We're so confident you'll see results that we offer a full 90-day money-back guarantee. Try it risk-free and see the transformation for yourself.", image: IMAGES.productSerum, approved: true },
  { id: 11, headline: "Join 50,000+ Women Who Made the Switch", body: "From first-time serum users to skincare veterans, thousands of women have replaced their entire anti-aging routine with Golden Radiance Serum.", image: IMAGES.brollPresentation, approved: true },
];

// ============================================================
// COMPONENT
// ============================================================

export default function DFYWorkflowPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [researchApproved, setResearchApproved] = useState(false);
  const [editingResearch, setEditingResearch] = useState<string | null>(null);
  const [angles, setAngles] = useState(MOCK_DFY_ANGLES);
  const [anglesApproved, setAnglesApproved] = useState(false);
  const [expandedAngle, setExpandedAngle] = useState<string | null>("a1");
  const [messageTestingDone, setMessageTestingDone] = useState(false);
  const [winningAngle, setWinningAngle] = useState<string | null>(null);
  const [creativesGenerated, setCreativesGenerated] = useState(false);
  const [creativeApprovals, setCreativeApprovals] = useState<Record<string, boolean>>({});
  const [listiclePoints, setListiclePoints] = useState(MOCK_LISTICLE_POINTS);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "ai"; content: string }>>([]);
  const [showChat, setShowChat] = useState(false);
  const [chatContext, setChatContext] = useState("");

  const product = MOCK_PRODUCTS.find(p => p.id === selectedProduct);

  const handleStartWorkflow = () => {
    if (!selectedProduct) return;
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setCurrentStep(1);
    }, 1500);
  };

  const handleSendChat = () => {
    if (!chatInput.trim()) return;
    setChatMessages(prev => [...prev, { role: "user", content: chatInput }]);
    const reply = `Understood. I'll adjust the ${chatContext} based on your feedback: "${chatInput.slice(0, 50)}...". The changes have been applied.`;
    setTimeout(() => {
      setChatMessages(prev => [...prev, { role: "ai", content: reply }]);
    }, 800);
    setChatInput("");
  };

  const openChat = (context: string) => {
    setChatContext(context);
    setShowChat(true);
    setChatMessages([]);
  };

  const toggleAngle = (id: string) => {
    setAngles(prev => prev.map(a => a.id === id ? { ...a, selected: !a.selected } : a));
  };

  // ============================================================
  // STEP RENDERERS
  // ============================================================

  const renderProductSelect = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-10">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00D4FF20, #00D4FF05)" }}>
          <Zap size={28} className="text-cyan-400" />
        </div>
        <h2 className="text-2xl font-semibold text-white mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          Done For You Workflow
        </h2>
        <p className="text-white/40 text-sm max-w-md mx-auto">
          Select a product and hit Go. The system will automatically run the full DFY playbook — research, angles, message testing, creative production, listicle, and analysis.
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] p-6" style={{ background: "#13161B" }}>
        <label className="block text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">Select Product</label>
        <div className="space-y-2 mb-6">
          {MOCK_PRODUCTS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedProduct(p.id)}
              className={`w-full flex items-center gap-4 p-3 rounded-lg border transition-all ${
                selectedProduct === p.id
                  ? "border-cyan-500/40 bg-cyan-500/5"
                  : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <img src={p.productImage} alt={p.name} className="w-12 h-12 rounded-lg object-cover" />
              <div className="text-left flex-1">
                <div className={`text-sm font-medium ${selectedProduct === p.id ? "text-cyan-400" : "text-white/70"}`}>{p.name}</div>
                <div className="text-[11px] text-white/30">{p.category}</div>
              </div>
              {selectedProduct === p.id && (
                <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                  <Check size={12} className="text-[#0D0F12]" />
                </div>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={handleStartWorkflow}
          disabled={!selectedProduct || isProcessing}
          className="w-full py-3 rounded-lg font-mono text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            background: selectedProduct ? "linear-gradient(135deg, #00D4FF, #0099CC)" : undefined,
            color: selectedProduct ? "#0D0F12" : undefined,
          }}
        >
          {isProcessing ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              Starting workflow...
            </>
          ) : (
            <>
              <Play size={14} />
              GO — Start Full DFY Workflow
            </>
          )}
        </button>
      </div>

      {/* Workflow Preview */}
      <div className="mt-8 rounded-xl border border-white/[0.04] p-5" style={{ background: "#0F1115" }}>
        <div className="text-[10px] font-mono text-white/20 uppercase tracking-widest mb-4">Workflow Pipeline</div>
        <div className="space-y-2">
          {DFY_STEPS.slice(1).map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.id} className="flex items-center gap-3 text-white/20">
                <div className="w-6 h-6 rounded-md border border-white/[0.06] flex items-center justify-center text-[10px] font-mono">{i + 1}</div>
                <Icon size={14} />
                <span className="text-xs">{step.label}</span>
                <span className="text-[10px] text-white/10 ml-auto">{step.description}</span>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );

  const renderResearch = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Product Research</h2>
          <p className="text-xs text-white/30 mt-1">AI-generated research for {product?.name}. Review, edit, and approve.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openChat("research")} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-1.5">
            <MessageSquare size={12} /> Feedback
          </button>
          <button onClick={() => { setResearchApproved(true); }} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: researchApproved ? "#10B981" : "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
            {researchApproved ? <><Check size={12} /> Approved</> : <><ThumbsUp size={12} /> Approve Research</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Product Overview */}
        <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider">Product Overview</h3>
            <button onClick={() => setEditingResearch(editingResearch === "overview" ? null : "overview")} className="text-white/20 hover:text-white/50"><Edit3 size={12} /></button>
          </div>
          <p className="text-sm text-white/60 leading-relaxed">{MOCK_RESEARCH.productOverview}</p>
        </div>

        {/* Target Audience */}
        <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider">Target Audience</h3>
            <button onClick={() => setEditingResearch(editingResearch === "audience" ? null : "audience")} className="text-white/20 hover:text-white/50"><Edit3 size={12} /></button>
          </div>
          <p className="text-sm text-white/60 leading-relaxed">{MOCK_RESEARCH.targetAudience}</p>
        </div>

        {/* Competitor Analysis */}
        <div className="rounded-xl border border-white/[0.06] p-5 lg:col-span-2" style={{ background: "#13161B" }}>
          <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-3">Competitor Analysis</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {MOCK_RESEARCH.competitorAnalysis.map((c, i) => (
              <div key={i} className="rounded-lg border border-white/[0.04] p-3" style={{ background: "#0F1115" }}>
                <div className="text-sm font-medium text-white/70 mb-2">{c.brand}</div>
                <div className="space-y-1.5">
                  <div><span className="text-[9px] font-mono text-green-400/60 uppercase">Strength:</span><p className="text-[11px] text-white/40">{c.strength}</p></div>
                  <div><span className="text-[9px] font-mono text-red-400/60 uppercase">Weakness:</span><p className="text-[11px] text-white/40">{c.weakness}</p></div>
                  <div><span className="text-[9px] font-mono text-cyan-400/60 uppercase">Opportunity:</span><p className="text-[11px] text-white/40">{c.opportunity}</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Key Ingredients */}
        <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
          <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-3">Key Ingredients</h3>
          <div className="space-y-3">
            {MOCK_RESEARCH.keyIngredients.map((ing, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                <div>
                  <div className="text-xs font-medium text-white/60">{ing.name}</div>
                  <div className="text-[11px] text-white/30">{ing.benefit}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Customer Pain Points */}
        <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
          <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-3">Customer Pain Points</h3>
          <div className="space-y-2">
            {MOCK_RESEARCH.customerPainPoints.map((p, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-white/50">
                <span className="text-red-400/60 mt-0.5">•</span>
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Resonance Statements */}
        <div className="rounded-xl border border-white/[0.06] p-5 lg:col-span-2" style={{ background: "#13161B" }}>
          <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-3">Real Customer Resonance Statements</h3>
          <div className="space-y-2">
            {MOCK_RESEARCH.resonanceStatements.map((s, i) => (
              <div key={i} className="rounded-lg border border-white/[0.04] p-3 text-sm text-white/50 italic" style={{ background: "#0F1115" }}>
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );

  const renderAngles = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Angles & Messages</h2>
          <p className="text-xs text-white/30 mt-1">{angles.filter(a => a.selected).length} angles selected. Review messages and angle-specific copy.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openChat("angles and messages")} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-1.5">
            <MessageSquare size={12} /> Feedback
          </button>
          <button onClick={() => setAnglesApproved(true)} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: anglesApproved ? "#10B981" : "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
            {anglesApproved ? <><Check size={12} /> Approved</> : <><ThumbsUp size={12} /> Approve Angles</>}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {angles.map((angle) => (
          <div key={angle.id} className={`rounded-xl border transition-all ${angle.selected ? "border-cyan-500/20 bg-[#13161B]" : "border-white/[0.04] bg-[#0F1115] opacity-50"}`}>
            {/* Angle Header */}
            <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpandedAngle(expandedAngle === angle.id ? null : angle.id)}>
              <button
                onClick={(e) => { e.stopPropagation(); toggleAngle(angle.id); }}
                className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-all ${
                  angle.selected ? "border-cyan-500 bg-cyan-500" : "border-white/20 bg-transparent"
                }`}
              >
                {angle.selected && <Check size={12} className="text-[#0D0F12]" />}
              </button>
              <div className="flex-1">
                <div className="text-sm font-medium text-white/80">{angle.name}</div>
                <div className="text-[11px] text-white/30">{angle.description}</div>
              </div>
              <span className="text-[10px] font-mono text-white/20">{angle.messages.length} messages</span>
              {expandedAngle === angle.id ? <ChevronUp size={14} className="text-white/20" /> : <ChevronDown size={14} className="text-white/20" />}
            </div>

            {/* Expanded Content */}
            <AnimatePresence>
              {expandedAngle === angle.id && angle.selected && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 border-t border-white/[0.04] pt-4">
                    {/* Angle Copy */}
                    <div className="mb-4">
                      <div className="text-[10px] font-mono text-cyan-400/60 uppercase tracking-wider mb-2">Angle Copy</div>
                      <div className="rounded-lg border border-white/[0.04] p-3 text-sm text-white/50 leading-relaxed" style={{ background: "#0D0F12" }}>
                        {angle.copy}
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="text-[10px] font-mono text-cyan-400/60 uppercase tracking-wider mb-2">Messages ({angle.messages.length})</div>
                    <div className="space-y-1.5">
                      {angle.messages.map((msg, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border border-white/[0.04] px-3 py-2" style={{ background: "#0D0F12" }}>
                          <span className="text-[10px] font-mono text-white/15 w-5 shrink-0">{i + 1}.</span>
                          <span className="text-xs text-white/50 flex-1">{msg}</span>
                          <button className="text-white/10 hover:text-white/30"><Edit3 size={10} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </motion.div>
  );

  const renderMessageTesting = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Message Testing</h2>
          <p className="text-xs text-white/30 mt-1">Generate message testing ads, launch campaign, and determine winning angle.</p>
        </div>
      </div>

      {!messageTestingDone ? (
        <div className="space-y-4">
          {/* Message Testing Ads Generation */}
          <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#00D4FF15" }}>
                <ImagePlus size={16} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-white/70">1. Generate Message Testing Ads</div>
                <div className="text-[11px] text-white/30">Creates ads for each angle's top message using your chosen template</div>
              </div>
              <div className="ml-auto">
                <div className="px-2 py-0.5 rounded text-[9px] font-mono bg-green-500/10 text-green-400 border border-green-500/20">COMPLETED</div>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {angles.filter(a => a.selected).map((angle) => (
                <div key={angle.id} className="rounded-lg border border-white/[0.04] p-2 text-center" style={{ background: "#0F1115" }}>
                  <div className="w-full aspect-square rounded bg-white/[0.03] mb-1.5 flex items-center justify-center overflow-hidden">
                    <img src={IMAGES.productSerum} alt="" className="w-full h-full object-cover opacity-60" />
                  </div>
                  <div className="text-[9px] text-white/40 truncate">{angle.name}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Launch Campaign */}
          <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#F59E0B15" }}>
                <Megaphone size={16} className="text-amber-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-white/70">2. Launch Testing Campaign</div>
                <div className="text-[11px] text-white/30">LVRG_ABO_Testing_Traffic — one ad set per angle</div>
              </div>
              <div className="ml-auto">
                <div className="px-2 py-0.5 rounded text-[9px] font-mono bg-green-500/10 text-green-400 border border-green-500/20">LAUNCHED</div>
              </div>
            </div>
          </div>

          {/* Analyze Results */}
          <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#A855F715" }}>
                <BarChart3 size={16} className="text-purple-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-white/70">3. Analyze Results (3 days)</div>
                <div className="text-[11px] text-white/30">Determine winning angle by Cost per Link Click & CTR</div>
              </div>
            </div>

            {/* Results Table */}
            <div className="rounded-lg border border-white/[0.04] overflow-hidden" style={{ background: "#0F1115" }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.04]">
                    <th className="text-left p-2.5 font-mono text-white/20 text-[10px] uppercase">Angle</th>
                    <th className="text-right p-2.5 font-mono text-white/20 text-[10px] uppercase">CPC</th>
                    <th className="text-right p-2.5 font-mono text-white/20 text-[10px] uppercase">CTR</th>
                    <th className="text-right p-2.5 font-mono text-white/20 text-[10px] uppercase">Clicks</th>
                    <th className="text-center p-2.5 font-mono text-white/20 text-[10px] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {angles.filter(a => a.selected).map((angle, i) => {
                    const isWinner = i === 0;
                    const cpc = (0.12 + Math.random() * 0.35).toFixed(2);
                    const ctr = (1.2 + Math.random() * 3.5).toFixed(1);
                    const clicks = Math.floor(80 + Math.random() * 200);
                    return (
                      <tr key={angle.id} className={`border-b border-white/[0.02] ${isWinner ? "bg-cyan-500/5" : ""}`}>
                        <td className={`p-2.5 ${isWinner ? "text-cyan-400 font-medium" : "text-white/50"}`}>{angle.name}</td>
                        <td className={`p-2.5 text-right font-mono ${isWinner ? "text-cyan-400" : "text-white/40"}`}>${isWinner ? "0.12" : cpc}</td>
                        <td className={`p-2.5 text-right font-mono ${isWinner ? "text-cyan-400" : "text-white/40"}`}>{isWinner ? "4.2" : ctr}%</td>
                        <td className={`p-2.5 text-right font-mono ${isWinner ? "text-cyan-400" : "text-white/40"}`}>{isWinner ? "247" : clicks}</td>
                        <td className="p-2.5 text-center">
                          {isWinner ? (
                            <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">WINNER</span>
                          ) : (
                            <span className="text-[9px] font-mono text-white/20">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button
              onClick={() => { setMessageTestingDone(true); setWinningAngle(angles[0]?.id || null); }}
              className="mt-4 w-full py-2.5 rounded-lg text-[11px] font-mono font-semibold flex items-center justify-center gap-2 transition-all"
              style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}
            >
              <Check size={12} /> Confirm Winning Angle & Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-cyan-500/20 p-6 text-center" style={{ background: "#13161B" }}>
          <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center mx-auto mb-3">
            <Target size={24} className="text-cyan-400" />
          </div>
          <div className="text-lg font-semibold text-cyan-400 mb-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Winning Angle: {angles[0]?.name}
          </div>
          <p className="text-xs text-white/30 max-w-md mx-auto">
            This angle had the lowest CPC ($0.12) and highest CTR (4.2%). All subsequent creatives will be produced for this angle.
          </p>
        </div>
      )}
    </motion.div>
  );

  const renderCreatives = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Produce Creatives</h2>
          <p className="text-xs text-white/30 mt-1">100+ creatives for winning angle: {angles[0]?.name}. Review and approve each type.</p>
        </div>
        {!creativesGenerated && (
          <button
            onClick={() => setCreativesGenerated(true)}
            className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all"
            style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}
          >
            <Sparkles size={12} /> Generate All Creatives
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CREATIVE_TYPES.map((type) => {
          const isApproved = creativeApprovals[type.id];
          return (
            <div key={type.id} className={`rounded-xl border p-5 transition-all ${isApproved ? "border-green-500/20" : "border-white/[0.06]"}`} style={{ background: "#13161B" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${type.color}15` }}>
                  <type.icon size={18} style={{ color: type.color }} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white/70">{type.label}</div>
                  <div className="text-[10px] text-white/30">{type.description}</div>
                </div>
              </div>

              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl font-bold font-mono" style={{ color: type.color }}>{type.count}</span>
                <span className="text-[10px] font-mono text-white/20">creatives</span>
              </div>

              {creativesGenerated ? (
                <div className="space-y-2">
                  {/* Progress bar */}
                  <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-1000" style={{ width: isApproved ? "100%" : "85%", background: isApproved ? "#10B981" : type.color }} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openChat(type.label)} className="flex-1 py-1.5 rounded-lg text-[10px] font-mono border border-white/[0.06] text-white/30 hover:text-white/60 hover:bg-white/[0.03] transition-all flex items-center justify-center gap-1">
                      <MessageSquare size={10} /> Review
                    </button>
                    <button
                      onClick={() => setCreativeApprovals(prev => ({ ...prev, [type.id]: !prev[type.id] }))}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-mono font-semibold flex items-center justify-center gap-1 transition-all ${
                        isApproved ? "bg-green-500/10 text-green-400 border border-green-500/20" : "text-[#0D0F12]"
                      }`}
                      style={!isApproved ? { background: type.color } : undefined}
                    >
                      {isApproved ? <><Check size={10} /> Approved</> : <><ThumbsUp size={10} /> Approve</>}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-1.5 rounded-full bg-white/[0.04]">
                  <div className="h-full rounded-full bg-white/[0.08] w-0" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {creativesGenerated && (
        <div className="mt-6 rounded-xl border border-white/[0.06] p-4 flex items-center justify-between" style={{ background: "#13161B" }}>
          <div className="flex items-center gap-3">
            <ListChecks size={16} className="text-white/30" />
            <span className="text-xs text-white/40">
              {Object.values(creativeApprovals).filter(Boolean).length} / {CREATIVE_TYPES.length} creative types approved
            </span>
          </div>
          <div className="text-xs font-mono text-white/20">
            Total: {CREATIVE_TYPES.reduce((sum, t) => sum + t.count, 0)} creatives
          </div>
        </div>
      )}
    </motion.div>
  );

  const renderListicle = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Build Listicle</h2>
          <p className="text-xs text-white/30 mt-1">11 reasons why — angle-specific listicle for {angles[0]?.name}. Approve each point.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openChat("listicle")} className="px-3 py-1.5 rounded-lg text-[11px] font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-1.5">
            <MessageSquare size={12} /> Feedback
          </button>
          <button onClick={() => setListiclePoints(prev => prev.map(p => ({ ...p, approved: true })))} className="px-4 py-1.5 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
            <ThumbsUp size={12} /> Approve All
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {listiclePoints.map((point, i) => (
          <div key={point.id} className={`rounded-xl border p-4 flex gap-4 transition-all ${point.approved ? "border-green-500/15 bg-[#13161B]" : "border-white/[0.06] bg-[#13161B]"}`}>
            <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-white/[0.03]">
              <img src={point.image} alt="" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-cyan-400/40">#{i + 1}</span>
                  <h4 className="text-sm font-medium text-white/70">{point.headline}</h4>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => openChat(`listicle point #${i + 1}`)} className="text-white/15 hover:text-white/40"><Edit3 size={12} /></button>
                  <button
                    onClick={() => setListiclePoints(prev => prev.map(p => p.id === point.id ? { ...p, approved: !p.approved } : p))}
                    className={`w-5 h-5 rounded border flex items-center justify-center ${point.approved ? "border-green-500 bg-green-500" : "border-white/15"}`}
                  >
                    {point.approved && <Check size={10} className="text-[#0D0F12]" />}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-white/40 leading-relaxed">{point.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-center text-xs text-white/20">
        {listiclePoints.filter(p => p.approved).length} / {listiclePoints.length} points approved
      </div>
    </motion.div>
  );

  const renderAnalysis = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #10B98120, #10B98105)" }}>
          <BarChart3 size={28} className="text-green-400" />
        </div>
        <h2 className="text-2xl font-semibold text-white mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          Sprint Complete
        </h2>
        <p className="text-sm text-white/40 max-w-lg mx-auto">
          The Done For You workflow has been completed. Here's a summary of what was produced and the recommended next steps.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Winning Angle", value: angles[0]?.name || "—", color: "#00D4FF" },
          { label: "Total Creatives", value: "225+", color: "#A855F7" },
          { label: "Listicle Points", value: "11", color: "#F59E0B" },
          { label: "Campaign Status", value: "Live", color: "#10B981" },
        ].map((stat, i) => (
          <div key={i} className="rounded-xl border border-white/[0.06] p-4 text-center" style={{ background: "#13161B" }}>
            <div className="text-[10px] font-mono text-white/20 uppercase tracking-wider mb-1">{stat.label}</div>
            <div className="text-lg font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Deliverables */}
      <div className="rounded-xl border border-white/[0.06] p-5 mb-6" style={{ background: "#13161B" }}>
        <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-4">Deliverables Produced</h3>
        <div className="space-y-2">
          {[
            { item: "Full Product Research Document", status: "delivered" },
            { item: "5 Angles with 10 Messages Each", status: "delivered" },
            { item: "Message Testing Ads (5 angles)", status: "delivered" },
            { item: "15 Founder Ads (3 concepts × 5 hooks)", status: "delivered" },
            { item: "15 Mini VSLs (3 concepts × 5 hooks)", status: "delivered" },
            { item: "15 Short Video Ads (3 concepts × 5 messages)", status: "delivered" },
            { item: "50 Static Ads (by awareness stage)", status: "delivered" },
            { item: "100 UGC Scripts (20 scripts × 5 hooks)", status: "delivered" },
            { item: "30 B-Roll Shots", status: "delivered" },
            { item: "11-Point Listicle Page", status: "delivered" },
          ].map((d, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center">
                <Check size={10} className="text-green-400" />
              </div>
              <span className="text-xs text-white/50 flex-1">{d.item}</span>
              <span className="text-[9px] font-mono text-green-400/60 uppercase">{d.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Next Steps */}
      <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161B" }}>
        <h3 className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-4">Recommended Next Steps</h3>
        <div className="space-y-3">
          {[
            { step: "Launch evergreen campaign with winning angle creatives", priority: "high" },
            { step: "Monitor performance for 7 days, identify top 3 performing creatives", priority: "high" },
            { step: "Produce more creatives for second-best angle as backup", priority: "medium" },
            { step: "A/B test listicle vs. original product page", priority: "medium" },
            { step: "Scale winning creatives to additional platforms (TikTok, YouTube)", priority: "low" },
          ].map((ns, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-white/15 w-5">{i + 1}.</span>
              <span className="text-xs text-white/50 flex-1">{ns.step}</span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                ns.priority === "high" ? "text-red-400/60 bg-red-500/5" :
                ns.priority === "medium" ? "text-amber-400/60 bg-amber-500/5" :
                "text-white/20 bg-white/[0.02]"
              }`}>{ns.priority}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Export */}
      <div className="mt-6 flex gap-3 justify-center">
        <button className="px-6 py-2.5 rounded-lg text-xs font-mono font-semibold flex items-center gap-2 transition-all" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)", color: "#0D0F12" }}>
          <Download size={14} /> Export Full Report
        </button>
        <button className="px-6 py-2.5 rounded-lg text-xs font-mono border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all flex items-center gap-2">
          <ArrowRight size={14} /> Start Next Sprint
        </button>
      </div>
    </motion.div>
  );

  // ============================================================
  // MAIN RENDER
  // ============================================================

  const canAdvance = () => {
    switch (currentStep) {
      case 0: return !!selectedProduct;
      case 1: return researchApproved;
      case 2: return anglesApproved;
      case 3: return messageTestingDone;
      case 4: return Object.values(creativeApprovals).filter(Boolean).length >= 3;
      case 5: return listiclePoints.filter(p => p.approved).length >= 8;
      case 6: return true;
      default: return false;
    }
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0: return renderProductSelect();
      case 1: return renderResearch();
      case 2: return renderAngles();
      case 3: return renderMessageTesting();
      case 4: return renderCreatives();
      case 5: return renderListicle();
      case 6: return renderAnalysis();
      default: return null;
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, #0D0F12 0%, #131620 100%)" }}>
      {/* Top Pipeline Bar */}
      {currentStep > 0 && (
        <div className="sticky top-0 z-30 border-b border-white/[0.06]" style={{ background: "#0A0C0Fdd", backdropFilter: "blur(12px)" }}>
          <div className="max-w-6xl mx-auto px-6 py-3">
            <div className="flex items-center gap-1">
              {DFY_STEPS.map((step, i) => {
                const Icon = step.icon;
                const isActive = i === currentStep;
                const isCompleted = i < currentStep;
                const isClickable = i <= currentStep;
                return (
                  <div key={step.id} className="flex items-center">
                    <button
                      onClick={() => isClickable && setCurrentStep(i)}
                      disabled={!isClickable}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-all ${
                        isActive ? "bg-cyan-500/10 text-cyan-400" :
                        isCompleted ? "text-green-400/60 hover:bg-white/[0.03]" :
                        "text-white/15"
                      } ${isClickable ? "cursor-pointer" : "cursor-default"}`}
                    >
                      {isCompleted ? <Check size={10} className="text-green-400" /> : <Icon size={10} />}
                      <span className="hidden lg:inline">{step.label}</span>
                    </button>
                    {i < DFY_STEPS.length - 1 && (
                      <ChevronRight size={10} className={`mx-0.5 ${i < currentStep ? "text-green-400/30" : "text-white/10"}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6">
        <AnimatePresence mode="wait">
          {renderCurrentStep()}
        </AnimatePresence>
      </div>

      {/* Bottom Navigation */}
      {currentStep > 0 && currentStep < 6 && (
        <div className="fixed bottom-10 left-0 right-0 border-t border-white/[0.06] py-3 z-30" style={{ background: "#0A0C0Fee", backdropFilter: "blur(12px)" }}>
          <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
            <button
              onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
              className="px-4 py-2 rounded-lg text-xs font-mono border border-white/[0.06] text-white/30 hover:text-white/60 hover:bg-white/[0.03] transition-all flex items-center gap-1.5"
            >
              <ChevronLeft size={12} /> Back
            </button>
            <div className="text-[10px] font-mono text-white/15">
              Step {currentStep} of {DFY_STEPS.length - 1}
            </div>
            <button
              onClick={() => setCurrentStep(prev => Math.min(DFY_STEPS.length - 1, prev + 1))}
              disabled={!canAdvance()}
              className="px-4 py-2 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: canAdvance() ? "linear-gradient(135deg, #00D4FF, #0099CC)" : undefined, color: canAdvance() ? "#0D0F12" : undefined }}
            >
              Next Step <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Chat Slide-Over */}
      <AnimatePresence>
        {showChat && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setShowChat(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-96 z-50 border-l border-white/[0.06] flex flex-col"
              style={{ background: "#0F1115" }}
            >
              <div className="h-14 border-b border-white/[0.06] flex items-center justify-between px-4 shrink-0">
                <div>
                  <div className="text-xs font-mono text-cyan-400">Feedback Chat</div>
                  <div className="text-[10px] text-white/20">{chatContext}</div>
                </div>
                <button onClick={() => setShowChat(false)} className="text-white/20 hover:text-white/50"><X size={16} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMessages.length === 0 && (
                  <div className="text-center text-xs text-white/15 mt-8">
                    Send feedback about the {chatContext}. The AI will adjust accordingly.
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                      msg.role === "user"
                        ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                        : "bg-white/[0.03] text-white/50 border border-white/[0.06]"
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-white/[0.06] p-3 flex gap-2 shrink-0">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                  placeholder="Type your feedback..."
                  className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-white/70 placeholder:text-white/15 outline-none focus:border-cyan-500/30"
                />
                <button onClick={handleSendChat} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00D4FF, #0099CC)" }}>
                  <Send size={12} className="text-[#0D0F12]" />
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
