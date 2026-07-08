/**
 * Static Ad Recreator — image generation endpoint.
 *
 *   POST /api/static-ads/recreate
 *   Body: { productId, angleName, language?, referenceId, brand?, feedback?,
 *           previousOutputUrl?, pipelineCardId? }
 *   Returns: { url, referenceId, durationMs, model, promptVersion }
 *
 * One call per reference. The client fires these in parallel so the UI can
 * stream results in as each one completes.
 *
 * The pipeline itself (prompt composition, feedback-edit mode, error
 * classification, generations logging, model selection) lives in
 * server/lib/staticAdRecreate.ts so the durable-jobs executor
 * (server/lib/jobExecutors/staticAds.ts) runs the exact same code path.
 * This file is only the HTTP shell: parse/validate the body, call
 * runStaticAdRecreate, map StaticAdRecreateError onto the response.
 */
import { type Request, type Response, Router } from "express";
import {
  runStaticAdRecreate,
  StaticAdRecreateError,
  type StaticAdRecreateArgs,
} from "../lib/staticAdRecreate.js";

export const staticAdsRouter: Router = Router();

type RecreateBody = Partial<StaticAdRecreateArgs>;

function sendError(res: Response, status: number, message: string, extra?: Record<string, unknown>) {
  res.status(status).json({ error: message, ...extra });
}

staticAdsRouter.post("/recreate", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as RecreateBody;
  const { productId, angleName, referenceId } = body;
  if (!productId || !angleName || !referenceId) {
    return sendError(res, 400, "productId, angleName, and referenceId are required");
  }

  try {
    const result = await runStaticAdRecreate({
      productId,
      angleName,
      referenceId,
      language: body.language,
      brand: body.brand,
      feedback: body.feedback,
      previousOutputUrl: body.previousOutputUrl,
      pipelineCardId: body.pipelineCardId,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof StaticAdRecreateError) {
      // Validation failures carry a bare message (400/404); classified
      // pipeline failures carry { errorCode, retryable, rawError } in
      // `extra` and map to 500 — identical to the pre-extraction handler.
      return sendError(res, err.httpStatus, err.message, err.extra);
    }
    // Shouldn't happen — runStaticAdRecreate wraps every failure — but keep
    // a generic 500 so an unexpected throw can't hang the request.
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
