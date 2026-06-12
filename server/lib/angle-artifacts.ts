import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";

/**
 * Shared per-angle artifact storage helpers. Each strategic angle in a product's
 * research owns up to three lazily-generated, cached sub-artifacts:
 *   - statements → web-mined customer resonance statements
 *   - messages   → first-person ad messages
 *   - adCopy     → a complete primary ad
 *
 * These live here (not inside the products route) so BOTH the authed operator
 * route AND the public client-facing share route can read-modify-write a single
 * angle's artifact slot without duplicating the merge logic or importing one
 * route module into another.
 */
export type AngleArtifactKind = "statements" | "messages" | "adCopy";

export type AngleArtifact = {
  content?: string | null;
  status?: "running" | "complete" | "failed";
  error?: string | null;
  generatedAt?: string;
};

export type StoredAngle = {
  id?: string;
  name: string;
  block: string;
  artifacts?: Partial<Record<AngleArtifactKind, AngleArtifact>>;
};

/**
 * Read-modify-write ONE angle's ONE artifact slot, merging the given fields into
 * whatever was there before (so a status flip doesn't wipe cached content, and a
 * content write doesn't clobber an unrelated error). No-op if the product or
 * angle can't be found. Touches only the targeted angle — siblings are untouched.
 */
export async function writeAngleArtifact(
  productId: string,
  angleId: string,
  kind: AngleArtifactKind,
  artifact: AngleArtifact,
): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1);
  if (!row) return;
  const research = (row.research ?? {}) as Record<string, unknown>;
  const angles = (Array.isArray((research as { angles?: unknown }).angles)
    ? (research as { angles: StoredAngle[] }).angles
    : []) as StoredAngle[];
  const idx = angles.findIndex((a) => a.id === angleId);
  if (idx === -1) return;
  const prev = angles[idx];
  const prevArtifacts = prev.artifacts ?? {};
  const merged: AngleArtifact = { ...(prevArtifacts[kind] ?? {}), ...artifact };
  const next = [...angles];
  next[idx] = { ...prev, artifacts: { ...prevArtifacts, [kind]: merged } };
  await db
    .update(schema.products)
    .set({ research: { ...research, angles: next } })
    .where(eq(schema.products.id, productId));
}
