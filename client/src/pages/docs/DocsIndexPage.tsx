/**
 * Public docs index. Links to the per-app walkthroughs. Lives at /docs
 * (no auth gate), so it's shareable with anyone who needs a tour without
 * needing them to be inside the workspace.
 *
 * Right now only Character B-Roll has a full walkthrough — the other
 * apps are listed as "coming soon" so the URL is forward-compatible
 * once we author the rest.
 */
import { Link } from "wouter";
import {
  Sparkles, User, Wand2, ImagePlus, Type, MessageSquare,
  Video, Copy, FileText, ArrowRight,
} from "lucide-react";

type Entry = {
  slug: string;
  name: string;
  blurb: string;
  icon: React.ElementType;
  status: "live" | "soon";
};

const ENTRIES: Entry[] = [
  {
    slug: "character-broll",
    name: "Character B-Roll",
    blurb: "UGC-style B-roll with identity preserved across every shot. One character image in, ~10 vertical videos out.",
    icon: User,
    status: "live",
  },
  {
    slug: "listicle-builder",
    name: "Listicle Builder",
    blurb: "Long-form advertorial landing page end-to-end: copy → images → LanderLab deploy in one click.",
    icon: FileText,
    status: "soon",
  },
  {
    slug: "broll",
    name: "Product B-Roll Generator",
    blurb: "Product-only cinematic B-roll. Twelve curated shot types — unboxing, hero, texture, application, proof.",
    icon: Video,
    status: "soon",
  },
  {
    slug: "single-scene",
    name: "Single Scene Generator",
    blurb: "Skip the shot-list step. Type the scene, get image + video. Same NBP/Kling pipeline as Character B-Roll.",
    icon: Wand2,
    status: "soon",
  },
  {
    slug: "static-ads",
    name: "Static Ads Recreator",
    blurb: "Recreate competitor statics or library references with your product, your brand colors, your fonts.",
    icon: ImagePlus,
    status: "soon",
  },
  {
    slug: "static-ads-iterations",
    name: "Static Ads Iterations",
    blurb: "Turn one winning static into ten headline variations. Test the headline, not the visual.",
    icon: Type,
    status: "soon",
  },
  {
    slug: "message-testing",
    name: "Message Testing Ads",
    blurb: "Generate 50+ message-testing creatives across every research angle in one batch.",
    icon: MessageSquare,
    status: "soon",
  },
  {
    slug: "copy-engine",
    name: "Copy Engine",
    blurb: "Listicle-style advertorial copy in your brand voice, aligned to a chosen strategic angle.",
    icon: Copy,
    status: "soon",
  },
];

export default function DocsIndexPage() {
  return (
    <div className="min-h-screen text-white/85" style={{ background: "#0A0B0E" }}>
      <div className="border-b border-white/[0.06]" style={{ background: "#0D0F12" }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
            <Sparkles size={13} className="text-cyan-300" />
          </div>
          <div>
            <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Inana</div>
            <div className="text-sm font-medium text-white/90">Documentation</div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-semibold text-white/95 leading-tight mb-3">
          App walkthroughs
        </h1>
        <p className="text-[15px] text-white/65 leading-relaxed mb-10">
          Scroll-once references for every app in the Inana workspace. No login required.
          Each walkthrough shows the step-by-step flow with screenshots so you can decide
          if the app fits a workflow before opening it.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ENTRIES.map((e) => {
            const Icon = e.icon;
            const live = e.status === "live";
            const card = (
              <div
                className={`rounded-lg border p-5 transition-all h-full ${
                  live
                    ? "border-white/[0.08] bg-white/[0.02] hover:border-cyan-500/40 hover:bg-white/[0.04] cursor-pointer"
                    : "border-white/[0.05] bg-white/[0.015] opacity-60"
                }`}
              >
                <div className="flex items-start gap-3 mb-2">
                  <div className={`w-9 h-9 rounded flex items-center justify-center shrink-0 ${
                    live ? "bg-cyan-500/15 border border-cyan-500/30" : "bg-white/[0.03] border border-white/[0.05]"
                  }`}>
                    <Icon size={16} className={live ? "text-cyan-400" : "text-white/40"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-white/90 font-medium">{e.name}</span>
                      {!live && (
                        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded text-white/40 bg-white/[0.04] border border-white/[0.08]">
                          Coming
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-[12px] text-white/55 leading-relaxed">{e.blurb}</p>
                {live && (
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-cyan-400 mt-3 uppercase tracking-wider">
                    Read walkthrough <ArrowRight size={11} />
                  </div>
                )}
              </div>
            );
            return live ? (
              <Link key={e.slug} href={`/docs/${e.slug}`}>
                <a className="block">{card}</a>
              </Link>
            ) : (
              <div key={e.slug}>{card}</div>
            );
          })}
        </div>
      </div>

      <footer className="border-t border-white/[0.06] py-6 text-center">
        <div className="text-[11px] font-mono text-white/30">
          Inana · <a href="https://app.inana.ai" className="hover:text-white/60 transition">app.inana.ai</a>
        </div>
      </footer>
    </div>
  );
}
