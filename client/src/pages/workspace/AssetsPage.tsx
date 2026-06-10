/**
 * DESIGN: Studio Control Room — Brand Assets
 *
 * The persistent library of approved assets saved from every app
 * (B-roll videos/images, Message Testing ads, Static Ads, ...).
 * Writes come from each app's "Save to Brand Assets" action; reads
 * come from GET /api/brand-assets.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  FolderOpen, Image as ImageIcon, Video, Download, Search, FileText,
  Package, Calendar, ExternalLink, ChevronDown, Trash2, Loader2, AlertTriangle, User,
  Globe, Copy, X, Edit3,
} from "lucide-react";
import {
  listBrandAssets, deleteBrandAsset, listProducts,
  type BrandAsset, type Product,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { downloadViaBlob } from "@/lib/download";

type KindFilter = "all" | "image" | "video" | "document" | "landing_page";

const SOURCE_APP_LABELS: Record<string, string> = {
  broll: "B-Roll",
  message_testing: "Message Testing",
  static_ads: "Static Ads",
  copy_engine: "Copy Engine",
  listicle_builder: "Listicle Builder",
};

function sourceAppLabel(src: string): string {
  return SOURCE_APP_LABELS[src] ?? src;
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3_600_000;
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  const diffD = diffH / 24;
  if (diffD < 7) return `${Math.round(diffD)}d ago`;
  return d.toLocaleDateString();
}

async function downloadAsset(asset: BrandAsset): Promise<void> {
  const safeTitle = (asset.title || "asset").slice(0, 60).replace(/\s+/g, "-");
  if (asset.kind === "document") {
    const content =
      typeof asset.metadata?.content === "string" ? (asset.metadata.content as string) : "";
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${safeTitle}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    return;
  }
  const ext = asset.kind === "video" ? "mp4" : "jpg";
  await downloadViaBlob(asset.url, `${safeTitle}.${ext}`);
}

export default function AssetsPage() {
  const { activeBrandId } = useBrand();
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [{ assets }, { products }] = await Promise.all([
          listBrandAssets(activeBrandId),
          listProducts(activeBrandId),
        ]);
        if (!cancelled) {
          setAssets(assets);
          setProducts(products);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  const productsById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const filteredAssets = useMemo(
    () =>
      assets.filter((a) => {
        if (kindFilter !== "all" && a.kind !== kindFilter) return false;
        if (productFilter !== "all" && a.productId !== productFilter) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          if (
            !a.title.toLowerCase().includes(q) &&
            !sourceAppLabel(a.sourceApp).toLowerCase().includes(q)
          )
            return false;
        }
        return true;
      }),
    [assets, kindFilter, productFilter, searchQuery],
  );

  const kindCounts = {
    all: assets.length,
    image: assets.filter((a) => a.kind === "image").length,
    video: assets.filter((a) => a.kind === "video").length,
    document: assets.filter((a) => a.kind === "document").length,
    landing_page: assets.filter((a) => a.kind === "landing_page").length,
  };

  const uniqueProducts = useMemo(() => {
    const ids = new Set<string>();
    assets.forEach((a) => {
      if (a.productId) ids.add(a.productId);
    });
    return Array.from(ids).map((id) => {
      const p = productsById.get(id);
      return {
        id,
        name: p?.name ?? "Unknown",
        count: assets.filter((a) => a.productId === id).length,
      };
    });
  }, [assets, productsById]);

  const selectedProductName =
    productFilter === "all"
      ? "All Products"
      : productsById.get(productFilter)?.name ?? "Unknown";

  const downloadAllFiltered = () => {
    filteredAssets.forEach((asset, i) => {
      setTimeout(() => downloadAsset(asset), i * 350);
    });
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteBrandAsset(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  const KIND_INFO: Record<"image" | "video" | "document" | "landing_page", { label: string; color: string; Icon: typeof ImageIcon }> = {
    image: { label: "Image", color: "#00D4FF", Icon: ImageIcon },
    video: { label: "Video", color: "#8B5CF6", Icon: Video },
    document: { label: "Document", color: "#F43F5E", Icon: FileText },
    landing_page: { label: "Landing Page", color: "#F59E0B", Icon: Globe },
  };

  // Side-panel state — opens when the user clicks a landing_page asset
  // (or any asset they want to see metadata for). Carries the asset
  // being inspected; closing sets back to null.
  const [openAsset, setOpenAsset] = useState<BrandAsset | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(url);
      setTimeout(() => setCopiedLink(null), 1500);
    } catch {
      // best-effort
    }
  };

  return (
    <div className="min-h-screen p-6" style={{ color: "#E2E8F0" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold font-mono text-white/90 flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #00D4FF20, #00D4FF05)",
                border: "1px solid rgba(0,212,255,0.15)",
              }}
            >
              <FolderOpen size={20} className="text-cyan-400" />
            </div>
            Brand Assets
          </h1>
          <p className="text-xs text-white/30 mt-2 font-mono ml-[52px]">
            Approved outputs saved from B-Roll, Message Testing, Static Ads, and more.
          </p>
        </div>
        <button
          onClick={downloadAllFiltered}
          disabled={filteredAssets.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Download size={14} />
          Download All ({filteredAssets.length})
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-rose-500/30 bg-rose-500/5 p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-rose-300 font-mono break-words">{error}</p>
        </div>
      )}

      {/* Stats Bar — one chip per asset kind, "all" first. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {(["all", "image", "video", "document", "landing_page"] as const).map((kind) => {
          const isActive = kindFilter === kind;
          const info =
            kind === "all"
              ? { label: "All Assets", color: "#00D4FF" }
              : KIND_INFO[kind];
          return (
            <button
              key={kind}
              onClick={() => setKindFilter(kind)}
              className={`rounded-lg border p-4 text-left transition-all ${
                isActive
                  ? "border-white/[0.12] bg-white/[0.04]"
                  : "border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                  {info.label}
                </span>
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: info.color,
                    boxShadow: isActive ? `0 0 8px ${info.color}60` : "none",
                  }}
                />
              </div>
              <div
                className="text-2xl font-bold font-mono"
                style={{ color: isActive ? info.color : "rgba(255,255,255,0.5)" }}
              >
                {kindCounts[kind]}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 flex-1 max-w-xs">
          <Search size={14} className="text-white/20" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search assets..."
            className="bg-transparent text-xs text-white/80 placeholder:text-white/20 outline-none flex-1 font-mono"
          />
        </div>

        <div className="relative">
          <button
            onClick={() => setProductDropdownOpen(!productDropdownOpen)}
            className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 hover:border-white/[0.15] transition-all"
          >
            <Package size={12} className="text-white/30" />
            <span className="text-xs font-mono text-white/60">{selectedProductName}</span>
            <ChevronDown
              size={12}
              className={`text-white/30 transition-transform ${productDropdownOpen ? "rotate-180" : ""}`}
            />
          </button>

          {productDropdownOpen && (
            <div
              className="absolute top-full left-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-20 min-w-[220px]"
              style={{ background: "#1A1D28" }}
            >
              <div className="p-1.5">
                <button
                  onClick={() => {
                    setProductFilter("all");
                    setProductDropdownOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-all text-xs ${
                    productFilter === "all"
                      ? "bg-cyan-500/10 text-cyan-400"
                      : "text-white/60 hover:bg-white/[0.04]"
                  }`}
                >
                  All Products
                  <span className="ml-auto text-[10px] font-mono text-white/30">{assets.length}</span>
                </button>
                {uniqueProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => {
                      setProductFilter(product.id);
                      setProductDropdownOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-all text-xs ${
                      productFilter === product.id
                        ? "bg-cyan-500/10 text-cyan-400"
                        : "text-white/60 hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="truncate">{product.name}</span>
                    <span className="ml-auto text-[10px] font-mono text-white/30">{product.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="ml-auto text-[10px] font-mono text-white/25">
          {filteredAssets.length} asset{filteredAssets.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-20">
          <Loader2 size={24} className="text-cyan-400 animate-spin mx-auto mb-3" />
          <div className="text-[11px] font-mono text-white/30">Loading brand assets...</div>
        </div>
      )}

      {/* Assets Grid */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredAssets.map((asset, i) => {
            const kindInfo = KIND_INFO[asset.kind];
            const KindIcon = kindInfo.Icon;
            const productName = asset.productId ? productsById.get(asset.productId)?.name ?? null : null;
            const thumb = asset.thumbnailUrl || (asset.kind === "image" ? asset.url : null);
            const isLandingPage = asset.kind === "landing_page";
            return (
              <motion.div
                key={asset.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                onClick={isLandingPage ? () => setOpenAsset(asset) : undefined}
                className={`rounded-xl border border-white/[0.06] overflow-hidden group hover:border-white/[0.12] transition-all ${isLandingPage ? "cursor-pointer hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5" : ""}`}
                style={{ background: "#13161F" }}
              >
                <div className={`relative aspect-square ${asset.kind === "video" ? "bg-black" : "bg-white/[0.02]"} overflow-hidden`}>
                  {asset.kind === "video" ? (
                    <video
                      src={asset.url}
                      poster={asset.thumbnailUrl ?? undefined}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover bg-black"
                    />
                  ) : asset.kind === "document" ? (
                    <div
                      className="w-full h-full p-4 overflow-hidden flex flex-col gap-1.5"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(244,63,94,0.08), rgba(244,63,94,0.02))",
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <FileText size={11} className="text-rose-400/60" />
                        <span className="text-[9px] font-mono text-rose-300/60 uppercase tracking-wider">
                          {typeof asset.metadata?.copyType === "string"
                            ? (asset.metadata.copyType as string)
                            : "Document"}
                        </span>
                      </div>
                      <div className="text-[9px] font-mono text-white/45 leading-relaxed line-clamp-[14] whitespace-pre-wrap break-words">
                        {typeof asset.metadata?.content === "string"
                          ? (asset.metadata.content as string).slice(0, 600)
                          : "(empty document)"}
                      </div>
                    </div>
                  ) : asset.kind === "landing_page" ? (
                    /* Landing-page card — real screenshot of the
                       published URL via WordPress mShots. No API key,
                       no infra: just an <img> pointing at the public
                       page. First load shows a placeholder while
                       mShots captures; subsequent loads hit the
                       cached image. Clicking the card opens the
                       side panel with all three URLs. */
                    <div className="w-full h-full overflow-hidden bg-[#FBF5EB]">
                      <img
                        src={`https://s.wordpress.com/mshots/v1/${encodeURIComponent(asset.url)}?w=800&h=800&vpw=1280&vph=1280`}
                        alt={asset.title}
                        loading="lazy"
                        className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
                      />
                      {/* Hover overlay — makes the click target
                          obvious on top of the screenshot. */}
                      <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                        <div className="px-3 py-2 rounded-lg bg-amber-500/95 text-[#1A1A1A] text-[10px] font-mono uppercase tracking-wider font-semibold flex items-center gap-1.5">
                          <Globe size={11} /> View links
                        </div>
                      </div>
                    </div>
                  ) : thumb ? (
                    <img
                      src={thumb}
                      alt={asset.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/20">
                      <ImageIcon size={28} />
                    </div>
                  )}

                  {/* Kind + Source App badges — hidden for landing_page
                      cards because the mock chrome + announcement bar
                      stacked at the top would fight the badges, and the
                      design is self-evidently a landing page. The
                      kind+source info gets re-added inline in the
                      footer below for landing_page rows. */}
                  {!isLandingPage ? (
                    <>
                      <div className="absolute top-2 left-2 pointer-events-none">
                        <span
                          className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider flex items-center gap-1"
                          style={{
                            background: `${kindInfo.color}20`,
                            color: kindInfo.color,
                            border: `1px solid ${kindInfo.color}30`,
                          }}
                        >
                          <KindIcon size={8} />
                          {kindInfo.label}
                        </span>
                      </div>
                      <div className="absolute top-2 right-2 pointer-events-none">
                        <span className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider bg-black/50 text-white/70 border border-white/10">
                          {sourceAppLabel(asset.sourceApp)}
                        </span>
                      </div>
                    </>
                  ) : null}

                  {asset.kind === "video" ? (
                    /* Video: action pill floats top-center, native controls stay clickable at the bottom */
                    <div className="absolute top-9 left-1/2 -translate-x-1/2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => void downloadAsset(asset)}
                        className="w-8 h-8 rounded-lg bg-black/70 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white/70 hover:bg-black/85 hover:text-white transition-colors"
                        title="Download"
                      >
                        <Download size={14} />
                      </button>
                      <a
                        href={asset.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 rounded-lg bg-black/70 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white/70 hover:bg-black/85 hover:text-white transition-colors"
                        title="Open in new tab"
                      >
                        <ExternalLink size={14} />
                      </a>
                      <button
                        onClick={() => void handleDelete(asset.id)}
                        disabled={deletingId === asset.id}
                        className="w-8 h-8 rounded-lg bg-rose-500/80 backdrop-blur-sm border border-rose-500/40 flex items-center justify-center text-white hover:bg-rose-500 transition-colors disabled:opacity-50"
                        title="Remove from brand assets"
                      >
                        {deletingId === asset.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  ) : (
                    /* Image / Document: full center overlay on hover */
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={() => void downloadAsset(asset)}
                        className="w-8 h-8 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/60 hover:bg-white/20 transition-colors"
                        title="Download"
                      >
                        <Download size={14} />
                      </button>
                      {asset.kind === "image" ? (
                        <a
                          href={asset.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-8 h-8 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/60 hover:bg-white/20 transition-colors"
                          title="Open in new tab"
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                      <button
                        onClick={() => void handleDelete(asset.id)}
                        disabled={deletingId === asset.id}
                        className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-300 hover:bg-rose-500/25 transition-colors disabled:opacity-50"
                        title="Remove from brand assets"
                      >
                        {deletingId === asset.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-3">
                  <div className="text-xs font-medium text-white/80 truncate" title={asset.title}>
                    {asset.title}
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] font-mono text-white/30 truncate">
                      {productName ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {/* Inline kind chip for landing_page rows — the
                        floating top-left badge is hidden for these so
                        it doesn't fight the browser-chrome mock, so
                        surface it here instead. */}
                    {isLandingPage ? (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider flex items-center gap-1"
                        style={{
                          background: `${kindInfo.color}20`,
                          color: kindInfo.color,
                          border: `1px solid ${kindInfo.color}30`,
                        }}
                      >
                        <KindIcon size={8} />
                        {kindInfo.label}
                      </span>
                    ) : null}
                    <span className="text-[9px] font-mono text-white/20 flex items-center gap-1">
                      <Calendar size={8} /> {formatRelativeDate(asset.createdAt)}
                    </span>
                    {asset.creatorName && (
                      <span
                        className="text-[9px] font-mono text-white/30 flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 border border-white/10"
                        title={`Created by ${asset.creatorName}`}
                      >
                        <User size={8} /> {asset.creatorName}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {!loading && filteredAssets.length === 0 && (
        <div className="text-center py-20">
          <FolderOpen size={40} className="text-white/10 mx-auto mb-4" />
          <div className="text-sm font-mono text-white/30">
            {assets.length === 0 ? "No brand assets yet" : "No assets match your filters"}
          </div>
          <div className="text-[10px] font-mono text-white/15 mt-1">
            {assets.length === 0
              ? "Generate and approve content in any app, then save it to brand assets."
              : "Try adjusting your filters"}
          </div>
        </div>
      )}

      {/* Side panel — opens when the user clicks a landing-page card.
          Shows headline + every URL flavour the deploy step produced
          (published, preview, editor) so the user has one place to
          jump back to their deployed lander. */}
      {openAsset && openAsset.kind === "landing_page" && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setOpenAsset(null)}
        >
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 32 }}
            className="w-full max-w-md h-full overflow-y-auto"
            style={{ background: "#13161F", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-mono text-amber-300/70 uppercase tracking-widest flex items-center gap-1.5">
                    <Globe size={11} /> Landing Page
                  </div>
                  <h2 className="text-[15px] font-medium text-white/90 mt-2 leading-snug">
                    {typeof openAsset.metadata?.headline === "string"
                      ? (openAsset.metadata.headline as string)
                      : openAsset.title}
                  </h2>
                  <div className="text-[11px] font-mono text-white/40 mt-1">
                    Deployed {typeof openAsset.metadata?.deployedAt === "string"
                      ? formatRelativeDate(openAsset.metadata.deployedAt as string)
                      : formatRelativeDate(openAsset.createdAt)}
                  </div>
                </div>
                <button
                  onClick={() => setOpenAsset(null)}
                  className="w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-colors"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Links section */}
              <div className="space-y-3">
                {[
                  { label: "Published URL", icon: Globe, url: openAsset.url, accent: "amber" as const, description: "The live URL — share this." },
                  ...(typeof openAsset.metadata?.previewUrl === "string"
                    ? [{ label: "Preview URL", icon: ExternalLink, url: openAsset.metadata.previewUrl as string, accent: "cyan" as const, description: "Preview the variant without going live." }]
                    : []),
                  ...(typeof openAsset.metadata?.editorUrl === "string"
                    ? [{ label: "Edit in LanderLab", icon: Edit3, url: openAsset.metadata.editorUrl as string, accent: "violet" as const, description: "Open the variant in LanderLab's editor." }]
                    : []),
                ].map((link) => {
                  const accentClasses = {
                    amber: "border-amber-500/30 bg-amber-500/[0.05]",
                    cyan: "border-cyan-500/30 bg-cyan-500/[0.05]",
                    violet: "border-violet-500/30 bg-violet-500/[0.05]",
                  }[link.accent];
                  const LinkIcon = link.icon;
                  return (
                    <div key={link.label} className={`rounded-lg border p-3 ${accentClasses}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <LinkIcon size={12} className="text-white/60" />
                        <span className="text-[10px] font-mono text-white/60 uppercase tracking-widest">{link.label}</span>
                      </div>
                      <div className="text-[11px] font-mono text-white/85 break-all mb-2 leading-relaxed">{link.url}</div>
                      <div className="text-[10px] font-mono text-white/30 mb-2">{link.description}</div>
                      <div className="flex items-center gap-2">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-wider bg-white/[0.05] text-white/80 border border-white/[0.10] hover:bg-white/[0.10] transition-colors flex items-center justify-center gap-1.5"
                        >
                          <ExternalLink size={11} /> Open
                        </a>
                        <button
                          onClick={() => void copyLink(link.url)}
                          className="px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-wider bg-white/[0.03] text-white/60 border border-white/[0.08] hover:bg-white/[0.08] transition-colors flex items-center gap-1.5"
                        >
                          <Copy size={11} /> {copiedLink === link.url ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Slug + product context */}
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2 text-[11px] font-mono">
                {typeof openAsset.metadata?.slug === "string" && (
                  <div className="flex justify-between text-white/50">
                    <span className="uppercase tracking-wider text-white/30">Slug</span>
                    <span className="text-white/70">{openAsset.metadata.slug as string}</span>
                  </div>
                )}
                {openAsset.productId && productsById.get(openAsset.productId) && (
                  <div className="flex justify-between text-white/50">
                    <span className="uppercase tracking-wider text-white/30">Product</span>
                    <span className="text-white/70">{productsById.get(openAsset.productId)?.name}</span>
                  </div>
                )}
                {openAsset.creatorName && (
                  <div className="flex justify-between text-white/50">
                    <span className="uppercase tracking-wider text-white/30">Saved by</span>
                    <span className="text-white/70">{openAsset.creatorName}</span>
                  </div>
                )}
              </div>

              {/* Delete */}
              <button
                onClick={() => { void handleDelete(openAsset.id); setOpenAsset(null); }}
                disabled={deletingId === openAsset.id}
                className="w-full px-3 py-2 rounded text-[11px] font-mono uppercase tracking-wider bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {deletingId === openAsset.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Remove from Brand Assets
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </div>
  );
}
