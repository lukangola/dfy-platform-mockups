import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import { writeAngleArtifact } from "../lib/angle-artifacts.js";
import {
  generateArtifactRevision,
  type RevisableKind,
} from "../lib/artifact-revision.js";

/**
 * PUBLIC, UN-AUTHENTICATED share router (Phase 2 client share link).
 *
 * Mounted at /api/share with NO auth middleware, deliberately bypassing the
 * cookie-session gating that protects /api/products. Read-only access is
 * granted purely by possession of an unguessable 192-bit token (minted by
 * POST /api/products/:id/share). Because anyone with the URL can read this,
 * we NEVER return the raw product/brand rows — only an explicit whitelist of
 * client-facing fields. Internal data (shareToken, brand_url, costs, model,
 * image candidates, mechanism, artifact errors, IDs other than angle handles)
 * is intentionally omitted.
 */
export const shareRouter: Router = Router();

type SharedArtifact = {
  content: string | null;
  status: "running" | "complete" | "failed" | null;
};

type SharedAngle = {
  id: string;
  name: string;
  block: string;
  artifacts: {
    statements?: SharedArtifact;
    messages?: SharedArtifact;
    adCopy?: SharedArtifact;
  };
};

export type SharedResearchPayload = {
  brand: { name: string; logoUrl: string | null };
  product: { name: string };
  research: {
    markdown: string | null;
    angles: SharedAngle[];
  };
};

type RawArtifact = {
  content?: string | null;
  status?: "running" | "complete" | "failed";
};

type RawAngle = {
  id?: string;
  name?: string;
  block?: string;
  artifacts?: Partial<Record<"statements" | "messages" | "adCopy", RawArtifact>>;
};

const ARTIFACT_KINDS = ["statements", "messages", "adCopy"] as const;

/**
 * Backfill a stable `id` onto any angle that lacks one. Older products were
 * researched before angles carried IDs; the operator's GET /api/products/:id
 * heals them lazily, but a client may open the share link first — so we heal
 * here too. Returns the (possibly) updated angles plus whether anything
 * changed, so the caller can persist. Stable IDs matter because they become
 * the anchor handles (`angle-<id>`) that Phase 3 comments hang off.
 */
function ensureAngleIds(angles: RawAngle[]): { angles: RawAngle[]; changed: boolean } {
  let changed = false;
  const next = angles.map((a) => {
    if (a && typeof a === "object" && !a.id) {
      changed = true;
      return { ...a, id: randomUUID() };
    }
    return a;
  });
  return { angles: next, changed };
}

function sanitizeArtifact(raw: RawArtifact | undefined): SharedArtifact | undefined {
  if (!raw) return undefined;
  return {
    content: typeof raw.content === "string" ? raw.content : null,
    status: raw.status ?? null,
  };
}

function sanitizeAngle(raw: RawAngle): SharedAngle | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  const block = typeof raw.block === "string" ? raw.block : "";
  if (!id || !name) return null;

  const artifacts: SharedAngle["artifacts"] = {};
  for (const kind of ARTIFACT_KINDS) {
    const cleaned = sanitizeArtifact(raw.artifacts?.[kind]);
    if (cleaned) artifacts[kind] = cleaned;
  }
  return { id, name, block, artifacts };
}

// ── Phase 3: client feedback ───────────────────────────────────────────
//
// The client submits one structured response per "section anchor" — the same
// `angle-<id>` / `angle-<id>-messages` / `angle-<id>-adCopy` handles the
// checklist uses. We resolve the product purely by share token (so the public
// route never trusts a client-supplied product id) and validate that the
// anchor actually points at a real angle in this product's research before we
// persist anything.

type SectionKind = "angle" | "messages" | "adCopy";
type Verdict = "approved" | "changes";

