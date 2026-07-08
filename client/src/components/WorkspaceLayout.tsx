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
  Settings, HelpCircle, FolderOpen, Zap, LogOut, Crown, Shield, Headset, Radar,
  LayoutDashboard,
} from "lucide-react";
import BrandSwitcher from "./BrandSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { useBrand } from "@/contexts/BrandContext";
import { useJobsPulse } from "@/hooks/useJobsPulse";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/workspace/dashboard", description: "Jobs overview" },
  { id: "products", label: "Products", icon: Package, path: "/workspace/products", description: "Product repository" },
  { id: "brand", label: "Brand Info", icon: Palette, path: "/workspace/brand", description: "Brand identity" },
  { id: "apps", label: "Apps", icon: LayoutGrid, path: "/workspace/apps", description: "Tool suite" },
  { id: "assets", label: "Assets", icon: FolderOpen, path: "/workspace/assets", description: "Generated content" },
  { id: "workflows", label: "Workflows", icon: Zap, path: "/workspace/workflows", description: "Automated pipelines" },
];

// Client Console is gated: only managers/admins, and only when the
// active brand is flagged as a Done-For-You client. Inserted right after
// Products so it sits with the other client-facing surfaces.
const CLIENT_CONSOLE_ITEM = {
  id: "console",
  label: "Client Console",
  icon: Headset,
  path: "/workspace/console",
  description: "Client share + feedback",
};

// Ad Inspo Console: available to managers/admins on ANY brand (not DFY-gated).
// Pinned to the top of the nav when visible.
const AD_CONSOLE_ITEM = {
  id: "ad-console",
  label: "Ad Inspo Console",
  icon: Radar,
  path: "/workspace/ad-console",
  description: "Competitor + trend command center",
};

// Ad Pipeline Kanban: same audience as the Ad Console (managers/admins, any
// brand). Sits right after the Ad Console in the nav.
const AD_PIPELINE_ITEM = {
  id: "ad-pipeline",
  label: "Ad Pipeline",
  icon: LayoutGrid,
  path: "/workspace/apps/ad-pipeline",
  description: "Ad production kanban",
};

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { user, role, logout } = useAuth();
  const { activeBrand, activeBrandId } = useBrand();
  const runningJobs = useJobsPulse(activeBrandId ?? null, user?.id ?? null);

  const isManager = role === "admin" || role === "manager";
  // Ad Inspo Console + Ad Pipeline are available to managers/admins on ANY brand.
  const showAdTools = isManager;
  // Client Console stays DFY-only: it's the client-facing share + feedback
  // surface, only meaningful for done-for-you brands.
  const showClientConsole = isManager && Boolean(activeBrand?.isDfyClient);
  // Dashboard is always the first entry — jobs overview lands above
  // everything else, including the (manager-only) Ad Console pin.
  // Client Console sits right after Products.
  const navItems = [
    NAV_ITEMS[0], // Dashboard
    ...(showAdTools ? [AD_CONSOLE_ITEM, AD_PIPELINE_ITEM] : []),
    NAV_ITEMS[1], // Products
    ...(showClientConsole ? [CLIENT_CONSOLE_ITEM] : []),
    NAV_ITEMS[2], // Brand Info
    NAV_ITEMS[3], // Apps
    ...NAV_ITEMS.slice(4), // Assets, Workflows
  ];

  // A nav item matches when the URL is its path or a sub-path of it. Several
  // items can match at once (e.g. /workspace/apps/ad-pipeline matches both
  // "Apps" → /workspace/apps and "Ad Pipeline" → /workspace/apps/ad-pipeline),
  // so only the LONGEST (most specific) match is highlighted.
  const matchesPath = (path: string) => location === path || location.startsWith(path + "/");
  const activePath =
    navItems
      .map((i) => i.path)
      .filter(matchesPath)
      .sort((a, b) => b.length - a.length)[0] ?? null;
  const isActive = (path: string) => path === activePath;
  const settingsActive = location.startsWith("/workspace/settings");

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
        {/* Brand Header — click to switch brand or add new. */}
        <BrandSwitcher collapsed={collapsed} />

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {!collapsed && (
            <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest px-3 py-2 mb-1">
              Navigation
            </div>
          )}
          {navItems.map((item) => {
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
                  {item.id === "dashboard" && runningJobs > 0 && !collapsed && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-cyan-400/20 text-cyan-300 text-[10px] font-mono px-1">
                      {runningJobs}
                    </span>
                  )}
                  {/* Collapsed sidebar has no room for a count — show a passive running dot. */}
                  {item.id === "dashboard" && runningJobs > 0 && collapsed && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  )}
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

        {/* User Profile Row — sits above System block. Single source of
            truth for the signed-in user's identity in the workspace shell.
            Click to navigate to Settings; the LogOut icon signs out. */}
        {user && (
          <div className="border-t border-white/[0.06] p-2">
            {!collapsed ? (
              <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="w-7 h-7 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 text-[11px] font-medium shrink-0">
                  {user.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-white/85 truncate leading-tight">{user.name}</div>
                  <div className="text-[9px] font-mono text-white/40 flex items-center gap-1 mt-0.5">
                    {role === "admin" ? <Crown size={9} className="text-amber-400" /> : <Shield size={9} />}
                    <span className="uppercase tracking-wider">{role ?? "—"}</span>
                  </div>
                </div>
                <button
                  onClick={() => void logout()}
                  className="p-1.5 rounded text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                  title="Sign out"
                >
                  <LogOut size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => void logout()}
                className="w-full flex items-center justify-center py-2 rounded-lg text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-all group relative"
                title="Sign out"
              >
                <LogOut size={13} />
                <div className="absolute left-full ml-2 px-2 py-1 rounded bg-[#1A1D23] border border-white/[0.08] text-[10px] font-mono text-white/60 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                  Sign out — {user.name}
                </div>
              </button>
            )}
          </div>
        )}

        {/* Bottom Section */}
        <div className="border-t border-white/[0.06] p-2 space-y-1">
          {!collapsed && (
            <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest px-3 py-1 mb-1">
              System
            </div>
          )}
          <Link href="/workspace/settings">
            <button
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group relative ${
                settingsActive
                  ? "bg-cyan-500/10 text-cyan-400"
                  : "text-white/30 hover:text-white/50 hover:bg-white/[0.03]"
              }`}
            >
              <Settings size={14} className={`shrink-0 ${settingsActive ? "text-cyan-400" : ""}`} />
              {!collapsed && <span className="font-mono tracking-wide">Settings</span>}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 rounded bg-[#1A1D23] border border-white/[0.08] text-[10px] font-mono text-white/60 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                  Settings
                </div>
              )}
            </button>
          </Link>
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
