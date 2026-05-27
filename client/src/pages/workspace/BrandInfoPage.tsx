/**
 * DESIGN: Studio Control Room — Brand Info
 * Displays the active brand's research (extracted when the brand was created).
 * All fields editable. Edits patch the brand row on the server.
 * Re-run research button retriggers brand_extract against the brand URL.
 */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Palette, Globe, Edit3, Save, Type, MessageCircle,
  Sparkles, CheckCircle2, RefreshCw, AlertTriangle,
  Plus, Trash2, ImageOff, Loader2, Upload,
} from "lucide-react";
import { patchBrand, retriggerBrandResearch, uploadBrandLogoRaw, type BrandResearch } from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";

type BrandColor = NonNullable<BrandResearch["colorPalette"]>[number];
type BrandFont = NonNullable<BrandResearch["fonts"]>[number];

function EditableField({
  label,
  value,
  placeholder,
  multiline = false,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onSave: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  useEffect(() => {
    if (!editing) setEditValue(value);
  }, [value, editing]);

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1.5">
        {label ? (
          <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">{label}</span>
        ) : (
          <span />
        )}
        <button
          onClick={() => {
            if (editing) onSave(editValue);
            setEditing(!editing);
          }}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
            editing
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 opacity-100"
              : "text-white/30 hover:text-white/50 opacity-0 group-hover:opacity-100"
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
            placeholder={placeholder}
            className="w-full bg-white/[0.03] border border-cyan-500/30 rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none resize-none font-mono text-xs"
          />
        ) : (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-white/[0.03] border border-cyan-500/30 rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none font-mono text-xs"
          />
        )
      ) : (
        <p className="text-sm text-white/60 leading-relaxed whitespace-pre-wrap">
          {value || <span className="text-white/20 italic">{placeholder ?? "—"}</span>}
        </p>
      )}
    </div>
  );
}

function fontFamilyFor(name: string): string {
  const lower = name.toLowerCase();
  if (/(serif|garamond|playfair|cormorant|lora|merriweather)/.test(lower)) return "'Playfair Display', serif";
  if (/(mono|code|jetbrains|menlo|consolas)/.test(lower)) return "'JetBrains Mono', monospace";
  return "'Inter', sans-serif";
}

function LogoBox({
  logoUrl,
  onSave,
}: {
  logoUrl: string | null;
  onSave: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(logoUrl ?? "");
  const [errored, setErrored] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  // Hidden file input — we drive the open via a styled button so the UI
  // stays consistent with the rest of the editor (the native button is
  // browser-styled and looks out of place).
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(logoUrl ?? "");
    setErrored(false);
  }, [logoUrl, editing]);

  // File-picker handler. Reads the picked file as a base64 dataUrl, POSTs
  // to /api/uploads/brand-logo (which converts SVG → PNG server-side),
  // then saves the returned URL on the brand. The server can take a beat
  // for SVG conversion + the fal.storage upload, so we show a spinner.
  const handleFile = async (file: File) => {
    setUploadError(null);
    setUploadNote(null);
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      if (!dataUrl) throw new Error("Could not read file");
      const { url, converted } = await uploadBrandLogoRaw(dataUrl, file.name);
      onSave(url);
      setDraft(url);
      setEditing(false);
      if (converted) setUploadNote("Converted SVG → PNG");
      // Clear the input so picking the same file again re-fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="shrink-0 flex flex-col items-center gap-2">
      <div className="w-20 h-20 rounded-xl border border-white/[0.08] bg-white/[0.02] flex items-center justify-center overflow-hidden relative group">
        {logoUrl && !errored ? (
          <img
            src={logoUrl}
            alt="Brand logo"
            className="max-w-[80%] max-h-[80%] object-contain"
            onError={() => setErrored(true)}
          />
        ) : (
          <ImageOff size={20} className="text-white/20" />
        )}
        {/* Primary action on the hover overlay is now Upload, not URL-paste.
            Clicking opens the OS file picker directly — no intermediate
            "type the URL" step the user has to dismiss first. The URL paste
            option lives below as a secondary fallback for power users with a
            specific CDN URL in hand. */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="absolute inset-x-0 bottom-0 bg-black/70 text-[9px] font-mono text-white/70 py-1 opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-wider flex items-center justify-center gap-1 disabled:opacity-100"
        >
          {uploading ? (
            <><Loader2 size={9} className="animate-spin" /> Uploading…</>
          ) : (
            <><Upload size={9} /> {logoUrl ? "Change" : "Upload"}</>
          )}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      {/* Secondary fallback: a small "paste URL instead" link that toggles
          the URL input. Most users won't need it — pick from disk and we
          take care of conversion + upload. */}
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          className="text-[9px] font-mono text-white/30 hover:text-white/60 underline underline-offset-2 transition-colors"
        >
          or paste URL
        </button>
      )}
      {editing && (
        <div className="w-full min-w-[260px] flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://…/logo.png"
              className="flex-1 bg-white/[0.03] border border-cyan-500/30 rounded px-2 py-1 text-[11px] text-white/80 outline-none font-mono"
            />
            <button
              onClick={() => {
                onSave(draft.trim());
                setEditing(false);
              }}
              className="px-2 py-1 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-2 py-1 rounded text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {uploadNote && (
        <span className="text-[9px] font-mono text-emerald-400/80">{uploadNote}</span>
      )}
      {uploadError && (
        <span className="text-[9px] font-mono text-rose-400/80 text-center max-w-[200px]">{uploadError}</span>
      )}
      {errored && !editing && !uploading && (
        <span className="text-[9px] font-mono text-rose-400/70">Couldn't load logo</span>
      )}
    </div>
  );
}

