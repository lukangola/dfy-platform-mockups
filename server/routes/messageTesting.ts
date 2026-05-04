/**
 * Message Testing support routes.
 *
 * GET /api/message-testing/reference-style
 *   - Reads the hard-wired reference image at client/public/templates/editorial-quote-reference.jpg
 *   - Uploads it to fal.storage once (cached) so nano-banana-pro/edit can consume it
 *   - Runs a Claude vision call to extract a structured JSON style spec
 *   - Persists both to server/data/reference-style.json so subsequent hits are free
 *   - If the reference file is missing, responds with { missing: true } and the client falls back
 *     to the hand-authored editorial-quote composition.
 */
import { promises as fs } from "fs";
import path from "path";
import { type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { uploadToFalStorage } from "../lib/fal.js";

export const messageTestingRouter: Router = Router();

const REFERENCE_DIR = path.resolve(process.cwd(), "client/public/templates");
const REFERENCE_BASENAME = "editorial-quote-reference";
const CACHE_PATH = path.resolve(process.cwd(), "server/data/reference-style.json");

async function findReferenceFile(): Promise<{ absPath: string; mime: string; filename: string } | null> {
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const p = path.join(REFERENCE_DIR, `${REFERENCE_BASENAME}.${ext}`);
    try {
      await fs.access(p);
      const mime =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return { absPath: p, mime, filename: `${REFERENCE_BASENAME}.${ext}` };
    } catch {
      // try next
    }
  }
  return null;
}

type ReferenceStyle = {
  referenceImageUrl: string;
  style: Record<string, unknown>;
  sourceHash: string; // file size + mtime so we re-extract when the asset changes
  extractedAt: string;
};

async function readCache(): Promise<ReferenceStyle | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    return JSON.parse(raw) as ReferenceStyle;
  } catch {
    return null;
  }
}

async function writeCache(entry: ReferenceStyle): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(entry, null, 2), "utf8");
}

async function fileSignature(p: string): Promise<string | null> {
  try {
    const st = await fs.stat(p);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

const STYLE_EXTRACTION_PROMPT = `You are a design system analyst. Look at the reference advertisement image and extract a structured JSON spec so it can be reproduced 1:1 with different copy and different products.

Return ONLY valid JSON with these exact keys:
{
  "layout": "short description of the layout skeleton (grid, alignment, visual hierarchy)",
  "aspect_ratio": "e.g. 1:1, 9:16, 4:5",
  "background": {
    "description": "...",
    "primary_color_hex": "#RRGGBB",
    "secondary_color_hex": "#RRGGBB or null",
    "texture": "smooth / paper grain / gradient / noise / ..."
  },
  "typography": {
    "headline": {
      "font_family_style": "e.g. high-contrast editorial serif, grotesque sans, etc.",
      "weight": "e.g. regular, medium, bold, black",
      "style": "e.g. italic, roman, all caps",
      "color_hex": "#RRGGBB",
      "alignment": "left | center | right",
      "size_emphasis": "oversized / medium / subtle"
    },
    "supporting_text": "short description of any secondary type, or null"
  },
  "product_placement": {
    "position": "e.g. lower right, center, left third",
    "scale": "dominant / balanced / subtle",
    "lighting": "hard / soft / studio / natural window",
    "shadow": "e.g. soft natural drop shadow to the lower-left"
  },
  "color_palette_hex": ["#....", "#...."],
  "mood": "one phrase — e.g. 'editorial direct-response, warm and confident'",
  "brand_voice": "short — direct-response, luxury, quiet-luxury, zine, etc.",
  "direct_response_tone": true,
  "no_text_except_quote": true
}

No prose, no markdown fences, just the JSON object.`;

messageTestingRouter.get("/reference-style", async (_req: Request, res: Response) => {
  try {
    const found = await findReferenceFile();
    if (!found) {
      return res.json({
        missing: true,
        message:
          "Drop your reference image at client/public/templates/editorial-quote-reference.{jpg,png,webp} and reload.",
      });
    }

    const sig = await fileSignature(found.absPath);
    if (!sig) return res.json({ missing: true });

    const cached = await readCache();
    if (cached && cached.sourceHash === sig) {
      return res.json({
        referenceImageUrl: cached.referenceImageUrl,
        style: cached.style,
        cached: true,
        extractedAt: cached.extractedAt,
      });
    }

    // (Re-)upload the file to fal.storage so nano-banana-pro/edit can reference it.
    const buf = await fs.readFile(found.absPath);
    const referenceImageUrl = await uploadToFalStorage(buf, found.mime, found.filename);

    // Extract the style JSON via Claude vision.
    const result = await generateText({
      systemPrompt: STYLE_EXTRACTION_PROMPT,
      userMessage:
        "Extract the style spec for the attached reference advertisement. Output only the JSON object.",
      imageUrls: [referenceImageUrl],
      maxTokens: 3000,
    });

    const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let style: Record<string, unknown>;
    try {
      style = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({
        error: "Reference style extractor returned non-JSON",
        raw: cleaned.slice(0, 500),
      });
    }

    const entry: ReferenceStyle = {
      referenceImageUrl,
      style,
      sourceHash: sig,
      extractedAt: new Date().toISOString(),
    };
    await writeCache(entry);

    res.json({
      referenceImageUrl,
      style,
      cached: false,
      extractedAt: entry.extractedAt,
    });
  } catch (err) {
    console.error("[message-testing] reference-style failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
