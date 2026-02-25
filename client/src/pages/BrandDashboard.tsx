/**
 * Brand Dashboard — Overview of a single brand's DFY project progress
 * Shows: current step, all step statuses, key metrics, timeline, next actions
 * This is the "one layer above" the step detail — you see everything at a glance
 */

import { Link, useParams } from "wouter";
import { motion } from "framer-motion";
import { mockBrands, stepNames, messageTestingCreatives } from "@/lib/portfolioData";

export default function BrandDashboard() {
  const params = useParams<{ brandId: string }>();
  const brand = mockBrands.find(b => b.id === params.brandId) || mockBrands[0];

  const completedSteps = Object.values(brand.stepStatuses).filter(s => s === 'completed').length;
  const progressPercent = (completedSteps / 6) * 100;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white" style={{ fontFamily: 'DM Sans' }}>
      {/* Header */}
      <header className="border-b border-white/10 px-8 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <span className="text-xs text-white/30 hover:text-white/50 transition-colors cursor-pointer" style={{ fontFamily: 'JetBrains Mono' }}>
                ← PORTFOLIO
              </span>
            </Link>
            <div className="w-px h-5 bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="text-2xl">{brand.logo}</span>
              <div>
                <h1 className="text-lg font-bold" style={{ fontFamily: 'Space Grotesk' }}>{brand.name}</h1>
                <span className="text-[10px] text-white/30" style={{ fontFamily: 'JetBrains Mono' }}>
                  {brand.category} — Week {brand.weekNumber}/{brand.totalWeeks}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] px-2 py-0.5 uppercase tracking-wider border ${
              brand.health === 'on-track' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
              brand.health === 'attention' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' :
              'border-red-500/30 text-red-400 bg-red-500/10'
            }`} style={{ fontFamily: 'JetBrains Mono' }}>
              {brand.health === 'on-track' ? 'ON TRACK' : brand.health === 'attention' ? 'NEEDS ATTENTION' : 'BLOCKED'}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-8 py-8">
        {/* Progress Overview */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/30 uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono' }}>
              Overall Progress
            </span>
            <span className="text-sm text-white/50" style={{ fontFamily: 'JetBrains Mono' }}>
              {completedSteps}/6 Steps Complete
            </span>
          </div>
          <div className="h-2 bg-white/5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500"
            />
          </div>
        </motion.div>

        {/* Key Metrics */}
        {brand.keyMetrics && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8"
          >
            {brand.keyMetrics.winningAngle && (
              <div className="border border-cyan-500/20 bg-cyan-500/5 p-4 col-span-2">
                <div className="text-[10px] text-cyan-400/60 uppercase tracking-wider mb-1" style={{ fontFamily: 'JetBrains Mono' }}>
                  Winning Angle
                </div>
                <div className="text-sm text-cyan-400 font-medium" style={{ fontFamily: 'Space Grotesk' }}>
                  "{brand.keyMetrics.winningAngle}"
                </div>
              </div>
            )}
            {brand.keyMetrics.adsLaunched !== undefined && (
              <div className="border border-white/10 bg-white/[0.02] p-4">
                <div className="text-2xl font-bold text-white/80" style={{ fontFamily: 'Space Grotesk' }}>
                  {brand.keyMetrics.adsLaunched}
                </div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono' }}>
                  Ads Launched
                </div>
              </div>
            )}
            {brand.keyMetrics.creativesProduced !== undefined && brand.keyMetrics.creativesProduced > 0 && (
              <div className="border border-white/10 bg-white/[0.02] p-4">
                <div className="text-2xl font-bold text-white/80" style={{ fontFamily: 'Space Grotesk' }}>
                  {brand.keyMetrics.creativesProduced}
                </div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono' }}>
                  Creatives Produced
                </div>
              </div>
            )}
            {brand.keyMetrics.roas !== undefined && (
              <div className="border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="text-2xl font-bold text-emerald-400" style={{ fontFamily: 'Space Grotesk' }}>
                  {brand.keyMetrics.roas}x
                </div>
                <div className="text-[10px] text-emerald-400/60 uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono' }}>
                  ROAS
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Step Timeline */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8"
        >
          <h2 className="text-xs text-white/30 uppercase tracking-wider mb-4" style={{ fontFamily: 'JetBrains Mono' }}>
            Process Timeline
          </h2>
          <div className="space-y-2">
            {stepNames.map((step, i) => {
              const status = brand.stepStatuses[step.id];
              const isCurrent = brand.currentStep === step.id;

              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.06 }}
                  className={`border transition-all ${
                    isCurrent ? 'border-cyan-500/30 bg-cyan-500/5' :
                    status === 'completed' ? 'border-white/10 bg-white/[0.02]' :
                    'border-white/5 bg-white/[0.01]'
                  }`}
                >
                  <div className="p-4 flex items-center gap-4">
                    {/* Step Number */}
                    <div className={`w-10 h-10 flex items-center justify-center text-sm font-bold shrink-0 ${
                      status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                      status === 'active' ? 'bg-cyan-500/20 text-cyan-400' :
                      status === 'testing' ? 'bg-amber-500/20 text-amber-400' :
                      status === 'review' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-white/5 text-white/20'
                    }`} style={{ fontFamily: 'JetBrains Mono' }}>
                      {status === 'completed' ? '✓' : step.icon}
                    </div>

                    {/* Step Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ fontFamily: 'Space Grotesk' }}>
                          {step.title}
                        </span>
                        {isCurrent && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono' }}>
                            CURRENT
                          </span>
                        )}
                      </div>
                      {/* Status-specific info */}
                      {status === 'testing' && (
                        <div className="text-xs text-amber-400/60 mt-1 flex items-center gap-1" style={{ fontFamily: 'JetBrains Mono' }}>
                          <span className="animate-pulse">●</span> Testing in progress — awaiting 3-day data window
                        </div>
                      )}
                      {status === 'review' && (
                        <div className="text-xs text-amber-400/60 mt-1" style={{ fontFamily: 'JetBrains Mono' }}>
                          Outputs ready for review and approval
                        </div>
                      )}
                      {status === 'completed' && (
                        <div className="text-xs text-white/20 mt-1" style={{ fontFamily: 'JetBrains Mono' }}>
                          Completed — outputs passed to next step
                        </div>
                      )}
                      {status === 'pending' && (
                        <div className="text-xs text-white/15 mt-1" style={{ fontFamily: 'JetBrains Mono' }}>
                          Waiting for previous step
                        </div>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div className={`text-[10px] px-2 py-1 uppercase tracking-wider shrink-0 ${
                      status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                      status === 'active' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                      status === 'testing' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                      status === 'review' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                      'bg-white/5 text-white/15 border border-white/5'
                    }`} style={{ fontFamily: 'JetBrains Mono' }}>
                      {status === 'testing' ? 'TESTING' : status.toUpperCase()}
                    </div>

                    {/* Action Button */}
                    {(status === 'active' || status === 'review' || status === 'testing') && (
                      <Link href={`/concept-a?brand=${brand.id}&step=${step.id}`}>
                        <span className="text-xs px-3 py-1.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors cursor-pointer" style={{ fontFamily: 'Space Grotesk' }}>
                          {status === 'review' ? 'Review' : status === 'testing' ? 'View Testing' : 'Open'}
                        </span>
                      </Link>
                    )}
                  </div>

                  {/* Testing Preview for Message Testing Step */}
                  {step.id === 2 && status === 'testing' && (
                    <div className="border-t border-white/5 px-4 py-4">
                      <div className="text-[10px] text-white/20 uppercase tracking-wider mb-3" style={{ fontFamily: 'JetBrains Mono' }}>
                        Message Testing Creatives — Live Performance
                      </div>
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                        {messageTestingCreatives.map((creative) => (
                          <div key={creative.id} className="border border-white/10 bg-white/[0.02] overflow-hidden">
                            <div className="aspect-square bg-white/5 relative overflow-hidden">
                              <img
                                src={creative.imageUrl}
                                alt={creative.angle}
                                className="w-full h-full object-cover opacity-80"
                              />
                              <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1">
                                <div className="text-[8px] text-white/60 truncate" style={{ fontFamily: 'JetBrains Mono' }}>
                                  CTR: {creative.metrics.ctr}%
                                </div>
                              </div>
                            </div>
                            <div className="p-1.5">
                              <div className="text-[8px] text-white/30 truncate" style={{ fontFamily: 'JetBrains Mono' }}>
                                ${creative.metrics.cpc}/click
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-xs text-amber-400/60" style={{ fontFamily: 'JetBrains Mono' }}>
                        <span className="animate-pulse">●</span>
                        Data collection in progress — 2 days remaining before winner determination
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* Next Action Card */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="border-2 border-cyan-500/20 bg-cyan-500/5 p-6"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-cyan-400/60 uppercase tracking-wider mb-1" style={{ fontFamily: 'JetBrains Mono' }}>
                NEXT ACTION REQUIRED
              </div>
              <div className="text-lg font-semibold" style={{ fontFamily: 'Space Grotesk' }}>
                {brand.stepStatuses[brand.currentStep] === 'testing'
                  ? `Wait for testing data (Step ${brand.currentStep}: ${stepNames[brand.currentStep].shortTitle})`
                  : brand.stepStatuses[brand.currentStep] === 'review'
                  ? `Review & approve outputs (Step ${brand.currentStep}: ${stepNames[brand.currentStep].shortTitle})`
                  : `Execute Step ${brand.currentStep}: ${stepNames[brand.currentStep].shortTitle}`
                }
              </div>
              <div className="text-xs text-white/30 mt-1" style={{ fontFamily: 'JetBrains Mono' }}>
                {brand.stepStatuses[brand.currentStep] === 'testing'
                  ? 'Testing creatives are live. Results will be ready in ~2 days.'
                  : brand.stepStatuses[brand.currentStep] === 'review'
                  ? 'AI pipeline has completed. Review outputs and approve or request changes.'
                  : 'Fill in the required inputs and execute the AI pipeline.'
                }
              </div>
            </div>
            <Link href={`/concept-a?brand=${brand.id}&step=${brand.currentStep}`}>
              <span className="px-5 py-3 bg-cyan-500 hover:bg-cyan-400 text-[#0A0A0F] font-bold text-sm transition-colors cursor-pointer" style={{ fontFamily: 'Space Grotesk' }}>
                {brand.stepStatuses[brand.currentStep] === 'testing' ? 'VIEW TESTING' :
                 brand.stepStatuses[brand.currentStep] === 'review' ? 'REVIEW NOW' :
                 'OPEN STEP'}
              </span>
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
