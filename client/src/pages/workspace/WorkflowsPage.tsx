/**
 * DESIGN: Studio Control Room — Workflows Listing
 * Shows available automated workflows
 * Dark background, Cyan accent (#00D4FF)
 */
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Zap, Play, ArrowRight, Clock, CheckCircle2, Sparkles, Target, BarChart3 } from "lucide-react";

const WORKFLOWS = [
  {
    id: "dfy",
    name: "Done For You",
    description: "Full automated workflow: Research → Angles → Message Testing → 100+ Creatives → Listicle → Analysis. Select a product and hit Go.",
    status: "active" as const,
    route: "/workspace/workflows/dfy",
    color: "#00D4FF",
    icon: Zap,
    steps: 6,
    estimatedTime: "2-3 hours",
    outputs: ["Product Research", "5 Angles × 10 Messages", "Message Testing Ads", "225+ Creatives", "Listicle Page", "Sprint Report"],
  },
  {
    id: "angle-sprint",
    name: "Angle Sprint",
    description: "Quick sprint to test a new angle for an existing product. Generates message testing ads, runs campaign, and produces creatives for winning messages.",
    status: "coming_soon" as const,
    route: "/workspace/workflows/angle-sprint",
    color: "#A855F7",
    icon: Target,
    steps: 4,
    estimatedTime: "1-2 hours",
    outputs: ["New Angle Research", "Message Testing Ads", "50+ Creatives", "Performance Report"],
  },
  {
    id: "performance-review",
    name: "Performance Review",
    description: "Analyze current campaign performance, identify top performers, and generate recommendations for scaling and new creative directions.",
    status: "coming_soon" as const,
    route: "/workspace/workflows/performance-review",
    color: "#10B981",
    icon: BarChart3,
    steps: 3,
    estimatedTime: "30 min",
    outputs: ["Performance Dashboard", "Top Performer Analysis", "Scaling Recommendations"],
  },
];

export default function WorkflowsPage() {
  return (
    <div className="min-h-screen p-6 lg:p-8" style={{ background: "linear-gradient(180deg, #0D0F12 0%, #131620 100%)" }}>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00D4FF20, #00D4FF05)" }}>
            <Zap size={20} className="text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Workflows</h1>
            <p className="text-xs text-white/30">Automated pipelines that combine multiple apps into end-to-end processes</p>
          </div>
        </div>
      </div>

      {/* Workflow Cards */}
      <div className="space-y-4">
        {WORKFLOWS.map((wf, i) => {
          const Icon = wf.icon;
          const isActive = wf.status === "active";
          return (
            <motion.div
              key={wf.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              {isActive ? (
                <Link href={wf.route}>
                  <div className="rounded-xl border border-white/[0.06] p-6 hover:border-cyan-500/20 transition-all cursor-pointer group" style={{ background: "#13161B" }}>
                    <WorkflowCardContent wf={wf} isActive={isActive} />
                  </div>
                </Link>
              ) : (
                <div className="rounded-xl border border-white/[0.04] p-6 opacity-50" style={{ background: "#0F1115" }}>
                  <WorkflowCardContent wf={wf} isActive={isActive} />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowCardContent({ wf, isActive }: { wf: typeof WORKFLOWS[0]; isActive: boolean }) {
  const Icon = wf.icon;
  return (
    <>
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${wf.color}15` }}>
          <Icon size={22} style={{ color: wf.color }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-base font-semibold text-white/80" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{wf.name}</h3>
            {isActive ? (
              <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">ACTIVE</span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-white/[0.03] text-white/20 border border-white/[0.06]">COMING SOON</span>
            )}
          </div>
          <p className="text-xs text-white/40 leading-relaxed mb-4">{wf.description}</p>

          {/* Stats */}
          <div className="flex items-center gap-6 mb-4">
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-white/25">
              <Sparkles size={10} />
              <span>{wf.steps} steps</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-white/25">
              <Clock size={10} />
              <span>{wf.estimatedTime}</span>
            </div>
          </div>

          {/* Outputs */}
          <div className="flex flex-wrap gap-1.5">
            {wf.outputs.map((output, j) => (
              <span key={j} className="px-2 py-0.5 rounded text-[9px] font-mono border border-white/[0.04] text-white/25" style={{ background: "#0D0F12" }}>
                {output}
              </span>
            ))}
          </div>
        </div>

        {isActive && (
          <div className="shrink-0 self-center">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center group-hover:bg-cyan-500/10 transition-all" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <ArrowRight size={14} className="text-white/20 group-hover:text-cyan-400 transition-all" />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
