/**
 * Ad Pipeline background enrichment. On card creation we either transcribe the
 * video (reusing fal/whisper) or create a static_ad_reference + deconstruct it
 * (reusing runDeconstruction). Run state is kept in-memory per card, mirroring
 * adConsolePull.ts — transient progress for a single-instance tool.
 */
import { pickVideoUrl } from "./adPipeline.js";

export type EnrichmentPlan =
  | { kind: "use_existing_transcript"; transcript: string }
  | { kind: "transcribe"; audioUrl: string }
  | { kind: "deconstruct"; imageUrl: string }
  | { kind: "noop" };

/** Decide what enrichment a freshly-created card needs (pure). */
export function enrichmentPlan(card: {
  format: string;
  transcript: string | null;
  referenceMediaUrls: string[];
}): EnrichmentPlan {
  if (card.format === "static") {
    const imageUrl = card.referenceMediaUrls[0];
    return imageUrl ? { kind: "deconstruct", imageUrl } : { kind: "noop" };
  }
  // video / organic
  if (card.transcript && card.transcript.trim()) {
    return { kind: "use_existing_transcript", transcript: card.transcript.trim() };
  }
  const audioUrl = pickVideoUrl(card.referenceMediaUrls);
  return audioUrl ? { kind: "transcribe", audioUrl } : { kind: "noop" };
}

import { db, schema } from "./db.js";
import { eq } from "drizzle-orm";
import { transcribeAudio } from "./fal.js";
import { runDeconstruction } from "../routes/staticAdReferences.js";

export type EnrichJobStatus = "pending" | "running" | "complete" | "failed";

type EnrichJob = { cardId: string; status: EnrichJobStatus; error: string | null };
const jobs = new Map<string, EnrichJob>();

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Current enrichment job snapshot for a card (null if none ran this process). */
export function getEnrichJob(cardId: string): EnrichJob | null {
  return jobs.get(cardId) ?? null;
}

/**
 * Fire-and-forget enrichment for a card. Reads the card, runs the planned work,
 * and writes the result (originalScript / staticReferenceId) + bgJobStatus back
 * onto the card row. Safe to call once per card creation.
 */
export function startEnrichment(cardId: string): void {
  const existing = jobs.get(cardId);
  if (existing && existing.status === "running") return;
  const job: EnrichJob = { cardId, status: "running", error: null };
  jobs.set(cardId, job);
  void runEnrichment(job).catch((err) => {
    job.status = "failed";
    job.error = msg(err);
  });
}

async function setCard(cardId: string, patch: Partial<typeof schema.adPipelineCards.$inferInsert>): Promise<void> {
  await db
    .update(schema.adPipelineCards)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.adPipelineCards.id, cardId));
}

async function runEnrichment(job: EnrichJob): Promise<void> {
  const { cardId } = job;
  await setCard(cardId, { bgJobStatus: "running", bgJobError: null });

  const [card] = await db
    .select()
    .from(schema.adPipelineCards)
    .where(eq(schema.adPipelineCards.id, cardId))
    .limit(1);
  if (!card) {
    job.status = "failed";
    job.error = "card not found";
    return;
  }

  const brief = (card.brief ?? {}) as { referenceMediaUrls?: string[]; transcript?: string | null; niche?: string | null };
  const plan = enrichmentPlan({
    format: card.format,
    transcript: brief.transcript ?? card.originalScript ?? null,
    referenceMediaUrls: brief.referenceMediaUrls ?? [],
  });

  try {
    if (plan.kind === "use_existing_transcript") {
      await setCard(cardId, { originalScript: plan.transcript, bgJobStatus: "complete" });
    } else if (plan.kind === "transcribe") {
      const t = await transcribeAudio({ audioUrl: plan.audioUrl });
      await setCard(cardId, { originalScript: t.text || null, bgJobStatus: "complete" });
    } else if (plan.kind === "deconstruct") {
      const [ref] = await db
        .insert(schema.staticAdReferences)
        .values({
          title: `${brief.niche ?? "ad"} — pipeline ${cardId.slice(0, 8)}`,
          niche: brief.niche || "other",
          imageUrl: plan.imageUrl,
          deconstructionStatus: "pending",
        })
        .returning();
      if (!ref) throw new Error("failed to create static_ad_reference");
      await setCard(cardId, { staticReferenceId: ref.id });
      // Await so the card's bgJobStatus reflects deconstruction completion.
      await runDeconstruction(ref.id);
      await setCard(cardId, { bgJobStatus: "complete" });
    } else {
      // noop — nothing to enrich (e.g. video with no media). Mark complete so the
      // card isn't stuck "pending"; it remains usable with whatever copy exists.
      await setCard(cardId, { bgJobStatus: "complete" });
    }
    job.status = "complete";
  } catch (err) {
    // Non-fatal: card stays usable (whisper/vision failure shouldn't block recreation).
    job.status = "failed";
    job.error = msg(err);
    await setCard(cardId, { bgJobStatus: "failed", bgJobError: msg(err) });
  }
}
