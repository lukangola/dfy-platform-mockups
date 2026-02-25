/**
 * CONCEPT B: "Flow Canvas" — Notion-Inspired Workflow Studio
 * Design: Scandinavian Minimalism, warm off-white, terracotta/sage accents
 * Layout: Left sidebar navigator + card-based main content
 * Typography: Instrument Serif (titles) + DM Sans (body)
 */

import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { processSteps, type ProcessStep } from "@/lib/processData";

function StepIcon({ status, stepId }: { status: ProcessStep['status']; stepId: number }) {
  if (status === 'approved') {
    return (
      <div className="w-7 h-7 rounded-full bg-[#7D9B76] flex items-center justify-center">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    );
  }
  if (status === 'active' || status === 'review') {
    return (
      <div className="w-7 h-7 rounded-full bg-[#C45D3E] flex items-center justify-center text-white text-xs font-medium">
        {stepId}
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full border-2 border-[#D4CFC7] flex items-center justify-center text-[#B5AFA5] text-xs font-medium">
      {stepId}
    </div>
  );
}

export default function ConceptB() {
  const [activeStep, setActiveStep] = useState(0);
  const [stepStates, setStepStates] = useState<Record<number, ProcessStep['status']>>({
    0: 'active', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending'
  });
  const [showOutput, setShowOutput] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set());

  const currentStep = processSteps[activeStep];

  const handleExecute = () => {
    setIsProcessing(true);
    setShowOutput(false);
    setTimeout(() => {
      setIsProcessing(false);
      setShowOutput(true);
      setStepStates(prev => ({ ...prev, [activeStep]: 'review' }));
    }, 2000);
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
        setExpandedOutputs(new Set());
      }, 500);
    }
  };

  const toggleOutput = (id: string) => {
    setExpandedOutputs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex" style={{ fontFamily: 'DM Sans' }}>
      {/* Sidebar */}
      <aside className="w-[260px] border-r border-[#E8E4DE] bg-[#F5F3EF] flex flex-col shrink-0 h-screen sticky top-0">
        {/* Sidebar Header */}
        <div className="px-5 py-5 border-b border-[#E8E4DE]">
          <Link href="/">
            <span className="text-xs text-[#B5AFA5] hover:text-[#8A8478] transition-colors cursor-pointer">
              ← Back to concepts
            </span>
          </Link>
          <div className="mt-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#C45D3E] flex items-center justify-center text-white text-xs font-bold">
              FC
            </div>
            <div>
              <div className="text-sm font-semibold text-[#1D1D1F]">Flow Canvas</div>
              <div className="text-[11px] text-[#B5AFA5]">Concept B</div>
            </div>
          </div>
        </div>

        {/* Client Info */}
        <div className="px-5 py-3 border-b border-[#E8E4DE]">
          <div className="text-[10px] uppercase tracking-wider text-[#B5AFA5] mb-1.5">Client</div>
          <div className="text-sm text-[#1D1D1F] font-medium">Acme Supplements</div>
          <div className="text-xs text-[#B5AFA5] mt-0.5">Week 2 of 6</div>
        </div>

        {/* Step Navigator */}
        <nav className="flex-1 overflow-y-auto py-3">
          <div className="px-5 mb-2">
            <div className="text-[10px] uppercase tracking-wider text-[#B5AFA5]">Process Steps</div>
          </div>
          {processSteps.map((step, i) => (
            <div key={step.id}>
              <button
                onClick={() => {
                  setActiveStep(step.id);
                  setShowOutput(stepStates[step.id] === 'review' || stepStates[step.id] === 'approved');
                  setShowFeedback(false);
                }}
                className={`w-full px-5 py-2.5 flex items-center gap-3 transition-all text-left ${
                  activeStep === step.id
                    ? 'bg-white border-l-2 border-l-[#C45D3E]'
                    : 'hover:bg-white/50 border-l-2 border-l-transparent'
                }`}
              >
                <StepIcon status={stepStates[step.id]} stepId={step.id} />
                <div className="min-w-0">
                  <div className={`text-sm truncate ${
                    activeStep === step.id ? 'text-[#1D1D1F] font-medium' : 'text-[#6B6660]'
                  }`}>
                    {step.shortTitle}
                  </div>
                  {stepStates[step.id] === 'review' && (
                    <div className="text-[10px] text-[#C45D3E]">Awaiting review</div>
                  )}
                  {stepStates[step.id] === 'approved' && (
                    <div className="text-[10px] text-[#7D9B76]">Completed</div>
                  )}
                </div>
              </button>
              {i < processSteps.length - 1 && (
                <div className="ml-[38px] h-4 flex items-center">
                  <div className={`w-px h-full ${
                    stepStates[step.id] === 'approved' ? 'bg-[#7D9B76]' : 'bg-[#E8E4DE]'
                  }`} />
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Progress */}
        <div className="px-5 py-4 border-t border-[#E8E4DE]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#B5AFA5]">Progress</span>
            <span className="text-xs text-[#1D1D1F] font-medium">
              {Object.values(stepStates).filter(s => s === 'approved').length}/6
            </span>
          </div>
          <div className="h-1.5 bg-[#E8E4DE] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#7D9B76] rounded-full transition-all duration-500"
              style={{ width: `${(Object.values(stepStates).filter(s => s === 'approved').length / 6) * 100}%` }}
            />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto h-screen">
        <div className="max-w-3xl mx-auto px-8 py-8">
          {/* Step Header */}
          <motion.div
            key={`header-${activeStep}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{currentStep.icon}</span>
              <span className="text-xs text-[#B5AFA5] uppercase tracking-wider">Step {currentStep.id}</span>
            </div>
            <h1 className="text-3xl text-[#1D1D1F] leading-tight" style={{ fontFamily: 'Instrument Serif' }}>
              {currentStep.title}
            </h1>
          </motion.div>

          {/* Inputs Card */}
          <motion.div
            key={`inputs-${activeStep}`}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl border border-[#E8E4DE] shadow-sm mb-6 overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-[#F0EDE8]">
              <h2 className="text-sm font-semibold text-[#1D1D1F]">Inputs</h2>
              <p className="text-xs text-[#B5AFA5] mt-0.5">
                {currentStep.inputs.filter(i => i.fromPrevious).length > 0
                  ? `${currentStep.inputs.filter(i => i.fromPrevious).length} auto-populated from previous steps`
                  : 'Fill in the required fields to proceed'}
              </p>
            </div>
            <div className="p-6 space-y-5">
              {currentStep.inputs.map((input) => (
                <div key={input.id}>
                  <label className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm text-[#3D3A36]">{input.label}</span>
                    {input.fromPrevious && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F0EDE8] text-[#B5AFA5]">
                        Auto
                      </span>
                    )}
                    {input.required && <span className="text-[#C45D3E] text-xs">*</span>}
                  </label>
                  {input.type === 'textarea' ? (
                    <textarea
                      placeholder={input.placeholder}
                      className="w-full bg-[#FAFAF8] border border-[#E8E4DE] rounded-lg px-4 py-3 text-sm text-[#1D1D1F] placeholder:text-[#C8C3BB] focus:border-[#C45D3E] focus:ring-1 focus:ring-[#C45D3E]/20 focus:outline-none resize-none h-24"
                      defaultValue={input.fromPrevious ? "Auto-populated from previous step" : ""}
                    />
                  ) : input.type === 'file' ? (
                    <div className="w-full bg-[#FAFAF8] border border-dashed border-[#D4CFC7] rounded-lg px-4 py-6 text-center cursor-pointer hover:border-[#C45D3E]/40 transition-colors group">
                      <div className="text-[#C8C3BB] group-hover:text-[#C45D3E]/60 transition-colors">
                        <svg className="w-6 h-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                        </svg>
                        <span className="text-xs">Drop file here or click to browse</span>
                      </div>
                    </div>
                  ) : (
                    <input
                      type={input.type}
                      placeholder={input.placeholder}
                      className="w-full bg-[#FAFAF8] border border-[#E8E4DE] rounded-lg px-4 py-2.5 text-sm text-[#1D1D1F] placeholder:text-[#C8C3BB] focus:border-[#C45D3E] focus:ring-1 focus:ring-[#C45D3E]/20 focus:outline-none"
                      defaultValue={input.fromPrevious ? "Auto-populated" : ""}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Execute */}
            <div className="px-6 py-4 border-t border-[#F0EDE8] bg-[#FDFCFA]">
              <button
                onClick={handleExecute}
                disabled={isProcessing || stepStates[activeStep] === 'approved'}
                className="w-full py-3 bg-[#C45D3E] hover:bg-[#B04E33] text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </>
                ) : stepStates[activeStep] === 'approved' ? (
                  'Step Completed'
                ) : (
                  <>
                    Run Step
                    <span className="text-white/60">→</span>
                  </>
                )}
              </button>
              <p className="text-[11px] text-[#B5AFA5] text-center mt-2">
                {currentStep.aiActions.length} AI actions will be executed in the background
              </p>
            </div>
          </motion.div>

          {/* Results Card */}
          <AnimatePresence mode="wait">
            {isProcessing && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-white rounded-xl border border-[#E8E4DE] shadow-sm p-8"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-[#C45D3E]/10 flex items-center justify-center mb-4">
                    <div className="w-6 h-6 border-2 border-[#C45D3E]/30 border-t-[#C45D3E] rounded-full animate-spin" />
                  </div>
                  <h3 className="text-lg text-[#1D1D1F] mb-1" style={{ fontFamily: 'Instrument Serif' }}>
                    Running AI Pipeline
                  </h3>
                  <p className="text-sm text-[#B5AFA5]">
                    Executing {currentStep.aiActions.length} actions...
                  </p>
                  <div className="mt-4 space-y-1.5 w-full max-w-sm">
                    {currentStep.aiActions.slice(0, 4).map((action, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.4 }}
                        className="flex items-center gap-2 text-xs text-[#8A8478]"
                      >
                        <div className="w-1 h-1 rounded-full bg-[#C45D3E]" />
                        {action}
                      </motion.div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {showOutput && !isProcessing && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {/* Results Header */}
                <div className="bg-white rounded-xl border border-[#E8E4DE] shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#F0EDE8]">
                    <h2 className="text-sm font-semibold text-[#1D1D1F]">Results</h2>
                    <p className="text-xs text-[#B5AFA5] mt-0.5">
                      {currentStep.outputs.length} outputs generated — click to expand
                    </p>
                  </div>
                  <div className="divide-y divide-[#F0EDE8]">
                    {currentStep.outputs.map((output, i) => (
                      <motion.div
                        key={output.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.08 }}
                      >
                        <button
                          onClick={() => toggleOutput(output.id)}
                          className="w-full px-6 py-4 flex items-center justify-between hover:bg-[#FDFCFA] transition-colors text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${
                              output.type === 'document' ? 'bg-[#C45D3E]' :
                              output.type === 'data' ? 'bg-[#D4A843]' :
                              output.type === 'creative' ? 'bg-[#8B6BB5]' :
                              output.type === 'list' ? 'bg-[#7D9B76]' :
                              'bg-[#5B8FB9]'
                            }`} />
                            <div>
                              <div className="text-sm text-[#1D1D1F]">{output.label}</div>
                              <div className="text-xs text-[#B5AFA5]">{output.description}</div>
                            </div>
                          </div>
                          <svg
                            className={`w-4 h-4 text-[#B5AFA5] transition-transform ${expandedOutputs.has(output.id) ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <AnimatePresence>
                          {expandedOutputs.has(output.id) && output.sampleContent && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 pb-4">
                                <pre className="text-xs text-[#6B6660] bg-[#FAFAF8] rounded-lg p-4 whitespace-pre-wrap leading-relaxed border border-[#E8E4DE]" style={{ fontFamily: 'DM Sans' }}>
                                  {output.sampleContent}
                                </pre>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Approval Card */}
                {stepStates[activeStep] === 'review' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-white rounded-xl border-2 border-[#C45D3E]/20 shadow-sm overflow-hidden"
                  >
                    <div className="px-6 py-4 bg-[#C45D3E]/5 border-b border-[#C45D3E]/10">
                      <h3 className="text-sm font-semibold text-[#C45D3E]">Review Required</h3>
                      <p className="text-xs text-[#8A8478] mt-0.5">
                        Review the outputs and approve to continue, or provide feedback for revisions.
                      </p>
                    </div>
                    <div className="p-6">
                      {showFeedback ? (
                        <div className="space-y-3">
                          <textarea
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            placeholder="What changes would you like to see?"
                            className="w-full bg-[#FAFAF8] border border-[#E8E4DE] rounded-lg px-4 py-3 text-sm text-[#1D1D1F] placeholder:text-[#C8C3BB] focus:border-[#C45D3E] focus:outline-none resize-none h-28"
                          />
                          <div className="flex gap-3">
                            <button
                              onClick={() => { setShowFeedback(false); setIsProcessing(true); setShowOutput(false); setTimeout(() => { setIsProcessing(false); setShowOutput(true); setFeedbackText(""); }, 2000); }}
                              className="flex-1 py-2.5 bg-[#C45D3E] hover:bg-[#B04E33] text-white rounded-lg text-sm font-medium transition-colors"
                            >
                              Re-run with Feedback
                            </button>
                            <button
                              onClick={() => setShowFeedback(false)}
                              className="px-4 py-2.5 border border-[#E8E4DE] text-[#8A8478] rounded-lg text-sm hover:bg-[#FAFAF8] transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <button
                            onClick={handleApprove}
                            className="flex-1 py-3 bg-[#7D9B76] hover:bg-[#6B8A65] text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M2 7L5.5 10.5L12 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Approve & Continue
                          </button>
                          <button
                            onClick={() => setShowFeedback(true)}
                            className="flex-1 py-3 border border-[#E8E4DE] text-[#6B6660] rounded-lg font-medium text-sm hover:bg-[#FAFAF8] transition-colors"
                          >
                            Request Changes
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {stepStates[activeStep] === 'approved' && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-[#7D9B76]/10 rounded-xl border border-[#7D9B76]/20 p-5 flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#7D9B76] flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[#3D6B35]">Step Approved</div>
                      <div className="text-xs text-[#7D9B76]">Results have been passed to the next step</div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
