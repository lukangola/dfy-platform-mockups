/**
 * New-brand creation form.
 *
 * Required inputs:
 *   - Brand URL (drives brand_extract research)
 *   - Either a product URL OR a pasted fact sheet (drives product_research)
 *   - A clean front product image (uploaded to fal.storage before submit)
 *
 * Optional inputs:
 *   - Back product image — improves downstream image generators when
 *     present, but the brand can be created without it.
 *
 * On submit the dialog hits POST /api/brands, which creates the brand + its
 * first product and fires both research pipelines in parallel. We hand the
 * fresh brand back to BrandContext which auto-switches the workspace to it.
 */
import { useState } from "react";
import { AlertCircle, Loader2, Plus, X } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";
import { toast } from "sonner";
import {
  ImageUploadSlot,
  emptyImageSlot,
  handleImageFile,
  type ImageSlot,
} from "./ImageUploadSlot";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function CreateBrandDialog({ open, onClose }: Props) {
  const { createBrand } = useBrand();
  const [brandUrl, setBrandUrl] = useState("");
  const [productInputMode, setProductInputMode] = useState<"url" | "factSheet">("url");
  const [productUrl, setProductUrl] = useState("");
  const [factSheet, setFactSheet] = useState("");
  const [productName, setProductName] = useState("");
  const [front, setFront] = useState<ImageSlot>(emptyImageSlot());
  const [back, setBack] = useState<ImageSlot>(emptyImageSlot());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!open) return null;

  function resetAndClose() {
    if (submitting) return;
    setBrandUrl("");
    setProductInputMode("url");
    setProductUrl("");
    setFactSheet("");
    setProductName("");
    setFront(emptyImageSlot());
    setBack(emptyImageSlot());
    setSubmitError(null);
    onClose();
  }

  // Back image is optional — many brands have a single canonical product
  // shot and the user shouldn't be blocked from creating a workspace just
  // because they don't have a back photo handy. Front is still required:
  // it's the hero shot every downstream image/video generator anchors on.
  const canSubmit =
    !submitting &&
    brandUrl.trim() &&
    (productInputMode === "url" ? productUrl.trim() : factSheet.trim()) &&
    front.uploadedUrl &&
    !front.uploading &&
    !back.uploading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createBrand({
        brandUrl: brandUrl.trim(),
        productUrl: productInputMode === "url" ? productUrl.trim() : undefined,
        factSheet: productInputMode === "factSheet" ? factSheet.trim() : undefined,
        productName: productName.trim() || undefined,
        productImageUrl: front.uploadedUrl!,
        // Back is optional — pass undefined when the slot is empty so the
        // server can store NULL on the product row instead of an empty
        // string masquerading as a URL.
        productBackImageUrl: back.uploadedUrl ?? undefined,
      });
      toast("Brand created — name & logo extracting in the background");
      resetAndClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      // z-[60] sits above the BrandSwitcher dropdown (z-50) and the
      // sidebar tooltips (also z-50) so the modal can't get visually
      // sandwiched under sibling chrome. Backdrop is solid enough that
      // nothing behind shows through.
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(6px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) resetAndClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/[0.08] overflow-hidden max-h-[90vh] flex flex-col"
        style={{ background: "#0F1218" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div>
            <h2 className="text-sm font-semibold text-white/90 flex items-center gap-2">
              <Plus size={16} className="text-cyan-400" />
              Add new brand
            </h2>
            <p className="text-xs text-white/40 font-mono mt-1">
              Brand info + first product, researched automatically
            </p>
          </div>
          <button
            onClick={resetAndClose}
            disabled={submitting}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition disabled:opacity-30"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Brand fields */}
          <section className="space-y-3">
            <label className="block">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">Brand URL</span>
              <input
                value={brandUrl}
                onChange={(e) => setBrandUrl(e.target.value)}
                placeholder="https://acmeskincare.com"
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-white/[0.08] bg-[#13161F] text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
              />
              <span className="text-[10px] text-white/30 mt-1 block">
                Brand name, logo, tone, colors, and fonts are auto-extracted from this URL.
              </span>
            </label>
          </section>

          {/* Product input — URL vs fact sheet toggle */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">First product</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            <div className="inline-flex rounded-lg border border-white/[0.08] p-0.5 bg-[#0A0C0F]">
              <button
                onClick={() => setProductInputMode("url")}
                className={`px-3 py-1.5 rounded-md text-xs font-mono transition ${
                  productInputMode === "url"
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                Product URL
              </button>
              <button
                onClick={() => setProductInputMode("factSheet")}
                className={`px-3 py-1.5 rounded-md text-xs font-mono transition ${
                  productInputMode === "factSheet"
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                Fact sheet
              </button>
            </div>

            {productInputMode === "url" ? (
              <input
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://acmeskincare.com/products/glow-serum"
                className="w-full px-3 py-2 rounded-lg border border-white/[0.08] bg-[#13161F] text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
              />
            ) : (
              <textarea
                value={factSheet}
                onChange={(e) => setFactSheet(e.target.value)}
                placeholder={`Paste product details here:\n• Name, category\n• Ingredients / contents\n• Claims, benefits, mechanism\n• Target customer, pricing`}
                rows={8}
                className="w-full px-3 py-2 rounded-lg border border-white/[0.08] bg-[#13161F] text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40 font-mono resize-none"
              />
            )}

            <label className="block">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                Product name <span className="text-white/25 normal-case">(optional — auto-detected otherwise)</span>
              </span>
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Glow Serum"
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-white/[0.08] bg-[#13161F] text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
              />
            </label>
          </section>

          {/* Front (required) + Back (optional) product images */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                Clean product shots
              </span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>
            <p className="text-[11px] text-white/40 leading-relaxed">
              The front shot is the canonical hero — every downstream image/video generator anchors
              on it. The back shot is optional but improves accuracy when present (extra label
              detail, ingredients, claims).
            </p>

            <div className="grid grid-cols-2 gap-3">
              <ImageUploadSlot
                label="Front — required"
                slot={front}
                onChange={(file) => void handleImageFile(file, setFront)}
                onClear={() => setFront(emptyImageSlot())}
              />
              <ImageUploadSlot
                label="Back — optional"
                slot={back}
                onChange={(file) => void handleImageFile(file, setBack)}
                onClear={() => setBack(emptyImageSlot())}
              />
            </div>
          </section>

          {submitError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/[0.06] bg-[#0A0C0F]">
          <button
            onClick={resetAndClose}
            disabled={submitting}
            className="px-3 py-2 rounded-lg text-xs font-mono text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition disabled:opacity-30"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg text-xs font-mono text-[#0D0F12] font-semibold transition disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #00D4FF 0%, #0099CC 100%)" }}
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" />
                Creating brand…
              </span>
            ) : (
              "Create brand"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

