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

Output ONLY the JSON object. No markdown fences, no commentary, no preamble.

---

## OFFER PAGE CONTENT

{{page_content}}
