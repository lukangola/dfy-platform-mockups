import { Link } from "wouter";
import { motion } from "framer-motion";
import { mockBrands, stepNames } from "@/lib/portfolioData";

const concepts = [
  { id: "a", label: "Command Center", path: "concept-a", accent: "#00D4FF" },
  { id: "b", label: "Flow Canvas", path: "concept-b", accent: "#C45D3E" },
  { id: "c", label: "Pipeline Theater", path: "concept-c", accent: "#38BDF8" },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-xs font-bold" style={{ fontFamily: 'Space Grotesk' }}>
              DFY
            </div>
            <span className="text-sm text-white/50 tracking-wider uppercase" style={{ fontFamily: 'Space Grotesk' }}>
              Platform UI Concepts
            </span>
          </div>
          <span className="text-xs text-white/30" style={{ fontFamily: 'JetBrains Mono' }}>
            v0.2 — With Portfolio & Dashboard
          </span>
        </div>
      </header>

      {/* Concept Selector Tabs */}
      <div className="border-b border-white/10 px-8">
        <div className="max-w-7xl mx-auto flex items-center gap-1 py-2">
          <span className="text-[10px] text-white/20 uppercase tracking-wider mr-3" style={{ fontFamily: 'JetBrains Mono' }}>
            VIEW AS:
          </span>
          {concepts.map((c) => (
            <Link key={c.id} href={`/${c.path}`}>
              <span
                className="text-xs px-3 py-1.5 border border-white/10 hover:border-white/20 text-white/40 hover:text-white/60 transition-all cursor-pointer"
                style={{ fontFamily: 'Space Grotesk' }}
              >
                {c.label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Hero */}
      <section className="px-8 pt-12 pb-8">
        <div className="max-w-7xl mx-auto">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm text-cyan-400 tracking-widest uppercase mb-3"
            style={{ fontFamily: 'JetBrains Mono' }}
          >
            Portfolio Overview
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl font-bold leading-tight mb-3"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            Active DFY Projects
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base text-white/40 max-w-xl"
            style={{ fontFamily: 'DM Sans' }}
          >
            All running Done-For-You brand projects at a glance. Click any brand to see its detailed dashboard and step progress.
          </motion.p>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="px-8 pb-8">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Active Projects", value: mockBrands.length, color: "text-cyan-400" },
            { label: "Steps Completed", value: Object.values(mockBrands.reduce((acc, b) => { Object.values(b.stepStatuses).forEach(s => { if (s === 'completed') acc.count++; }); return acc; }, { count: 0 })).reduce(() => mockBrands.reduce((sum, b) => sum + Object.values(b.stepStatuses).filter(s => s === 'completed').length, 0), 0), color: "text-emerald-400" },
            { label: "In Testing", value: mockBrands.filter(b => Object.values(b.stepStatuses).includes('testing')).length, color: "text-amber-400" },
            { label: "Needs Attention", value: mockBrands.filter(b => b.health === 'attention').length, color: "text-red-400" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.05 }}
              className="border border-white/10 bg-white/[0.02] p-4"
            >
              <div className={`text-2xl font-bold ${stat.color}`} style={{ fontFamily: 'Space Grotesk' }}>
                {stat.value}
              </div>
              <div className="text-[10px] text-white/30 uppercase tracking-wider mt-1" style={{ fontFamily: 'JetBrains Mono' }}>
                {stat.label}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Brand Cards */}
      <section className="px-8 pb-20">
        <div className="max-w-7xl mx-auto space-y-3">
          {mockBrands.map((brand, i) => (
            <motion.div
              key={brand.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.08 }}
            >
              <Link href={`/dashboard/${brand.id}`}>
                <div className="group border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-all cursor-pointer overflow-hidden">
                  <div className="p-5 flex items-center gap-5">
                    {/* Brand Icon */}
                    <div className="text-3xl w-12 h-12 flex items-center justify-center bg-white/5 shrink-0">
                      {brand.logo}
                    </div>

                    {/* Brand Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-lg font-semibold" style={{ fontFamily: 'Space Grotesk' }}>
                          {brand.name}
                        </h3>
                        <span className={`text-[9px] px-2 py-0.5 uppercase tracking-wider border ${
                          brand.health === 'on-track' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
                          brand.health === 'attention' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' :
                          'border-red-500/30 text-red-400 bg-red-500/10'
                        }`} style={{ fontFamily: 'JetBrains Mono' }}>
                          {brand.health === 'on-track' ? 'ON TRACK' : brand.health === 'attention' ? 'NEEDS ATTENTION' : 'BLOCKED'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-white/30" style={{ fontFamily: 'JetBrains Mono' }}>
                        <span>{brand.category}</span>
                        <span>•</span>
                        <span>Week {brand.weekNumber}/{brand.totalWeeks}</span>
                        {brand.keyMetrics?.winningAngle && (
                          <>
                            <span>•</span>
                            <span className="text-cyan-400/60">Angle: "{brand.keyMetrics.winningAngle}"</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Step Progress */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {stepNames.map((step) => {
                        const status = brand.stepStatuses[step.id];
                        return (
                          <div
                            key={step.id}
                            className="relative group/step"
                            title={`${step.shortTitle}: ${status}`}
                          >
                            <div className={`w-8 h-8 flex items-center justify-center text-[10px] font-bold transition-all ${
                              status === 'completed' ? 'bg-emerald-500/30 text-emerald-400' :
                              status === 'active' ? 'bg-cyan-500/30 text-cyan-400 ring-1 ring-cyan-500/30' :
                              status === 'testing' ? 'bg-amber-500/30 text-amber-400 animate-pulse' :
                              status === 'review' ? 'bg-amber-500/20 text-amber-400' :
                              'bg-white/5 text-white/20'
                            }`} style={{ fontFamily: 'JetBrains Mono' }}>
                              {status === 'completed' ? '✓' : step.id}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Current Step Label */}
                    <div className="text-right shrink-0 w-36">
                      <div className="text-[10px] text-white/20 uppercase" style={{ fontFamily: 'JetBrains Mono' }}>
                        CURRENT
                      </div>
                      <div className="text-sm text-white/60" style={{ fontFamily: 'Space Grotesk' }}>
                        {stepNames[brand.currentStep].shortTitle}
                      </div>
                      <div className="text-[10px] text-white/20" style={{ fontFamily: 'JetBrains Mono' }}>
                        {brand.stepStatuses[brand.currentStep] === 'testing' ? '⏳ Testing...' :
                         brand.stepStatuses[brand.currentStep] === 'review' ? '👁 In Review' :
                         '▶ Active'}
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="text-white/20 group-hover:text-white/40 group-hover:translate-x-1 transition-all shrink-0">
                      →
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="h-0.5 bg-white/5">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-500"
                      style={{ width: `${(Object.values(brand.stepStatuses).filter(s => s === 'completed').length / 6) * 100}%` }}
                    />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Concept Links Footer */}
      <section className="px-8 pb-16 border-t border-white/10 pt-10">
        <div className="max-w-7xl mx-auto">
          <h3 className="text-xs tracking-widest uppercase text-white/20 mb-6" style={{ fontFamily: 'JetBrains Mono' }}>
            View This Portfolio in Different UI Concepts
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {concepts.map((c) => (
              <Link key={c.id} href={`/${c.path}`}>
                <div className="border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] p-5 transition-all cursor-pointer group">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2" style={{ backgroundColor: c.accent }} />
                    <span className="text-xs text-white/30 uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono' }}>
                      Concept {c.id.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-lg font-semibold mb-1" style={{ fontFamily: 'Space Grotesk' }}>
                    {c.label}
                  </div>
                  <div className="text-sm text-white/30 group-hover:text-white/40 flex items-center gap-2 transition-colors" style={{ color: c.accent }}>
                    View full mockup →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
