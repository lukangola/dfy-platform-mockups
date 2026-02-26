/**
 * DESIGN: Studio Control Room — B-Roll App Wrapper
 * Embeds the existing StudioControlRoom component within the workspace
 * Removes the standalone back button and adapts the header
 */
import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Link2, Users, UserCircle, Sparkles,
  Check, X, RefreshCw, MessageSquare, ChevronRight, Play,
  FolderOpen, Send, Image as ImageIcon, Video, Eye, ArrowLeft,
} from "lucide-react";
import { MOCK_SHOTS, MOCK_CHAT_MESSAGES, SHOT_TYPE_INFO, IMAGES, type Shot, type ShotType } from "@/lib/mockData";

const STEPS = ["Input", "Shots Review", "Video Generation", "Export"];

function StatusBadge({ status }: { status: Shot["status"] }) {
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

export default function BrollAppPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedType, setSelectedType] = useState<ShotType | "all">("all");
  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");

  const filteredShots = selectedType === "all"
    ? MOCK_SHOTS
    : MOCK_SHOTS.filter((s) => s.type === selectedType);

  const shotsByType = (type: ShotType) => MOCK_SHOTS.filter((s) => s.type === type);

  return (
    <div className="min-h-screen flex flex-col" style={{ color: "#E2E8F0" }}>
      {/* Top Bar — adapted for workspace context */}
      <header className="h-12 border-b border-white/[0.06] flex items-center px-4 gap-4 shrink-0" style={{ background: "#0D0F12" }}>
        <Link href="/workspace/apps">
          <button className="flex items-center gap-2 text-white/40 hover:text-cyan-400 transition-colors text-sm">
            <ArrowLeft size={14} />
            <span className="font-mono text-xs">APPS</span>
          </button>
        </Link>
        <div className="w-px h-5 bg-white/10" />
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-cyan-500/20 flex items-center justify-center">
            <Video size={12} className="text-cyan-400" />
          </div>
          <span className="font-mono text-xs text-white/60 tracking-wider">B-ROLL GENERATOR</span>
        </div>

        {/* Step Indicator */}
        <div className="ml-auto flex items-center gap-1">
          {STEPS.map((step, i) => (
            <button
              key={step}
              onClick={() => setCurrentStep(i)}
              className="flex items-center gap-1.5 group"
            >
              <div
                className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold transition-all ${
                  i === currentStep
                    ? "bg-cyan-500/20 text-cyan-400 shadow-[0_0_12px_rgba(0,212,255,0.3)]"
                    : i < currentStep
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-white/5 text-white/30"
                }`}
              >
                {i < currentStep ? <Check size={10} /> : i + 1}
              </div>
              <span
                className={`text-[10px] font-mono tracking-wider hidden md:block ${
                  i === currentStep ? "text-cyan-400" : "text-white/30"
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
        {/* Left Sidebar — Shot Type Filter */}
        <aside className="w-52 border-r border-white/[0.06] p-3 flex flex-col gap-1 shrink-0" style={{ background: "#0D0F12" }}>
          <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest px-2 py-2 mb-1">
            Shot Categories
          </div>
          <button
            onClick={() => setSelectedType("all")}
            className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-all ${
              selectedType === "all" ? "bg-cyan-500/10 text-cyan-400" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
            }`}
          >
            <Eye size={13} />
            <span className="font-mono">All Shots</span>
            <span className="ml-auto text-[10px] opacity-50">{MOCK_SHOTS.length}</span>
          </button>
          {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-all ${
                selectedType === type ? "bg-white/[0.06] text-white" : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
              }`}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: SHOT_TYPE_INFO[type].color,
                  boxShadow: selectedType === type ? `0 0 8px ${SHOT_TYPE_INFO[type].color}60` : "none",
                }}
              />
              <span className="font-mono truncate">{SHOT_TYPE_INFO[type].label}</span>
              <span className="ml-auto text-[10px] opacity-50">{shotsByType(type).length}</span>
            </button>
          ))}

          <div className="mt-auto border-t border-white/[0.06] pt-3">
            <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest px-2 py-1 mb-2">Stats</div>
            <div className="grid grid-cols-2 gap-2 px-2">
              {[
                { label: "Approved", value: MOCK_SHOTS.filter((s) => s.status === "approved").length, color: "#10B981" },
                { label: "Pending", value: MOCK_SHOTS.filter((s) => s.status === "pending").length, color: "#FFB020" },
                { label: "Rejected", value: MOCK_SHOTS.filter((s) => s.status === "rejected").length, color: "#F43F5E" },
                { label: "Generating", value: MOCK_SHOTS.filter((s) => s.status === "generating").length, color: "#00D4FF" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-lg font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
                  <div className="text-[9px] font-mono text-white/30 uppercase">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Center — Content Area */}
        <main className="flex-1 overflow-auto p-4">
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div key="input" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="max-w-2xl mx-auto py-8">
                <h2 className="text-xl font-bold font-mono text-cyan-400 mb-6 flex items-center gap-2">
                  <Sparkles size={18} />
                  PROJECT INPUT
                </h2>
                <div className="space-y-4">
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">Product Image</label>
                    <div className="border-2 border-dashed border-white/10 rounded-lg p-8 flex flex-col items-center gap-3 hover:border-cyan-500/30 transition-colors cursor-pointer group">
                      <div className="w-20 h-20 rounded-lg overflow-hidden border border-white/10">
                        <img src={IMAGES.productSerum} alt="Product" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex items-center gap-2 text-white/30 group-hover:text-cyan-400 transition-colors">
                        <Upload size={14} />
                        <span className="text-xs font-mono">Drop image or click to upload</span>
                      </div>
                      <span className="text-[10px] font-mono text-white/20">White background recommended</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">Product Link</label>
                    <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2.5">
                      <Link2 size={14} className="text-white/30" />
                      <input type="text" placeholder="https://example.com/product" className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 font-mono text-xs" defaultValue="https://lumina-beauty.com/serum-gold" />
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">Target Audience</label>
                    <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2.5">
                      <Users size={14} className="text-white/30" />
                      <input type="text" placeholder="e.g. Women 25-40, skincare enthusiasts" className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 text-xs" defaultValue="Women 25-40, premium skincare enthusiasts, beauty-conscious professionals" />
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3">Avatar Description</label>
                    <div className="flex items-start gap-2 bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2.5">
                      <UserCircle size={14} className="text-white/30 mt-0.5" />
                      <textarea rows={3} placeholder="Describe your ideal customer..." className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 resize-none text-xs" defaultValue="Sarah, 32, marketing manager in a metropolitan city. Values self-care rituals, follows beauty influencers, willing to invest in premium products that deliver visible results." />
                    </div>
                  </div>
                  <button onClick={() => setCurrentStep(1)} className="w-full py-3 rounded-lg font-mono text-sm font-bold tracking-wider uppercase transition-all" style={{ background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)", color: "#0D0F12", boxShadow: "0 0 20px rgba(0,212,255,0.3)" }}>
                    Generate B-Roll Shots
                  </button>
                </div>
              </motion.div>
            )}

            {currentStep === 1 && (
              <motion.div key="shots" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-mono text-white/60 uppercase tracking-widest flex items-center gap-2">
                    <ImageIcon size={14} className="text-cyan-400" />
                    Generated Shots <span className="text-cyan-400">({filteredShots.length})</span>
                  </h2>
                  <button onClick={() => setCurrentStep(2)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all">
                    <Check size={10} /> Approve All & Generate Videos
                  </button>
                </div>
                {(selectedType === "all" ? (Object.keys(SHOT_TYPE_INFO) as ShotType[]) : [selectedType]).map((type) => {
                  const shots = selectedType === "all" ? shotsByType(type) : filteredShots;
                  if (shots.length === 0) return null;
                  return (
                    <div key={type} className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: SHOT_TYPE_INFO[type].color, boxShadow: `0 0 8px ${SHOT_TYPE_INFO[type].color}60` }} />
                        <span className="text-xs font-mono text-white/50 uppercase tracking-widest">{SHOT_TYPE_INFO[type].label}</span>
                        <div className="flex-1 h-px bg-white/[0.06]" />
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                        {shots.map((shot) => (
                          <motion.div key={shot.id} whileHover={{ scale: 1.02 }} className={`shrink-0 w-56 rounded-lg border overflow-hidden cursor-pointer group transition-all ${selectedShot?.id === shot.id ? "border-cyan-500/50 shadow-[0_0_15px_rgba(0,212,255,0.15)]" : "border-white/[0.06] hover:border-white/[0.12]"}`} style={{ background: "#13161F" }} onClick={() => { setSelectedShot(shot); setChatOpen(false); }}>
                            <div className="relative aspect-video overflow-hidden">
                              <img src={shot.image} alt={shot.title} className="w-full h-full object-cover" />
                              {shot.status === "generating" && (
                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                  <RefreshCw size={20} className="text-cyan-400 animate-spin" />
                                </div>
                              )}
                              <div className="absolute top-2 right-2"><StatusBadge status={shot.status} /></div>
                              <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                <button className="w-8 h-8 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-colors"><Check size={14} /></button>
                                <button className="w-8 h-8 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/30 transition-colors"><RefreshCw size={14} /></button>
                                <button onClick={(e) => { e.stopPropagation(); setSelectedShot(shot); setChatOpen(true); }} className="w-8 h-8 rounded bg-white/10 border border-white/20 flex items-center justify-center text-white/60 hover:bg-white/20 transition-colors"><MessageSquare size={14} /></button>
                                <button className="w-8 h-8 rounded bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 hover:bg-rose-500/30 transition-colors"><X size={14} /></button>
                              </div>
                            </div>
                            <div className="p-3">
                              <div className="text-xs font-medium text-white/80 truncate">{shot.title}</div>
                              <div className="text-[10px] text-white/30 mt-1 truncate font-mono">{shot.description}</div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div key="videos" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-mono text-white/60 uppercase tracking-widest flex items-center gap-2">
                    <Video size={14} className="text-cyan-400" /> Generated Videos
                  </h2>
                  <button onClick={() => setCurrentStep(3)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all">
                    <Check size={10} /> Approve & Export All
                  </button>
                </div>
                {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => {
                  const shots = shotsByType(type).filter((s) => s.status === "approved");
                  if (shots.length === 0) return null;
                  return (
                    <div key={type} className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: SHOT_TYPE_INFO[type].color, boxShadow: `0 0 8px ${SHOT_TYPE_INFO[type].color}60` }} />
                        <span className="text-xs font-mono text-white/50 uppercase tracking-widest">{SHOT_TYPE_INFO[type].label}</span>
                        <div className="flex-1 h-px bg-white/[0.06]" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {shots.map((shot) => (
                          <div key={shot.id} className="rounded-lg border border-white/[0.06] overflow-hidden group cursor-pointer hover:border-white/[0.12] transition-all" style={{ background: "#13161F" }}>
                            <div className="relative aspect-video overflow-hidden">
                              <img src={shot.image} alt={shot.title} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                                  <Play size={20} className="text-white ml-0.5" />
                                </div>
                              </div>
                              <div className="absolute bottom-2 right-2 text-[10px] font-mono text-white/60 bg-black/60 px-1.5 py-0.5 rounded">0:04</div>
                            </div>
                            <div className="p-3 flex items-center justify-between">
                              <div>
                                <div className="text-xs font-medium text-white/80">{shot.title}</div>
                                <div className="text-[10px] text-white/30 font-mono">Video • 4s • 1080p</div>
                              </div>
                              <div className="flex gap-1">
                                <button className="w-7 h-7 rounded bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/25 transition-colors"><Check size={12} /></button>
                                <button className="w-7 h-7 rounded bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/25 transition-colors"><RefreshCw size={12} /></button>
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

            {currentStep === 3 && (
              <motion.div key="export" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="max-w-3xl mx-auto py-8">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                    <Check size={28} className="text-emerald-400" />
                  </div>
                  <h2 className="text-xl font-bold font-mono text-emerald-400 mb-2">EXPORT COMPLETE</h2>
                  <p className="text-sm text-white/40">All approved videos have been saved to their respective folders.</p>
                </div>
                <div className="space-y-3">
                  {(Object.keys(SHOT_TYPE_INFO) as ShotType[]).map((type) => {
                    const count = shotsByType(type).filter((s) => s.status === "approved").length;
                    return (
                      <div key={type} className="rounded-lg border border-white/[0.06] p-4 flex items-center gap-4" style={{ background: "#13161F" }}>
                        <FolderOpen size={20} style={{ color: SHOT_TYPE_INFO[type].color }} />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white/80 font-mono">{SHOT_TYPE_INFO[type].label}</div>
                          <div className="text-[10px] text-white/30 font-mono">/exports/{type}/</div>
                        </div>
                        <span className="text-xs font-mono" style={{ color: SHOT_TYPE_INFO[type].color }}>{count} videos</span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Right Panel — Chat / Details */}
        <AnimatePresence>
          {(selectedShot || chatOpen) && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="border-l border-white/[0.06] flex flex-col overflow-hidden shrink-0"
              style={{ background: "#0D0F12" }}
            >
              {selectedShot && (
                <>
                  <div className="p-3 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Shot Details</span>
                      <button onClick={() => { setSelectedShot(null); setChatOpen(false); }} className="text-white/30 hover:text-white/60"><X size={14} /></button>
                    </div>
                    <div className="rounded-lg overflow-hidden border border-white/[0.06]">
                      <img src={selectedShot.image} alt={selectedShot.title} className="w-full aspect-video object-cover" />
                    </div>
                    <div className="mt-3">
                      <div className="text-sm font-medium text-white/80">{selectedShot.title}</div>
                      <div className="text-[10px] text-white/40 mt-1">{selectedShot.description}</div>
                      <div className="flex items-center gap-2 mt-2">
                        <StatusBadge status={selectedShot.status} />
                        <span className="text-[10px] font-mono text-white/20 uppercase">{SHOT_TYPE_INFO[selectedShot.type].label}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button className="flex-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all flex items-center justify-center gap-1"><Check size={10} /> Approve</button>
                      <button className="flex-1 py-2 rounded text-[10px] font-mono uppercase tracking-wider bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25 transition-all flex items-center justify-center gap-1"><RefreshCw size={10} /> Regenerate</button>
                    </div>
                  </div>
                  <div className="p-3 border-b border-white/[0.06]">
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-2">Prompt</div>
                    <div className="text-[11px] text-white/50 font-mono leading-relaxed bg-white/[0.02] rounded p-2 border border-white/[0.04]">{selectedShot.prompt}</div>
                  </div>
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-white/[0.06] flex items-center gap-2">
                      <MessageSquare size={12} className="text-cyan-400" />
                      <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Feedback Chat</span>
                    </div>
                    <div className="flex-1 overflow-auto p-3 space-y-3">
                      {MOCK_CHAT_MESSAGES.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-relaxed ${msg.role === "user" ? "bg-cyan-500/15 text-cyan-100 border border-cyan-500/20" : "bg-white/[0.04] text-white/60 border border-white/[0.06]"}`} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="p-3 border-t border-white/[0.06]">
                      <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded px-3 py-2">
                        <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Give feedback on this shot..." className="bg-transparent text-[11px] text-white/80 placeholder:text-white/20 outline-none flex-1 font-mono" />
                        <button className="text-cyan-400 hover:text-cyan-300 transition-colors"><Send size={14} /></button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
