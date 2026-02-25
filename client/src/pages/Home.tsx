import { Link } from "wouter";
import { motion } from "framer-motion";

const concepts = [
  {
    id: "a",
    title: "Command Center",
    subtitle: "Mission Control Dashboard",
    description: "Dark, information-dense operations dashboard inspired by NASA Mission Control and Bloomberg terminals. Horizontal pipeline, terminal-style outputs, neon accents.",
    path: "/concept-a",
    gradient: "from-[#1A1A2E] to-[#0D0D1A]",
    accent: "#00D4FF",
    accentName: "Cyan",
    tags: ["Dark Mode", "Data-Dense", "Neo-Brutalist"],
  },
  {
    id: "b",
    title: "Flow Canvas",
    subtitle: "Notion-Inspired Workflow Studio",
    description: "Warm, minimalist workflow studio with sidebar navigation, card-based content, and progressive disclosure. Calm, focused, tool-like but beautiful.",
    path: "/concept-b",
    gradient: "from-[#FAFAF8] to-[#F0EDE8]",
    accent: "#C45D3E",
    accentName: "Terracotta",
    tags: ["Light Mode", "Minimal", "Scandinavian"],
  },
  {
    id: "c",
    title: "Pipeline Theater",
    subtitle: "Cinematic Step-by-Step Journey",
    description: "Full-screen immersive experience where each step takes center stage. Gradient-coded stages, dramatic transitions, theatrical reveal animations.",
    path: "/concept-c",
    gradient: "from-[#0F172A] to-[#1E293B]",
    accent: "#38BDF8",
    accentName: "Sky Blue",
    tags: ["Dark Mode", "Cinematic", "Editorial"],
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-8 py-5">
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
            v0.1 — Mockup Preview
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="px-8 pt-20 pb-16">
        <div className="max-w-7xl mx-auto">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-sm text-cyan-400 tracking-widest uppercase mb-4"
            style={{ fontFamily: 'JetBrains Mono' }}
          >
            Done-For-You Playbook Execution Platform
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl font-bold leading-tight mb-6 max-w-3xl"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            Three UI Concepts for Your
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
              Workflow Platform
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg text-white/50 max-w-2xl leading-relaxed"
            style={{ fontFamily: 'DM Sans' }}
          >
            Each concept demonstrates how an employee would navigate the 6-step DFY process — from initial setup through research, testing, creative production, and analysis — with AI execution and approval gates at every stage.
          </motion.p>
        </div>
      </section>

      {/* Concept Cards */}
      <section className="px-8 pb-24">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {concepts.map((concept, i) => (
            <motion.div
              key={concept.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 + i * 0.15 }}
            >
              <Link href={concept.path}>
                <div className="group relative border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-all duration-300 overflow-hidden cursor-pointer h-full">
                  {/* Preview gradient bar */}
                  <div className={`h-48 bg-gradient-to-br ${concept.gradient} relative overflow-hidden`}>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className="text-6xl font-bold opacity-20 group-hover:opacity-30 transition-opacity"
                        style={{ fontFamily: 'Space Grotesk', color: concept.accent }}
                      >
                        {concept.id.toUpperCase()}
                      </div>
                    </div>
                    {/* Accent line */}
                    <div
                      className="absolute bottom-0 left-0 right-0 h-1 opacity-80 group-hover:opacity-100 transition-opacity"
                      style={{ backgroundColor: concept.accent }}
                    />
                  </div>

                  {/* Content */}
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-2 h-2"
                        style={{ backgroundColor: concept.accent }}
                      />
                      <span
                        className="text-xs tracking-wider uppercase text-white/40"
                        style={{ fontFamily: 'JetBrains Mono' }}
                      >
                        Concept {concept.id.toUpperCase()}
                      </span>
                    </div>

                    <h2
                      className="text-2xl font-bold text-white mb-1"
                      style={{ fontFamily: 'Space Grotesk' }}
                    >
                      {concept.title}
                    </h2>
                    <p
                      className="text-sm mb-4"
                      style={{ fontFamily: 'DM Sans', color: concept.accent }}
                    >
                      {concept.subtitle}
                    </p>
                    <p
                      className="text-sm text-white/50 leading-relaxed mb-5"
                      style={{ fontFamily: 'DM Sans' }}
                    >
                      {concept.description}
                    </p>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-2 mb-5">
                      {concept.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] tracking-wider uppercase px-2 py-1 border border-white/10 text-white/40"
                          style={{ fontFamily: 'JetBrains Mono' }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* CTA */}
                    <div className="flex items-center gap-2 text-sm font-medium group-hover:gap-3 transition-all" style={{ color: concept.accent, fontFamily: 'Space Grotesk' }}>
                      View Mockup
                      <span className="text-lg">→</span>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Process Overview */}
      <section className="px-8 pb-20 border-t border-white/10 pt-16">
        <div className="max-w-7xl mx-auto">
          <h3
            className="text-xs tracking-widest uppercase text-white/30 mb-8"
            style={{ fontFamily: 'JetBrains Mono' }}
          >
            The 6-Step Process Each Concept Implements
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { step: 0, label: "Infrastructure", icon: "⚙️" },
              { step: 1, label: "Research", icon: "🔍" },
              { step: 2, label: "Message Testing", icon: "💬" },
              { step: 3, label: "Creative Production", icon: "🎨" },
              { step: 4, label: "Listicle", icon: "📋" },
              { step: 5, label: "Analysis", icon: "📊" },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.6 + i * 0.08 }}
                className="border border-white/10 p-4 bg-white/[0.02]"
              >
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="text-[10px] text-white/30 mb-1" style={{ fontFamily: 'JetBrains Mono' }}>
                  STEP {item.step}
                </div>
                <div className="text-sm text-white/70" style={{ fontFamily: 'Space Grotesk' }}>
                  {item.label}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
