/**
 * Multi-brand state container.
 *
 * Holds the list of brands, the currently-active brand (persisted in
 * localStorage), and the creation/refresh helpers that the BrandSwitcher and
 * CreateBrandDialog use. Every page that fetches brand-scoped data reads
 * `activeBrandId` from here.
 *
 * Brand research runs async on the server after create, so pages that depend
 * on it can call `refreshBrand(id)` to repoll while the spinner is visible.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  createBrand as apiCreateBrand,
  getBrand as apiGetBrand,
  listBrands as apiListBrands,
  type Brand,
  type Product,
} from "@/lib/api";

const LS_ACTIVE_BRAND_ID = "activeBrandId";
const DEFAULT_BRAND_ID = "00000000-0000-0000-0000-000000000001";

type BrandContextValue = {
  brands: Brand[];
  activeBrandId: string | null;
  activeBrand: Brand | null;
  loading: boolean;
  error: string | null;
  setActiveBrandId: (id: string) => void;
  refreshBrands: () => Promise<void>;
  refreshBrand: (id: string) => Promise<Brand | null>;
  createBrand: (args: {
    brandUrl: string;
    productUrl?: string;
    factSheet?: string;
    productName?: string;
    productImageUrl: string;
    productBackImageUrl: string;
  }) => Promise<{ brand: Brand; product: Product }>;
};

const BrandContext = createContext<BrandContextValue | undefined>(undefined);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrandId, setActiveBrandIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_ACTIVE_BRAND_ID);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshBrands = useCallback(async () => {
    try {
      const { brands: next } = await apiListBrands();
      setBrands(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshBrand = useCallback(async (id: string) => {
    try {
      const { brand } = await apiGetBrand(id);
      setBrands((prev) => {
        const idx = prev.findIndex((b) => b.id === brand.id);
        if (idx === -1) return [brand, ...prev];
        const next = [...prev];
        next[idx] = brand;
        return next;
      });
      return brand;
    } catch (err) {
      console.warn("[brand] refreshBrand failed:", err);
      return null;
    }
  }, []);

  // Initial load. If no active brand stored, pick the first brand returned
  // (or the Default Brand seeded by the migration).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { brands: next } = await apiListBrands();
        if (cancelled) return;
        setBrands(next);
        if (next.length === 0) {
          setActiveBrandIdState(null);
        } else {
          const stored = activeBrandId;
          const exists = stored && next.some((b) => b.id === stored);
          if (!exists) {
            const fallback =
              next.find((b) => b.id === DEFAULT_BRAND_ID)?.id ?? next[0].id;
            setActiveBrandIdState(fallback);
            try {
              localStorage.setItem(LS_ACTIVE_BRAND_ID, fallback);
            } catch {
              // localStorage can fail in private-mode Safari; just carry on.
            }
          }
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
    // activeBrandId is read only for pick-a-fallback on first load, not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setActiveBrandId = useCallback((id: string) => {
    setActiveBrandIdState(id);
    try {
      localStorage.setItem(LS_ACTIVE_BRAND_ID, id);
    } catch {
      // same as above — non-fatal.
    }
  }, []);

  const createBrand = useCallback<BrandContextValue["createBrand"]>(
    async (args) => {
      const result = await apiCreateBrand(args);
      setBrands((prev) => [result.brand, ...prev]);
      setActiveBrandId(result.brand.id);
      return result;
    },
    [setActiveBrandId]
  );

  const activeBrand = useMemo(
    () => brands.find((b) => b.id === activeBrandId) ?? null,
    [brands, activeBrandId]
  );

  const value = useMemo<BrandContextValue>(
    () => ({
      brands,
      activeBrandId,
      activeBrand,
      loading,
      error,
      setActiveBrandId,
      refreshBrands,
      refreshBrand,
      createBrand,
    }),
    [brands, activeBrandId, activeBrand, loading, error, setActiveBrandId, refreshBrands, refreshBrand, createBrand]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error("useBrand must be used within a BrandProvider");
  return ctx;
}