function defaultResearch(name: string, websiteUrl: string, logoUrl: string | null): BrandResearch {
  return {
    name,
    websiteUrl,
    logoUrl,
    description: "",
    tone: "",
    colorPalette: [],
    fonts: [],
  };
}

export default function BrandInfoPage() {
  const { activeBrand, activeBrandId, refreshBrand } = useBrand();

  // Local copy of the active brand's research. We edit this optimistically,
  // then patch the server. When the active brand changes, we re-seed.
  const [research, setResearch] = useState<BrandResearch | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [colorsEditing, setColorsEditing] = useState(false);
  const [fontsEditing, setFontsEditing] = useState(false);
  const [reExtracting, setReExtracting] = useState(false);

  const lastSeededKey = useRef<string | null>(null);

  // Re-seed local research when we switch brands, or when the server's research
  // object transitions from absent → present (extraction just completed).
  // Does NOT depend on local `research` so user edits are never wiped.
  useEffect(() => {
    if (!activeBrand) {
      setResearch(null);
      lastSeededKey.current = null;
      return;
    }
    const hasServerResearch = !!activeBrand.research;
    const key = `${activeBrand.id}:${hasServerResearch ? "y" : "n"}`;
    if (lastSeededKey.current === key) return;
    const seed =
      activeBrand.research ??
      defaultResearch(activeBrand.name, activeBrand.brandUrl ?? "", activeBrand.logoUrl);
    setResearch(seed);
    lastSeededKey.current = key;
  }, [activeBrand]);

  // Poll while research is running so the page fills in as soon as it lands.
  useEffect(() => {
    if (!activeBrandId) return;
    if (activeBrand?.researchStatus !== "pending" && activeBrand?.researchStatus !== "researching") return;
    const t = setInterval(() => { void refreshBrand(activeBrandId); }, 3000);
    return () => clearInterval(t);
  }, [activeBrandId, activeBrand?.researchStatus, refreshBrand]);

  const persistPatch = async (patch: { research?: BrandResearch; name?: string; logoUrl?: string | null }) => {
    if (!activeBrandId) return;
    setSaveError(null);
    try {
      await patchBrand(activeBrandId, patch);
      await refreshBrand(activeBrandId);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateResearch = (patch: Partial<BrandResearch>) => {
    setResearch((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void persistPatch({ research: next });
      return next;
    });
  };

  const updateBrandName = (name: string) => {
    setResearch((prev) => (prev ? { ...prev, name } : prev));
    void persistPatch({ name });
  };

  const updateLogo = (logoUrl: string | null) => {
    setResearch((prev) => (prev ? { ...prev, logoUrl } : prev));
    void persistPatch({ logoUrl });
  };

  const updateColor = (idx: number, patch: Partial<BrandColor>) => {
    setResearch((prev) => {
      if (!prev) return prev;
      const palette = (prev.colorPalette ?? []).map((c, i) => (i === idx ? { ...c, ...patch } : c));
      const next = { ...prev, colorPalette: palette };
      void persistPatch({ research: next });
      return next;
    });
  };

  const removeColor = (idx: number) => {
    setResearch((prev) => {
      if (!prev) return prev;
      const palette = (prev.colorPalette ?? []).filter((_, i) => i !== idx);
      const next = { ...prev, colorPalette: palette };
      void persistPatch({ research: next });
      return next;
    });
  };

  const addColor = () => {
    setResearch((prev) => {
      if (!prev) return prev;
      const palette = [...(prev.colorPalette ?? []), { name: "New color", hex: "#FFFFFF", usage: "" }];
      const next = { ...prev, colorPalette: palette };
      void persistPatch({ research: next });
      return next;
    });
  };

  const updateFont = (idx: number, patch: Partial<BrandFont>) => {
    setResearch((prev) => {
      if (!prev) return prev;
      const fonts = (prev.fonts ?? []).map((f, i) => (i === idx ? { ...f, ...patch } : f));
      const next = { ...prev, fonts };
      void persistPatch({ research: next });
      return next;
    });
  };

  const removeFont = (idx: number) => {
    setResearch((prev) => {
      if (!prev) return prev;
      const fonts = (prev.fonts ?? []).filter((_, i) => i !== idx);
      const next = { ...prev, fonts };
      void persistPatch({ research: next });
      return next;
    });
  };

  const addFont = () => {
    setResearch((prev) => {
      if (!prev) return prev;
      const fonts = [...(prev.fonts ?? []), { name: "New font", usage: "", weight: "400" }];
      const next = { ...prev, fonts };
      void persistPatch({ research: next });
      return next;
    });
  };

  const handleReExtract = async () => {
    if (!activeBrandId || reExtracting) return;
    setReExtracting(true);
    setSaveError(null);
    try {
      await retriggerBrandResearch(activeBrandId);
      await refreshBrand(activeBrandId);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setReExtracting(false);
    }
  };

  // No active brand yet — BrandProvider is still loading or there are none.
  if (!activeBrand) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-white/40 text-xs font-mono">
          <Loader2 size={14} className="animate-spin" />
          Loading brand…
        </div>
      </div>
    );
  }

  const isResearching =
    activeBrand.researchStatus === "pending" || activeBrand.researchStatus === "researching";
  const researchFailed = activeBrand.researchStatus === "failed";
  const hasResearch = !!research && !isResearching;

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
              {isResearching
                ? "Claude is reading the site…"
                : researchFailed
                ? "Research failed — re-run below"
                : "Extracted from website · All fields editable"}
            </p>
          </div>
          {activeBrand.researchStatus === "complete" && !saveError && (
            <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={10} />
              Synced
            </span>
          )}
        </div>

        {/* Brand URL + Re-run */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5">
            <Globe size={14} className="text-white/30 shrink-0" />
            <span className="text-xs font-mono text-white/60 truncate">
              {activeBrand.brandUrl || <span className="text-white/20 italic">No brand URL set</span>}
            </span>
          </div>
          <button
            onClick={handleReExtract}
            disabled={reExtracting || isResearching || !activeBrand.brandUrl}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono font-semibold uppercase tracking-wider transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: reExtracting || isResearching ? "rgba(0,212,255,0.1)" : "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)",
              color: reExtracting || isResearching ? "#00D4FF" : "#0D0F12",
              border: reExtracting || isResearching ? "1px solid rgba(0,212,255,0.3)" : "none",
            }}
          >
            {reExtracting || isResearching ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Extracting…
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Re-Extract
              </>
            )}
          </button>
        </div>
      </div>

      {/* Extraction Progress */}
      <AnimatePresence>
        {isResearching && (
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
                <div className="text-xs text-cyan-400 font-mono mb-1">Claude is reading the site… this usually takes 30–60s</div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-cyan-400"
                    initial={{ width: "0%" }}
                    animate={{ width: "90%" }}
                    transition={{ duration: 45, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Errors */}
      {(researchFailed || saveError) && (
        <div className="border-b border-rose-500/30 px-6 py-3 flex items-center gap-3" style={{ background: "rgba(244,63,94,0.08)" }}>
          <AlertTriangle size={14} className="text-rose-400 shrink-0" />
          <div className="text-xs text-rose-300 font-mono">
            {saveError || activeBrand.researchError || "Brand research failed."}
          </div>
        </div>
      )}

      {/* Content */}
      {hasResearch && research && (
        <div className="p-6 space-y-5">
          {/* Logo + Brand Name */}
          <div className="rounded-xl border border-white/[0.06] p-5 flex items-center gap-5" style={{ background: "#13161F" }}>
            <LogoBox
              logoUrl={activeBrand.logoUrl ?? research.logoUrl ?? null}
              onSave={(val) => updateLogo(val || null)}
            />
            <div className="flex-1 min-w-0">
              <EditableField
                label="Brand Name"
                value={activeBrand.name}
                onSave={(val) => updateBrandName(val)}
              />
            </div>
          </div>

          {/* Brand Description */}
          <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161F" }}>
            <EditableField
              label="Brand Description"
              value={research.description ?? ""}
              multiline
              onSave={(val) => updateResearch({ description: val })}
            />
          </div>

          {/* Color Palette */}
          <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{ background: "#13161F" }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Palette size={14} className="text-cyan-400" />
                <span className="text-xs font-mono text-white/60 uppercase tracking-wider">Color Palette</span>
                <span className="text-[10px] font-mono text-white/30">· {(research.colorPalette ?? []).length}</span>
              </div>
              <div className="flex items-center gap-2">
                {colorsEditing && (
                  <button
                    onClick={addColor}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-cyan-400 hover:bg-cyan-500/10 transition-all"
                  >
                    <Plus size={10} /> Add
                  </button>
                )}
                <button
                  onClick={() => setColorsEditing((v) => !v)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-all ${
                    colorsEditing
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      : "text-white/30 hover:text-white/50"
                  }`}
                >
                  {colorsEditing ? <><Save size={10} /> Done</> : <><Edit3 size={10} /> Edit</>}
                </button>
              </div>
            </div>

            <div className="p-5">
              {(research.colorPalette ?? []).length === 0 ? (
                <div className="text-center py-8 text-xs text-white/30 font-mono">
                  No colors yet. Click <span className="text-cyan-400">Edit</span> to add some.
                </div>
              ) : (
                <>
                  {!colorsEditing && (
                    <div className="flex gap-3 mb-5 flex-wrap">
                      {(research.colorPalette ?? []).map((color, i) => (
                        <div key={i} className="group cursor-pointer" style={{ minWidth: "80px", flex: "1 1 80px" }}>
                          <div
                            className="h-20 rounded-lg border border-white/[0.06] group-hover:scale-105 transition-transform"
                            style={{ backgroundColor: color.hex }}
                          />
                          <div className="mt-2">
                            <div className="text-xs font-semibold text-white/70 truncate">{color.name}</div>
                            <div className="text-[10px] font-mono text-white/30">{color.hex}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="border border-white/[0.04] rounded-lg overflow-hidden">
                    <div className="grid gap-px bg-white/[0.04]" style={{ gridTemplateColumns: colorsEditing ? "1.5fr 1fr 2fr auto" : "1.5fr 1fr 2fr" }}>
                      <div className="px-3 py-2 text-[9px] font-mono text-white/30 uppercase tracking-widest" style={{ background: "#13161F" }}>Color</div>
                      <div className="px-3 py-2 text-[9px] font-mono text-white/30 uppercase tracking-widest" style={{ background: "#13161F" }}>Hex</div>
                      <div className="px-3 py-2 text-[9px] font-mono text-white/30 uppercase tracking-widest" style={{ background: "#13161F" }}>Usage</div>
                      {colorsEditing && <div className="px-3 py-2" style={{ background: "#13161F" }} />}
                    </div>
                    {(research.colorPalette ?? []).map((color, idx) => (
                      <div key={idx} className="grid gap-px bg-white/[0.04]" style={{ gridTemplateColumns: colorsEditing ? "1.5fr 1fr 2fr auto" : "1.5fr 1fr 2fr" }}>
                        <div className="px-3 py-2.5 flex items-center gap-2" style={{ background: "#13161F" }}>
                          <div
                            className="w-3 h-3 rounded-full border border-white/10 shrink-0"
                            style={{ backgroundColor: color.hex }}
                          />
                          {colorsEditing ? (
                            <input
                              type="text"
                              value={color.name}
                              onChange={(e) => updateColor(idx, { name: e.target.value })}
                              className="w-full bg-transparent border-b border-cyan-500/30 text-xs text-white/80 outline-none focus:border-cyan-500"
                            />
                          ) : (
                            <span className="text-xs text-white/60">{color.name}</span>
                          )}
                        </div>
                        <div className="px-3 py-2.5 flex items-center gap-2" style={{ background: "#13161F" }}>
                          {colorsEditing ? (
                            <>
                              <input
                                type="color"
                                value={color.hex}
                                onChange={(e) => updateColor(idx, { hex: e.target.value.toUpperCase() })}
                                className="w-5 h-5 rounded shrink-0 cursor-pointer bg-transparent border border-white/10"
                              />
                              <input
                                type="text"
                                value={color.hex}
                                onChange={(e) => updateColor(idx, { hex: e.target.value })}
                                className="w-full bg-transparent border-b border-cyan-500/30 text-xs font-mono text-white/60 outline-none focus:border-cyan-500 uppercase"
                              />
                            </>
                          ) : (
                            <span className="text-xs font-mono text-white/40">{color.hex}</span>
                          )}
                        </div>
                        <div className="px-3 py-2.5" style={{ background: "#13161F" }}>
                          {colorsEditing ? (
                            <input
                              type="text"
                              value={color.usage}
                              onChange={(e) => updateColor(idx, { usage: e.target.value })}
                              className="w-full bg-transparent border-b border-cyan-500/30 text-xs text-white/60 outline-none focus:border-cyan-500"
                            />
                          ) : (
                            <span className="text-xs text-white/40">{color.usage}</span>
                          )}
                        </div>
                        {colorsEditing && (
                          <div className="px-3 py-2.5 flex items-center" style={{ background: "#13161F" }}>
                            <button
                              onClick={() => removeColor(idx)}
                              className="text-rose-400/70 hover:text-rose-400 transition-colors"
                              title="Remove color"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Typography */}
          <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{ background: "#13161F" }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Type size={14} className="text-violet-400" />
                <span className="text-xs font-mono text-white/60 uppercase tracking-wider">Typography</span>
                <span className="text-[10px] font-mono text-white/30">· {(research.fonts ?? []).length}</span>
              </div>
              <div className="flex items-center gap-2">
                {fontsEditing && (
                  <button
                    onClick={addFont}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-violet-400 hover:bg-violet-500/10 transition-all"
                  >
                    <Plus size={10} /> Add
                  </button>
                )}
                <button
                  onClick={() => setFontsEditing((v) => !v)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-all ${
                    fontsEditing
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      : "text-white/30 hover:text-white/50"
                  }`}
                >
                  {fontsEditing ? <><Save size={10} /> Done</> : <><Edit3 size={10} /> Edit</>}
                </button>
              </div>
            </div>
            <div className="p-5 space-y-3">
              {(research.fonts ?? []).length === 0 ? (
                <div className="text-center py-6 text-xs text-white/30 font-mono">
                  No fonts extracted. Click <span className="text-violet-400">Edit</span> to add some, or Re-Extract to try again.
                </div>
              ) : (
                (research.fonts ?? []).map((font, i) => (
                  <div key={i} className="flex items-start gap-4 py-3 border-b border-white/[0.04] last:border-0">
                    <div className="w-32 shrink-0">
                      <div
                        className="text-2xl font-semibold text-white/80"
                        style={{ fontFamily: fontFamilyFor(font.name) }}
                      >
                        Aa
                      </div>
                      {fontsEditing ? (
                        <input
                          type="text"
                          value={font.name}
                          onChange={(e) => updateFont(i, { name: e.target.value })}
                          className="w-full mt-1 bg-transparent border-b border-cyan-500/30 text-xs font-semibold text-white/80 outline-none focus:border-cyan-500"
                        />
                      ) : (
                        <div className="text-xs font-semibold text-white/60 mt-1">{font.name}</div>
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      {fontsEditing ? (
                        <>
                          <input
                            type="text"
                            value={font.usage}
                            placeholder="Usage (e.g. Headlines, hero text)"
                            onChange={(e) => updateFont(i, { usage: e.target.value })}
                            className="w-full bg-transparent border-b border-cyan-500/30 text-xs text-white/60 outline-none focus:border-cyan-500"
                          />
                          <input
                            type="text"
                            value={font.weight}
                            placeholder="Weight (e.g. 400–600)"
                            onChange={(e) => updateFont(i, { weight: e.target.value })}
                            className="w-full bg-transparent border-b border-cyan-500/30 text-[10px] font-mono text-white/40 outline-none focus:border-cyan-500"
                          />
                        </>
                      ) : (
                        <>
                          <div className="text-xs text-white/40">{font.usage || <span className="text-white/20 italic">No usage defined</span>}</div>
                          <div className="text-[10px] font-mono text-white/20 mt-1">Weight: {font.weight || "—"}</div>
                        </>
                      )}
                    </div>
                    {fontsEditing && (
                      <button
                        onClick={() => removeFont(i)}
                        className="text-rose-400/70 hover:text-rose-400 transition-colors shrink-0 mt-1"
                        title="Remove font"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Brand Tone */}
          <div className="rounded-xl border border-white/[0.06] p-5" style={{ background: "#13161F" }}>
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle size={14} className="text-rose-400" />
              <span className="text-xs font-mono text-white/60 uppercase tracking-wider">Brand Tone & Voice</span>
            </div>
            <EditableField
              label=""
              value={research.tone ?? ""}
              placeholder="Describe the brand's voice"
              multiline
              onSave={(val) => updateResearch({ tone: val })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
