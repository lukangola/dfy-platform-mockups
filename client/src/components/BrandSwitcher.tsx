/**
 * Top-left brand identifier + switcher.
 *
 * Collapsed sidebar → renders just the logo square; clicking it still opens
 * the dropdown. Expanded sidebar → renders logo + brand name + chevron.
 *
 * Dropdown lists every brand (highlighting the active one) and has an
 * "Add new brand" row at the bottom that triggers CreateBrandDialog.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Loader2, Plus, Sparkles } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";
import CreateBrandDialog from "./CreateBrandDialog";

export default function BrandSwitcher({ collapsed }: { collapsed: boolean }) {
  const { brands, activeBrand, activeBrandId, setActiveBrandId, loading, refreshBrand } = useBrand();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  const workspaceName = activeBrand?.name?.trim() || (loading ? "Loading…" : "Your Brand");
  const showLogo = !!activeBrand?.logoUrl && !logoBroken;

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  // Reset broken logo state when the active brand changes.
  useEffect(() => {
    setLogoBroken(false);
  }, [activeBrand?.logoUrl]);

  // While any brand has researching status, poll for updates.
  useEffect(() => {
    const researching = brands.filter((b) => b.researchStatus === "researching" || b.researchStatus === "pending");
    if (researching.length === 0) return;
    const handle = window.setInterval(() => {
      researching.forEach((b) => void refreshBrand(b.id));
    }, 3000);
    return () => window.clearInterval(handle);
  }, [brands, refreshBrand]);

  return (
    <>
      <div className="relative h-14 border-b border-white/[0.06] shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="w-full h-full flex items-center px-4 gap-3 hover:bg-white/[0.03] transition"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
            style={
              showLogo
                ? { background: "#FFFFFF" }
                : { background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)" }
            }
          >
            {showLogo ? (
              <img
                src={activeBrand!.logoUrl!}
                alt={`${workspaceName} logo`}
                className="max-w-[85%] max-h-[85%] object-contain"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <Sparkles size={16} className="text-[#0D0F12]" />
            )}
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden whitespace-nowrap flex-1 min-w-0 text-left"
              >
                <div
                  className="text-sm font-semibold text-white/90 truncate max-w-[130px]"
                  title={workspaceName}
                >
                  {workspaceName}
                </div>
                <div className="text-[9px] font-mono text-white/30 uppercase tracking-wider flex items-center gap-1.5">
                  {activeBrand?.researchStatus === "researching" && (
                    <Loader2 size={8} className="animate-spin text-cyan-400" />
                  )}
                  <span>
                    {activeBrand?.researchStatus === "researching"
                      ? "Researching"
                      : activeBrand?.researchStatus === "failed"
                        ? "Research failed"
                        : "Workspace"}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {!collapsed && <ChevronDown size={14} className="text-white/30 shrink-0" />}
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute left-2 right-2 top-full mt-1 z-50 rounded-lg border border-white/[0.08] overflow-hidden shadow-2xl"
              style={{ background: "#13161F" }}
            >
              <div className="px-3 pt-2.5 pb-1.5">
                <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">
                  Switch brand
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto">
                {brands.length === 0 && !loading ? (
                  <div className="px-3 py-4 text-xs text-white/30 italic">No brands yet.</div>
                ) : (
                  brands.map((b) => {
                    const isActive = b.id === activeBrandId;
                    return (
                      <button
                        key={b.id}
                        onClick={() => {
                          setActiveBrandId(b.id);
                          setOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${
                          isActive ? "bg-cyan-500/10" : "hover:bg-white/[0.04]"
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded flex items-center justify-center shrink-0 overflow-hidden"
                          style={
                            b.logoUrl
                              ? { background: "#FFFFFF" }
                              : { background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)" }
                          }
                        >
                          {b.logoUrl ? (
                            <img
                              src={b.logoUrl}
                              alt=""
                              className="max-w-[85%] max-h-[85%] object-contain"
                            />
                          ) : (
                            <Sparkles size={11} className="text-[#0D0F12]" />
                          )}
                        </div>
                        <span
                          className={`flex-1 truncate text-xs font-mono ${
                            isActive ? "text-cyan-300" : "text-white/70"
                          }`}
                        >
                          {b.name}
                        </span>
                        {b.researchStatus === "researching" && (
                          <Loader2 size={10} className="animate-spin text-cyan-400 shrink-0" />
                        )}
                        {isActive && <Check size={12} className="text-cyan-300 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="border-t border-white/[0.06]">
                <button
                  onClick={() => {
                    setShowCreate(true);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs font-mono text-cyan-300 hover:bg-cyan-500/10 transition"
                >
                  <Plus size={12} />
                  Add new brand
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <CreateBrandDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </>
  );
}
