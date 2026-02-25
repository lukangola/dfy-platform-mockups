/**
 * CONCEPT C: "Pipeline Theater" — Cinematic Step-by-Step Journey
 * Design: Editorial meets SaaS, dark navy base, gradient-coded steps
 * Layout: Full-screen single-step view, centered content column
 * Typography: Sora (headings) + DM Sans (body)
 * Enhanced: Image previews, testing phase, winning angle flow, dashboard nav
 */

import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { processSteps, type ProcessStep } from "@/lib/processData";
import { messageTestingCreatives } from "@/lib/portfolioData";

type ExtendedStatus = ProcessStep['status'] | 'testing';

const stepGradients = [
  { from: '#3B82F6', to: '#06B6D4', bg: 'from-blue-600/10 to-cyan-500/10' },
  { from: '#06B6D4', to: '#10B981', bg: 'from-cyan-500/10 to-emerald-500/10' },
  { from: '#10B981', to: '#F59E0B', bg: 'from-emerald-500/10 to-amber-500/10' },
  { from: '#F59E0B', to: '#EF4444', bg: 'from-amber-500/10 to-red-500/10' },
  { from: '#EF4444', to: '#8B5CF6', bg: 'from-red-500/10 to-violet-500/10' },
  { from: '#8B5CF6', to: '#EC4899', bg: 'from-violet-500/10 to-pink-500/10' },
];