/**
 * Lifecycle of an AI revision proposal, all stored as plain text in
 * share_feedback.suggestion_status:
 *   - "ready"    → a revision was generated and is awaiting the client's call
 *   - "applied"  → the client accepted; the revision was written LIVE to the
 *                  artifact immediately (no operator step). Feedback stays OPEN
 *                  so the operator gets a notification to acknowledge ("mark as
 *                  read"). The before→after is preserved via suggestion_original.
 *   - "declined" → the client chose "Send for manual review"; the original copy
 *                  is kept and the feedback stays open for the team to handle.
 *   - "failed"   → generation errored (see suggestionError)
 *   - null       → no proposal (e.g. an "approved" verdict, or an angle-level note)
 */
type SuggestionStatus =
  | "ready"
  | "applied"
  | "declined"
  | "failed"
  | null;

export type SharedFeedback = {
  anchorId: string;
  sectionKind: SectionKind;
  verdict: Verdict;
  note: string | null;
  clientName: string | null;
  suggestion: string | null;
  suggestionStatus: SuggestionStatus;
  suggestionError: string | null;
  updatedAt: string;
};

const NOTE_MAX = 4000;
const NAME_MAX = 120;

/**
 * Parse a section anchor into its angle id + which of the three feedback
 * targets it refers to. Returns null for anything that isn't a well-formed
 * `angle-…` handle, so the PUT route can 400 on garbage rather than storing it.
 */
function parseAnchor(anchorId: string): { angleId: string; sectionKind: SectionKind } | null {
  if (typeof anchorId !== "string" || !anchorId.startsWith("angle-")) return null;
  let rest = anchorId.slice("angle-".length);
  let sectionKind: SectionKind = "angle";
  if (rest.endsWith("-messages")) {
    sectionKind = "messages";
    rest = rest.slice(0, -"-messages".length);
  } else if (rest.endsWith("-adCopy")) {
    sectionKind = "adCopy";
    rest = rest.slice(0, -"-adCopy".length);
  }
  if (!rest) return null;
  return { angleId: rest, sectionKind };
}

function sanitizeNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, NOTE_MAX);
  return trimmed.length ? trimmed : null;
}

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, NAME_MAX);
  return trimmed.length ? trimmed : null;
}

function toFeedbackView(row: typeof schema.shareFeedback.$inferSelect): SharedFeedback {
  return {
    anchorId: row.anchorId,
    sectionKind: (row.sectionKind as SectionKind) ?? "angle",
    verdict: (row.verdict as Verdict) ?? "approved",
    note: row.note ?? null,
    clientName: row.clientName ?? null,
    suggestion: row.suggestion ?? null,
    suggestionStatus: (row.suggestionStatus as SuggestionStatus) ?? null,
    suggestionError: row.suggestionError ?? null,
    updatedAt: new Date(row.updatedAt as unknown as string).toISOString(),
  };
}

/**
 * Pull the angle (name + strategy block) and the current copy of one revisable
 * section out of a product's research. Returns null when the angle or the
 * section's copy is missing — the auto-revision path needs all three to run.
 */
function findRevisionInputs(
  product: { research: unknown },
  angleId: string,
  kind: RevisableKind,
): { angle: { name: string; block: string }; original: string } | null {
  const research = (product.research ?? {}) as { angles?: RawAngle[] };
  const angles = Array.isArray(research.angles) ? research.angles : [];
  const match = angles.find((a) => a && a.id === angleId);
  if (!match || typeof match.name !== "string" || typeof match.block !== "string") return null;
  const original = (match.artifacts?.[kind]?.content ?? "").trim();
  if (!original) return null;
  return { angle: { name: match.name, block: match.block }, original };
}

async function resolveSharedProduct(token: string | undefined) {
  if (!token) return null;
  const [product] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.shareToken, token))
    .limit(1);
  return product ?? null;
}

/** The angle ids that currently exist in a product's research. */
function angleIdsFor(product: { research: unknown }): Set<string> {
  const research = (product.research ?? {}) as { angles?: RawAngle[] };
  const angles = Array.isArray(research.angles) ? research.angles : [];
  const ids = new Set<string>();
  for (const a of angles) {
    if (a && typeof a.id === "string" && a.id) ids.add(a.id);
  }
  return ids;
}

