---
expectsJson: true
model: claude-opus-4-7
maxTokens: 2000
---

# OFFER EXTRACTOR

You are given the rendered HTML / Markdown of a product offer page. Your job
is to extract the structured offer fields a marketer needs to build a landing
page CTA + offer block: discount, free gifts, shipping, guarantee, scarcity,
trust elements.

Return a single JSON object with this exact shape:

```json
{
  "discount_label": "e.g. \"Up to 58% off\" — verbatim if shown on page; otherwise short summary",
  "scarcity_line": "e.g. \"Only 142 units left in stock\" — short, one line; null if no scarcity signal",
  "shipping_line": "e.g. \"Free shipping on orders over €50\" — short; null if not mentioned",
  "guarantee_line": "e.g. \"90-day money-back guarantee\" — short; null if not mentioned",
  "trust_line": "e.g. \"Over 110,000 customers · 4.7★ rating\" — short trust/social-proof line; null if absent",
  "cta_text": "Short verb-led CTA matching the page's primary button, in the page's language. Default: \"Get the offer\"",
  "secondary_cta_text": "Optional secondary CTA, e.g. \"Learn more\". null if there isn't an obvious one.",
  "free_gifts": ["string", "..."],
  "raw_offer_summary": "One-line plain-English summary the listicle copy generator can use directly, e.g. \"Up to 58% off + free shaker bottle + free shipping over €50 + 90-day guarantee\"",
  "countdown_label": "e.g. \"Offer ends in\" — short; default to that exact phrase in the page's language"
}
```

Hard rules:
- **All fields in the OUTPUT LANGUAGE of the page** (German if the page is German, English if English, etc.). Detect the language from the page content.
- **Verbatim wherever possible.** Don't paraphrase real numbers, percentages, or guarantee windows. If the page says "90 Tage Geld-zurück", emit "90 Tage Geld-zurück-Garantie", not "money-back guarantee".
- **Null is preferred over fabrication.** If the page doesn't mention shipping, return `null` — not a made-up shipping line.
- **No invented free gifts or claims.** The `free_gifts` array contains only items explicitly mentioned on the page as included free; empty array if none.
- `raw_offer_summary` is the single line the upstream copy generator will weave into the listicle's CTA block — make it concrete and benefit-stacked.

**DISCOUNT PERCENTAGE RULES (the most-hallucinated field — read carefully):**
- If a "VERIFIED SHOPIFY PRICING" block appears at the bottom of the page content, the **MAX DISCOUNT** number in that block is the ground truth. Use it exactly. Do NOT pick a different number from anywhere else in the HTML. The HTML may contain dozens of unrelated percent values (badges, loyalty tiers, savings calculator widgets, comparison ribbons) — those are noise. Only the verified max discount counts.
- If there is NO verified pricing block, you may extract a discount only if the page renders a clear single headline like "Bis zu 40% Rabatt" or "Up to 40% off" in plain HTML text near the product title or hero. Otherwise return `null` for `discount_label`. Do NOT pick the largest random `%` you see in the markup — it's almost always wrong.
- Never fabricate a percentage. Never round up or down for visual appeal. Never average. Never guess based on "what feels promo-worthy".

Output ONLY the JSON object. No markdown fences, no commentary, no preamble.

---

## OFFER PAGE CONTENT

{{page_content}}
