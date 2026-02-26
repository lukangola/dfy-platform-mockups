/**
 * DESIGN: Clean Canvas — Editorial Whitespace
 * Warm Off-White (#FAFAF8), Indigo accent (#4338CA)
 * Fonts: Playfair Display (serif headlines), DM Sans (body), IBM Plex Mono (technical)
 * Vertical flow, magazine-grid, slide-over feedback panel
 */
import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Upload, Link2, Users, UserCircle, Sparkles,
  Check, X, RefreshCw, MessageSquare, ChevronRight, Play,
  FolderOpen, Send, ArrowRight,
} from "lucide-react";
import { MOCK_SHOTS, MOCK_CHAT_MESSAGES, SHOT_TYPE_INFO, IMAGES, type Shot, type ShotType } from "@/lib/mockData";

const STEPS = [
  { label: "Input", desc: "Produktdaten" },
  { label: "Shots", desc: "Review & Approve" },
  { label: "Videos", desc: "Generierung" },
  { label: "Export", desc: "Ordner-Ablage" },
];

function StatusPill({ status }: { status: Shot["status"] }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Approved" },
    pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pending" },
    rejected: { bg: "bg-rose-50", text: "text-rose-700", label: "Needs Rework" },
    generating: { bg: "bg-indigo-50", text: "text-indigo-700", label: "Generating..." },
  };
  const s = map[status];
  return <span className={`text-[10px] px-2.5 py-1 rounded-full ${s.bg} ${s.text} font-medium`}>{s.label}</span>;
}

