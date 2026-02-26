/**
 * DESIGN: Neon Forge — Cyberpunk Production Lab
 * Pure Black (#000) to Deep Navy (#0A0E1A), Neon accents per shot type
 * Fonts: Space Grotesk (display/body), Fira Code (mono/prompts)
 * Tab-based with central viewport, pipeline visualizer, glassmorphism
 */
import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Upload, Link2, Users, UserCircle, Sparkles,
  Check, X, RefreshCw, MessageSquare, Play,
  FolderOpen, Send, Zap, ChevronRight,
} from "lucide-react";
import { MOCK_SHOTS, MOCK_CHAT_MESSAGES, SHOT_TYPE_INFO, IMAGES, type Shot, type ShotType } from "@/lib/mockData";

const PIPELINE_STEPS = [
  { id: 0, label: "INPUT", icon: Upload },
  { id: 1, label: "SHOTS", icon: Sparkles },
  { id: 2, label: "VIDEOS", icon: Play },
  { id: 3, label: "EXPORT", icon: FolderOpen },
];

function NeonBadge({ status }: { status: Shot["status"] }) {
  const map: Record<string, { glow: string; text: string; label: string }> = {
    approved: { glow: "shadow-[0_0_10px_rgba(57,255,20,0.4)]", text: "text-[#39FF14]", label: "APPROVED" },
    pending: { glow: "shadow-[0_0_10px_rgba(255,208,0,0.4)]", text: "text-[#FFD000]", label: "PENDING" },
    rejected: { glow: "shadow-[0_0_10px_rgba(255,45,138,0.4)]", text: "text-[#FF2D8A]", label: "REWORK" },
    generating: { glow: "shadow-[0_0_10px_rgba(0,180,255,0.4)]", text: "text-[#00B4FF]", label: "FORGING..." },
  };
  const s = map[status];
  return (
    <span className={`text-[9px] px-2 py-0.5 rounded border border-current/30 font-mono uppercase tracking-widest ${s.text} ${s.glow}`}>
      {s.label}
    </span>
  );
}

