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

export default function AdPipelineKanbanAppPage() {
  const { activeBrandId } = useBrand();
  const [, navigate] = useLocation();
  const [cards, setCards] = useState<AdPipelineCard[]>([]);
  const [, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);

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
                  <PipelineCard key={card.id} card={card} onDragStart={() => setDragId(card.id)} onRecreate={() => recreate(card)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineCard({ card, onDragStart, onRecreate }: { card: AdPipelineCard; onDragStart: () => void; onRecreate: () => void }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="rounded-lg bg-[#0D0F12] border border-white/10 p-3 space-y-2 cursor-grab"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{card.format}</span>
        {card.bgJobStatus === "running" || card.bgJobStatus === "pending" ? (
          <span className="text-[10px] text-cyan-400">enriching…</span>
        ) : card.bgJobStatus === "failed" ? (
          <span className="text-[10px] text-red-400" title={card.bgJobError ?? ""}>enrich failed</span>
        ) : null}
      </div>

      {card.sourceUrl && (
        <a href={card.sourceUrl} target="_blank" rel="noreferrer" className="block text-xs text-cyan-400 hover:underline truncate">
          Original reference ↗
        </a>
      )}

      {card.format === "static" ? (
        card.referenceImageUrl && <img src={card.referenceImageUrl} alt="reference" className="w-full rounded-md" />
      ) : (
        card.originalScript && <p className="text-xs text-white/60 line-clamp-3 whitespace-pre-wrap">{card.originalScript}</p>
      )}

      {(card.productId || card.angleName) && (
        <p className="text-[11px] text-white/40">{card.angleName ?? ""}{card.language ? ` · ${card.language}` : ""}</p>
      )}

      {card.output ? (
        card.output.kind === "image" && card.output.imageUrl ? (
          <img src={card.output.imageUrl} alt="recreated" className="w-full rounded-md border border-cyan-500/30" />
        ) : (
          <p className="text-xs text-white/80 line-clamp-4 whitespace-pre-wrap border-l-2 border-cyan-500/40 pl-2">{card.output.text}</p>
        )
      ) : (
        <button onClick={onRecreate} className="w-full rounded-md bg-cyan-500 py-1.5 text-xs font-semibold text-black hover:bg-cyan-400">
          Recreate
        </button>
      )}
    </div>
  );
}
