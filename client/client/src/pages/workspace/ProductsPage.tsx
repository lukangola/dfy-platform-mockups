/**
 * DESIGN: Studio Control Room — Products Repository
 * Grid of product cards with status indicators
 * Add product form accessible via button
 */
import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, Package, ExternalLink, Clock, CheckCircle2,
  Loader2, Upload, Link2, X, ArrowRight, Filter,
} from "lucide-react";
import { MOCK_PRODUCTS, IMAGES, type Product } from "@/lib/mockData";

function ResearchStatusBadge({ status }: { status: Product["researchStatus"] }) {
  const config = {
    pending: { label: "Pending", color: "text-white/40 bg-white/[0.04] border-white/[0.08]", icon: Clock },
    researching: { label: "Researching...", color: "text-amber-400 bg-amber-500/10 border-amber-500/25", icon: Loader2 },
    complete: { label: "Complete", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", icon: CheckCircle2 },
  };
  const { label, color, icon: Icon } = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border ${color}`}>
      <Icon size={10} className={status === "researching" ? "animate-spin" : ""} />
      {label}
    </span>
  );
}

export default function ProductsPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProducts = MOCK_PRODUCTS.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
              {MOCK_PRODUCTS.length} products · {MOCK_PRODUCTS.filter((p) => p.researchStatus === "complete").length} researched
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProducts.map((product, i) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link href={`/workspace/products/${product.id}`}>
                <div
                  className="rounded-xl border border-white/[0.06] overflow-hidden hover:border-white/[0.12] transition-all group cursor-pointer"
                  style={{ background: "#13161F" }}
                >
                  {/* Product Images */}
                  <div className="flex h-44">
                    <div className="w-1/2 border-r border-white/[0.06] bg-white/[0.02] flex items-center justify-center p-4">
                      <img
                        src={product.productImage}
                        alt={product.name}
                        className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="w-1/2 overflow-hidden">
                      <img
                        src={product.contentImage}
                        alt={`${product.name} content`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  </div>

                  {/* Product Info */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold text-white/90 group-hover:text-cyan-400 transition-colors">
                          {product.name}
                        </h3>
                        <div className="text-[10px] font-mono text-white/30 mt-1 flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">{product.category}</span>
                          <span>Added {product.addedAt}</span>
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
                          window.open(product.productLink, '_blank');
                        }}
                        className="text-[10px] font-mono text-white/20 hover:text-cyan-400 transition-colors flex items-center gap-1 cursor-pointer"
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
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: filteredProducts.length * 0.05 }}
          >
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
            onClick={() => setShowAddForm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg rounded-xl border border-white/[0.08] overflow-hidden"
              style={{ background: "#13161F" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                <div>
                  <h2 className="text-sm font-semibold text-white/90">Add New Product</h2>
                  <p className="text-[10px] font-mono text-white/30 mt-0.5">Research will start automatically after adding</p>
                </div>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.08] transition-all"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4">
                {/* Product Link */}
                <div>
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2">
                    Product Link
                  </label>
                  <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5">
                    <Link2 size={14} className="text-white/30" />
                    <input
                      type="text"
                      placeholder="https://your-store.com/product"
                      className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 font-mono text-xs"
                    />
                  </div>
                </div>

                {/* Product Image */}
                <div>
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2">
                    Clean Product Image <span className="text-white/20">(white background)</span>
                  </label>
                  <div className="border-2 border-dashed border-white/[0.08] rounded-lg p-6 flex flex-col items-center gap-2 hover:border-cyan-500/30 transition-colors cursor-pointer group">
                    <Upload size={20} className="text-white/20 group-hover:text-cyan-400 transition-colors" />
                    <span className="text-[10px] font-mono text-white/30 group-hover:text-white/50 transition-colors">
                      Drop image or click to upload
                    </span>
                    <span className="text-[9px] font-mono text-white/15">PNG, JPG — White background recommended</span>
                  </div>
                </div>

                {/* Content Image */}
                <div>
                  <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest block mb-2">
                    Product + Content Image <span className="text-white/20">(product with its contents visible)</span>
                  </label>
                  <div className="border-2 border-dashed border-white/[0.08] rounded-lg p-6 flex flex-col items-center gap-2 hover:border-cyan-500/30 transition-colors cursor-pointer group">
                    <Upload size={20} className="text-white/20 group-hover:text-cyan-400 transition-colors" />
                    <span className="text-[10px] font-mono text-white/30 group-hover:text-white/50 transition-colors">
                      Drop image or click to upload
                    </span>
                    <span className="text-[9px] font-mono text-white/15">Show product alongside its contents on white background</span>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-4 border-t border-white/[0.06] flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/20">
                  Research starts automatically after upload
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 rounded-lg text-xs font-mono text-white/40 border border-white/[0.08] hover:bg-white/[0.03] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg text-xs font-mono font-semibold uppercase tracking-wider transition-all"
                    style={{
                      background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)",
                      color: "#0D0F12",
                    }}
                  >
                    Add Product
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
