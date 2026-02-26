import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Monitor, Paintbrush, Zap } from "lucide-react";

const variants = [
  {
    title: "Studio Control Room",
    subtitle: "Broadcast-Ästhetik",
    description: "Dunkles, professionelles Interface inspiriert von Film-Post-Production-Tools. Panel-basierte Architektur mit Filmstrip-Navigation und Terminal-Style Chat.",
    href: "/studio",
    icon: Monitor,
    gradient: "from-slate-900 via-cyan-950 to-slate-900",
    accent: "#00D4FF",
    tags: ["Dark Mode", "Panel Layout", "Keyboard-First"],
  },
  {
    title: "Clean Canvas",
    subtitle: "Editorial Whitespace",
    description: "Minimalistisch wie ein Apple-Produktkatalog. Warmes Off-White, großzügiger Weißraum, asymmetrisches Magazine-Grid mit Serifenschrift für Headlines.",
    href: "/canvas",
    icon: Paintbrush,
    gradient: "from-stone-100 via-indigo-50 to-stone-100",
    accent: "#4338CA",
    tags: ["Light Mode", "Editorial", "Serif Typography"],
  },
  {
    title: "Neon Forge",
    subtitle: "Cyberpunk Production Lab",
    description: "Futuristisches Lab-Gefühl mit Neon-Akzenten. Jeder Shot-Typ hat seine eigene Neon-Farbe. Glassmorphism und Glow-Effekte mit Pipeline-Visualizer.",
    href: "/neon",
    icon: Zap,
    gradient: "from-black via-purple-950 to-black",
    accent: "#FF2D8A",
    tags: ["Dark Mode", "Neon", "Gamified"],
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white overflow-hidden">
      {/* Subtle grid background */}
      <div
        className="fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10">
        {/* Header */}
        <header className="pt-16 pb-12 px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-6xl mx-auto"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>BR</span>
              </div>
              <span className="text-white/40 text-sm tracking-widest uppercase" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                Design Mockups
              </span>
            </div>
            <h1
              className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05]"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              B-Roll Tool
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-pink-400">
                UI Concepts
              </span>
            </h1>
            <p className="mt-6 text-lg text-white/50 max-w-2xl leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Drei unterschiedliche Design-Ansätze für ein KI-gestütztes B-Roll-Generierungstool.
              Von der Produktbild-Eingabe über Shot-Generierung und Review bis zur Video-Produktion.
            </p>
          </motion.div>
        </header>

        {/* Variant Cards */}
        <main className="px-8 pb-24">
          <div className="max-w-6xl mx-auto grid gap-8">
            {variants.map((v, i) => (
              <motion.div
                key={v.href}
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 + i * 0.15 }}
              >
                <Link href={v.href}>
                  <div className="group relative rounded-2xl overflow-hidden border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-500 cursor-pointer">
                    {/* Gradient overlay */}
                    <div className={`absolute inset-0 bg-gradient-to-r ${v.gradient} opacity-30 group-hover:opacity-50 transition-opacity duration-500`} />

                    <div className="relative z-10 p-8 md:p-12 flex flex-col md:flex-row items-start md:items-center gap-8">
                      {/* Icon */}
                      <div
                        className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0 border border-white/10"
                        style={{ backgroundColor: `${v.accent}15` }}
                      >
                        <v.icon size={28} style={{ color: v.accent }} />
                      </div>

                      {/* Content */}
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h2
                            className="text-2xl md:text-3xl font-bold text-white"
                            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                          >
                            {v.title}
                          </h2>
                          <span
                            className="text-xs px-3 py-1 rounded-full border"
                            style={{
                              color: v.accent,
                              borderColor: `${v.accent}40`,
                              backgroundColor: `${v.accent}10`,
                              fontFamily: "'JetBrains Mono', monospace",
                            }}
                          >
                            {v.subtitle}
                          </span>
                        </div>
                        <p className="text-white/40 leading-relaxed max-w-xl" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                          {v.description}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-4">
                          {v.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-xs px-2.5 py-1 rounded-md bg-white/5 text-white/30 border border-white/[0.06]"
                              style={{ fontFamily: "'JetBrains Mono', monospace" }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="shrink-0 w-12 h-12 rounded-full border border-white/10 flex items-center justify-center group-hover:border-white/20 group-hover:bg-white/5 transition-all duration-300">
                        <ArrowRight size={20} className="text-white/40 group-hover:text-white/80 group-hover:translate-x-0.5 transition-all duration-300" />
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Workflow description */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="max-w-6xl mx-auto mt-16"
          >
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
              <h3
                className="text-sm text-white/30 uppercase tracking-widest mb-6"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                Workflow
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { step: "01", label: "Input", desc: "Produktbild & Zielgruppe" },
                  { step: "02", label: "Generate", desc: "KI-Shot-Generierung" },
                  { step: "03", label: "Review", desc: "Feedback & Re-Prompt" },
                  { step: "04", label: "Approve", desc: "Shots genehmigen" },
                  { step: "05", label: "Video", desc: "Video-Generierung" },
                ].map((item) => (
                  <div key={item.step} className="text-center">
                    <div
                      className="text-3xl font-bold text-white/10 mb-2"
                      style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                    >
                      {item.step}
                    </div>
                    <div className="text-sm font-medium text-white/60" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                      {item.label}
                    </div>
                    <div className="text-xs text-white/25 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                      {item.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
