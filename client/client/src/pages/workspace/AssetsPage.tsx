/**
 * DESIGN: Studio Control Room — Assets Page
 * Shows all generated assets from all apps in the workspace
 * Filterable by type, product, source app
 * Dark background (#0D0F12), Cyan accent (#00D4FF)
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  FolderOpen, Image, Video, Filter, Download, Search,
  Package, Calendar, ExternalLink, ChevronDown,
} from "lucide-react";
import { MOCK_ASSETS, MOCK_PRODUCTS, type AssetType } from "@/lib/mockData";

const TYPE_INFO: Record<AssetType, { label: string; icon: typeof Image; color: string }> = {
  "static-ad": { label: "Static Ad", icon: Image, color: "#F59E0B" },
  "broll-image": { label: "B-Roll Image", icon: Image, color: "#00D4FF" },
  "broll-video": { label: "B-Roll Video", icon: Video, color: "#8B5CF6" },
};

export default function AssetsPage() {
  const [typeFilter, setTypeFilter] = useState<AssetType | "all">("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  const filteredAssets = MOCK_ASSETS.filter((asset) => {
    if (typeFilter !== "all" && asset.type !== typeFilter) return false;
    if (productFilter !== "all" && asset.productId !== productFilter) return false;
    if (searchQuery && !asset.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const assetCounts = {
    all: MOCK_ASSETS.length,
    "static-ad": MOCK_ASSETS.filter((a) => a.type === "static-ad").length,
    "broll-image": MOCK_ASSETS.filter((a) => a.type === "broll-image").length,
    "broll-video": MOCK_ASSETS.filter((a) => a.type === "broll-video").length,
  };

  const selectedProductName = productFilter === "all"
    ? "All Products"
    : MOCK_PRODUCTS.find((p) => p.id === productFilter)?.name || "Unknown";

  const uniqueProducts = Array.from(new Set(MOCK_ASSETS.map((a) => a.productId))).map((id) => {
    const product = MOCK_PRODUCTS.find((p) => p.id === id);
    return { id, name: product?.name || "Unknown", count: MOCK_ASSETS.filter((a) => a.productId === id).length };
  });

  return (
    <div className="min-h-screen p-6" style={{ color: "#E2E8F0" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold font-mono text-white/90 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00D4FF20, #00D4FF05)", border: "1px solid rgba(0,212,255,0.15)" }}>
              <FolderOpen size={20} className="text-cyan-400" />
            </div>
            Assets
          </h1>
          <p className="text-xs text-white/30 mt-2 font-mono ml-[52px]">
            All generated content from your workspace apps
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all">
          <Download size={14} />
          Download All
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {(["all", "static-ad", "broll-image", "broll-video"] as const).map((type) => {
          const isActive = typeFilter === type;
          const info = type === "all" ? { label: "All Assets", color: "#00D4FF" } : TYPE_INFO[type];
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`rounded-lg border p-4 text-left transition-all ${
                isActive
                  ? "border-white/[0.12] bg-white/[0.04]"
                  : "border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">{info.label}</span>
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: info.color,
                    boxShadow: isActive ? `0 0 8px ${info.color}60` : "none",
                  }}
                />
              </div>
              <div className="text-2xl font-bold font-mono" style={{ color: isActive ? info.color : "rgba(255,255,255,0.5)" }}>
                {assetCounts[type]}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        {/* Search */}
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

        {/* Product Filter */}
        <div className="relative">
          <button
            onClick={() => setProductDropdownOpen(!productDropdownOpen)}
            className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 hover:border-white/[0.15] transition-all"
          >
            <Package size={12} className="text-white/30" />
            <span className="text-xs font-mono text-white/60">{selectedProductName}</span>
            <ChevronDown size={12} className={`text-white/30 transition-transform ${productDropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {productDropdownOpen && (
            <div
              className="absolute top-full left-0 mt-1 rounded-lg border border-white/[0.08] overflow-hidden z-20 min-w-[200px]"
              style={{ background: "#1A1D28" }}
            >
              <div className="p-1.5">
                <button
                  onClick={() => { setProductFilter("all"); setProductDropdownOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-all text-xs ${
                    productFilter === "all" ? "bg-cyan-500/10 text-cyan-400" : "text-white/60 hover:bg-white/[0.04]"
                  }`}
                >
                  All Products
                  <span className="ml-auto text-[10px] font-mono text-white/30">{MOCK_ASSETS.length}</span>
                </button>
                {uniqueProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => { setProductFilter(product.id); setProductDropdownOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-all text-xs ${
                      productFilter === product.id ? "bg-cyan-500/10 text-cyan-400" : "text-white/60 hover:bg-white/[0.04]"
                    }`}
                  >
                    {product.name}
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

      {/* Assets Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {filteredAssets.map((asset, i) => {
          const typeInfo = TYPE_INFO[asset.type];
          const TypeIcon = typeInfo.icon;
          return (
            <motion.div
              key={asset.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="rounded-xl border border-white/[0.06] overflow-hidden group hover:border-white/[0.12] transition-all cursor-pointer"
              style={{ background: "#13161F" }}
            >
              <div className="relative aspect-square overflow-hidden">
                <img src={asset.image} alt={asset.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />

                {/* Type Badge */}
                <div className="absolute top-2 left-2">
                  <span
                    className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider flex items-center gap-1"
                    style={{
                      background: `${typeInfo.color}20`,
                      color: typeInfo.color,
                      border: `1px solid ${typeInfo.color}30`,
                    }}
                  >
                    <TypeIcon size={8} />
                    {typeInfo.label}
                  </span>
                </div>

                {/* Status Badge */}
                <div className="absolute top-2 right-2">
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider ${
                      asset.status === "exported"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    }`}
                  >
                    {asset.status}
                  </span>
                </div>

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button className="w-8 h-8 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/60 hover:bg-white/20 transition-colors">
                    <Download size={14} />
                  </button>
                  <button className="w-8 h-8 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white/60 hover:bg-white/20 transition-colors">
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>

              <div className="p-3">
                <div className="text-xs font-medium text-white/80 truncate">{asset.title}</div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] font-mono text-white/30 truncate">{asset.productName}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  {asset.language && (
                    <span className="text-[9px] font-mono text-white/20 bg-white/[0.03] border border-white/[0.06] rounded px-1.5 py-0.5">
                      {asset.language}
                    </span>
                  )}
                  <span className="text-[9px] font-mono text-white/20 flex items-center gap-1">
                    <Calendar size={8} /> {asset.createdAt}
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {filteredAssets.length === 0 && (
        <div className="text-center py-20">
          <FolderOpen size={40} className="text-white/10 mx-auto mb-4" />
          <div className="text-sm font-mono text-white/30">No assets found</div>
          <div className="text-[10px] font-mono text-white/15 mt-1">Try adjusting your filters</div>
        </div>
      )}
    </div>
  );
}
