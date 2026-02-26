/**
 * DESIGN: Studio Control Room — Product Detail with Research
 * Shows full product research with editable fields
 */
import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft, ExternalLink, Edit3, Save, CheckCircle2,
  Loader2, Clock, FlaskConical, Target, DollarSign,
  Swords, Lightbulb, Video, ChevronRight, Package,
} from "lucide-react";
import { MOCK_PRODUCTS, type Product } from "@/lib/mockData";

function ResearchStatusBadge({ status }: { status: Product["researchStatus"] }) {
  const config = {
    pending: { label: "Pending", color: "text-white/40 bg-white/[0.04] border-white/[0.08]", icon: Clock },
    researching: { label: "Researching...", color: "text-amber-400 bg-amber-500/10 border-amber-500/25", icon: Loader2 },
    complete: { label: "Research Complete", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", icon: CheckCircle2 },
  };
  const { label, color, icon: Icon } = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border ${color}`}>
      <Icon size={10} className={status === "researching" ? "animate-spin" : ""} />
      {label}
    </span>
  );
}

function EditableSection({ title, icon: Icon, children, iconColor = "text-cyan-400" }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  iconColor?: string;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{ background: "#13161F" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Icon size={14} className={iconColor} />
          <span className="text-xs font-mono text-white/60 uppercase tracking-wider">{title}</span>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-all ${
            editing
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              : "text-white/30 hover:text-white/50 border border-transparent hover:border-white/[0.08]"
          }`}
        >
          {editing ? <><Save size={10} /> Save</> : <><Edit3 size={10} /> Edit</>}
        </button>
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

export default function ProductDetailPage({ productId }: { productId: string }) {
  const product = MOCK_PRODUCTS.find((p) => p.id === productId);

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Package size={40} className="text-white/10 mx-auto mb-4" />
          <p className="text-sm text-white/40 font-mono">Product not found</p>
          <Link href="/workspace/products">
            <button className="mt-4 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors">
              ← Back to Products
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const research = product.research;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-6 py-4" style={{ background: "#0D0F12" }}>
        <div className="flex items-center gap-2 text-[10px] font-mono text-white/30 mb-3">
          <Link href="/workspace/products">
            <button className="hover:text-cyan-400 transition-colors flex items-center gap-1">
              <ArrowLeft size={10} />
              Products
            </button>
          </Link>
          <ChevronRight size={10} />
          <span className="text-white/50">{product.name}</span>
        </div>

        <div className="flex items-start gap-5">
          {/* Product Image Thumbnail */}
          <div className="w-16 h-16 rounded-lg border border-white/[0.08] bg-white/[0.02] flex items-center justify-center overflow-hidden shrink-0">
            <img src={product.productImage} alt={product.name} className="max-h-full max-w-full object-contain" />
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-white/90">{product.name}</h1>
              <ResearchStatusBadge status={product.researchStatus} />
            </div>
            <div className="flex items-center gap-4 mt-1.5">
              <span className="text-[10px] font-mono text-white/30 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                {product.category}
              </span>
              <a
                href={product.productLink}
                className="text-[10px] font-mono text-cyan-400/60 hover:text-cyan-400 transition-colors flex items-center gap-1"
              >
                <ExternalLink size={10} />
                {product.productLink}
              </a>
            </div>
          </div>

          {/* Action: Launch B-Roll */}
          {product.researchStatus === "complete" && (
            <Link href="/workspace/apps/broll">
              <button
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono font-semibold uppercase tracking-wider transition-all shrink-0"
                style={{
                  background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)",
                  color: "#0D0F12",
                  boxShadow: "0 0 20px rgba(0,212,255,0.2)",
                }}
              >
                <Video size={14} />
                Generate B-Roll
              </button>
            </Link>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {product.researchStatus === "pending" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-white/[0.06] p-12 text-center"
            style={{ background: "#13161F" }}
          >
            <Clock size={40} className="text-white/10 mx-auto mb-4" />
            <h3 className="text-sm font-semibold text-white/60 mb-2">Research Pending</h3>
            <p className="text-xs text-white/30 font-mono max-w-md mx-auto">
              Product research will begin automatically. This typically takes 2–5 minutes depending on the product complexity.
            </p>
          </motion.div>
        )}

        {product.researchStatus === "researching" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-amber-500/20 p-12 text-center"
            style={{ background: "#13161F" }}
          >
            <Loader2 size={40} className="text-amber-400 mx-auto mb-4 animate-spin" />
            <h3 className="text-sm font-semibold text-amber-400 mb-2">Research In Progress</h3>
            <p className="text-xs text-white/30 font-mono max-w-md mx-auto">
              Analyzing product page, extracting ingredients, identifying competitors, and generating content angles...
            </p>
            <div className="mt-6 max-w-xs mx-auto">
              <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-amber-400"
                  initial={{ width: "0%" }}
                  animate={{ width: "65%" }}
                  transition={{ duration: 2, ease: "easeOut" }}
                />
              </div>
              <div className="flex justify-between mt-2 text-[9px] font-mono text-white/20">
                <span>Analyzing...</span>
                <span>~65%</span>
              </div>
            </div>
          </motion.div>
        )}

        {product.researchStatus === "complete" && research && (
          <div className="space-y-4">
            {/* Product Images Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{ background: "#13161F" }}>
                <div className="px-4 py-2.5 border-b border-white/[0.06]">
                  <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Product Image</span>
                </div>
                <div className="p-6 flex items-center justify-center bg-white/[0.01]" style={{ minHeight: 200 }}>
                  <img src={product.productImage} alt={product.name} className="max-h-48 object-contain" />
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{ background: "#13161F" }}>
                <div className="px-4 py-2.5 border-b border-white/[0.06]">
                  <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Product + Content</span>
                </div>
                <div className="overflow-hidden" style={{ minHeight: 200 }}>
                  <img src={product.contentImage} alt={`${product.name} content`} className="w-full h-full object-cover" style={{ minHeight: 200 }} />
                </div>
              </div>
            </div>

            {/* Summary */}
            <EditableSection title="Summary" icon={Package}>
              <p className="text-sm text-white/60 leading-relaxed">{research.summary}</p>
            </EditableSection>

            {/* Ingredients */}
            <EditableSection title="Key Ingredients" icon={FlaskConical} iconColor="text-emerald-400">
              <div className="space-y-2">
                {research.ingredients.map((ing, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white/80">{ing.name}</span>
                        {ing.percentage && (
                          <span className="text-[9px] font-mono text-emerald-400/60 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                            {ing.percentage}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-white/40">{ing.purpose}</span>
                    </div>
                  </div>
                ))}
              </div>
            </EditableSection>

            {/* Claims & USPs */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <EditableSection title="Product Claims" icon={CheckCircle2} iconColor="text-blue-400">
                <ul className="space-y-2">
                  {research.claims.map((claim, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-white/50">
                      <CheckCircle2 size={12} className="text-blue-400/50 mt-0.5 shrink-0" />
                      {claim}
                    </li>
                  ))}
                </ul>
              </EditableSection>

              <EditableSection title="Unique Selling Points" icon={Lightbulb} iconColor="text-amber-400">
                <ul className="space-y-2">
                  {research.uniqueSellingPoints.map((usp, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-white/50">
                      <Lightbulb size={12} className="text-amber-400/50 mt-0.5 shrink-0" />
                      {usp}
                    </li>
                  ))}
                </ul>
              </EditableSection>
            </div>

            {/* Target & Pricing */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <EditableSection title="Target Demographic" icon={Target} iconColor="text-violet-400">
                <p className="text-sm text-white/60 leading-relaxed">{research.targetDemographic}</p>
                <div className="mt-3 flex items-center gap-2">
                  <DollarSign size={12} className="text-emerald-400" />
                  <span className="text-xs font-mono text-emerald-400">{research.pricePoint}</span>
                </div>
              </EditableSection>

              <EditableSection title="Competitor Landscape" icon={Swords} iconColor="text-rose-400">
                <div className="space-y-2">
                  {research.competitors.map((comp, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                      <span className="text-xs text-white/60">{comp.name}</span>
                      <span className="text-[10px] font-mono text-white/40">{comp.price}</span>
                    </div>
                  ))}
                </div>
              </EditableSection>
            </div>

            {/* Content Angles */}
            <EditableSection title="Content Angles" icon={Video} iconColor="text-cyan-400">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {research.contentAngles.map((angle, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs text-white/50 hover:border-cyan-500/20 hover:text-white/70 transition-all cursor-pointer"
                  >
                    <div className="w-5 h-5 rounded bg-cyan-500/10 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-mono text-cyan-400">{i + 1}</span>
                    </div>
                    {angle}
                  </div>
                ))}
              </div>
            </EditableSection>
          </div>
        )}
      </div>
    </div>
  );
}
