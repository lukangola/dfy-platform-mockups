import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useBrand } from "@/contexts/BrandContext";
import {
  listAdPipelineCards, updateAdPipelineCard, listProducts,
  type AdPipelineCard, type AdPipelineStage, type Product,
} from "@/lib/api";

const COLUMNS: { stage: AdPipelineStage; label: string }[] = [
  { stage: "idea", label: "Idea" },
  { stage: "in_production", label: "In Production" },
  { stage: "ready", label: "Ready" },
];

const STAGE_LABEL: Record<AdPipelineStage, string> = {
  idea: "Idea",
  in_production: "In Production",
  ready: "Ready",
};

/** Concept title for a card — first non-empty of hook / script first line / source copy / copy / caption. */
function cardTitle(card: AdPipelineCard): string {
  const firstLine = (s: string | null | undefined, max = 80): string | null => {
    if (!s) return null;
    const line = s.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
    if (!line) return null;
    return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
  };
  return (
    firstLine(card.brief.hook) ??
    firstLine(card.originalScript) ??
    firstLine(card.brief.sourceCopy) ??
    firstLine(card.brief.copy) ??
    firstLine(card.brief.caption) ??
    "Untitled concept"
  );
}

/** Original advertiser/brand the concept came from. */
function cardBrand(card: AdPipelineCard): string | null {
  return card.brief.advertiserName ?? card.brief.brand?.name ?? null;
}

