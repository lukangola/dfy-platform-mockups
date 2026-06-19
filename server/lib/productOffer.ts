import { generateText } from "./anthropic.js";
import { extractJsonObject } from "./jsonExtract.js";
import { loadPrompt } from "./prompts.js";

/**
 * Structured result shape returned by the `offer_extract` prompt.
 * All fields are optional / nullable — the prompt returns what it finds.
 */
export interface OfferExtractResult {
  discount_label?: string | null;
  scarcity_line?: string | null;
  shipping_line?: string | null;
  guarantee_line?: string | null;
  trust_line?: string | null;
  cta_text?: string | null;
  secondary_cta_text?: string | null;
  free_gifts?: string[];
  raw_offer_summary?: string | null;
  countdown_label?: string | null;
  [key: string]: unknown;
}

/**
 * Derives a concise plain-English offer string from the structured
 * `offer_extract` JSON result, suitable to drop into the Copy Engine's
 * "front-end offer" field.
 *
 * Priority:
 *  1. `raw_offer_summary` if non-empty (prompt already crafted it for this use)
 *  2. A best-effort join of the populated fields (discount, free gifts,
 *     shipping, guarantee)
 *  3. null when nothing extractable is present
 */
export function buildOfferString(structured: OfferExtractResult): string | null {
  if (structured.raw_offer_summary && structured.raw_offer_summary.trim()) {
    return structured.raw_offer_summary.trim();
  }

  const parts: string[] = [];
  if (structured.discount_label) parts.push(structured.discount_label);
  if (Array.isArray(structured.free_gifts) && structured.free_gifts.length > 0) {
    parts.push(`free gifts: ${structured.free_gifts.join(", ")}`);
  }
  if (structured.shipping_line) parts.push(structured.shipping_line);
  if (structured.guarantee_line) parts.push(structured.guarantee_line);

  return parts.length > 0 ? parts.join(" + ") : null;
}

/**
 * Fetch `url`, run the `offer_extract` prompt against its HTML, and return
 * a concise offer string plus the full structured JSON.
 *
 * Tolerates fetch/parse failures gracefully: returns `{ offer: null,
 * structured: null }` on any error so callers never see an unexpected 500.
 */
export async function extractOfferFromUrl(
  url: string,
): Promise<{ offer: string | null; structured: OfferExtractResult | null }> {
  let pageContent = "";
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InanaBot/1.0)" },
    });
    const html = await r.text();
    pageContent = html.slice(0, 50_000);
  } catch (err) {
    console.warn(`[productOffer] failed to fetch ${url}:`, err);
  }

  if (!pageContent) {
    return { offer: null, structured: null };
  }

  try {
    const prompt = loadPrompt("offer_extract", { page_content: pageContent });
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Extract the offer from the page content above. Return only JSON.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens ?? 2000,
    });

    let structured: OfferExtractResult = {};
    try {
      structured = extractJsonObject<OfferExtractResult>(result.text, {
        stopReason: result.stopReason,
        action: "offer_extract",
      });
    } catch (parseErr) {
      console.error(
        `[productOffer] offer_extract JSON parse failed — stop_reason=${result.stopReason} tokensOut=${result.tokensOut}\nRAW:\n${result.text}`,
      );
      // Non-fatal: return what we can
    }

    const offer = buildOfferString(structured);
    return { offer, structured };
  } catch (err) {
    console.error(`[productOffer] extractOfferFromUrl failed for ${url}:`, err);
    return { offer: null, structured: null };
  }
}
