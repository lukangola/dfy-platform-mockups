/**
 * Shared form/input primitives used across the workspace apps.
 *
 * Extracted from ListicleBuilderAppPage so the Landing Page Builder (and
 * any future builder app) can reuse the exact same Card / Dropdown /
 * DropdownItem / ErrorRow look without duplicating the markup. Anything
 * here should be presentational — no app-specific logic.
 */
import { AlertTriangle, Check, ChevronDown } from "lucide-react";

export function Card({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5">
      <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-3 flex items-center gap-1.5">
        {label}
        {required && <span className="ml-auto text-rose-300/60 normal-case tracking-normal">required</span>}
      </label>
      {hint && <p className="text-[11px] text-white/40 font-mono leading-relaxed mb-3">{hint}</p>}
      {children}
    </div>
  );
}

export function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-300 font-mono flex items-start gap-2 mb-3">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

export function Dropdown({
  open,
  setOpen,
  icon,
  label,
  sublabel,
  thumb,
  children,
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  icon?: React.ReactNode;
  label: string;
  sublabel?: string;
  thumb?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 hover:border-white/[0.15] transition-all text-left"
      >
        {thumb ? (
          <img src={thumb} alt="" className="w-7 h-7 rounded object-cover" />
        ) : icon ? (
          <div className="w-7 h-7 rounded bg-white/[0.04] flex items-center justify-center shrink-0">{icon}</div>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white/80 truncate">{label}</div>
          {sublabel && <div className="text-[10px] font-mono text-white/30 truncate">{sublabel}</div>}
        </div>
        <ChevronDown size={14} className={`text-white/30 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-2 inset-x-0 z-10 bg-[#13151a] border border-white/[0.08] rounded-lg overflow-hidden shadow-xl max-h-72 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  onClick,
  selected,
  label,
  sublabel,
  thumb,
  accentColor,
}: {
  onClick: () => void;
  selected?: boolean;
  label: string;
  sublabel?: string;
  thumb?: string | null;
  /** Color for the check icon on the selected item — defaults to orange to
   *  match the Listicle Builder look; pass any tailwind text class for other
   *  apps (e.g. "text-violet-400" for the LP Builder). */
  accentColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
    >
      {thumb && <img src={thumb} alt="" className="w-6 h-6 rounded object-cover" />}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white/80 truncate">{label}</div>
        {sublabel && <div className="text-[10px] font-mono text-white/30 truncate">{sublabel}</div>}
      </div>
      {selected && <Check size={12} className={`${accentColor ?? "text-orange-400"} shrink-0`} />}
    </button>
  );
}
