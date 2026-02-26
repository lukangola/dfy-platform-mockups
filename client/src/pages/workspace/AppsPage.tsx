/**
 * DESIGN: Studio Control Room — App Launcher
 * Grid of available apps/tools within the workspace
 * B-Roll Generator is the active one, others are coming soon or beta
 */
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Video, FileText, Palette, Type, Calendar, Search,
  ArrowRight, Lock, Sparkles, LayoutGrid,
} from "lucide-react";
import { WORKSPACE_APPS, type WorkspaceApp } from "@/lib/mockData";
import { toast } from "sonner";

const ICON_MAP: Record<string, React.ElementType> = {
  Video,
  FileText,
  Palette,
  Type,
  Calendar,
  Search,
};

function StatusBadge({ status }: { status: WorkspaceApp["status"] }) {
  const config = {
    active: { label: "Active", className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
    beta: { label: "Beta", className: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
    coming_soon: { label: "Coming Soon", className: "text-white/30 bg-white/[0.04] border-white/[0.08]" },
  };
  const { label, className } = config[status];
  return (
    <span className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${className}`}>
      {label}
    </span>
  );
}

export default function AppsPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-6 py-5" style={{ background: "#0D0F12" }}>
        <h1 className="text-lg font-semibold text-white/90 flex items-center gap-2">
          <LayoutGrid size={18} className="text-cyan-400" />
          App Suite
        </h1>
        <p className="text-xs text-white/30 mt-1 font-mono">
          {WORKSPACE_APPS.filter((a) => a.status === "active").length} active · {WORKSPACE_APPS.filter((a) => a.status === "beta").length} beta · {WORKSPACE_APPS.filter((a) => a.status === "coming_soon").length} coming soon
        </p>
      </div>

      {/* Apps Grid */}
      <div className="p-6">
        {/* Active Apps Section */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 8px rgba(16,185,129,0.5)" }} />
            <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Active Tools</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {WORKSPACE_APPS.filter((app) => app.status === "active").map((app, i) => {
              const Icon = ICON_MAP[app.icon] || Sparkles;
              return (
                <motion.div
                  key={app.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link href={app.route}>
                    <div
                      className="rounded-xl border overflow-hidden cursor-pointer group transition-all hover:shadow-lg"
                      style={{
                        background: "#13161F",
                        borderColor: `${app.color}25`,
                        boxShadow: `0 0 0 0 ${app.color}00`,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = `${app.color}50`;
                        e.currentTarget.style.boxShadow = `0 0 30px ${app.color}10`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = `${app.color}25`;
                        e.currentTarget.style.boxShadow = `0 0 0 0 ${app.color}00`;
                      }}
                    >
                      <div className="p-5">
                        <div className="flex items-start justify-between mb-4">
                          <div
                            className="w-12 h-12 rounded-xl flex items-center justify-center"
                            style={{ background: `${app.color}15`, border: `1px solid ${app.color}30` }}
                          >
                            <Icon size={22} style={{ color: app.color }} />
                          </div>
                          <StatusBadge status={app.status} />
                        </div>

                        <h3 className="text-sm font-semibold text-white/90 group-hover:text-white transition-colors mb-1.5">
                          {app.name}
                        </h3>
                        <p className="text-xs text-white/40 leading-relaxed mb-4">
                          {app.description}
                        </p>

                        <div className="flex items-center gap-1.5 text-xs font-mono transition-colors" style={{ color: app.color }}>
                          <span>Launch</span>
                          <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Beta Apps */}
        {WORKSPACE_APPS.filter((app) => app.status === "beta").length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-amber-400" style={{ boxShadow: "0 0 8px rgba(255,176,32,0.5)" }} />
              <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Beta</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {WORKSPACE_APPS.filter((app) => app.status === "beta").map((app, i) => {
                const Icon = ICON_MAP[app.icon] || Sparkles;
                return (
                  <motion.div
                    key={app.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 + 0.1 }}
                  >
                    <div
                      className="rounded-xl border border-white/[0.06] overflow-hidden cursor-pointer group hover:border-white/[0.12] transition-all"
                      style={{ background: "#13161F" }}
                      onClick={() => toast("Beta feature — coming soon with full functionality")}
                    >
                      <div className="p-5">
                        <div className="flex items-start justify-between mb-4">
                          <div
                            className="w-12 h-12 rounded-xl flex items-center justify-center"
                            style={{ background: `${app.color}10`, border: `1px solid ${app.color}20` }}
                          >
                            <Icon size={22} style={{ color: `${app.color}80` }} />
                          </div>
                          <StatusBadge status={app.status} />
                        </div>

                        <h3 className="text-sm font-semibold text-white/70 mb-1.5">{app.name}</h3>
                        <p className="text-xs text-white/30 leading-relaxed mb-4">{app.description}</p>

                        <div className="flex items-center gap-1.5 text-xs font-mono text-white/30">
                          <span>Try Beta</span>
                          <ArrowRight size={12} />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Coming Soon Apps */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-white/20" />
            <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Coming Soon</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {WORKSPACE_APPS.filter((app) => app.status === "coming_soon").map((app, i) => {
              const Icon = ICON_MAP[app.icon] || Sparkles;
              return (
                <motion.div
                  key={app.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 + 0.2 }}
                >
                  <div
                    className="rounded-xl border border-white/[0.04] overflow-hidden opacity-60"
                    style={{ background: "#11131A" }}
                  >
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white/[0.02] border border-white/[0.04]">
                          <Icon size={22} className="text-white/15" />
                        </div>
                        <StatusBadge status={app.status} />
                      </div>

                      <h3 className="text-sm font-semibold text-white/40 mb-1.5">{app.name}</h3>
                      <p className="text-xs text-white/20 leading-relaxed mb-4">{app.description}</p>

                      <div className="flex items-center gap-1.5 text-xs font-mono text-white/15">
                        <Lock size={10} />
                        <span>Notify Me</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