export default function CleanCanvas() {
  const [currentStep, setCurrentStep] = useState(1);
  const [feedbackShot, setFeedbackShot] = useState<Shot | null>(null);
  const [chatInput, setChatInput] = useState("");

  const shotsByType = (type: ShotType) => MOCK_SHOTS.filter((s) => s.type === type);

  return (
    <div
      className="min-h-screen"
      style={{
        background: "#FAFAF8",
        fontFamily: "'DM Sans', sans-serif",
        color: "#1A1A1A",
      }}
    >
      {/* Minimal Left Nav */}
      <nav className="fixed left-0 top-0 bottom-0 w-14 border-r border-[#E5E3DF] flex flex-col items-center py-6 gap-6 z-50" style={{ background: "#FAFAF8" }}>
        <Link href="/">
          <button className="w-8 h-8 rounded-lg bg-[#4338CA] flex items-center justify-center text-white text-[10px] font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
            B
          </button>
        </Link>
        <div className="w-6 h-px bg-[#E5E3DF]" />
        {STEPS.map((step, i) => (
          <button
            key={step.label}
            onClick={() => setCurrentStep(i)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-all ${
              i === currentStep
                ? "bg-[#4338CA] text-white"
                : i < currentStep
                ? "bg-emerald-100 text-emerald-700"
                : "bg-[#F0EFEC] text-[#6B6B6B] hover:bg-[#E5E3DF]"
            }`}
          >
            {i < currentStep ? <Check size={12} /> : i + 1}
          </button>
        ))}
      </nav>

      {/* Main Content */}
      <div className="ml-14">
        {/* Top Bar */}
        <header className="sticky top-0 z-40 border-b border-[#E5E3DF] px-8 py-4 flex items-center justify-between" style={{ background: "#FAFAF8" }}>
          <div className="flex items-center gap-4">
            <Link href="/">
              <button className="flex items-center gap-1.5 text-[#6B6B6B] hover:text-[#4338CA] transition-colors text-sm">
                <ArrowLeft size={14} />
              </button>
            </Link>
            <div>
              <h1 className="text-lg font-semibold" style={{ fontFamily: "'Playfair Display', serif" }}>
                Lumina Serum — B-Roll
              </h1>
              <div className="flex items-center gap-2 text-xs text-[#6B6B6B]">
                {STEPS.map((step, i) => (
                  <span key={step.label} className="flex items-center gap-1">
                    <span className={i === currentStep ? "text-[#4338CA] font-medium" : ""}>{step.label}</span>
                    {i < STEPS.length - 1 && <ChevronRight size={10} className="text-[#D0CECC]" />}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {currentStep === 1 && (
              <button
                onClick={() => setCurrentStep(2)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
                style={{ background: "#4338CA" }}
              >
                Approve & Generate Videos
                <ArrowRight size={14} />
              </button>
            )}
            {currentStep === 2 && (
              <button
                onClick={() => setCurrentStep(3)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
                style={{ background: "#4338CA" }}
              >
                Export to Folders
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          {/* STEP 0: Input */}
          {currentStep === 0 && (
            <motion.main
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto px-8 py-16"
            >
              <h2
                className="text-3xl font-bold mb-2"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                New B-Roll Project
              </h2>
              <p className="text-[#6B6B6B] text-sm mb-10">
                Upload your product image and describe your target audience to generate cinematic B-roll shots.
              </p>

              <div className="space-y-8">
                {/* Product Image */}
                <div>
                  <label className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider block mb-3">
                    Product Image
                  </label>
                  <div className="border-2 border-dashed border-[#E5E3DF] rounded-xl p-10 flex flex-col items-center gap-4 hover:border-[#4338CA]/30 transition-colors cursor-pointer group">
                    <div className="w-24 h-32 rounded-lg overflow-hidden shadow-sm">
                      <img src={IMAGES.productSerum} alt="Product" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex items-center gap-2 text-[#6B6B6B] group-hover:text-[#4338CA] transition-colors">
                      <Upload size={16} />
                      <span className="text-sm">Upload product image</span>
                    </div>
                    <span className="text-xs text-[#B0AEA8]">White background recommended — PNG or JPG</span>
                  </div>
                </div>

                {/* Product Link */}
                <div>
                  <label className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider block mb-3">
                    Product Link
                  </label>
                  <div className="flex items-center gap-3 border border-[#E5E3DF] rounded-lg px-4 py-3 focus-within:border-[#4338CA]/40 transition-colors">
                    <Link2 size={16} className="text-[#B0AEA8]" />
                    <input
                      type="text"
                      placeholder="https://example.com/product"
                      className="bg-transparent text-sm outline-none flex-1 placeholder:text-[#D0CECC]"
                      defaultValue="https://lumina-beauty.com/serum-gold"
                    />
                  </div>
                </div>

                {/* Target Audience */}
                <div>
                  <label className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider block mb-3">
                    Target Audience
                  </label>
                  <div className="flex items-center gap-3 border border-[#E5E3DF] rounded-lg px-4 py-3 focus-within:border-[#4338CA]/40 transition-colors">
                    <Users size={16} className="text-[#B0AEA8]" />
                    <input
                      type="text"
                      placeholder="e.g. Women 25-40, skincare enthusiasts"
                      className="bg-transparent text-sm outline-none flex-1 placeholder:text-[#D0CECC]"
                      defaultValue="Women 25-40, premium skincare enthusiasts"
                    />
                  </div>
                </div>

                {/* Avatar */}
                <div>
                  <label className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider block mb-3">
                    Avatar Description
                  </label>
                  <div className="flex items-start gap-3 border border-[#E5E3DF] rounded-lg px-4 py-3 focus-within:border-[#4338CA]/40 transition-colors">
                    <UserCircle size={16} className="text-[#B0AEA8] mt-0.5" />
                    <textarea
                      rows={3}
                      placeholder="Describe your ideal customer..."
                      className="bg-transparent text-sm outline-none flex-1 resize-none placeholder:text-[#D0CECC]"
                      defaultValue="Sarah, 32, marketing manager. Values self-care rituals, follows beauty influencers, invests in premium products."
                    />
                  </div>
                </div>

                <button
                  onClick={() => setCurrentStep(1)}
                  className="w-full py-3.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: "#4338CA" }}
                >
                  Generate B-Roll Shots
                </button>
              </div>
            </motion.main>
          )}

          {/* STEP 1: Shots Review */}
          {currentStep === 1 && (
            <motion.main
              key="shots"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="px-8 py-10"
            >
              {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => {
                const shots = shotsByType(type);
                if (shots.length === 0) return null;
                return (
                  <section key={type} className="mb-16">
                    {/* Section Header — Editorial Style */}
                    <div className="mb-8 max-w-xl">
                      <h2
                        className="text-4xl font-bold mb-2"
                        style={{ fontFamily: "'Playfair Display', serif", color: "#1A1A1A" }}
                      >
                        {SHOT_TYPE_INFO[type].label}
                      </h2>
                      <p className="text-sm text-[#6B6B6B] leading-relaxed">
                        {SHOT_TYPE_INFO[type].description}
                      </p>
                      <div className="w-12 h-0.5 mt-4" style={{ background: SHOT_TYPE_INFO[type].color }} />
                    </div>

                    {/* Asymmetric Magazine Grid */}
                    <div className="grid grid-cols-12 gap-4">
                      {shots.map((shot, i) => {
                        // Asymmetric sizing: first shot large, rest smaller
                        const isLarge = i === 0;
                        const colSpan = isLarge ? "col-span-12 md:col-span-7" : "col-span-6 md:col-span-5";
                        const aspectClass = isLarge ? "aspect-[16/10]" : "aspect-[4/3]";

                        return (
                          <motion.div
                            key={shot.id}
                            className={`${colSpan} group cursor-pointer`}
                            whileHover={{ scale: 0.995 }}
                            onClick={() => setFeedbackShot(shot)}
                          >
                            <div className={`relative ${aspectClass} rounded-xl overflow-hidden`}>
                              <img src={shot.image} alt={shot.title} className="w-full h-full object-cover" />
                              {/* Overlay on hover */}
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-500">
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                  <div className="flex gap-3">
                                    <button className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-emerald-600 hover:bg-white transition-colors shadow-lg">
                                      <Check size={16} />
                                    </button>
                                    <button className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-[#4338CA] hover:bg-white transition-colors shadow-lg">
                                      <RefreshCw size={16} />
                                    </button>
                                    <button className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-[#6B6B6B] hover:bg-white transition-colors shadow-lg">
                                      <MessageSquare size={16} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                              {/* Status */}
                              <div className="absolute top-3 left-3">
                                <StatusPill status={shot.status} />
                              </div>
                            </div>
                            <div className="mt-3">
                              <div className="text-sm font-medium text-[#1A1A1A]">{shot.title}</div>
                              <div className="text-xs text-[#6B6B6B] mt-0.5">{shot.description}</div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </motion.main>
          )}

          {/* STEP 2: Videos */}
          {currentStep === 2 && (
            <motion.main
              key="videos"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="px-8 py-10"
            >
              {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => {
                const shots = shotsByType(type).filter((s) => s.status === "approved");
                if (shots.length === 0) return null;
                return (
                  <section key={type} className="mb-16">
                    <h2
                      className="text-3xl font-bold mb-6"
                      style={{ fontFamily: "'Playfair Display', serif" }}
                    >
                      {SHOT_TYPE_INFO[type].label}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {shots.map((shot) => (
                        <div key={shot.id} className="group cursor-pointer">
                          <div className="relative aspect-video rounded-xl overflow-hidden shadow-sm">
                            <img src={shot.image} alt={shot.title} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-300 flex items-center justify-center">
                              <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                                <Play size={22} className="text-[#1A1A1A] ml-0.5" />
                              </div>
                            </div>
                            <div className="absolute bottom-3 right-3 text-xs text-white/80 bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                              0:04
                            </div>
                          </div>
                          <div className="mt-3 flex items-start justify-between">
                            <div>
                              <div className="text-sm font-medium">{shot.title}</div>
                              <div className="text-xs text-[#6B6B6B]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Video • 4s • 1080p</div>
                            </div>
                            <div className="flex gap-1.5">
                              <button className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 hover:bg-emerald-100 transition-colors">
                                <Check size={14} />
                              </button>
                              <button className="w-8 h-8 rounded-lg bg-[#F0EFEC] flex items-center justify-center text-[#6B6B6B] hover:bg-[#E5E3DF] transition-colors">
                                <RefreshCw size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </motion.main>
          )}

          {/* STEP 3: Export */}
          {currentStep === 3 && (
            <motion.main
              key="export"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto px-8 py-16"
            >
              <div className="text-center mb-12">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                  <Check size={28} className="text-emerald-600" />
                </div>
                <h2 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Export Complete
                </h2>
                <p className="text-[#6B6B6B] text-sm">
                  All approved videos have been organized into their respective folders.
                </p>
              </div>

              <div className="space-y-4">
                {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => {
                  const count = shotsByType(type).filter((s) => s.status === "approved").length;
                  return (
                    <div
                      key={type}
                      className="rounded-xl border border-[#E5E3DF] p-5 flex items-center gap-4 hover:shadow-sm transition-shadow"
                    >
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${SHOT_TYPE_INFO[type].color}15` }}>
                        <FolderOpen size={18} style={{ color: SHOT_TYPE_INFO[type].color }} />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{SHOT_TYPE_INFO[type].label}</div>
                        <div className="text-xs text-[#B0AEA8]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>/exports/{type}/</div>
                      </div>
                      <span className="text-sm font-medium" style={{ color: SHOT_TYPE_INFO[type].color }}>
                        {count} videos
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.main>
          )}
        </AnimatePresence>
      </div>

      {/* Slide-Over Feedback Panel */}
      <AnimatePresence>
        {feedbackShot && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-50"
              onClick={() => setFeedbackShot(null)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-[420px] z-50 border-l border-[#E5E3DF] flex flex-col overflow-hidden"
              style={{ background: "#FAFAF8" }}
            >
              {/* Header */}
              <div className="p-5 border-b border-[#E5E3DF] flex items-center justify-between">
                <h3 className="text-lg font-semibold" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Shot Feedback
                </h3>
                <button onClick={() => setFeedbackShot(null)} className="text-[#B0AEA8] hover:text-[#6B6B6B] transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* Image */}
              <div className="p-5">
                <div className="rounded-xl overflow-hidden shadow-sm">
                  <img src={feedbackShot.image} alt={feedbackShot.title} className="w-full aspect-video object-cover" />
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-base font-semibold">{feedbackShot.title}</h4>
                    <StatusPill status={feedbackShot.status} />
                  </div>
                  <p className="text-sm text-[#6B6B6B] mt-1">{feedbackShot.description}</p>
                </div>
                <div className="flex gap-2 mt-4">
                  <button className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center justify-center gap-1.5">
                    <Check size={14} /> Approve
                  </button>
                  <button className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[#F0EFEC] text-[#6B6B6B] hover:bg-[#E5E3DF] transition-colors flex items-center justify-center gap-1.5">
                    <RefreshCw size={14} /> Regenerate
                  </button>
                </div>
              </div>

              {/* Prompt */}
              <div className="px-5 pb-4">
                <div className="text-xs font-medium text-[#B0AEA8] uppercase tracking-wider mb-2">Current Prompt</div>
                <div className="text-xs text-[#6B6B6B] leading-relaxed bg-[#F5F4F1] rounded-lg p-3 border border-[#E5E3DF]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  {feedbackShot.prompt}
                </div>
              </div>

              {/* Chat */}
              <div className="flex-1 flex flex-col overflow-hidden border-t border-[#E5E3DF]">
                <div className="px-5 py-3">
                  <span className="text-xs font-medium text-[#B0AEA8] uppercase tracking-wider">Feedback Chat</span>
                </div>
                <div className="flex-1 overflow-auto px-5 space-y-3">
                  {MOCK_CHAT_MESSAGES.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-xs leading-relaxed ${
                          msg.role === "user"
                            ? "bg-[#4338CA] text-white"
                            : "bg-[#F0EFEC] text-[#1A1A1A]"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-[#E5E3DF]">
                  <div className="flex items-center gap-2 border border-[#E5E3DF] rounded-lg px-3 py-2.5 focus-within:border-[#4338CA]/40 transition-colors">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Describe changes for this shot..."
                      className="bg-transparent text-sm outline-none flex-1 placeholder:text-[#D0CECC]"
                    />
                    <button className="text-[#4338CA] hover:text-[#3730A3] transition-colors">
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
