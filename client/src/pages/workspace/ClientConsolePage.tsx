/**
 * DESIGN: Studio Control Room — Client Console
 *
 * The operator-facing hub for Done-For-You clients. Scoped to the ACTIVE brand
 * (driven by the global BrandSwitcher). For every product under the active DFY
 * brand it surfaces:
 *   - the Client Share Link control (mint / rotate / revoke the public review
 *     link), and
 *   - the Client Feedback triage inbox (what the client flagged on that link).
 *
 * Both are extracted, reusable pieces from components/clientFeedback.tsx — the
 * same inbox/share UI that used to live inline on the product page.
 *
 * Access: managers + admins only. The nav item is hidden for plain members and
 * for non-DFY brands, but we re-check here so a hand-typed URL can't bypass it.
 * Mutations (share create/revoke) are additionally gated server-side with
 * requireManager.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Headset, Package, Loader2, ArrowRight, ShieldAlert, Building2,
} from "lucide-react";
import {
  listProducts, getProduct, getProductFeedback, updateFeedbackStatus,
  type Product, type OperatorFeedback,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { useAuth } from "@/contexts/AuthContext";
import { ClientShareCard, FeedbackInbox } from "@/components/clientFeedback";

/** angle-id order for a product, used to sort the feedback inbox groups. */
function angleOrderFor(product: Product): string[] {
  return (product.research?.angles ?? [])
    .map((a) => a.id)
    .filter((id): id is string => Boolean(id));
}

/**
 * One product's console block: header (links to the product detail),
 * the share-link control, and the feedback inbox. Owns its own feedback state
 * so each product refreshes independently.
 */
function ProductConsoleBlock({ product: initial, showHeader }: { product: Product; showHeader: boolean }) {
  const [product, setProduct] = useState<Product>(initial);
  const [feedback, setFeedback] = useState<OperatorFeedback[]>([]);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Keep the local copy in sync if the parent re-fetches the product list.
  useEffect(() => {
    setProduct(initial);
  }, [initial]);

  async function refreshFeedback() {
    if (feedbackBusy) return;
    setFeedbackBusy(true);
    try {
      const { feedback: rows } = await getProductFeedback(product.id);
      setFeedback(rows);
      setFeedbackError(null);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : String(err));
    } finally {
      setFeedbackBusy(false);
    }
  }

  // Initial load + reload when switching to a different product id.
  useEffect(() => {
    void refreshFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  async function handleResolve(fb: OperatorFeedback) {
    if (resolvingId) return;
    setResolvingId(fb.id);
    setFeedbackError(null);
    const nextStatus = fb.status === "resolved" ? "open" : "resolved";
    try {
      const { feedback: updated } = await updateFeedbackStatus(product.id, fb.id, nextStatus);
      setFeedback((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingId(null);
    }
  }

  // After minting/rotating/revoking the share link, re-fetch this product so the
  // ClientShareCard sees the new `shareToken`.
  async function refreshProduct() {
    try {
      const { product: fresh } = await getProduct(product.id);
      setProduct(fresh);
    } catch {
      // Non-fatal — the card surfaces its own error if the mutation failed.
    }
  }

  return (
    <div className="space-y-4">
      {/* Slim product header — only when the brand has more than one product,
          so a single-product brand doesn't just repeat its own name. The
          share/feedback cards below carry their own LIVE / to-action state, so
          we don't duplicate those chips up here. */}
      {showHeader && (
        <Link href={`/workspace/products/${product.id}`}>
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center shrink-0 overflow-hidden">
              {product.productImageUrl ? (
                <img src={product.productImageUrl} alt={product.name} className="max-h-full max-w-full object-contain" />
              ) : (
                <Package size={15} className="text-white/20" />
              )}
            </div>
            <h3 className="flex-1 min-w-0 text-sm font-semibold text-white/80 truncate group-hover:text-cyan-400 transition-colors">
              {product.name}
            </h3>
            <span className="shrink-0 flex items-center gap-1 text-[10px] font-mono text-white/30 uppercase tracking-wider group-hover:text-cyan-400 transition-colors">
              View product <ArrowRight size={12} />
            </span>
          </div>
        </Link>
      )}

      <ClientShareCard
        productId={product.id}
        shareToken={product.shareToken ?? null}
        onChanged={refreshProduct}
      />
      <FeedbackInbox
        feedback={feedback}
        angleOrder={angleOrderFor(product)}
        resolvingId={resolvingId}
        busy={feedbackBusy}
        error={feedbackError}
        onResolve={handleResolve}
        onRefresh={refreshFeedback}
      />
    </div>
  );
}

export default function ClientConsolePage() {
  const { activeBrand, activeBrandId } = useBrand();
  const { role } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canUse = role === "admin" || role === "manager";
  const isDfy = Boolean(activeBrand?.isDfyClient);

  useEffect(() => {
    if (!activeBrandId || !canUse || !isDfy) {
      setProducts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { products: rows } = await listProducts(activeBrandId);
        if (cancelled) return;
        setProducts(rows);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, canUse, isDfy]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-6 py-5" style={{ background: "#0D0F12" }}>
        <h1 className="text-lg font-semibold text-white/90 flex items-center gap-2">
          <Headset size={18} className="text-cyan-400" />
          Client Console
        </h1>
        <p className="text-xs text-white/30 mt-1 font-mono">
          {activeBrand ? activeBrand.name : "No brand selected"}
          {isDfy && canUse ? ` · ${products.length} product${products.length === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      <div className="p-6">
        {/* Guard: plain member somehow reached the URL */}
        {!canUse ? (
          <GuardPanel
            icon={ShieldAlert}
            title="Manager access required"
            body="The Client Console is available to managers and admins. Ask an admin to upgrade your role if you need access."
          />
        ) : !activeBrand ? (
          <GuardPanel
            icon={Building2}
            title="No brand selected"
            body="Pick a client brand from the switcher in the top-left to manage its share links and feedback."
          />
        ) : !isDfy ? (
          <GuardPanel
            icon={Building2}
            title={`${activeBrand.name} isn't a Done-For-You client`}
            body="The Client Console only applies to DFY clients. An admin can flag this brand as a client under Settings → Clients to turn it on."
          />
        ) : loadError ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-mono text-rose-300">
            Failed to load products: {loadError}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="text-white/20 animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <GuardPanel
            icon={Package}
            title="No products yet"
            body="Add a product to this brand from the Products page, then come back here to share it with the client."
          />
        ) : (
          <div className="space-y-8">
            {products.map((product, i) => (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
              >
                <ProductConsoleBlock product={product} showHeader={products.length > 1} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GuardPanel({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
}) {
  return (
    <div className="max-w-xl mx-auto mt-10 rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
        <Icon size={20} className="text-white/30" />
      </div>
      <h2 className="text-sm font-semibold text-white/80">{title}</h2>
      <p className="text-xs text-white/40 mt-2 leading-relaxed font-mono">{body}</p>
    </div>
  );
}