function angleNameFor(product: { research: unknown }, angleId: string): string | null {
  const research = (product.research ?? {}) as { angles?: RawAngle[] };
  const angles = Array.isArray(research.angles) ? research.angles : [];
  const match = angles.find((a) => a && a.id === angleId);
  return match && typeof match.name === "string" ? match.name : null;
}

/**
 * GET /api/share/:token — resolve a product by its share token and return a
 * sanitized, read-only view of the research for the client document. 404s
 * (without distinguishing why) when the token is missing, revoked, or unknown.
 */
shareRouter.get("/:token", async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    if (!token) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.shareToken, token))
      .limit(1);
    if (!product) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [brand] = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.id, product.brandId))
      .limit(1);

    const research = (product.research ?? {}) as {
      markdown?: string;
      angles?: RawAngle[];
    };
    const rawAngles = Array.isArray(research.angles) ? research.angles : [];

    // Heal missing angle IDs (older products) and persist once, so the doc's
    // anchor handles are stable across reloads. Idempotent — once healed, no
    // further writes happen.
    const { angles: healedAngles, changed } = ensureAngleIds(rawAngles);
    if (changed) {
      await db
        .update(schema.products)
        .set({ research: { ...research, angles: healedAngles } })
        .where(eq(schema.products.id, product.id));
    }

    const angles = healedAngles
      .map(sanitizeAngle)
      .filter((a): a is SharedAngle => a !== null);

    const payload: SharedResearchPayload = {
      brand: {
        name: brand?.name ?? "",
        logoUrl: brand?.logoUrl ?? null,
      },
      product: { name: product.name },
      research: {
        markdown: typeof research.markdown === "string" ? research.markdown : null,
        angles,
      },
    };

    res.json(payload);
  } catch (err) {
    console.error("[share] resolve token failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /api/share/:token/feedback — the client's own previously-submitted
 * feedback for this share link, so the share page can rehydrate the checklist
 * and per-section verdicts on load (across devices, not just localStorage).
 * Scoped strictly to the current token. 404s the same way the doc route does
 * when the token is unknown/revoked.
 */
shareRouter.get("/:token/feedback", async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    const product = await resolveSharedProduct(token);
    if (!product) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select()
      .from(schema.shareFeedback)
      .where(eq(schema.shareFeedback.shareToken, token));
    res.json({ feedback: rows.map(toFeedbackView) });
  } catch (err) {
    console.error("[share] list feedback failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * PUT /api/share/:token/feedback/:anchorId — upsert the client's verdict +
 * optional note for one section. Idempotent per (token, anchor): resubmitting
 * overwrites the prior row and re-opens it for the operator (a fresh edit is
 * something to look at again). Rejects anchors that don't resolve to a real
 * angle in this product, so a client can't seed feedback for arbitrary handles.
 *
 * Client-driven AI revision: when the client asks for CHANGES on a text section
 * (messages | adCopy) and leaves a note, we generate a revised version inline —
 * synchronously, on this same request — and stash it on the row as a "ready"
 * proposal the client can then accept or decline. This is what makes the loop
 * feel instant: the operator no longer has to click a button to produce it.
 * Any prior proposal is reset first so a fresh edit always starts clean.
 */
shareRouter.put("/:token/feedback/:anchorId", async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    const anchorId = req.params.anchorId;
    const product = await resolveSharedProduct(token);
    if (!product) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const parsed = parseAnchor(anchorId);
    if (!parsed || !angleIdsFor(product).has(parsed.angleId)) {
      res.status(400).json({ error: "Unknown section" });
      return;
    }

    const body = (req.body ?? {}) as { verdict?: unknown; note?: unknown; clientName?: unknown };
    const verdict: Verdict | null =
      body.verdict === "approved" || body.verdict === "changes" ? body.verdict : null;
    if (!verdict) {
      res.status(400).json({ error: "verdict must be 'approved' or 'changes'" });
      return;
    }
    const note = sanitizeNote(body.note);
    const clientName = sanitizeName(body.clientName);
    const angleName = angleNameFor(product, parsed.angleId);

    // Upsert the verdict/note first, ALWAYS resetting any prior AI proposal —
    // a new edit invalidates whatever was generated last time.
    const [row] = await db
      .insert(schema.shareFeedback)
      .values({
        productId: product.id,
        shareToken: token,
        anchorId,
        angleId: parsed.angleId,
        angleName,
        sectionKind: parsed.sectionKind,
        verdict,
        note,
        clientName,
        status: "open",
        suggestion: null,
        suggestionStatus: null,
        suggestionError: null,
        suggestionOriginal: null,
      })
      .onConflictDoUpdate({
        target: [schema.shareFeedback.shareToken, schema.shareFeedback.anchorId],
        set: {
          verdict,
          note,
          clientName,
          angleName,
          sectionKind: parsed.sectionKind,
          status: "open",
          suggestion: null,
          suggestionStatus: null,
          suggestionError: null,
          suggestionOriginal: null,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    // Auto-generate a revision when the client requested changes on a revisable
    // text section and gave us a note to act on. Anything else (approvals,
    // angle-level notes, notes with no live copy to revise) returns as-is.
    const revisable =
      verdict === "changes" &&
      (parsed.sectionKind === "messages" || parsed.sectionKind === "adCopy") &&
      !!note;
    if (!revisable) {
      res.json({ feedback: toFeedbackView(row) });
      return;
    }

    const kind = parsed.sectionKind as RevisableKind;
    const inputs = findRevisionInputs(product, parsed.angleId, kind);
    if (!inputs) {
      // No live copy to revise — leave it as plain feedback for manual handling.
      res.json({ feedback: toFeedbackView(row) });
      return;
    }

    try {
      const result = await generateArtifactRevision({
        product,
        angle: inputs.angle,
        kind,
        original: inputs.original,
        feedback: note!,
      });

      await db.insert(schema.generations).values({
        action: "angle_artifact_revise",
        kind: "text",
        inputs: {
          productId: product.id,
          angleId: parsed.angleId,
          artifactKind: kind,
          feedbackId: row.id,
          note,
          original: inputs.original,
          source: "client_share",
        },
        output: { content: result.content },
        model: result.model,
        promptVersion: result.promptVersion,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: String(result.costUsd),
        durationMs: result.durationMs,
      });

      const [updated] = await db
        .update(schema.shareFeedback)
        .set({
          suggestion: result.content,
          suggestionStatus: "ready",
          suggestionError: null,
          // Snapshot the live copy NOW, before any accept overwrites it, so the
          // operator can later see the exact before→after that was applied.
          suggestionOriginal: inputs.original,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.shareFeedback.id, row.id))
        .returning();

      res.json({ feedback: toFeedbackView(updated) });
    } catch (genErr) {
      const msg = genErr instanceof Error ? genErr.message : String(genErr);
      console.error("[share] auto-revision failed:", genErr);
      const [updated] = await db
        .update(schema.shareFeedback)
        .set({
          suggestionStatus: "failed",
          suggestionError: msg,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.shareFeedback.id, row.id))
        .returning();
      res.json({ feedback: toFeedbackView(updated) });
    }
  } catch (err) {
    console.error("[share] submit feedback failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/share/:token/feedback/:anchorId/suggestion/accept — the CLIENT
 * accepts the generated revision. Per the client-driven design, this applies
 * the revision to the LIVE artifact IMMEDIATELY (no operator approval step):
 * we write `fb.suggestion` into the angle's message/adCopy slot via
 * writeAngleArtifact and mark the proposal "applied". The feedback stays OPEN
 * so the operator gets a notification (the before→after diff, from
 * suggestion_original → suggestion) to acknowledge with "mark as read". Only
 * valid while the proposal is still "ready".
 *
 * Note: this is the one write the PUBLIC, token-gated route performs against
 * live product copy. Blast radius is limited to the single product addressed by
 * this 192-bit share token and to the two hand-editable artifact kinds.
 */
shareRouter.post("/:token/feedback/:anchorId/suggestion/accept", async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    const anchorId = req.params.anchorId;
    const product = await resolveSharedProduct(token);
    if (!product) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [fb] = await db
      .select()
      .from(schema.shareFeedback)
      .where(
        and(
          eq(schema.shareFeedback.shareToken, token),
          eq(schema.shareFeedback.anchorId, anchorId),
        ),
      )
      .limit(1);
    if (!fb) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (fb.suggestionStatus !== "ready") {
      res.status(409).json({ error: "There is no pending revision to accept" });
      return;
    }

    const kind = fb.sectionKind;
    if (kind !== "messages" && kind !== "adCopy") {
      res.status(400).json({ error: "This section can't be revised automatically" });
      return;
    }
    if (!fb.angleId) {
      res.status(400).json({ error: "Feedback is not tied to an angle" });
      return;
    }
    const content = (fb.suggestion ?? "").trim();
    if (!content) {
      res.status(400).json({ error: "There is no revised copy to apply" });
      return;
    }

    // Snapshot the BEFORE copy. It's normally captured at generation time, but
    // we also re-capture here as a fallback: the live artifact still holds the
    // pre-overwrite content at this exact moment, so reading it now guarantees
    // the operator always sees a real before→after even for older proposals that
    // predate the generation-time snapshot.
    const liveBefore = findRevisionInputs(product, fb.angleId, kind)?.original ?? null;
    const before = (fb.suggestionOriginal && fb.suggestionOriginal.trim())
      ? fb.suggestionOriginal
      : liveBefore;

    // Apply LIVE — overwrite the angle's cached message/adCopy artifact with the
    // accepted revision.
    await writeAngleArtifact(product.id, fb.angleId, kind, {
      content,
      status: "complete",
      error: null,
      generatedAt: new Date().toISOString(),
    });

    const [updated] = await db
      .update(schema.shareFeedback)
      .set({
        suggestionStatus: "applied",
        suggestionOriginal: before,
        status: "open",
        updatedAt: sql`now()`,
      })
      .where(eq(schema.shareFeedback.id, fb.id))
      .returning();

    res.json({ feedback: toFeedbackView(updated) });
  } catch (err) {
    console.error("[share] accept suggestion failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/share/:token/feedback/:anchorId/suggestion/decline — the CLIENT
 * declines the generated revision and asks the team to handle their note
 * manually. The original copy is kept, the feedback stays OPEN (so the operator
 * still sees it in the inbox), and the proposal is marked "declined". Only valid
 * while the proposal is still "ready".
 */
shareRouter.post("/:token/feedback/:anchorId/suggestion/decline", async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    const anchorId = req.params.anchorId;
    const product = await resolveSharedProduct(token);
    if (!product) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [fb] = await db
      .select()
      .from(schema.shareFeedback)
      .where(
        and(
          eq(schema.shareFeedback.shareToken, token),
          eq(schema.shareFeedback.anchorId, anchorId),
        ),
      )
      .limit(1);
    if (!fb) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (fb.suggestionStatus !== "ready") {
      res.status(409).json({ error: "There is no pending revision to decline" });
      return;
    }

    const [updated] = await db
      .update(schema.shareFeedback)
      .set({ suggestionStatus: "declined", status: "open", updatedAt: sql`now()` })
      .where(eq(schema.shareFeedback.id, fb.id))
      .returning();

    res.json({ feedback: toFeedbackView(updated) });
  } catch (err) {
    console.error("[share] decline suggestion failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * DELETE /api/share/:token/feedback/:anchorId — clear the client's feedback for
 * one section (they changed their mind / un-submit). No-op (still 200) if there
 * was nothing stored, so the client UI can call it optimistically.
 */
shareRouter.delete("/:token/feedback/:anchorId", async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    const anchorId = req.params.anchorId;
    const product = await resolveSharedProduct(token);
    if (!product) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .delete(schema.shareFeedback)
      .where(
        and(
          eq(schema.shareFeedback.shareToken, token),
          eq(schema.shareFeedback.anchorId, anchorId),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    console.error("[share] clear feedback failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
