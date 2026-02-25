/**
 * CONCEPT A: "Command Center" — Mission Control Dashboard
 * Design: Neo-Brutalist, dark charcoal base, cyan/amber accents
 * Layout: Horizontal pipeline top, split-panel below
 * Typography: JetBrains Mono (data) + Space Grotesk (headings)
 * Enhanced: Image previews for creatives, testing phase, winning angle flow
 */

import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { processSteps, type ProcessStep } from "@/lib/processData";
import { messageTestingCreatives } from "@/lib/portfolioData";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-white/10 text-white/40 border-white/10",
    active: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    review: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    testing: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  };
  const labels: Record<string, string> = { pending: "PENDING", active: "ACTIVE", review: "IN REVIEW", approved: "APPROVED", testing: "TESTING" };
  return (
    <span className={`text-[10px] tracking-wider uppercase px-2 py-0.5 border ${styles[status] || styles.pending}`} style={{ fontFamily: 'JetBrains Mono' }}>
      {labels[status] || status.toUpperCase()}
    </span>
  );
}

type ExtendedStatus = ProcessStep['status'] | 'testing';

export default function ConceptA() {
  const [activeStep, setActiveStep] = useState(0);
  const [stepStates, setStepStates] = useState<Record<number, ExtendedStatus>>({
    0: 'active', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending'
  });
  const [showOutput, setShowOutput] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testingComplete, setTestingComplete] = useState(false);
  const [winningAngleSelected, setWinningAngleSelected] = useState<string | null>(null);

  const currentStep = processSteps[activeStep];

  const handleExecute = () => {
    setIsProcessing(true);
    setShowOutput(false);
    setTimeout(() => {
      setIsProcessing(false);
      setShowOutput(true);
      // For step 2 (message testing), go to testing phase first
      if (activeStep === 2) {
        setStepStates(prev => ({ ...prev, [activeStep]: 'testing' }));
        setIsTesting(true);
      } else {
        setStepStates(prev => ({ ...prev, [activeStep]: 'review' }));
      }
    }, 2500);
  };

  const handleTestingComplete = () => {
    setIsTesting(false);
    setTestingComplete(true);
    setStepStates(prev => ({ ...prev, [activeStep]: 'review' }));
  };

  const handleSelectWinningAngle = (angle: string) => {
    setWinningAngleSelected(angle);
  };

  const handleApprove = () => {
    setStepStates(prev => ({ ...prev, [activeStep]: 'approved' }));
    if (activeStep < 5) {
      setTimeout(() => {
        const next = activeStep + 1;
        setActiveStep(next);
        setStepStates(prev => ({ ...prev, [next]: 'active' }));
        setShowOutput(false);
        setShowFeedback(false);
        setFeedbackText("");
        setIsTesting(false);
        setTestingComplete(false);
        setWinningAngleSelected(null);
      }, 600);
    }
  };

  const handleRequestChanges = () => {
    setShowFeedback(true);
  };

  const handleSubmitFeedback = () => {
    setShowFeedback(false);
    setIsProcessing(true);
    setShowOutput(false);
    setTimeout(() => {
      setIsProcessing(false);
      setShowOutput(true);
      setStepStates(prev => ({ ...prev, [activeStep]: 'review' }));
      setFeedbackText("");
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-[#1A1A2E] text-white flex flex-col" style={{ fontFamily: 'Space Grotesk' }}>
      {/* Top Bar */}
      <header className="h-12 border-b border-white/10 flex items-center px-4 justify-between bg-[#12121F] shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/">
            <span className="text-xs text-white/30 hover:text-white/50 transition-colors cursor-pointer" style={{ fontFamily: 'JetBrains Mono' }}>
              ← PORTFOLIO
            </span>
          </Link>
          <div className="w-px h-5 bg-white/10" />
          <Link href="/dashboard/acme-supplements">
            <span className="text-xs text-white/30 hover:text-white/50 transition-colors cursor-pointer" style={{ fontFamily: 'JetBrains Mono' }}>
              DASHBOARD
            </span>
          </Link>
          <div className="w-px h-5 bg-white/10" />
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-[8px] font-bold">CC</div>
            <span className="text-sm font-semibold">Command Center</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-white/30" style={{ fontFamily: 'JetBrains Mono' }}>
            CLIENT: ACME SUPPLEMENTS
          </span>
          <div className="w-2 h-2 bg-emerald-500 animate-pulse" />
        </div>
      </header>

      {/* Pipeline Bar */}
      <div className="h-20 border-b border-white/10 bg-[#15152A] px-4 flex items-center shrink-0">
        <div className="flex items-center w-full max-w-6xl mx-auto">
          {processSteps.map((step, i) => (
            <div key={step.id} className="flex items-center flex-1">
              <button
                onClick={() => {
                  setActiveStep(step.id);
                  setShowOutput(stepStates[step.id] === 'review' || stepStates[step.id] === 'approved' || stepStates[step.id] === 'testing');
                  setShowFeedback(false);
                }}
                className={`flex items-center gap-2 px-3 py-2 transition-all w-full ${
                  activeStep === step.id
                    ? 'bg-cyan-500/10 border border-cyan-500/30'
                    : 'border border-transparent hover:border-white/10'
                }`}
              >
                <div className={`w-8 h-8 flex items-center justify-center text-xs font-bold shrink-0 ${
                  stepStates[step.id] === 'approved' ? 'bg-emerald-500/30 text-emerald-400' :
                  stepStates[step.id] === 'active' ? 'bg-cyan-500/30 text-cyan-400' :
                  stepStates[step.id] === 'review' || stepStates[step.id] === 'testing' ? 'bg-amber-500/30 text-amber-400' :
                  'bg-white/10 text-white/30'
                }`} style={{ fontFamily: 'JetBrains Mono' }}>
                  {stepStates[step.id] === 'approved' ? '✓' : step.id}
                </div>
                <div className="text-left min-w-0">
                  <div className="text-[10px] text-white/40 truncate" style={{ fontFamily: 'JetBrains Mono' }}>
                    STEP {step.id}
                  </div>
                  <div className="text-xs text-white/70 truncate">{step.shortTitle}</div>
                </div>
              </button>
              {i < processSteps.length - 1 && (
                <div className={`w-6 h-px shrink-0 ${
                  stepStates[step.id] === 'approved' ? 'bg-emerald-500/50' : 'bg-white/10'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content — Split Panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel — Inputs */}
        <div className="w-[42%] border-r border-white/10 flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 bg-[#15152A] shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{currentStep.icon}</span>
                <h2 className="text-lg font-bold">{currentStep.shortTitle}</h2>
              </div>
              <StatusBadge status={stepStates[activeStep]} />
            </div>
            <p className="text-xs text-white/40" style={{ fontFamily: 'JetBrains Mono' }}>
              {currentStep.title}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="text-[10px] tracking-widest uppercase text-cyan-400/60 mb-2" style={{ fontFamily: 'JetBrains Mono' }}>
              REQUIRED INPUTS
            </div>

            {currentStep.inputs.map((input) => (
              <div key={input.id} className="space-y-1.5">
                <label className="flex items-center gap-2">
                  <span className="text-xs text-white/60">{input.label}</span>
                  {input.fromPrevious && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400/60 border border-cyan-500/20" style={{ fontFamily: 'JetBrains Mono' }}>
                      FROM STEP {input.previousStepId}
                    </span>
                  )}
                  {input.required && <span className="text-[9px] text-amber-400/60">*</span>}
                </label>
                {input.type === 'textarea' ? (
                  <textarea
                    placeholder={input.placeholder}
                    className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white/80 placeholder:text-white/20 focus:border-cyan-500/40 focus:outline-none resize-none h-20"
                    style={{ fontFamily: 'JetBrains Mono', fontSize: '12px' }}
                    defaultValue={input.fromPrevious ? "← Auto-populated from previous step" : ""}
                  />
                ) : input.type === 'file' ? (
                  <div className="w-full bg-white/5 border border-dashed border-white/15 px-3 py-4 text-center cursor-pointer hover:border-cyan-500/30 transition-colors">
                    <span className="text-xs text-white/30" style={{ fontFamily: 'JetBrains Mono' }}>DROP FILE OR CLICK TO UPLOAD</span>
                  </div>
                ) : (
                  <input
                    type={input.type}
                    placeholder={input.placeholder}
                    className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white/80 placeholder:text-white/20 focus:border-cyan-500/40 focus:outline-none"
                    style={{ fontFamily: 'JetBrains Mono', fontSize: '12px' }}
                    defaultValue={input.fromPrevious ? "← Auto-populated" : ""}
                  />
                )}
              </div>
            ))}

            {/* Winning Angle Input for Step 3 */}
            {activeStep === 3 && winningAngleSelected && (
              <div className="border-2 border-cyan-500/20 bg-cyan-500/5 p-3">
                <div className="text-[10px] text-cyan-400/60 uppercase tracking-wider mb-1" style={{ fontFamily: 'JetBrains Mono' }}>
                  WINNING ANGLE FROM STEP 2
                </div>
                <div className="text-sm text-cyan-400 font-medium">"{winningAngleSelected}"</div>
              </div>
            )}

            {/* AI Actions Preview */}
            <div className="mt-6 pt-4 border-t border-white/10">
              <div className="text-[10px] tracking-widest uppercase text-amber-400/60 mb-3" style={{ fontFamily: 'JetBrains Mono' }}>
                AI BACKEND ACTIONS ({currentStep.aiActions.length})
              </div>
              <div className="space-y-1">
                {currentStep.aiActions.map((action, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-white/30">
                    <span className="text-white/15 shrink-0" style={{ fontFamily: 'JetBrains Mono' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: '11px' }}>{action}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Execute Button */}
            <div className="pt-4">
              <button
                onClick={handleExecute}
                disabled={isProcessing || stepStates[activeStep] === 'approved'}
                className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-[#1A1A2E] font-bold text-sm tracking-wider uppercase transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ fontFamily: 'Space Grotesk' }}
              >
                {isProcessing ? "PROCESSING..." : stepStates[activeStep] === 'approved' ? "COMPLETED" : "EXECUTE STEP"}
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel — Output / Review */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#12121F]">
          <div className="px-5 py-4 border-b border-white/10 bg-[#0D0D1A] shrink-0">
            <div className="flex items-center justify-between">
              <div className="text-[10px] tracking-widest uppercase text-white/30" style={{ fontFamily: 'JetBrains Mono' }}>
                OUTPUT / REVIEW PANEL
              </div>
              {showOutput && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-emerald-500" />
                  <span className="text-[10px] text-emerald-400/60" style={{ fontFamily: 'JetBrains Mono' }}>
                    {isTesting ? 'TESTING LIVE' : `${currentStep.outputs.length} OUTPUTS READY`}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <AnimatePresence mode="wait">
              {isProcessing ? (
                <motion.div
                  key="processing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center h-full"
                >
                  <div className="relative w-16 h-16 mb-6">
                    <div className="absolute inset-0 border-2 border-cyan-500/20 animate-spin" style={{ animationDuration: '3s' }} />
                    <div className="absolute inset-2 border-2 border-cyan-500/40 animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
                    <div className="absolute inset-4 border-2 border-cyan-500/60 animate-spin" style={{ animationDuration: '1s' }} />
                  </div>
                  <div className="text-sm text-cyan-400/80 mb-2">Executing AI Pipeline...</div>
                  <div className="space-y-1 text-center">
                    {currentStep.aiActions.slice(0, 3).map((action, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.6 }}
                        className="text-[11px] text-white/30"
                        style={{ fontFamily: 'JetBrains Mono' }}
                      >
                        → {action}
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              ) : showOutput ? (
                <motion.div
                  key="output"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4"
                >
                  {/* MESSAGE TESTING: Image Creative Previews */}
                  {activeStep === 2 && (isTesting || testingComplete) && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="border border-white/10 bg-white/[0.02]"
                    >
                      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-purple-400" />
                          <span className="text-sm font-medium">Message Testing Creatives</span>
                        </div>
                        {isTesting && (
                          <span className="text-[9px] text-amber-400 flex items-center gap-1" style={{ fontFamily: 'JetBrains Mono' }}>
                            <span className="animate-pulse">●</span> LIVE TESTING
                          </span>
                        )}
                        {testingComplete && (
                          <span className="text-[9px] text-emerald-400" style={{ fontFamily: 'JetBrains Mono' }}>
                            DATA COLLECTED
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="grid grid-cols-3 gap-3">
                          {messageTestingCreatives.map((creative, i) => {
                            const isWinner = testingComplete && creative.metrics.ctr === Math.max(...messageTestingCreatives.map(c => c.metrics.ctr));
                            return (
                              <motion.div
                                key={creative.id}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: i * 0.1 }}
                                className={`border overflow-hidden ${
                                  isWinner ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' :
                                  winningAngleSelected === creative.angle ? 'border-cyan-500/30' :
                                  'border-white/10'
                                }`}
                              >
                                <div className="aspect-square relative overflow-hidden bg-white/5">
                                  <img
                                    src={creative.imageUrl}
                                    alt={creative.angle}
                                    className="w-full h-full object-cover opacity-90"
                                  />
                                  {isWinner && (
                                    <div className="absolute top-1 right-1 bg-emerald-500 text-[8px] text-white px-1.5 py-0.5 font-bold" style={{ fontFamily: 'JetBrains Mono' }}>
                                      WINNER
                                    </div>
                                  )}
                                  {isTesting && (
                                    <div className="absolute top-1 left-1 bg-amber-500/80 text-[8px] text-white px-1.5 py-0.5" style={{ fontFamily: 'JetBrains Mono' }}>
                                      LIVE
                                    </div>
                                  )}
                                </div>
                                <div className="p-2 bg-black/20">
                                  <div className="text-[9px] text-white/50 mb-1 truncate" style={{ fontFamily: 'JetBrains Mono' }}>
                                    {creative.angle}
                                  </div>
                                  <div className="text-[10px] text-white/30 leading-tight mb-2 line-clamp-2">
                                    {creative.message}
                                  </div>
                                  <div className="grid grid-cols-2 gap-1">
                                    <div className="text-[8px] text-white/20" style={{ fontFamily: 'JetBrains Mono' }}>
                                      CTR: <span className={isWinner ? 'text-emerald-400' : 'text-white/50'}>{creative.metrics.ctr}%</span>
                                    </div>
                                    <div className="text-[8px] text-white/20" style={{ fontFamily: 'JetBrains Mono' }}>
                                      CPC: <span className="text-white/50">${creative.metrics.cpc}</span>
                                    </div>
                                    <div className="text-[8px] text-white/20" style={{ fontFamily: 'JetBrains Mono' }}>
                                      Clicks: <span className="text-white/50">{creative.metrics.clicks}</span>
                                    </div>
                                    <div className="text-[8px] text-white/20" style={{ fontFamily: 'JetBrains Mono' }}>
                                      Spend: <span className="text-white/50">${creative.metrics.spend}</span>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>

                        {/* Testing Phase Actions */}
                        {isTesting && (
                          <div className="mt-4 border border-amber-500/20 bg-amber-500/5 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-[10px] text-amber-400/80 uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono' }}>
                                TESTING IN PROGRESS
                              </div>
                              <div className="text-[10px] text-white/30" style={{ fontFamily: 'JetBrains Mono' }}>
                                ~2 days remaining
                              </div>
                            </div>
                            <p className="text-xs text-white/40 mb-3">
                              Creatives are live and collecting data. Once sufficient data is gathered, you can determine the winning angle.
                            </p>
                            <button
                              onClick={handleTestingComplete}
                              className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-[#1A1A2E] font-bold text-xs tracking-wider uppercase transition-colors"
                              style={{ fontFamily: 'Space Grotesk' }}
                            >
                              SIMULATE: TESTING DATA READY
                            </button>
                          </div>
                        )}

                        {/* Winning Angle Selection */}
                        {testingComplete && !winningAngleSelected && (
                          <div className="mt-4 border border-cyan-500/20 bg-cyan-500/5 p-3">
                            <div className="text-[10px] text-cyan-400/80 uppercase tracking-wider mb-2" style={{ fontFamily: 'JetBrains Mono' }}>
                              SELECT WINNING ANGLE
                            </div>
                            <p className="text-xs text-white/40 mb-3">
                              Based on the test results, select the winning angle to proceed to creative production.
                            </p>
                            <div className="space-y-2">
                              {Array.from(new Set(messageTestingCreatives.map(c => c.angle))).map((angle) => {
                                const angleCreatives = messageTestingCreatives.filter(c => c.angle === angle);
                                const avgCtr = (angleCreatives.reduce((sum, c) => sum + c.metrics.ctr, 0) / angleCreatives.length).toFixed(1);
                                const avgCpc = (angleCreatives.reduce((sum, c) => sum + c.metrics.cpc, 0) / angleCreatives.length).toFixed(2);
                                const isBest = angle === "The Hidden Root Cause";
                                return (
                                  <button
                                    key={angle}
                                    onClick={() => handleSelectWinningAngle(angle)}
                                    className={`w-full p-3 border text-left transition-all flex items-center justify-between ${
                                      isBest ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10' : 'border-white/10 hover:border-white/20'
                                    }`}
                                  >
                                    <div>
                                      <div className="text-sm text-white/80 flex items-center gap-2">
                                        {angle}
                                        {isBest && <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5" style={{ fontFamily: 'JetBrains Mono' }}>RECOMMENDED</span>}
                                      </div>
                                      <div className="text-[10px] text-white/30 mt-0.5" style={{ fontFamily: 'JetBrains Mono' }}>
                                        {angleCreatives.length} creatives tested
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-xs text-white/50" style={{ fontFamily: 'JetBrains Mono' }}>
                                        Avg CTR: <span className={isBest ? 'text-emerald-400' : ''}>{avgCtr}%</span>
                                      </div>
                                      <div className="text-[10px] text-white/30" style={{ fontFamily: 'JetBrains Mono' }}>
                                        Avg CPC: ${avgCpc}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Winning Angle Confirmed */}
                        {winningAngleSelected && (
                          <div className="mt-4 border-2 border-emerald-500/30 bg-emerald-500/5 p-3">
                            <div className="text-[10px] text-emerald-400/80 uppercase tracking-wider mb-1" style={{ fontFamily: 'JetBrains Mono' }}>
                              WINNING ANGLE SELECTED
                            </div>
                            <div className="text-sm text-emerald-400 font-bold">"{winningAngleSelected}"</div>
                            <div className="text-[10px] text-white/30 mt-1" style={{ fontFamily: 'JetBrains Mono' }}>
                              This will be passed as input to Step 3: Creative Production
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Regular Outputs */}
                  {currentStep.outputs.map((output, i) => (
                    <motion.div
                      key={output.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: (activeStep === 2 ? 0.5 : 0) + i * 0.1 }}
                      className="border border-white/10 bg-white/[0.02]"
                    >
                      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 ${
                            output.type === 'document' ? 'bg-cyan-400' :
                            output.type === 'data' ? 'bg-amber-400' :
                            output.type === 'creative' ? 'bg-purple-400' :
                            output.type === 'list' ? 'bg-emerald-400' :
                            'bg-blue-400'
                          }`} />
                          <span className="text-sm font-medium">{output.label}</span>
                        </div>
                        <span className="text-[9px] text-white/30 uppercase" style={{ fontFamily: 'JetBrains Mono' }}>
                          {output.type}
                        </span>
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-xs text-white/40 mb-2">{output.description}</p>
                        {output.sampleContent && (
                          <pre className="text-[11px] text-white/50 bg-black/30 p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed border border-white/5" style={{ fontFamily: 'JetBrains Mono' }}>
                            {output.sampleContent}
                          </pre>
                        )}
                      </div>
                    </motion.div>
                  ))}

                  {/* Approval Section */}
                  {stepStates[activeStep] === 'review' && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                      className="border-2 border-amber-500/30 bg-amber-500/5 p-5 mt-6"
                    >
                      <div className="text-[10px] tracking-widest uppercase text-amber-400/80 mb-3" style={{ fontFamily: 'JetBrains Mono' }}>
                        APPROVAL REQUIRED
                      </div>
                      <p className="text-sm text-white/60 mb-4" style={{ fontFamily: 'DM Sans' }}>
                        {activeStep === 2 && winningAngleSelected
                          ? `Approve the winning angle "${winningAngleSelected}" and proceed to creative production.`
                          : 'Review the outputs above. Approve to proceed to the next step, or request changes with feedback.'}
                      </p>

                      {showFeedback ? (
                        <div className="space-y-3">
                          <textarea
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            placeholder="Describe the changes you need..."
                            className="w-full bg-black/30 border border-amber-500/20 px-3 py-2 text-sm text-white/80 placeholder:text-white/20 focus:border-amber-500/40 focus:outline-none resize-none h-24"
                            style={{ fontFamily: 'JetBrains Mono', fontSize: '12px' }}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={handleSubmitFeedback}
                              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-[#1A1A2E] font-bold text-xs tracking-wider uppercase transition-colors"
                            >
                              RE-EXECUTE WITH FEEDBACK
                            </button>
                            <button
                              onClick={() => setShowFeedback(false)}
                              className="px-4 py-2.5 border border-white/10 text-white/40 text-xs tracking-wider uppercase hover:border-white/20 transition-colors"
                            >
                              CANCEL
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <button
                            onClick={handleApprove}
                            className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-[#1A1A2E] font-bold text-sm tracking-wider uppercase transition-colors"
                          >
                            ✓ APPROVE & PROCEED
                          </button>
                          <button
                            onClick={handleRequestChanges}
                            className="flex-1 py-3 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 font-bold text-sm tracking-wider uppercase transition-colors"
                          >
                            REQUEST CHANGES
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {stepStates[activeStep] === 'approved' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-2 border-emerald-500/30 bg-emerald-500/5 p-5 mt-6 flex items-center gap-3"
                    >
                      <div className="w-8 h-8 bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">✓</div>
                      <div>
                        <div className="text-sm font-bold text-emerald-400">Step Approved</div>
                        <div className="text-xs text-white/40" style={{ fontFamily: 'JetBrains Mono' }}>
                          Outputs passed to next step
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center h-full text-center"
                >
                  <div className="text-4xl mb-4 opacity-20">⟩</div>
                  <div className="text-sm text-white/20 mb-1">No output yet</div>
                  <div className="text-xs text-white/10" style={{ fontFamily: 'JetBrains Mono' }}>
                    Fill in the inputs and execute the step
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="h-8 border-t border-white/10 bg-[#0D0D1A] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-white/20" style={{ fontFamily: 'JetBrains Mono' }}>
            STEP {activeStep}/5
          </span>
          <span className="text-[10px] text-white/20" style={{ fontFamily: 'JetBrains Mono' }}>
            TIMELINE: 6 WEEKS MAX
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-white/20" style={{ fontFamily: 'JetBrains Mono' }}>
            {Object.values(stepStates).filter(s => s === 'approved').length}/6 COMPLETED
          </span>
          <span className="text-[10px] text-cyan-400/40" style={{ fontFamily: 'JetBrains Mono' }}>
            CONCEPT A: COMMAND CENTER
          </span>
        </div>
      </div>
    </div>
  );
}
