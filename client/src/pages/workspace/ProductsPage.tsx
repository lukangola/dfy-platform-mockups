/**
 * DESIGN: Studio Control Room — Products Repository
 * Grid of product cards fetched from /api/products with async research status.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, Package, ExternalLink, Clock, CheckCircle2,
  Loader2, Link2, X, ArrowRight, Filter, AlertTriangle,
} from "lucide-react";
import {
  createProduct, listProducts,
  type Product,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import {
  ImageUploadSlot,
  emptyImageSlot,
  handleImageFile,
  type ImageSlot,
} from "@/components/ImageUploadSlot";

type Status = Product["researchStatus"];

function ResearchStatusBadge({ status }: { status: Status }) {
  const config: Record<Status, { label: string; color: string; icon: React.ElementType }> = {
    pending: { label: "Pending", color: "text-white/40 bg-white/[0.04] border-white/[0.08]", icon: Clock },
    researching: { label: "Researching...", color: "text-amber-400 bg-amber-500/10 border-amber-500/25", icon: Loader2 },
    complete: { label: "Complete", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", icon: CheckCircle2 },
    failed: { label: "Failed", color: "text-rose-400 bg-rose-500/10 border-rose-500/25", icon: AlertTriangle },
  };
  const { label, color, icon: Icon } = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border ${color}`}>
      <Icon size={10} className={status === "researching" ? "animate-spin" : ""} />
      {label}
    </span>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function ProductsPage() {
  const { activeBrandId } = useBrand();
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add-form state — input is either a product URL or a pasted fact sheet
  // (the same toggle pattern as CreateBrandDialog). Front + back product
  // shots are optional; they upload to fal.storage as the user picks
  // each file, and the resulting public URLs are submitted alongside
  // the URL/fact-sheet payload. Category dropped — the brand-extract +
  // product-research pipelines derive category automatically.
  const [formMode, setFormMode] = useState<"url" | "factSheet">("url");
  const [formUrl, setFormUrl] = useState("");
  const [formFactSheet, setFormFactSheet] = useState("");
  const [formName, setFormName] = useState("");
  const [front, setFront] = useState<ImageSlot>(emptyImageSlot());
  const [back, setBack] = useState<ImageSlot>(emptyImageSlot());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function refresh() {
    if (!activeBrandId) return;
    try {
      const { products } = await listProducts(activeBrandId);
      setProducts(products);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!activeBrandId) return;
    setLoading(true);
    setProducts([]);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBrandId]);

  // Poll while any product is researching (so the badge flips to Complete live)
  useEffect(() => {
    const anyRunning = products.some((p) => p.researchStatus === "pending" || p.researchStatus === "researching");
    if (!anyRunning) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  // Whether the user has provided one of the two valid product sources.
  // Images are optional, so they don't gate submission.
  const hasProductSource =
    formMode === "url" ? !!formUrl.trim() : !!formFactSheet.trim();
  const imagesUploading = front.uploading || back.uploading;
  const canSubmit = !submitting && !imagesUploading && hasProductSource && !!activeBrandId;

  function resetAddForm() {
    setFormMode("url");
    setFormUrl("");
    setFormFactSheet("");
    setFormName("");
    setFront(emptyImageSlot());
    setBack(emptyImageSlot());
    setSubmitError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createProduct({
        brandId: activeBrandId!,
        // Exactly one of productUrl / factSheet is sent — the server
        // requires one of the two and rejects requests with neither.
        productUrl: formMode === "url" ? formUrl.trim() : undefined,
        factSheet: formMode === "factSheet" ? formFactSheet.trim() : undefined,
        // Optional user-supplied product name (overrides whatever the
        // page-scraper / fact-sheet parser would otherwise extract).
        name: formName.trim() || undefined,
        // Optional clean product shots, already uploaded to fal.storage
        // by the ImageUploadSlot helper. Only sent if the slot has a
        // successfully-uploaded URL.
        productImageUrl: front.uploadedUrl ?? undefined,
        productBackImageUrl: back.uploadedUrl ?? undefined,
      });
      resetAddForm();
      setShowAddForm(false);
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const completeCount = products.filter((p) => p.researchStatus === "complete").length;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-6 py-5" style={{ background: "#0D0F12" }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white/90 flex items-center gap-2">
              <Package size={18} className="text-cyan-400" />
              Product Repository
            </h1>
            <p className="text-xs text-white/30 mt-1 font-mono">
              {products.length} products · {completeCount} researched
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono font-semibold uppercase tracking-wider transition-all"
            style={{
              background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)",
              color: "#0D0F12",
              boxShadow: "0 0 20px rgba(0,212,255,0.2)",
            }}
          >
            <Plus size={14} />
            Add Product
          </button>
        </div>

        {/* Search Bar */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2">
            <Search size={14} className="text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products..."
              className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 font-mono text-xs"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono text-white/40 border border-white/[0.08] hover:bg-white/[0.03] transition-all">
            <Filter size={12} />
            Filter
          </button>
        </div>
      </div>

      {/* Products Grid */}
      <div className="p-6">
        {loadError && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-mono text-rose-300">
            Failed to load products: {loadError}
          </div>
        )}

        {loading && products.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="text-white/20 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredProducts.map((product, i) => (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
              >
                <Link href={`/workspace/products/${product.id}`}>
                  <div
                    className="rounded-xl border border-white/[0.06] overflow-hidden hover:border-white/[0.12] transition-all group cursor-pointer"
                    style={{ background: "#13161F" }}
                  >
                    {/* Product Images */}
                    <div className="flex h-44">
                      <div className="w-1/2 border-r border-white/[0.06] bg-white/[0.02] flex items-center justify-center p-4">
                        {product.productImageUrl ? (
                          <img
                            src={product.productImageUrl}
                            alt={product.name}
                            className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <Package size={32} className="text-white/10" />
                        )}
                      </div>
                      <div className="w-1/2 overflow-hidden bg-white/[0.01] flex items-center justify-center">
                        {product.contentImageUrl ? (
                          <img
                            src={product.contentImageUrl}
                            alt={`${product.name} content`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="text-[10px] font-mono text-white/20">No content image</div>
                        )}
                      </div>
                    </div>

                    {/* Product Info */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-white/90 group-hover:text-cyan-400 transition-colors truncate">
                            {product.name}
                          </h3>
                          <div className="text-[10px] font-mono text-white/30 mt-1 flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">{product.category}</span>
                            <span>Added {formatDate(product.createdAt)}</span>
                          </div>
                        </div>
                        <ArrowRight size={14} className="text-white/20 group-hover:text-cyan-400 transition-colors mt-1 shrink-0" />
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <ResearchStatusBadge status={product.researchStatus} />
                        <span
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (product.productUrl) window.open(product.productUrl, "_blank");
                          }}
                          className={`text-[10px] font-mono transition-colors flex items-center gap-1 ${
                            product.productUrl
                              ? "text-white/20 hover:text-cyan-400 cursor-pointer"
                              : "text-white/10 cursor-default"
                          }`}
                        >
                          <ExternalLink size={10} />
                          Link
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}

            {/* Add Product Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <button
                onClick={() => setShowAddForm(true)}
                className="w-full h-full min-h-[280px] rounded-xl border-2 border-dashed border-white/[0.08] hover:border-cyan-500/30 transition-all flex flex-col items-center justify-center gap-3 group cursor-pointer"
                style={{ background: "transparent" }}
              >
                <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center group-hover:bg-cyan-500/10 group-hover:border-cyan-500/30 transition-all">
                  <Plus size={20} className="text-white/20 group-hover:text-cyan-400 transition-colors" />
                </div>
                <span className="text-xs font-mono text-white/30 group-hover:text-cyan-400 transition-colors">Add New Product</span>
              </button>
            </motion.div>
          </div>
        )}
      </div>

      {/* Add Product Modal */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
            onClick={() => { if (!submitting) { resetAddForm(); setShowAddForm(false); } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg rounded-xl border border-white/[0.08] overflow-hidden"
              style={{ background: "#13161F" }}
              onClick={(e) => e.stopPropagation()}
            >
              <form onSubmit={handleSubmit}>
                {/* Modal Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                  <div>
                    <h2 className="text-sm font-semibold text-white/90">Add New Product</h2>
                    <p className="text-[10px] font-mono text-white/30 mt-0.5">Strategic research starts automatically (2–4 min)</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { resetAddForm(); setShowAddForm(false); }}
                    disabled={submitting}
                    className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.08] transition-all disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="p-5 space-y-4">
                  {/* Source toggle — Product URL vs. Fact Sheet ──────── */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest block">
                      Product source *
                    </span>
                    <div className="inline-flex rounded-lg border border-white/[0.08] p-0.5 bg-[#0A0C0F]">
                      <button
                        type="button"
                        onClick={() => setFormMode("url")}
                        className={`px-3 py-1.5 rounded-md text-xs font-mono transition ${
                          formMode === "url"
                            ? "bg-cyan-500/15 text-cyan-300"
                            : "text-white/40 hover:text-white/70"
                        }`}
                      >
                        Product URL
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormMode("factSheet")}
                        className={`px-3 py-1.5 rounded-md text-xs font-mono transition ${
                          formMode === "factSheet"
                            ? "bg-cyan-500/15 text-cyan-300"
                            : "text-white/40 hover:text-white/70"
                        }`}
                      >
                        Fact sheet
                      </button>
                    </div>

                    {formMode === "url" ? (
                      <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 focus-within:border-cyan-500/40 transition-colors">
                        <Link2 size={14} className="text-white/30" />
                        <input
                          type="url"
                          autoFocus
                          value={formUrl}
                          onChange={(e) => setFormUrl(e.target.value)}
                          placeholder="https://your-store.com/product"
                          className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 font-mono text-xs"
                        />
                      </div>
                    ) : (
                      <textarea
                        autoFocus
                        value={formFactSheet}
                        onChange={(e) => setFormFactSheet(e.target.value)}
                        placeholder={"Paste product details here:\n• Name, category\n• Ingredients / contents\n• Claims, benefits, mechanism\n• Target customer, pricing"}
                        rows={7}
                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white/85 placeholder:text-white/25 outline-none font-mono leading-relaxed resize-y focus:border-cyan-500/40 transition-colors"
                      />
                    )}
                  </div>

                  {/* Optional product name */}
                  <div>
                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2">
                      Product name <span className="text-white/20 normal-case">(optional — auto-detected otherwise)</span>
                    </label>
                    <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 focus-within:border-cyan-500/40 transition-colors">
                      <input
                        type="text"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="e.g. Golden Radiance Serum"
                        className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 font-mono text-xs"
                      />
                    </div>
                  </div>

                  {/* Optional product shots — front + back ─────────── */}
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                        Clean product shots <span className="text-white/20 normal-case">(optional)</span>
                      </span>
                      <span className="text-[10px] font-mono text-white/30 normal-case">
                        Upload front only, or front + back
                      </span>
                    </div>
                    <p className="text-[10px] text-white/30 font-mono leading-relaxed">
                      Plain background, clean shots — these become the canonical references for every
                      downstream image / video generator. Skip if you'd rather have the research
                      pipeline scrape them from the URL.
                    </p>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <ImageUploadSlot
                        label="Front"
                        slot={front}
                        onChange={(file) => void handleImageFile(file, setFront)}
                        onClear={() => setFront(emptyImageSlot())}
                      />
                      <ImageUploadSlot
                        label="Back"
                        slot={back}
                        onChange={(file) => void handleImageFile(file, setBack)}
                        onClear={() => setBack(emptyImageSlot())}
                        disabled={!front.dataUrl}
                        disabledHint="Add front first"
                      />
                    </div>
                  </div>

                  <div className="text-[10px] font-mono text-white/30 leading-relaxed border border-white/[0.06] rounded-lg p-3 bg-white/[0.02]">
                    Strategic diagnosis + 5 elaborated angles run automatically in the background after submit (~2–4 min).
                  </div>

                  {submitError && (
                    <div className="text-[10px] font-mono text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-lg px-3 py-2">
                      {submitError}
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { resetAddForm(); setShowAddForm(false); }}
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg text-xs font-mono text-white/40 border border-white/[0.08] hover:bg-white/[0.03] transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    title={
                      imagesUploading ? "Wait for image upload to finish" :
                      !hasProductSource ? (formMode === "url" ? "Paste a product URL" : "Paste a fact sheet") :
                      undefined
                    }
                    className="px-4 py-2 rounded-lg text-xs font-mono font-semibold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    style={{
                      background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)",
                      color: "#0D0F12",
                    }}
                  >
                    {submitting ? <><Loader2 size={12} className="animate-spin" /> Adding...</> : <>Add Product</>}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
