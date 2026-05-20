/**
 * Public documentation page for the Character B-Roll app.
 *
 * No auth required — sits at /docs/character-broll on app.inana.ai so
 * anyone with the link can scroll through the app's walkthrough without
 * signing in. Designed as a "scroll once, get it" reference: short copy
 * + screenshot placeholders for each step, plus a brief mini-glossary
 * at the bottom.
 *
 * Screenshots are loaded from /docs-screenshots/character-broll/<step>.png
 * — drop real captures into client/public/docs-screenshots/character-broll/
 * and they'll replace the dashed-border placeholders without code changes.
 */
import { Link } from "wouter";
import {
  ArrowLeft, Check, Film, Image as ImageIcon, MessageSquare, Package,
  Sparkles, User, Video,
} from "lucide-react";

/**
 * Image with a graceful placeholder fallback. If the file under
 * /public/docs-screenshots/... doesn't exist yet, the dashed box with
 * the caption renders instead, so the docs page is never broken just
 * because a screenshot hasn't been captured yet.
 */
function StepShot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="my-4">
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        <img
          src={src}
          alt={alt}
          className="w-full block"
          onError={(e) => {
            // Hide the broken img and show the placeholder sibling
            const img = e.currentTarget;
            img.style.display = "none";
            const ph = img.nextElementSibling as HTMLDivElement | null;
            if (ph) ph.style.display = "flex";
          }}
        />
        <div
          className="aspect-[16/9] hidden flex-col items-center justify-center text-center px-6 border-2 border-dashed border-white/[0.1] bg-white/[0.015]"
          style={{ display: "none" }}
        >
          <ImageIcon size={28} className="text-white/20 mb-2" />
          <div className="text-[11px] font-mono text-white/40 uppercase tracking-widest mb-1">
            Screenshot placeholder
          </div>
          <div className="text-[12px] text-white/50 max-w-md leading-relaxed">{caption}</div>
          <div className="text-[10px] font-mono text-white/25 mt-3">{src}</div>
        </div>
      </div>
      <figcaption className="text-[11px] text-white/40 font-mono leading-relaxed mt-2 px-1">{caption}</figcaption>
    </figure>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider text-cyan-300 bg-cyan-500/10 border border-cyan-500/25 mx-0.5 whitespace-nowrap">
      {children}
    </span>
  );
}

function StepHeader({ n, label, icon: Icon }: { n: number; label: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-3 mb-3 mt-10">
      <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center shrink-0">
        <Icon size={18} className="text-cyan-300" />
      </div>
      <div>
        <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-widest">Step {n}</div>
        <h2 className="text-xl font-semibold text-white/95">{label}</h2>
      </div>
    </div>
  );
}

