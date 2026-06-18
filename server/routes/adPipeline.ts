/**
 * Ad Pipeline routes (managers + admins).
 *
 *   GET  /api/ad-pipeline/brands/:brandId/cards                — list cards + outputs
 *   POST /api/ad-pipeline/brands/:brandId/cards               — create from a feed item
 *   GET  /api/ad-pipeline/cards/:cardId                       — one card + output
 *   PUT  /api/ad-pipeline/cards/:cardId                       — update stage / product / angle
 *   GET  /api/ad-pipeline/cards/:cardId/job-status           — enrichment job snapshot
 */
import { type Request, type Response, Router } from "express";
import { requireAuth, requireManager } from "../lib/auth.js";
import {
  createCardFromFeedItem,
  getCardWithOutput,
  listCardsWithOutputs,
  updateCard,
  type AdPipelineStage,
} from "../lib/adPipeline.js";
import { getEnrichJob } from "../lib/adPipelineEnrich.js";

export const adPipelineRouter: Router = Router();

adPipelineRouter.use(requireAuth, requireManager);

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

adPipelineRouter.get("/brands/:brandId/cards", async (req: Request, res: Response) => {
  try {
    const cards = await listCardsWithOutputs(req.params.brandId);
    res.json({ cards });
  } catch (err) {
    console.error("[ad-pipeline] list cards failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

adPipelineRouter.post("/brands/:brandId/cards", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      feedItemId?: string;
      mode?: "idea" | "recreate";
      productId?: string | null;
      angleName?: string | null;
      language?: string | null;
    };
    if (!body.feedItemId) return sendError(res, 400, "feedItemId is required");
    const mode = body.mode === "recreate" ? "recreate" : "idea";
    const card = await createCardFromFeedItem({
      brandId: req.params.brandId,
      feedItemId: body.feedItemId,
      mode,
      productId: body.productId ?? null,
      angleName: body.angleName ?? null,
      language: body.language ?? null,
      userId: req.auth?.user.id ?? null,
    });
    if (!card) return sendError(res, 404, "Feed item not found");
    res.status(201).json({ card });
  } catch (err) {
    console.error("[ad-pipeline] create card failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

adPipelineRouter.get("/cards/:cardId", async (req: Request, res: Response) => {
  try {
    const brandId = String(req.query.brandId ?? "");
    if (!brandId) return sendError(res, 400, "brandId query param is required");
    const card = await getCardWithOutput(brandId, req.params.cardId);
    if (!card) return sendError(res, 404, "Card not found");
    res.json({ card });
  } catch (err) {
    console.error("[ad-pipeline] get card failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

adPipelineRouter.put("/cards/:cardId", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      brandId?: string;
      stage?: AdPipelineStage;
      productId?: string | null;
      angleName?: string | null;
      language?: string | null;
    };
    if (!body.brandId) return sendError(res, 400, "brandId is required");
    const card = await updateCard(body.brandId, req.params.cardId, {
      stage: body.stage,
      productId: body.productId,
      angleName: body.angleName,
      language: body.language,
    });
    if (!card) return sendError(res, 404, "Card not found");
    res.json({ card });
  } catch (err) {
    console.error("[ad-pipeline] update card failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

adPipelineRouter.get("/cards/:cardId/job-status", async (req: Request, res: Response) => {
  try {
    res.json({ job: getEnrichJob(req.params.cardId) });
  } catch (err) {
    console.error("[ad-pipeline] job status failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
