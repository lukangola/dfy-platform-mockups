/**
 * CollapsibleSection — the dark "Studio Control Room" accordion card used
 * across the operator product view and the public client share document.
 * Pure presentational; owns only its open/closed state (or none, when pinned
 * open via `forceOpen`).
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function CollapsibleSection({
  title,
  icon: Icon,
  subtitle,
  defaultOpen = false,
  forceOpen,
  badge,
  headerRight,
  children,
}: {
  title: string;
  icon: React.ElementType;
  subtitle?: string;
  defaultOpen?: boolean;
  /**
   * When set to true, keeps the section open regardless of the user's toggle.
   * Useful for pinning the section open while an inline form inside it is
   * active.
   */
  forceOpen?: boolean;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [userOpen, setUserOpen] = useState(defaultOpen);
  const open = forceOpen ?? userOpen;
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    if (forceOpen) return; // ignore toggle while pinned open
    setUserOpen(v);
  };
  return (
    <section
      className="rounded-xl border border-white/[0.06] overflow-hidden"
      style={{ background: "#13161F" }}
    >
      <div className="flex items-center gap-3 p-5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left group"
        >
          <ChevronDown
            size={14}
            className={`text-white/40 group-hover:text-white/70 shrink-0 transition-transform ${
              open ? "rotate-0" : "-rotate-90"
            }`}
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white/80 flex items-center gap-2">
              <Icon size={14} className="text-cyan-400 shrink-0" />
              <span className="truncate">{title}</span>
              {badge}
            </h2>
            {subtitle && !open && (
              <p className="text-[10px] font-mono text-white/40 mt-1 truncate">{subtitle}</p>
            )}
          </div>
        </button>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>
      {open && (
        <div className="px-5 pb-5 border-t border-white/[0.04]">
          {subtitle && (
            <p className="text-[10px] font-mono text-white/40 mt-3 mb-3">{subtitle}</p>
          )}
          {children}
        </div>
      )}
    </section>
  );
}
