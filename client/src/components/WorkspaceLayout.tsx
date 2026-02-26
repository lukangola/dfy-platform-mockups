/**
 * DESIGN: Studio Control Room — Workspace Shell
 * Persistent sidebar navigation for the brand workspace
 * Dark background (#0D0F12), Cyan accent (#00D4FF)
 * JetBrains Mono for labels, Inter for body
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, Palette, LayoutGrid, ChevronLeft, ChevronRight,
  Settings, HelpCircle, Sparkles, Box,
} from "lucide-react";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { id: "products", label: "Products", icon: Package, path: "/workspace/products", description: "Product repository" },
  { id: "brand", label: "Brand Info", icon: Palette, path: "/workspace/brand", description: "Brand identity" },
  { id: "apps", label: "Apps", icon: LayoutGrid, path: "/workspace/apps", description: "Tool suite" },
];

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (path: string) => location.startsWith(path);

  return (
    <div
      className="min-h-screen flex"
      style={{
        background: "linear-gradient(180deg, #0D0F12 0%, #131620 100%)",
        fontFamily: "'Inter', sans-serif",
        color: "#E2E8F0",
      }}
    >
      {/* Sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 64 : 220 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="h-screen sticky top-0 border-r border-white/[0.06] flex flex-col shrink-0 overflow-hidden"
        style={{ background: "#0A0C0F" }}
      >
        {/* Brand Header */}
        <div className="h-14 border-b border-white/[0.06] flex items-center px-4 gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)" }}>
            <Sparkles size={16} className="text-[#0D0F12]" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden whitespace-nowrap"
              >
                <div className="text-sm font-semibold text-white/90">Lumina Beauty</div>
                <div className="text-[9px] font-mono text-white/30 uppercase tracking-wider">Workspace</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {!collapsed && (
            <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest px-3 py-2 mb-1">
              Navigation
            </div>
          )}
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link key={item.id} href={item.path}>
                <button
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs transition-all group relative ${
                    active
                      ? "bg-cyan-500/10 text-cyan-400"
                      : "text-white/40 hover:text-white/70 hover:bg-white/[0.03]"
                  }`}
                >
                  <Icon size={16} className={`shrink-0 ${active ? "text-cyan-400" : "text-white/40 group-hover:text-white/60"}`} />
                  <AnimatePresence>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto" }}
                        exit={{ opacity: 0, width: 0 }}
                        className="font-mono tracking-wide overflow-hidden whitespace-nowrap"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {active && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-cyan-400"
                      style={{ boxShadow: "0 0 8px rgba(0,212,255,0.5)" }}
                    />
                  )}
                  {/* Tooltip for collapsed state */}
                  {collapsed && (
                    <div className="absolute left-full ml-2 px-2 py-1 rounded bg-[#1A1D23] border border-white/[0.08] text-[10px] font-mono text-white/60 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                      {item.label}
                    </div>
                  )}
                </button>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Section */}
        <div className="border-t border-white/[0.06] p-2 space-y-1">
          {!collapsed && (
            <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest px-3 py-1 mb-1">
              System
            </div>
          )}
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-white/30 hover:text-white/50 hover:bg-white/[0.03] transition-all group relative">
            <Settings size={14} className="shrink-0" />
            {!collapsed && <span className="font-mono tracking-wide">Settings</span>}
            {collapsed && (
              <div className="absolute left-full ml-2 px-2 py-1 rounded bg-[#1A1D23] border border-white/[0.08] text-[10px] font-mono text-white/60 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                Settings
              </div>
            )}
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-white/30 hover:text-white/50 hover:bg-white/[0.03] transition-all group relative">
            <HelpCircle size={14} className="shrink-0" />
            {!collapsed && <span className="font-mono tracking-wide">Help</span>}
            {collapsed && (
              <div className="absolute left-full ml-2 px-2 py-1 rounded bg-[#1A1D23] border border-white/[0.08] text-[10px] font-mono text-white/60 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                Help
              </div>
            )}
          </button>

          {/* Collapse Toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center py-2 rounded-lg text-white/20 hover:text-white/40 hover:bg-white/[0.03] transition-all mt-1"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
