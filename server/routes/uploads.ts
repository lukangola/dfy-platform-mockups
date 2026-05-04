import { type Request, type Response, Router } from "express";
import { uploadToFalStorage } from "../lib/fal.js";

export const uploadsRouter: Router = Router();

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

async function handleImageUpload(req: Request, res: Response, prefix: string) {
  try {
    const body = (req.body ?? {}) as { dataUrl?: string; filename?: string };
    if (!body.dataUrl || !body.dataUrl.startsWith("data:")) {
      return sendError(res, 400, "dataUrl (data:<mime>;base64,...) is required");
    }
    const match = body.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return sendError(res, 400, "dataUrl must be base64-encoded");
    const mime = match[1];
    if (!mime.startsWith("image/")) return sendError(res, 400, "Only image/* uploads are allowed");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.byteLength > 8 * 1024 * 1024) return sendError(res, 413, "Image exceeds 8MB limit");

    const ext = mime.split("/")[1]?.split("+")[0] ?? "png";
    const filename = body.filename?.replace(/[^a-z0-9._-]/gi, "_") || `${prefix}-${Date.now()}.${ext}`;
    const url = await uploadToFalStorage(buffer, mime, filename);
    res.json({ url });
  } catch (err) {
    console.error(`[uploads] ${prefix} failed:`, err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
}

uploadsRouter.post("/character-image", (req, res) => handleImageUpload(req, res, "character"));
uploadsRouter.post("/product-image", (req, res) => handleImageUpload(req, res, "product"));