export default function NeonForge() {
  const [currentStep, setCurrentStep] = useState(1);
  const [activeType, setActiveType] = useState<ShotType>("unboxing");
  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);
  const [chatInput, setChatInput] = useState("");

  const shotsByType = (type: ShotType) => MOCK_SHOTS.filter((s) => s.type === type);
  const currentShots = shotsByType(activeType);
  const neonColor = SHOT_TYPE_INFO[activeType].neonColor || "#FF2D8A";

  return (
    <div
      className="min-h-screen flex flex-col overflow-hidden"
      style={{
        background: "radial-gradient(ellipse at 50% 0%, #0A0E1A 0%, #000000 70%)",
        fontFamily: "'Space Grotesk', sans-serif",
        color: "#E0E0E0",
      }}
    >
      {/* Noise Texture Overlay */}
      <div className="fixed inset-0 opacity-[0.015] pointer-events-none z-0" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
      }} />

      {/* Pipeline Header */}
      <header className="relative z-10 border-b border-white/[0.04] px-6 py-3 flex items-center gap-6" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(20px)" }}>
        <Link href="/">
          <button className="flex items-center gap-2 text-white/30 hover:text-[#FF2D8A] transition-colors">
            <ArrowLeft size={14} />
          </button>
        </Link>
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-[#FF2D8A]" />
          <span className="font-bold text-sm tracking-wider" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            NEON FORGE
          </span>
        </div>

        {/* Pipeline Visualizer */}
        <div className="flex-1 flex items-center justify-center gap-0">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.id} className="flex items-center">
              <button
                onClick={() => setCurrentStep(step.id)}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full transition-all relative group"
                style={{
                  background: i === currentStep ? `${neonColor}15` : "transparent",
                  border: i === currentStep ? `1px solid ${neonColor}40` : "1px solid transparent",
                  boxShadow: i === currentStep ? `0 0 15px ${neonColor}20` : "none",
                }}
              >
                <step.icon
                  size={12}
                  style={{ color: i === currentStep ? neonColor : i < currentStep ? "#39FF14" : "rgba(255,255,255,0.2)" }}
                />
                <span
                  className="text-[10px] font-bold tracking-widest"
                  style={{
                    fontFamily: "'Fira Code', monospace",
                    color: i === currentStep ? neonColor : i < currentStep ? "#39FF14" : "rgba(255,255,255,0.2)",
                  }}
                >
                  {step.label}
                </span>
                {i === currentStep && (
                  <motion.div
                    layoutId="pipeline-glow"
                    className="absolute inset-0 rounded-full"
                    style={{ boxShadow: `0 0 20px ${neonColor}30`, border: `1px solid ${neonColor}30` }}
                  />
                )}
              </button>
              {i < PIPELINE_STEPS.length - 1 && (
                <div className="w-8 h-px mx-1" style={{ background: i < currentStep ? "#39FF1440" : "rgba(255,255,255,0.06)" }} />
              )}
            </div>
          ))}
        </div>

        <div className="text-[10px] font-mono text-white/20">v0.1.0</div>
      </header>

      <div className="flex-1 flex relative z-10 overflow-hidden">
        {/* Left — Shot Type Tabs (Vertical, Color-Coded) */}
        <aside className="w-14 border-r border-white/[0.04] flex flex-col items-center py-4 gap-2" style={{ background: "rgba(0,0,0,0.4)" }}>
          {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => {
            const info = SHOT_TYPE_INFO[type];
            const isActive = activeType === type;
            return (
              <button
                key={type}
                onClick={() => setActiveType(type)}
                className="w-10 h-10 rounded-lg flex items-center justify-center transition-all relative group"
                style={{
                  background: isActive ? `${info.neonColor}15` : "transparent",
                  border: isActive ? `1px solid ${info.neonColor}40` : "1px solid transparent",
                  boxShadow: isActive ? `0 0 12px ${info.neonColor}25` : "none",
                }}
                title={info.label}
              >
                <div
                  className="w-3 h-3 rounded-full transition-all"
                  style={{
                    background: info.neonColor,
                    boxShadow: isActive ? `0 0 8px ${info.neonColor}` : "none",
                    opacity: isActive ? 1 : 0.4,
                  }}
                />
                {/* Tooltip */}
                <div className="absolute left-full ml-2 px-2 py-1 rounded bg-black/90 border border-white/10 text-[9px] font-mono text-white/60 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                  {info.label}
                  <span className="ml-1 text-white/30">({shotsByType(type).length})</span>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Center — Main Viewport */}
        <main className="flex-1 overflow-auto p-5">
          <AnimatePresence mode="wait">
            {/* INPUT STEP */}
            {currentStep === 0 && (
              <motion.div
                key="input"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="max-w-2xl mx-auto py-8"
              >
                <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
                  <Sparkles size={20} style={{ color: neonColor }} />
                  Initialize Forge
                </h2>
                <p className="text-sm text-white/30 mb-8">Feed the forge with your product data to begin generation.</p>

                <div className="space-y-4">
                  {/* Product Image */}
                  <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(10px)" }}>
                    <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest block mb-3" style={{ fontFamily: "'Fira Code', monospace" }}>
                      // product_image
                    </label>
                    <div className="border border-dashed border-white/10 rounded-lg p-8 flex flex-col items-center gap-3 hover:border-[#FF2D8A]/40 transition-colors cursor-pointer group">
                      <div className="w-20 h-28 rounded-lg overflow-hidden border border-white/10" style={{ boxShadow: `0 0 20px ${neonColor}15` }}>
                        <img src={IMAGES.productSerum} alt="Product" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex items-center gap-2 text-white/30 group-hover:text-[#FF2D8A] transition-colors">
                        <Upload size={14} />
                        <span className="text-xs font-mono" style={{ fontFamily: "'Fira Code', monospace" }}>upload_image()</span>
                      </div>
                    </div>
                  </div>

                  {/* Product Link */}
                  <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest block mb-3" style={{ fontFamily: "'Fira Code', monospace" }}>
                      // product_url
                    </label>
                    <div className="flex items-center gap-2 bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2.5">
                      <Link2 size={14} className="text-white/20" />
                      <input
                        type="text"
                        placeholder="https://..."
                        className="bg-transparent text-sm text-white/80 placeholder:text-white/15 outline-none flex-1"
                        style={{ fontFamily: "'Fira Code', monospace", fontSize: "12px" }}
                        defaultValue="https://lumina-beauty.com/serum-gold"
                      />
                    </div>
                  </div>

                  {/* Target Audience */}
                  <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest block mb-3" style={{ fontFamily: "'Fira Code', monospace" }}>
                      // target_audience
                    </label>
                    <div className="flex items-center gap-2 bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2.5">
                      <Users size={14} className="text-white/20" />
                      <input
                        type="text"
                        className="bg-transparent text-sm text-white/80 placeholder:text-white/15 outline-none flex-1"
                        defaultValue="Women 25-40, premium skincare enthusiasts"
                      />
                    </div>
                  </div>

                  {/* Avatar */}
                  <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest block mb-3" style={{ fontFamily: "'Fira Code', monospace" }}>
                      // avatar_description
                    </label>
                    <div className="flex items-start gap-2 bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2.5">
                      <UserCircle size={14} className="text-white/20 mt-0.5" />
                      <textarea
                        rows={3}
                        className="bg-transparent text-sm text-white/80 placeholder:text-white/15 outline-none flex-1 resize-none"
                        defaultValue="Sarah, 32, marketing manager. Values self-care, follows beauty influencers."
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => setCurrentStep(1)}
                    className="w-full py-3.5 rounded-xl font-bold text-sm tracking-wider uppercase transition-all"
                    style={{
                      background: `linear-gradient(135deg, ${neonColor}, ${neonColor}CC)`,
                      color: "#000",
                      boxShadow: `0 0 30px ${neonColor}40`,
                    }}
                  >
                    Ignite the Forge
                  </button>
                </div>
              </motion.div>
            )}

            {/* SHOTS STEP */}
            {currentStep === 1 && (
              <motion.div
                key="shots"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                {/* Category Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ background: neonColor, boxShadow: `0 0 12px ${neonColor}` }} />
                    <h2 className="text-lg font-bold tracking-wide">{SHOT_TYPE_INFO[activeType].label}</h2>
                    <span className="text-xs text-white/20 font-mono" style={{ fontFamily: "'Fira Code', monospace" }}>
                      {currentShots.length} shots
                    </span>
                  </div>
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition-all"
                    style={{
                      background: "#39FF1415",
                      color: "#39FF14",
                      border: "1px solid #39FF1430",
                      boxShadow: "0 0 15px rgba(57,255,20,0.15)",
                    }}
                  >
                    <Check size={12} />
                    Approve & Forge Videos
                  </button>
                </div>

                {/* Masonry Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {currentShots.map((shot) => (
                    <motion.div
                      key={shot.id}
                      whileHover={{ scale: 1.01 }}
                      className="rounded-xl overflow-hidden cursor-pointer group relative"
                      style={{
                        background: "rgba(255,255,255,0.02)",
                        border: `1px solid ${selectedShot?.id === shot.id ? neonColor + "60" : "rgba(255,255,255,0.04)"}`,
                        boxShadow: selectedShot?.id === shot.id ? `0 0 20px ${neonColor}20` : "none",
                      }}
                      onClick={() => setSelectedShot(shot)}
                    >
                      <div className="relative aspect-video overflow-hidden">
                        <img src={shot.image} alt={shot.title} className="w-full h-full object-cover" />
                        {shot.status === "generating" && (
                          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                            <RefreshCw size={24} className="animate-spin" style={{ color: neonColor }} />
                          </div>
                        )}
                        <div className="absolute top-2 right-2">
                          <NeonBadge status={shot.status} />
                        </div>
                        {/* Neon border glow on hover */}
                        <div
                          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                          style={{ boxShadow: `inset 0 0 30px ${neonColor}15` }}
                        />
                        {/* Hover Actions */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <button
                            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                            style={{ background: "#39FF1420", border: "1px solid #39FF1440", color: "#39FF14" }}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                            style={{ background: `${neonColor}20`, border: `1px solid ${neonColor}40`, color: neonColor }}
                          >
                            <RefreshCw size={14} />
                          </button>
                          <button
                            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}
                            onClick={(e) => { e.stopPropagation(); setSelectedShot(shot); }}
                          >
                            <MessageSquare size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="text-xs font-medium text-white/80">{shot.title}</div>
                        <div className="text-[10px] text-white/25 mt-1 font-mono" style={{ fontFamily: "'Fira Code', monospace" }}>{shot.description}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* VIDEOS STEP */}
            {currentStep === 2 && (
              <motion.div
                key="videos"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold tracking-wide flex items-center gap-2">
                    <Play size={16} style={{ color: neonColor }} />
                    Forged Videos
                  </h2>
                  <button
                    onClick={() => setCurrentStep(3)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition-all"
                    style={{ background: "#39FF1415", color: "#39FF14", border: "1px solid #39FF1430" }}
                  >
                    <FolderOpen size={12} />
                    Export All
                  </button>
                </div>

                {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => {
                  const shots = shotsByType(type).filter((s) => s.status === "approved");
                  if (shots.length === 0) return null;
                  const typeNeon = SHOT_TYPE_INFO[type].neonColor || "#FF2D8A";
                  return (
                    <div key={type} className="mb-8">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full" style={{ background: typeNeon, boxShadow: `0 0 8px ${typeNeon}` }} />
                        <span className="text-xs font-mono text-white/40 uppercase tracking-widest" style={{ fontFamily: "'Fira Code', monospace" }}>
                          {SHOT_TYPE_INFO[type].label}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        {shots.map((shot) => (
                          <div
                            key={shot.id}
                            className="rounded-xl overflow-hidden group cursor-pointer"
                            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                          >
                            <div className="relative aspect-video overflow-hidden">
                              <img src={shot.image} alt={shot.title} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <div
                                  className="w-14 h-14 rounded-full flex items-center justify-center"
                                  style={{ background: `${typeNeon}20`, border: `2px solid ${typeNeon}60`, boxShadow: `0 0 20px ${typeNeon}30` }}
                                >
                                  <Play size={22} className="ml-0.5" style={{ color: typeNeon }} />
                                </div>
                              </div>
                              <div className="absolute bottom-2 right-2 text-[10px] font-mono text-white/50 bg-black/60 px-1.5 py-0.5 rounded" style={{ fontFamily: "'Fira Code', monospace" }}>
                                0:04
                              </div>
                            </div>
                            <div className="p-3 flex items-center justify-between">
                              <div>
                                <div className="text-xs font-medium text-white/80">{shot.title}</div>
                                <div className="text-[10px] text-white/25 font-mono" style={{ fontFamily: "'Fira Code', monospace" }}>1080p • 4s</div>
                              </div>
                              <div className="flex gap-1.5">
                                <button className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#39FF1415", border: "1px solid #39FF1430", color: "#39FF14" }}>
                                  <Check size={12} />
                                </button>
                                <button className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${typeNeon}15`, border: `1px solid ${typeNeon}30`, color: typeNeon }}>
                                  <RefreshCw size={12} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}

            {/* EXPORT STEP */}
            {currentStep === 3 && (
              <motion.div
                key="export"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="max-w-2xl mx-auto py-12"
              >
                <div className="text-center mb-10">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 15 }}
                    className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"
                    style={{ background: "#39FF1415", border: "2px solid #39FF1440", boxShadow: "0 0 40px rgba(57,255,20,0.2)" }}
                  >
                    <Check size={32} className="text-[#39FF14]" />
                  </motion.div>
                  <h2 className="text-2xl font-bold mb-2" style={{ color: "#39FF14" }}>FORGE COMPLETE</h2>
                  <p className="text-sm text-white/30">All approved videos have been exported to their designated folders.</p>
                </div>

                <div className="space-y-3">
                  {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => {
                    const count = shotsByType(type).filter((s) => s.status === "approved").length;
                    const typeNeon = SHOT_TYPE_INFO[type].neonColor || "#FF2D8A";
                    return (
                      <div
                        key={type}
                        className="rounded-xl p-4 flex items-center gap-4"
                        style={{
                          background: "rgba(255,255,255,0.02)",
                          border: `1px solid ${typeNeon}20`,
                          boxShadow: `0 0 15px ${typeNeon}08`,
                        }}
                      >
                        <FolderOpen size={20} style={{ color: typeNeon }} />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white/80">{SHOT_TYPE_INFO[type].label}</div>
                          <div className="text-[10px] text-white/25 font-mono" style={{ fontFamily: "'Fira Code', monospace" }}>/forge/exports/{type}/</div>
                        </div>
                        <span className="text-sm font-bold font-mono" style={{ color: typeNeon, fontFamily: "'Fira Code', monospace" }}>
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Right — Command Center (Chat/Details) */}
        <AnimatePresence>
          {selectedShot && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="border-l border-white/[0.04] flex flex-col overflow-hidden shrink-0"
              style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(20px)" }}
            >
              {/* Shot Preview */}
              <div className="p-3 border-b border-white/[0.04]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest" style={{ fontFamily: "'Fira Code', monospace" }}>
                    // shot_details
                  </span>
                  <button onClick={() => setSelectedShot(null)} className="text-white/20 hover:text-white/50 transition-colors">
                    <X size={14} />
                  </button>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${neonColor}20`, boxShadow: `0 0 15px ${neonColor}10` }}>
                  <img src={selectedShot.image} alt={selectedShot.title} className="w-full aspect-video object-cover" />
                </div>
                <div className="mt-3">
                  <div className="text-sm font-medium text-white/80">{selectedShot.title}</div>
                  <div className="text-[10px] text-white/30 mt-1">{selectedShot.description}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <NeonBadge status={selectedShot.status} />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    className="flex-1 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1 transition-all"
                    style={{ background: "#39FF1415", color: "#39FF14", border: "1px solid #39FF1430" }}
                  >
                    <Check size={10} /> Approve
                  </button>
                  <button
                    className="flex-1 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1 transition-all"
                    style={{ background: `${neonColor}15`, color: neonColor, border: `1px solid ${neonColor}30` }}
                  >
                    <RefreshCw size={10} /> Re-Forge
                  </button>
                </div>
              </div>

              {/* Prompt */}
              <div className="p-3 border-b border-white/[0.04]">
                <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2" style={{ fontFamily: "'Fira Code', monospace" }}>
                  // prompt
                </div>
                <div
                  className="text-[10px] text-white/40 leading-relaxed rounded-lg p-2.5"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontFamily: "'Fira Code', monospace" }}
                >
                  {selectedShot.prompt}
                </div>
              </div>

              {/* Chat */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-white/[0.04] flex items-center gap-2">
                  <MessageSquare size={12} style={{ color: neonColor }} />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest" style={{ fontFamily: "'Fira Code', monospace" }}>
                    // command_center
                  </span>
                </div>
                <div className="flex-1 overflow-auto p-3 space-y-3">
                  {MOCK_CHAT_MESSAGES.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[85%] rounded-lg px-3 py-2 text-[10px] leading-relaxed"
                        style={{
                          fontFamily: "'Fira Code', monospace",
                          background: msg.role === "user" ? `${neonColor}15` : "rgba(255,255,255,0.03)",
                          border: msg.role === "user" ? `1px solid ${neonColor}25` : "1px solid rgba(255,255,255,0.04)",
                          color: msg.role === "user" ? `${neonColor}CC` : "rgba(255,255,255,0.5)",
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-white/[0.04]">
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <span className="text-white/15 text-xs" style={{ fontFamily: "'Fira Code', monospace" }}>&gt;</span>
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Enter command..."
                      className="bg-transparent text-[11px] text-white/80 placeholder:text-white/15 outline-none flex-1"
                      style={{ fontFamily: "'Fira Code', monospace" }}
                    />
                    <button style={{ color: neonColor }} className="hover:opacity-80 transition-opacity">
                      <Send size={14} />
                    </button>
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