export default function ConceptC() {
  const [activeStep, setActiveStep] = useState(0);
  const [stepStates, setStepStates] = useState<Record<number, ExtendedStatus>>({
    0: 'active', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending'
  });
  const [showOutput, setShowOutput] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [direction, setDirection] = useState(1);
  const [isTesting, setIsTesting] = useState(false);
  const [testingComplete, setTestingComplete] = useState(false);
  const [winningAngleSelected, setWinningAngleSelected] = useState<string | null>(null);

  const currentStep = processSteps[activeStep];
  const gradient = stepGradients[activeStep];

  const navigateStep = (newStep: number) => {
    setDirection(newStep > activeStep ? 1 : -1);
    setActiveStep(newStep);
    const st = stepStates[newStep];
    setShowOutput(st === 'review' || st === 'approved' || st === 'testing');
    setShowFeedback(false);
  };

  const handleExecute = () => {
    setIsProcessing(true);
    setShowOutput(false);
    setTimeout(() => {
      setIsProcessing(false);
      setShowOutput(true);
      if (activeStep === 2) {
        setStepStates(prev => ({ ...prev, [activeStep]: 'testing' }));
        setIsTesting(true);
      } else {
        setStepStates(prev => ({ ...prev, [activeStep]: 'review' }));
      }
    }, 3000);
  };

  const handleTestingComplete = () => {
    setIsTesting(false);
    setTestingComplete(true);
    setStepStates(prev => ({ ...prev, [activeStep]: 'review' }));
  };

  const handleApprove = () => {
    setStepStates(prev => ({ ...prev, [activeStep]: 'approved' }));
    if (activeStep < 5) {
      setTimeout(() => {
        const next = activeStep + 1;
        setDirection(1);
        setActiveStep(next);
        setStepStates(prev => ({ ...prev, [next]: 'active' }));
        setShowOutput(false);
        setShowFeedback(false);
        setFeedbackText("");
        setIsTesting(false);
        setTestingComplete(false);
        setWinningAngleSelected(null);
      }, 800);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col relative overflow-hidden" style={{ fontFamily: 'DM Sans' }}>
      {/* Ambient gradient background */}
      <div
        className="fixed inset-0 opacity-30 transition-all duration-1000 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% 30%, ${gradient.from}15, transparent 70%), radial-gradient(ellipse at 80% 80%, ${gradient.to}10, transparent 60%)`
        }}
      />

      {/* Top Navigation */}
      <header className="relative z-10 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <span className="text-xs text-white/30 hover:text-white/50 transition-colors cursor-pointer">
                ← Portfolio
              </span>
            </Link>
            <div className="w-px h-5 bg-white/10" />
            <Link href="/dashboard/acme-supplements">
              <span className="text-xs text-white/30 hover:text-white/50 transition-colors cursor-pointer">
                Dashboard
              </span>
            </Link>
            <div className="w-px h-5 bg-white/10" />
            <span className="text-sm font-semibold" style={{ fontFamily: 'Sora' }}>Pipeline Theater</span>
          </div>
          <div className="text-xs text-white/30">Acme Supplements — Sprint Week 2</div>
        </div>

        {/* Progress Rail */}
        <div className="max-w-6xl mx-auto px-6 pb-3">
          <div className="flex items-center gap-1">
            {processSteps.map((step, i) => (
              <div key={step.id} className="flex items-center flex-1">
                <button
                  onClick={() => navigateStep(step.id)}
                  className="group flex items-center gap-2 w-full"
                >
                  <div className={`relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    stepStates[step.id] === 'approved' ? 'bg-emerald-500 text-white' :
                    activeStep === step.id ? 'text-white' :
                    stepStates[step.id] === 'review' || stepStates[step.id] === 'testing' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                    'bg-white/5 text-white/30 border border-white/10'
                  }`} style={activeStep === step.id ? { background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` } : {}}>
                    {stepStates[step.id] === 'approved' ? '✓' : step.id}
                    {activeStep === step.id && (
                      <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }} />
                    )}
                  </div>
                  <span className={`text-xs hidden lg:block truncate ${
                    activeStep === step.id ? 'text-white/80' : 'text-white/30'
                  }`}>
                    {step.shortTitle}
                  </span>
                </button>
                {i < processSteps.length - 1 && (
                  <div className={`h-px flex-1 mx-2 ${
                    stepStates[step.id] === 'approved' ? 'bg-emerald-500/40' : 'bg-white/5'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={activeStep}
            custom={direction}
            initial={{ opacity: 0, x: direction * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -60 }}
            transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="max-w-2xl mx-auto px-6 py-10"
          >
            {/* Step Hero */}
            <div className="text-center mb-10">
              <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 }} className="text-5xl mb-4">
                {currentStep.icon}
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                className="text-xs uppercase tracking-[0.2em] mb-3" style={{ color: gradient.from }}>
                Step {currentStep.id} of 5
              </motion.div>
              <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                className="text-4xl font-bold leading-tight mb-3" style={{ fontFamily: 'Sora' }}>
                {currentStep.title}
              </motion.h1>
              <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.3, duration: 0.6 }}
                className="h-1 w-24 mx-auto rounded-full"
                style={{ background: `linear-gradient(90deg, ${gradient.from}, ${gradient.to})` }}
              />
            </div>

            {/* Winning Angle Banner (for step 3) */}
            {activeStep === 3 && winningAngleSelected && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 mb-6 flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-lg">🎯</div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-emerald-400/60">Winning Angle from Step 2</div>
                  <div className="text-sm font-semibold text-emerald-400">"{winningAngleSelected}"</div>
                </div>
              </motion.div>
            )}

            {/* Input Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="bg-white/[0.04] backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                <span className="text-sm font-medium text-white/60">Inputs</span>
                <span className="text-[10px] text-white/30 uppercase tracking-wider">{currentStep.inputs.length} fields</span>
              </div>
              <div className="p-6 space-y-5">
                {currentStep.inputs.map((input) => (
                  <div key={input.id}>
                    <label className="flex items-center gap-2 mb-2">
                      <span className="text-sm text-white/70">{input.label}</span>
                      {input.fromPrevious && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full border border-white/10 text-white/30">from step {input.previousStepId}</span>
                      )}
                    </label>
                    {input.type === 'textarea' ? (
                      <textarea placeholder={input.placeholder}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/80 placeholder:text-white/15 focus:border-white/20 focus:outline-none resize-none h-24"
                        defaultValue={input.fromPrevious ? "Auto-populated from previous step" : ""} />
                    ) : input.type === 'file' ? (
                      <div className="w-full bg-white/5 border border-dashed border-white/10 rounded-xl px-4 py-8 text-center cursor-pointer hover:border-white/20 transition-all group">
                        <div className="text-white/20 group-hover:text-white/40 transition-colors">
                          <svg className="w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <span className="text-xs">Drop files here</span>
                        </div>
                      </div>
                    ) : (
                      <input type={input.type} placeholder={input.placeholder}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/80 placeholder:text-white/15 focus:border-white/20 focus:outline-none"
                        defaultValue={input.fromPrevious ? "Auto-populated" : ""} />
                    )}
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Execute Button */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mb-8">
              <button onClick={handleExecute}
                disabled={isProcessing || stepStates[activeStep] === 'approved'}
                className="w-full py-4 rounded-2xl font-bold text-base transition-all disabled:opacity-30 disabled:cursor-not-allowed relative overflow-hidden group"
                style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})`, fontFamily: 'Sora' }}>
                <span className="relative z-10">
                  {isProcessing ? 'Processing...' : stepStates[activeStep] === 'approved' ? 'Completed' : 'Execute Step'}
                </span>
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
              </button>
              <p className="text-xs text-white/20 text-center mt-3">{currentStep.aiActions.length} AI actions will run automatically</p>
            </motion.div>

            {/* Processing Animation */}
            <AnimatePresence>
              {isProcessing && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white/[0.04] backdrop-blur-sm border border-white/10 rounded-2xl p-10 text-center mb-8">
                  <div className="relative w-24 h-24 mx-auto mb-6">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
                      <motion.circle cx="50" cy="50" r="42" fill="none" stroke={`url(#grad-${activeStep})`}
                        strokeWidth="4" strokeLinecap="round" strokeDasharray="264"
                        initial={{ strokeDashoffset: 264 }} animate={{ strokeDashoffset: 0 }}
                        transition={{ duration: 2.5, ease: "easeInOut" }} />
                      <defs>
                        <linearGradient id={`grad-${activeStep}`}>
                          <stop offset="0%" stopColor={gradient.from} />
                          <stop offset="100%" stopColor={gradient.to} />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-2xl">{currentStep.icon}</div>
                  </div>
                  <h3 className="text-lg font-semibold mb-2" style={{ fontFamily: 'Sora' }}>Executing Pipeline</h3>
                  <div className="space-y-2 max-w-sm mx-auto">
                    {currentStep.aiActions.map((action, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.3 }} className="text-xs text-white/30 flex items-center gap-2">
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.3 + 0.2 }}
                          className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: gradient.from }} />
                        {action}
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Output / Results */}
            <AnimatePresence>
              {showOutput && !isProcessing && (
                <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 mb-8">

                  {/* MESSAGE TESTING: Creative Previews */}
                  {activeStep === 2 && (isTesting || testingComplete) && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-white/[0.04] backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }} />
                          <div>
                            <div className="text-sm font-medium">Message Testing Creatives</div>
                            <div className="text-xs text-white/30">{isTesting ? 'Ads are live and collecting data...' : 'Testing complete — select winning angle'}</div>
                          </div>
                        </div>
                        {isTesting && (
                          <span className="text-[10px] px-2 py-1 rounded-full bg-amber-500/20 text-amber-400 flex items-center gap-1">
                            <span className="animate-pulse">●</span> LIVE
                          </span>
                        )}
                      </div>
                      <div className="p-6">
                        <div className="grid grid-cols-3 gap-3">
                          {messageTestingCreatives.map((creative, i) => {
                            const isWinner = testingComplete && creative.metrics.ctr === Math.max(...messageTestingCreatives.map(c => c.metrics.ctr));
                            return (
                              <motion.div key={creative.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: i * 0.08 }}
                                className={`rounded-xl border overflow-hidden ${
                                  isWinner ? 'border-emerald-500/50 ring-2 ring-emerald-500/20' : 'border-white/10'
                                }`}>
                                <div className="aspect-square relative overflow-hidden bg-white/5">
                                  <img src={creative.imageUrl} alt={creative.angle} className="w-full h-full object-cover opacity-90" />
                                  {isWinner && (
                                    <div className="absolute top-2 right-2 bg-emerald-500 text-white text-[8px] px-2 py-0.5 rounded-full font-bold">WINNER</div>
                                  )}
                                  {isTesting && (
                                    <div className="absolute top-2 left-2 bg-amber-500/90 text-white text-[8px] px-2 py-0.5 rounded-full">LIVE</div>
                                  )}
                                </div>
                                <div className="p-2.5 bg-black/20">
                                  <div className="text-[10px] font-medium mb-0.5" style={{ color: gradient.from }}>{creative.angle}</div>
                                  <div className="text-[10px] text-white/30 leading-tight mb-2 line-clamp-2">{creative.message}</div>
                                  <div className="grid grid-cols-2 gap-1">
                                    <div className="text-[9px] text-white/20">CTR: <span className={isWinner ? 'text-emerald-400' : 'text-white/50'}>{creative.metrics.ctr}%</span></div>
                                    <div className="text-[9px] text-white/20">CPC: <span className="text-white/50">${creative.metrics.cpc}</span></div>
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>

                        {/* Testing Phase */}
                        {isTesting && (
                          <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-amber-400" style={{ fontFamily: 'Sora' }}>Testing in Progress</span>
                              <span className="text-xs text-white/30">~2 days remaining</span>
                            </div>
                            <p className="text-xs text-white/40 mb-3">Creatives are live and collecting performance data. Once enough data is gathered, you can determine the winning angle.</p>
                            <button onClick={handleTestingComplete}
                              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0F172A] font-bold text-sm transition-colors"
                              style={{ fontFamily: 'Sora' }}>
                              Simulate: Testing Data Ready
                            </button>
                          </div>
                        )}

                        {/* Winning Angle Selection */}
                        {testingComplete && !winningAngleSelected && (
                          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                            <h4 className="text-sm font-semibold mb-1" style={{ fontFamily: 'Sora', color: gradient.from }}>Select Winning Angle</h4>
                            <p className="text-xs text-white/40 mb-3">Based on test results, choose the angle for creative production.</p>
                            <div className="space-y-2">
                              {Array.from(new Set(messageTestingCreatives.map(c => c.angle))).map((angle) => {
                                const angleCreatives = messageTestingCreatives.filter(c => c.angle === angle);
                                const avgCtr = (angleCreatives.reduce((sum, c) => sum + c.metrics.ctr, 0) / angleCreatives.length).toFixed(1);
                                const isBest = angle === "The Hidden Root Cause";
                                return (
                                  <button key={angle} onClick={() => setWinningAngleSelected(angle)}
                                    className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                                      isBest ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10' : 'border-white/10 hover:border-white/20'
                                    }`}>
                                    <div>
                                      <div className="text-sm text-white/80 flex items-center gap-2">
                                        {angle}
                                        {isBest && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Recommended</span>}
                                      </div>
                                      <div className="text-[10px] text-white/30 mt-0.5">{angleCreatives.length} creatives tested</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-xs text-white/50">Avg CTR: <span className={isBest ? 'text-emerald-400' : ''}>{avgCtr}%</span></div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Winning Angle Confirmed */}
                        {winningAngleSelected && (
                          <div className="mt-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-lg">🎯</div>
                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-emerald-400/60">Winning Angle Selected</div>
                              <div className="text-sm font-semibold text-emerald-400">"{winningAngleSelected}"</div>
                              <div className="text-[10px] text-white/30 mt-0.5">This will be passed as input to Step 3</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Regular Outputs */}
                  {currentStep.outputs.map((output, i) => (
                    <motion.div key={output.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (activeStep === 2 ? 0.3 : 0) + i * 0.12 }}
                      className="bg-white/[0.04] backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden">
                      <div className="px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }} />
                          <div>
                            <div className="text-sm font-medium">{output.label}</div>
                            <div className="text-xs text-white/30">{output.description}</div>
                          </div>
                        </div>
                        <span className="text-[10px] text-white/20 uppercase tracking-wider border border-white/10 px-2 py-0.5 rounded-full">{output.type}</span>
                      </div>
                      {output.sampleContent && (
                        <div className="px-6 pb-5">
                          <pre className="text-xs text-white/40 bg-black/20 rounded-xl p-4 whitespace-pre-wrap leading-relaxed border border-white/5">
                            {output.sampleContent}
                          </pre>
                        </div>
                      )}
                    </motion.div>
                  ))}

                  {/* Approval */}
                  {stepStates[activeStep] === 'review' && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                      className="rounded-2xl overflow-hidden"
                      style={{ background: `linear-gradient(135deg, ${gradient.from}15, ${gradient.to}15)`, border: `1px solid ${gradient.from}30` }}>
                      <div className="p-6">
                        <h3 className="text-lg font-semibold mb-2" style={{ fontFamily: 'Sora' }}>Review & Approve</h3>
                        <p className="text-sm text-white/40 mb-5">
                          {activeStep === 2 && winningAngleSelected
                            ? `Approve "${winningAngleSelected}" as the winning angle and proceed to creative production.`
                            : 'Approve to advance to the next stage, or provide feedback for revisions.'}
                        </p>

                        {showFeedback ? (
                          <div className="space-y-3">
                            <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)}
                              placeholder="Describe the changes needed..."
                              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/80 placeholder:text-white/15 focus:outline-none resize-none h-28" />
                            <div className="flex gap-3">
                              <button onClick={() => { setShowFeedback(false); setIsProcessing(true); setShowOutput(false); setTimeout(() => { setIsProcessing(false); setShowOutput(true); setFeedbackText(""); }, 2500); }}
                                className="flex-1 py-3 rounded-xl font-semibold text-sm text-white transition-all"
                                style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})`, fontFamily: 'Sora' }}>
                                Re-run with Feedback
                              </button>
                              <button onClick={() => setShowFeedback(false)}
                                className="px-6 py-3 rounded-xl border border-white/10 text-white/40 text-sm hover:bg-white/5 transition-colors">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <button onClick={handleApprove}
                              className="flex-1 py-4 rounded-xl font-bold text-base text-white transition-all relative overflow-hidden group"
                              style={{ background: `linear-gradient(135deg, #10B981, #059669)`, fontFamily: 'Sora' }}>
                              <span className="relative z-10 flex items-center justify-center gap-2">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                  <path d="M2 8L6 12L14 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                Approve & Continue
                              </span>
                              <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
                            </button>
                            <button onClick={() => setShowFeedback(true)}
                              className="flex-1 py-4 rounded-xl border border-white/10 text-white/60 font-semibold text-base hover:bg-white/5 transition-colors"
                              style={{ fontFamily: 'Sora' }}>
                              Request Changes
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {stepStates[activeStep] === 'approved' && (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path d="M3 10L8 15L17 5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-emerald-400" style={{ fontFamily: 'Sora' }}>Step Complete</div>
                        <div className="text-sm text-white/40">All outputs approved and forwarded</div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Step Navigation Arrows */}
      <div className="fixed bottom-8 left-0 right-0 z-20 flex justify-center gap-4 pointer-events-none">
        <button onClick={() => activeStep > 0 && navigateStep(activeStep - 1)} disabled={activeStep === 0}
          className="pointer-events-auto w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white/60 transition-all disabled:opacity-20 disabled:cursor-not-allowed backdrop-blur-sm">
          ←
        </button>
        <button onClick={() => activeStep < 5 && navigateStep(activeStep + 1)} disabled={activeStep === 5}
          className="pointer-events-auto w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white/60 transition-all disabled:opacity-20 disabled:cursor-not-allowed backdrop-blur-sm">
          →
        </button>
      </div>
    </div>
  );
}
