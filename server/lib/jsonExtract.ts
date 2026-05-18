/**
 * Robust JSON extraction from LLM responses.
 *
 * Claude responses that should be "pure JSON" sometimes have small
 * deviations that break a strict `JSON.parse`:
 *   - leading text ("Here's the JSON:")
 *   - trailing text ("Let me know if you need anything else.")
 *   - markdown code fences (```json ... ```)
 *   - truncation mid-object (max_tokens hit) — the JSON is incomplete
 *
 * `extractJsonObject` tries, in order:
 *   1. Strip ```json fences + trim. Direct `JSON.parse`.
 *   2. Find the first `{` and a balanced matching `}` (skipping braces
 *      inside string literals + escape sequences). Try `JSON.parse` on
 *      that slice.
 *   3. Throw a rich error with stop_reason + total length + last 300
 *      chars (the END is where truncation manifests).
 *
 * Used by every route handler that asks Claude for a JSON object —
 * brand_extract, offer_extract, ad_extract_angle, deconstruction, etc.
 * Centralised so a single fix benefits every JSON-returning prompt.
 */
export function extractJsonObject<T = unknown>(
  raw: string,
  context?: { stopReason?: string | null; action?: string },
): T {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  // Path 1: clean object on its own.
  try {
    return JSON.parse(stripped) as T;
  } catch {
    /* fall through */
  }

  // Path 2: pick the first balanced { ... } object out of the text.
  const balanced = findFirstBalancedObject(stripped);
  if (balanced) {
    try {
      return JSON.parse(balanced) as T;
    } catch {
      /* fall through */
    }
  }

  // Build a diagnostic that's actually useful — first 200 + last 300
  // chars (truncation evidence lives at the end), plus stop_reason if
  // the caller has it (max_tokens means we hit the budget).
  const head = stripped.slice(0, 200);
  const tail = stripped.length > 500 ? "…" + stripped.slice(-300) : "";
  const stopHint = context?.stopReason ? ` [stop_reason=${context.stopReason}]` : "";
  const action = context?.action ?? "extractor";
  throw new Error(
    `${action} returned non-JSON${stopHint} (len=${stripped.length}): ${head}${tail}`,
  );
}

/**
 * Walk the string left-to-right, tracking string-literal state so braces
 * inside `"..."` don't count, until the outer `{` closes. Returns the
 * substring `{...}` (inclusive) or null if no balanced object exists.
 * Truncated input where the closing brace is missing returns null.
 */
function findFirstBalancedObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