export default function AdPipelineKanbanAppPage() {
  const { activeBrandId } = useBrand();
  const [, navigate] = useLocation();
  const [cards, setCards] = useState<AdPipelineCard[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  async function refresh() {
    if (!activeBrandId) return;
    const { cards } = await listAdPipelineCards(activeBrandId);
    setCards(cards);
  }

  useEffect(() => {
    if (!activeBrandId) return;
    setLoading(true);
    Promise.all([
      listAdPipelineCards(activeBrandId),
      listProducts(activeBrandId),
    ]).then(([c, p]) => { setCards(c.cards); setProducts(p.products); }).finally(() => setLoading(false));
  }, [activeBrandId]);

  // Poll while any card is still enriching.
  useEffect(() => {
    if (!cards.some((c) => c.bgJobStatus === "pending" || c.bgJobStatus === "running")) return;
    const iv = setInterval(refresh, 2500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const byStage = useMemo(() => {
    const map: Record<AdPipelineStage, AdPipelineCard[]> = { idea: [], in_production: [], ready: [] };
    for (const c of cards) map[c.stage]?.push(c);
    return map;
  }, [cards]);

  const productName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) map.set(p.id, p.name);
    return (id: string) => map.get(id) ?? id;
  }, [products]);

  // Re-derive the open card from the latest list each render so the modal stays live during polling.
  const openCard = useMemo(
    () => (openCardId ? cards.find((c) => c.id === openCardId) ?? null : null),
    [openCardId, cards],
  );

  async function moveCard(card: AdPipelineCard, stage: AdPipelineStage) {
    if (!activeBrandId || card.stage === stage) return;
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, stage } : c)));
    try {
      await updateAdPipelineCard(activeBrandId, card.id, { stage });
    } catch {
      void refresh();
    }
  }

  function recreate(card: AdPipelineCard) {
    // Idea cards have no product/angle yet → send to the app; the user picks there.
    // (For a richer flow, reuse the Ad Console product/angle picker. v1 keeps it simple.)
    const isStatic = card.format === "static";
    const base = isStatic ? "/workspace/apps/static-ads" : "/workspace/apps/copy-engine";
    const params = new URLSearchParams({ pipelineCardId: card.id });
    if (card.productId) params.set(isStatic ? "productId" : "product", card.productId);
    if (card.angleName) params.set("angle", card.angleName);
    if (!isStatic) { params.set("mode", "rewrite"); params.set("source", card.originalScript ?? card.brief.sourceCopy ?? ""); }
    if (isStatic && card.staticReferenceId) params.set("referenceId", card.staticReferenceId);
    navigate(`${base}?${params.toString()}`);
  }

  if (!activeBrandId) return <div className="p-8 text-white/60">Select a brand to view its Ad Pipeline.</div>;

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-white/90 mb-4">Ad Pipeline</h1>
      {loading ? (
        <div className="text-white/50">Loading…</div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {COLUMNS.map((col) => (
            <div
              key={col.stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { const c = cards.find((x) => x.id === dragId); if (c) void moveCard(c, col.stage); setDragId(null); }}
              className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 min-h-[60vh]"
            >
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-white/80">
                {col.label}
                <span className="text-xs text-white/40">{byStage[col.stage].length}</span>
              </div>
              <div className="space-y-3">
                {byStage[col.stage].map((card) => (
                  <PipelineCard
                    key={card.id}
                    card={card}
                    onDragStart={() => setDragId(card.id)}
                    onClick={() => setOpenCardId(card.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {openCard && (
        <CardDetailModal
          card={openCard}
          productName={productName}
          onRecreate={() => recreate(openCard)}
          onClose={() => setOpenCardId(null)}
        />
      )}
    </div>
  );
}

function PipelineCard({ card, onDragStart, onClick }: { card: AdPipelineCard; onDragStart: () => void; onClick: () => void }) {
  const brand = cardBrand(card);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="rounded-lg bg-[#0D0F12] border border-white/10 p-3 space-y-2 cursor-pointer hover:border-white/20 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{card.format}</span>
        {card.bgJobStatus === "running" || card.bgJobStatus === "pending" ? (
          <span className="text-[10px] text-cyan-400">enriching…</span>
        ) : card.bgJobStatus === "failed" ? (
          <span className="text-[10px] text-red-400" title={card.bgJobError ?? ""}>enrich failed</span>
        ) : null}
      </div>

      <p className="text-[13px] font-medium text-white/90 leading-snug line-clamp-2">{cardTitle(card)}</p>

      {brand && (
        <span className="inline-block max-w-full truncate text-[11px] text-white/50 px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.08]">
          {brand}
        </span>
      )}

      {card.output ? (
        card.output.kind === "image" && card.output.imageUrl ? (
          <div className="flex items-center gap-2">
            <img src={card.output.imageUrl} alt="recreated" className="h-8 w-8 rounded object-cover border border-cyan-500/30" />
            <span className="text-[11px] text-cyan-300">✓ Recreated</span>
          </div>
        ) : (
          <span className="inline-block text-[11px] text-cyan-300">
            {card.output.kind === "image" ? "✓ Recreated" : "✓ Draft ready"}
          </span>
        )
      ) : null}
    </div>
  );
}

function CardDetailModal({
  card,
  productName,
  onRecreate,
  onClose,
}: {
  card: AdPipelineCard;
  productName: (id: string) => string;
  onRecreate: () => void;
  onClose: () => void;
}) {
  const brand = cardBrand(card);
  const enriching = card.bgJobStatus === "pending" || card.bgJobStatus === "running";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0D0F12] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.05] text-white/60 border border-white/[0.08]">
                {card.format}
              </span>
              <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.05] text-white/60 border border-white/[0.08]">
                {STAGE_LABEL[card.stage]}
              </span>
              {enriching ? (
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  enriching…
                </span>
              ) : card.bgJobStatus === "failed" ? (
                <span
                  className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20"
                  title={card.bgJobError ?? ""}
                >
                  enrich failed
                </span>
              ) : null}
            </div>
            <h3 className="text-sm font-semibold text-white/90 leading-snug">{cardTitle(card)}</h3>
            {brand && <p className="text-[12px] text-white/55 truncate">{brand}</p>}
            {card.bgJobStatus === "failed" && card.bgJobError && (
              <p className="text-[11px] text-red-300/80 leading-relaxed">{card.bgJobError}</p>
            )}
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none -mt-0.5">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Original reference link */}
          {card.sourceUrl && (
            <a
              href={card.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-cyan-400 hover:underline"
            >
              Original reference ↗
            </a>
          )}

          {/* Original script / transcript (or reference image for static) */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-1.5">
              Original {card.format === "static" ? "reference" : "script"}
            </p>
            {card.originalScript ? (
              <p className="text-[12px] text-white/70 leading-relaxed whitespace-pre-wrap">{card.originalScript}</p>
            ) : card.format === "static" && card.referenceImageUrl ? (
              <img src={card.referenceImageUrl} alt="reference" className="w-full rounded-md border border-white/10" />
            ) : enriching ? (
              <p className="text-[12px] text-white/40 italic">Transcribing…</p>
            ) : (
              <p className="text-[12px] text-white/40 italic">No script available.</p>
            )}
          </div>

          {/* Rewritten script / recreated output */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-1.5">
              {card.output?.kind === "image" ? "Recreated output" : "Rewritten script"}
              {card.output && card.output.kind === "text" && (
                <span className="ml-1 text-white/25 lowercase">
                  {card.output.source === "asset" ? "(saved)" : "(draft)"}
                </span>
              )}
            </p>
            {card.output ? (
              card.output.kind === "image" && card.output.imageUrl ? (
                <img src={card.output.imageUrl} alt="recreated" className="w-full rounded-md border border-cyan-500/30" />
              ) : card.output.text ? (
                <p className="text-[12px] text-white/80 leading-relaxed whitespace-pre-wrap border-l-2 border-cyan-500/40 pl-3">
                  {card.output.text}
                </p>
              ) : (
                <p className="text-[12px] text-white/40 italic">No output yet.</p>
              )
            ) : (
              <p className="text-[12px] text-white/40 italic">No output yet.</p>
            )}
          </div>

          {/* Inputs the user gave */}
          {(card.productId || card.angleName || card.language) && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-1.5">Inputs</p>
              <dl className="space-y-1 text-[12px]">
                {card.productId && (
                  <div className="flex gap-2">
                    <dt className="text-white/40 w-20 shrink-0">Product</dt>
                    <dd className="text-white/70">{productName(card.productId)}</dd>
                  </div>
                )}
                {card.angleName && (
                  <div className="flex gap-2">
                    <dt className="text-white/40 w-20 shrink-0">Angle</dt>
                    <dd className="text-white/70">{card.angleName}</dd>
                  </div>
                )}
                {card.language && (
                  <div className="flex gap-2">
                    <dt className="text-white/40 w-20 shrink-0">Language</dt>
                    <dd className="text-white/70">{card.language}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Recreate (only when no output yet) */}
          {!card.output && (
            <button
              onClick={onRecreate}
              className="w-full rounded-md bg-cyan-500 py-2 text-xs font-semibold text-black hover:bg-cyan-400 transition-colors"
            >
              Recreate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