export default function CharacterBrollDocsPage() {
  return (
    <div className="min-h-screen text-white/85" style={{ background: "#0A0B0E" }}>
      {/* Top bar */}
      <div className="border-b border-white/[0.06]" style={{ background: "#0D0F12" }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
              <Sparkles size={13} className="text-cyan-300" />
            </div>
            <div>
              <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Inana · Docs</div>
              <div className="text-sm font-medium text-white/90">Character B-Roll</div>
            </div>
          </div>
          <Link href="/docs">
            <a className="text-[11px] font-mono text-white/40 hover:text-white/80 transition flex items-center gap-1.5">
              <ArrowLeft size={11} /> All apps
            </a>
          </Link>
        </div>
      </div>

      <article className="max-w-3xl mx-auto px-6 py-10">
        {/* Intro */}
        <div className="mb-10">
          <h1 className="text-3xl font-semibold text-white/95 leading-tight mb-3">
            UGC-style B-roll without the UGC creator
          </h1>
          <p className="text-[15px] text-white/65 leading-relaxed mb-4">
            Character B-Roll generates a full sequence of cinematic shots and short videos
            featuring the same character across every scene — same face, same outfit, different
            angles. You give it one image of your character + a product + either a strategic angle
            or a script, and it walks itself through shot-list → images → videos. ~10 minutes
            end-to-end for a 10-shot sequence.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            {[
              { label: "1 character image in", icon: User },
              { label: "Engine-written shot list", icon: MessageSquare },
              { label: "~10 cinematic images", icon: ImageIcon },
              { label: "~10 vertical videos out", icon: Video },
            ].map((b) => {
              const I = b.icon;
              return (
                <div key={b.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 flex items-center gap-2">
                  <I size={13} className="text-cyan-400 shrink-0" />
                  <span className="text-[11px] text-white/60 font-mono leading-tight">{b.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* What you need */}
        <section className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5 mb-2">
          <h3 className="text-[11px] font-mono text-white/40 uppercase tracking-widest mb-3">Before you start</h3>
          <ul className="space-y-2 text-[13px] text-white/70">
            <li className="flex items-start gap-2"><Check size={13} className="text-emerald-400 mt-0.5 shrink-0" /> A product with completed research (set up on the <em>Products</em> tab — strategic diagnosis + a handful of strategic angles).</li>
            <li className="flex items-start gap-2"><Check size={13} className="text-emerald-400 mt-0.5 shrink-0" /> One clean image of the character you want to feature (head + shoulders or half-body, plain background ideal).</li>
            <li className="flex items-start gap-2"><Check size={13} className="text-emerald-400 mt-0.5 shrink-0" /> Either a chosen <strong>strategic angle</strong>, or a short <strong>script / VO outline</strong> if you already know what the character should say.</li>
          </ul>
        </section>

        {/* ─────────── Step 0 ─────────── */}
        <StepHeader n={1} label="Set up the shoot" icon={Package} />
        <p className="text-[14px] text-white/70 leading-relaxed mb-2">
          Open the workspace's <Pill>App Suite</Pill> and pick <Pill>Character B-Roll</Pill>.
          Configure four things:
        </p>
        <ol className="list-decimal pl-5 space-y-2 text-[14px] text-white/70 leading-relaxed mb-1">
          <li><strong>Product</strong> — pick from your researched product library. The product's research is what the shot-list architect grounds its scenes in.</li>
          <li><strong>Character</strong> — upload a new image, or pick from your saved characters. Inana will preserve this face / outfit across every shot.</li>
          <li>
            <strong>Input mode</strong> — choose one:
            <ul className="list-disc pl-5 mt-1 text-[13px] text-white/60 space-y-1">
              <li><Pill>Angle</Pill> — the shot-list architect writes scenes around a strategic angle (best when you're testing a new angle from scratch).</li>
              <li><Pill>Script</Pill> — paste a VO / dialogue line per beat (best when you already know exactly what the character says and just need visuals).</li>
            </ul>
          </li>
          <li><strong>Asset limits</strong> — how many shots (typically 8–12) and whether to render videos for all approved images or just a subset.</li>
        </ol>
        <StepShot
          src="/docs-screenshots/character-broll/01-setup.png"
          alt="Setup view of the Character B-Roll app"
          caption="Step 1 — Setup view. Product + character + input mode + asset limits, all on one screen. Click 'Generate Shot List' to advance."
        />

        {/* ─────────── Step 1 ─────────── */}
        <StepHeader n={2} label="Review the shot list" icon={MessageSquare} />
        <p className="text-[14px] text-white/70 leading-relaxed mb-2">
          The architect emits ~10 shots, grouped into seven categories so the sequence reads
          like a real ad: <em>Hook → Problem → Failed Solution → Product → Authority →
          Emotional Payoff → Lifestyle</em>. Each shot has a title, a 1-line visual
          description, a location, and (in script mode) the quoted VO line.
        </p>
        <p className="text-[14px] text-white/70 leading-relaxed mb-2">
          You can edit any field inline, delete a shot, or add your own with the
          <Pill>+ Add shot</Pill> button (you pick a category, then write the description
          yourself). When the list looks right, click <Pill>Approve & Generate Images</Pill>.
        </p>
        <StepShot
          src="/docs-screenshots/character-broll/02-shot-list.png"
          alt="Shot list editor with seven coloured category groups"
          caption="Step 2 — Shot list. Each card belongs to one of seven coloured categories. Every field is editable; the architect's output is a starting point, not a contract."
        />

        {/* ─────────── Step 2 ─────────── */}
        <StepHeader n={3} label="Generate images" icon={ImageIcon} />
        <p className="text-[14px] text-white/70 leading-relaxed mb-2">
          Image generation auto-fires as soon as you land on this step. Every shot
          renders in parallel; each tile shows its category pill on the upper-left and
          a status (generating / ready / failed). The model used is <Pill>fal-ai/nano-banana-pro/edit</Pill>,
          fed the character reference image plus the shot's description so the
          identity stays consistent across the whole sequence.
        </p>
        <p className="text-[14px] text-white/70 leading-relaxed mb-2">
          For each image you can:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-[14px] text-white/70 leading-relaxed mb-1">
          <li><Pill>Approve</Pill> — locks the image as the source for the video step.</li>
          <li><Pill>Regenerate</Pill> — re-rolls with the exact same prompt (use this when the model just got unlucky).</li>
          <li><Pill>Feedback</Pill> — type a short note ("make the character smile", "show the product label more clearly") and re-roll with the correction layered on top.</li>
        </ul>
        <p className="text-[14px] text-white/70 leading-relaxed mb-1">
          Click <Pill>Generate Videos</Pill> in the header once you're happy with all images.
        </p>
        <StepShot
          src="/docs-screenshots/character-broll/03-images.png"
          alt="Image grid with category badges and approve/regenerate/feedback controls"
          caption="Step 3 — Images. Tiles render in parallel; identity stays consistent across all shots because they all share the same character reference."
        />

        {/* ─────────── Step 3 ─────────── */}
        <StepHeader n={4} label="Render videos" icon={Film} />
        <p className="text-[14px] text-white/70 leading-relaxed mb-2">
          Video generation auto-fires for every approved image. Each clip is a 5-second
          9:16 vertical render — straight to Meta / TikTok aspect ratio, no further
          editing required. The model is <Pill>fal-ai/kling-video/v3/pro</Pill>, fed the
          approved still as the first frame plus a short motion prompt derived from the
          shot's description.
        </p>
        <p className="text-[14px] text-white/70 leading-relaxed mb-2">
          The same approve / regenerate / feedback controls apply per video. Approved videos
          are downloadable from the tile (single MP4) or as a batch from the header.
        </p>
        <StepShot
          src="/docs-screenshots/character-broll/04-videos.png"
          alt="Video grid showing inline playback + download/approve buttons"
          caption="Step 4 — Videos. 5-second 9:16 vertical clips, Meta/TikTok-ready, download individually or batch."
        />

        {/* What you end up with — five real Kling-rendered shots
            from an actual Alcami Elements run, one per category. The
            full reel was 21 shots; these five are the narrative spine
            (problem → failed solution → product → payoff → lifestyle).
            Videos are served from fal.media (the same CDN our pipeline
            uploads to); they're public so no auth required. preload
            "metadata" keeps the page lightweight until the visitor
            actually plays one. */}
        <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-5 mt-12">
          <h3 className="text-[11px] font-mono text-emerald-400/80 uppercase tracking-widest mb-3">
            Sample output — 5 shots from a real Alcami Elements run
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              {
                cat: "Problem",
                color: "#F87171",
                title: "Edge-of-bed, hand on chest",
                videoUrl:
                  "https://v3b.fal.media/files/b/0a9868af/8sn1kG9szgkcULpqydt3a_output.mp4",
                poster:
                  "https://v3b.fal.media/files/b/0a98689b/FqUh5CTK6DFXcG0p6UnFg_S2HYhk9D.jpg",
              },
              {
                cat: "Failed Solution",
                color: "#FB923C",
                title: "Pouring wine, staring flat",
                videoUrl:
                  "https://v3b.fal.media/files/b/0a9868b1/3HDVE6F-I_d35GLSqa3Th_output.mp4",
                poster:
                  "https://v3b.fal.media/files/b/0a98689b/MDZOOXlyiggCsPqwc_Mmt_DzyHLLSC.jpg",
              },
              {
                cat: "Product",
                color: "#00D4FF",
                title: "Unboxing the pouch",
                videoUrl:
                  "https://v3b.fal.media/files/b/0a9868b0/BqLLk52Uu3xNi2WhXQz1c_output.mp4",
                poster:
                  "https://v3b.fal.media/files/b/0a98689b/TTuk49-gdk4ARFbvuJRfi_pDoSGI8S.jpg",
              },
              {
                cat: "Payoff",
                color: "#34D399",
                title: "Curled on the couch, shoulders drop",
                videoUrl:
                  "https://v3b.fal.media/files/b/0a9868b0/A8MKOIlCPkMYfkzw4WmYH_output.mp4",
                poster:
                  "https://v3b.fal.media/files/b/0a98689b/Kh1tiTtImtRt2fhIhzEyI_bLd3iPIg.jpg",
              },
              {
                cat: "Lifestyle",
                color: "#FBBF24",
                title: "Window bench, mug, morning sky",
                videoUrl:
                  "https://v3b.fal.media/files/b/0a986962/zDQGh9O14hpCS3KkJiXqh_output.mp4",
                poster:
                  "https://v3b.fal.media/files/b/0a986925/OyTVrxfuVuWgjosLXRqg2_84Iygwi0.jpg",
              },
            ].map((c) => (
              <figure key={c.cat} className="rounded-md border border-white/[0.08] bg-black overflow-hidden relative">
                <video
                  src={c.videoUrl}
                  poster={c.poster}
                  controls
                  preload="metadata"
                  playsInline
                  muted
                  className="w-full aspect-[9/16] object-cover block bg-black"
                />
                <div className="absolute top-1.5 left-1.5 pointer-events-none">
                  <div
                    className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded backdrop-blur-sm"
                    style={{ color: c.color, background: "rgba(0,0,0,0.55)", border: `1px solid ${c.color}55` }}
                  >
                    {c.cat}
                  </div>
                </div>
                <figcaption className="text-[10px] text-white/55 font-mono leading-snug px-2 py-2 border-t border-white/[0.06]">
                  {c.title}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="text-[12px] text-white/55 leading-relaxed mt-4">
            All five videos came from a single Character B-Roll run on the Alcami Elements
            brand — same character, same product, different shot categories. Press play
            on any tile to watch the raw 9:16 5-second Kling output, exactly as it lands
            in your Asset Library.
          </p>
        </section>

        {/* Tips */}
        <section className="mt-12">
          <h3 className="text-[11px] font-mono text-white/40 uppercase tracking-widest mb-3">Tips</h3>
          <ul className="space-y-2.5 text-[13px] text-white/65 leading-relaxed">
            <li>
              <strong className="text-white/85">One character image is enough</strong> —
              a clean front-on portrait at 1024px+ gives the best identity preservation.
              Avoid heavy sunglasses, hats, or odd lighting in the reference.
            </li>
            <li>
              <strong className="text-white/85">Edit the shot list before you click "Approve"</strong> —
              changing a description there costs nothing. Re-rolling an already-generated image
              costs an extra render.
            </li>
            <li>
              <strong className="text-white/85">Feedback beats regenerate</strong> for fixing
              specific issues. "Make the bottle bigger and centered" lands faster than rolling
              the dice 5 more times.
            </li>
            <li>
              <strong className="text-white/85">Approved assets land in your Asset Library</strong>
              under the product they belong to, filterable by source app and angle.
            </li>
          </ul>
        </section>

        {/* Mini-glossary */}
        <section className="mt-12 pb-12 border-t border-white/[0.06] pt-8">
          <h3 className="text-[11px] font-mono text-white/40 uppercase tracking-widest mb-3">Glossary</h3>
          <dl className="space-y-2 text-[13px] text-white/65">
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <dt className="text-white/40 font-mono text-[12px]">Strategic angle</dt>
              <dd>A specific marketing hook for the product, generated during product research (e.g. "pain-free mornings without painkillers").</dd>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <dt className="text-white/40 font-mono text-[12px]">Shot category</dt>
              <dd>One of seven slots in the architect's output — Hook, Problem, Failed Solution, Product, Authority, Payoff, Lifestyle. Each colour-coded.</dd>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <dt className="text-white/40 font-mono text-[12px]">Identity preservation</dt>
              <dd>The character's face/outfit staying consistent across every shot. Driven by the single character reference image you upload at setup.</dd>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <dt className="text-white/40 font-mono text-[12px]">Script mode</dt>
              <dd>Alternative to Angle mode — you supply the VO/dialogue line per beat and the architect builds visuals around those lines.</dd>
            </div>
          </dl>
        </section>
      </article>

      <footer className="border-t border-white/[0.06] py-6 text-center">
        <div className="text-[11px] font-mono text-white/30">
          Inana · <Link href="/docs"><a className="hover:text-white/60 transition">Docs index</a></Link> · <a href="https://app.inana.ai" className="hover:text-white/60 transition">app.inana.ai</a>
        </div>
      </footer>
    </div>
  );
}
