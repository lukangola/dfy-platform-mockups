/**
 * DESIGN: Studio Control Room — Brand Info
 * Brand identity extraction from URL with editable fields
 * Color palette, fonts, description, tone
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Palette, Globe, Edit3, Save, Type, MessageCircle,
  Sparkles, CheckCircle2, RefreshCw, Quote,
} from "lucide-react";
import { MOCK_BRAND, type BrandInfo } from "@/lib/mockData";

function EditableField({ label, value, multiline = false, onSave }: {
  label: string;
  value: string;
  multiline?: boolean;
  onSave?: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">{label}</span>
        <button
          onClick={() => {
            if (editing) {
              onSave?.(editValue);
            }
            setEditing(!editing);
          }}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-all opacity-0 group-hover:opacity-100 ${
            editing
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 opacity-100"
              : "text-white/30 hover:text-white/50"
          }`}
        >
          {editing ? <><Save size={9} /> Save</> : <><Edit3 size={9} /> Edit</>}
        </button>
      </div>
      {editing ? (
        multiline ? (
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            rows={4}
            className="w-full bg-white/[0.03] border border-cyan-500/30 rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none resize-none font-mono text-xs"
          />
        ) : (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-full bg-white/[0.03] border border-cyan-500/30 rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none font-mono text-xs"
          />
        )
      ) : (
        <p className="text-sm text-white/60 leading-relaxed">{value}</p>
      )}
    </div>
  );
}

export default function BrandInfoPage() {
  const [brand] = useState<BrandInfo>(MOCK_BRAND);
  const [urlInput, setUrlInput] = useState(brand.websiteUrl);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(true);

  const handleExtract = () => {
    setExtracting(true);
    setTimeout(() => {
      setExtracting(false);
      setExtracted(true);
    }, 2000);
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-6 py-5" style={{ background: "#0D0F12" }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white/90 flex items-center gap-2">
              <Palette size={18} className="text-cyan-400" />
              Brand Identity
            </h1>
            <p className="text-xs text-white/30 mt-1 font-mono">
              Extracted from website · All fields editable
            </p>
          </div>
          {extracted && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                <CheckCircle2 size={10} />
                Synced
              </span>
            </div>
          )}
        </div>

        {/* URL Input */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5">
            <Globe size={14} className="text-white/30 shrink-0" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://your-brand-website.com"
              className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 font-mono text-xs"
            />
          </div>
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono font-semibold uppercase tracking-wider transition-all shrink-0 disabled:opacity-50"
            style={{
              background: extracting ? "rgba(0,212,255,0.1)" : "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)",
              color: extracting ? "#00D4FF" : "#0D0F12",
              border: extracting ? "1px solid rgba(0,212,255,0.3)" : "none",
            }}
          >
            {extracting ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                {extracted ? "Re-Extract" : "Extract Brand"}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Extraction Progress */}
      <AnimatePresence>
        {extracting && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-b border-cyan-500/20 px-6 py-4"
            style={{ background: "rgba(0,212,255,0.03)" }}
          >
            <div className="flex items-center gap-3">
              <RefreshCw size={14} className="text-cyan-400 animate-spin" />
              <div className="flex-1">
                <div className="text-xs text-cyan-400 font-mono mb-1">Analyzing website...</div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-cyan-400"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 2, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      {extracted && (
        <div className="p-6 space-y-5">
          {/* Brand Name & Tagline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161F" }}>
              <EditableField label="Brand Name" value={brand.name} />
            </div>
            <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161F" }}>
              <div className="flex items-center gap-2 mb-1.5">
                <Quote size={10} className="text-amber-400" />
                <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Tagline</span>
              </div>
              <p className="text-lg font-semibold text-white/80 italic" style={{ fontFamily: "'Playfair Display', serif" }}>
                "{brand.tagline}"
              </p>
            </div>
          </div>

          {/* Brand Description */}
          <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161F" }}>
            <EditableField label="Brand Description" value={brand.description} multiline />
          </div>

          {/* Color Palette */}
          <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{ background: "#13161F" }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Palette size={14} className="text-cyan-400" />
                <span className="text-xs font-mono text-white/60 uppercase tracking-wider">Color Palette</span>
              </div>
              <button className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-white/30 hover:text-white/50 transition-all">
                <Edit3 size={10} /> Edit
              </button>
            </div>
            <div className="p-5">
              {/* Color Swatches Row */}
              <div className="flex gap-3 mb-5">
                {brand.colorPalette.map((color) => (
                  <div key={color.hex} className="flex-1 group cursor-pointer">
                    <div
                      className="h-20 rounded-lg border border-white/[0.06] group-hover:scale-105 transition-transform"
                      style={{ backgroundColor: color.hex }}
                    />
                    <div className="mt-2">
                      <div className="text-xs font-semibold text-white/70">{color.name}</div>
                      <div className="text-[10px] font-mono text-white/30">{color.hex}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Color Details Table */}
              <div className="border border-white/[0.04] rounded-lg overflow-hidden">
                <div className="grid grid-cols-3 gap-px bg-white/[0.04]">
                  <div className="px-3 py-2 text-[9px] font-mono text-white/30 uppercase tracking-widest" style={{ background: "#13161F" }}>Color</div>
                  <div className="px-3 py-2 text-[9px] font-mono text-white/30 uppercase tracking-widest" style={{ background: "#13161F" }}>Hex</div>
                  <div className="px-3 py-2 text-[9px] font-mono text-white/30 uppercase tracking-widest" style={{ background: "#13161F" }}>Usage</div>
                </div>
                {brand.colorPalette.map((color) => (
                  <div key={color.hex} className="grid grid-cols-3 gap-px bg-white/[0.04]">
                    <div className="px-3 py-2.5 flex items-center gap-2" style={{ background: "#13161F" }}>
                      <div className="w-3 h-3 rounded-full border border-white/10" style={{ backgroundColor: color.hex }} />
                      <span className="text-xs text-white/60">{color.name}</span>
                    </div>
                    <div className="px-3 py-2.5" style={{ background: "#13161F" }}>
                      <span className="text-xs font-mono text-white/40">{color.hex}</span>
                    </div>
                    <div className="px-3 py-2.5" style={{ background: "#13161F" }}>
                      <span className="text-xs text-white/40">{color.usage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Typography */}
          <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{ background: "#13161F" }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Type size={14} className="text-violet-400" />
                <span className="text-xs font-mono text-white/60 uppercase tracking-wider">Typography</span>
              </div>
              <button className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-white/30 hover:text-white/50 transition-all">
                <Edit3 size={10} /> Edit
              </button>
            </div>
            <div className="p-5 space-y-4">
              {brand.fonts.map((font, i) => (
                <div key={i} className="flex items-start gap-4 py-3 border-b border-white/[0.04] last:border-0">
                  <div className="w-32 shrink-0">
                    <div className="text-lg font-semibold text-white/80" style={{ fontFamily: font.name === "Cormorant Garamond" ? "'Playfair Display', serif" : font.name === "DM Mono" ? "'JetBrains Mono', monospace" : "'Inter', sans-serif" }}>
                      Aa
                    </div>
                    <div className="text-xs font-semibold text-white/60 mt-1">{font.name}</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-white/40">{font.usage}</div>
                    <div className="text-[10px] font-mono text-white/20 mt-1">Weight: {font.weight}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Brand Tone */}
          <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161F" }}>
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle size={14} className="text-rose-400" />
              <span className="text-xs font-mono text-white/60 uppercase tracking-wider">Brand Tone & Voice</span>
            </div>
            <EditableField label="" value={brand.tone} multiline />
          </div>
        </div>
      )}
    </div>
  );
}
