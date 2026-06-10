---
model: fal-ai/nano-banana-pro/edit
---

RECREATION PROMPT

You are adapting a reference static ad to a new product. Preserve the reference's visual structure exactly, but rewrite EVERY piece of visible copy so it speaks directly to the audience defined by the selected ANGLE.

---

LANGUAGE — HARD RULE, OVERRIDES THE REFERENCE

OUTPUT LANGUAGE: **{{language}}**

Every single piece of visible copy in the final image — headline, sub-headline, bullets, callouts, badges, button labels, footer, disclaimers, watermarks, on-pack copy you re-render, hand-written-style annotations, EVERYTHING — must be written in **{{language}}**.

The REFERENCE AD may be in a different language (often German, French, English, Spanish, etc.). The REFERENCE AD STRUCTURAL ANALYSIS below contains literal copy strings from the original — those are STRUCTURAL EXAMPLES to show you the layout pattern, NOT text to copy. Treat every copy snippet in the deconstruction as if it were in a placeholder language; rewrite it in {{language}}.

Hard rules:

1. No copy in any language other than **{{language}}** may appear in the final image. Not in headlines, not in fine print, not in URLs or hashtags, not in mock product labels you add on top of the real product label.
2. If the reference's headline is German "Aktiviere Deine Energie", and {{language}} is English, the rewrite is an English headline that follows the SAME shape ("Activate Your Energy") — not the German original, not a German-English mix.
3. Brand name, product name, and the real product's existing on-pack label stay as they are (those are product identity, not ad copy). Everything else is in {{language}}.
4. If you're tempted to keep a phrase "because it sounds catchy in the source language", DON'T. Rewrite it in {{language}}.

---

COPY RULE — PRESERVE THE REFERENCE'S CLAIM, TRANSLATE IT THROUGH THE ANGLE

Every reference ad has its own distinct claim, hook, and message approach — that uniqueness is exactly why we chose it. Your job is NOT to replace every reference's headline with a generic pitch for the angle. Your job is to rewrite THIS reference's specific claim for THIS product, targeted at the audience defined by the angle.

Think of it as a three-way translation:

- WHAT the reference says (its unique claim / hook / message pattern — e.g. a specific before/after, an ingredient reveal, a bold contrarian stat, a testimonial fragment, a problem callout)
- WHO we're speaking to (the angle's audience — their vocabulary, pains, desires, objections)
- WHAT we're selling (the new product's actual benefits and mechanism)

Rewrite the reference's claim so it's still recognisably the same *kind* of claim (same hook shape, same emotional beat, same message pattern), but re-expressed for this product and this audience. If the reference's headline is a specific stat ("97% saw results in 14 days"), your rewrite should also be a specific stat — relevant to this product and resonant with this angle's audience. If the reference is a bold first-person testimonial, your rewrite is also a bold first-person testimonial — in the voice of the angle's audience, about this product.

Rules:

1. Start from the reference ad's actual copy and claim, not from scratch. Preserve its hook shape, message pattern, emotional register, and structural voice. Don't homogenise across references — if ten different references all produce ten different kinds of ads, ten recreations should also produce ten visibly different ads.
2. Do NOT literally copy the reference's words. Rewrite them so they reference the new product and land for the angle's audience.
3. Stay within the angle. The audience lens is how you decide vocabulary, pain framing, specificity, and which product benefits to surface — but the angle does NOT dictate a single headline template that gets reused across every creative.
4. Preserve the reference ad's copy SLOTS (how many lines of headline, how many bullets, lengths, hierarchy) and the reference's specific COPY PATTERN (before/after, numbered list, stat callout, testimonial, problem-solution, etc.).
5. Only pull from the angle's messaging pillars where they fit naturally into the reference's existing message slots — not as a forced overwrite.

A reader who matches the angle's audience should feel "this is for me" — but across ten recreations they should see ten distinct executions, not the same claim ten times.

---

BRAND VISUAL IDENTITY — HARD RULE, OVERRIDES THE REFERENCE'S COLORS + FONTS

The reference ad dictates LAYOUT (where things go, how they stack, copy slot sizes, hierarchy, spacing, photographic mood). The BRAND dictates VISUAL IDENTITY (which colors fill those slots, which fonts render the copy, which logo appears). These are separate responsibilities — do not let the reference's colors or fonts leak into the final output.

USE THESE BRAND TOKENS — they are concrete and authoritative. Do NOT substitute the reference ad's hex codes or font families for them:

- **Primary / CTA color** → `{{PRIMARY_HEX}}`
  Use this color for the primary action button background, primary headline accent, and any "primary brand color" surface the reference uses. If the reference's CTA was forest green and {{PRIMARY_HEX}} is terracotta, the rewrite's CTA is terracotta.
- **Page / background color** → `{{BG_HEX}}`
  Use this as the main canvas / page background where the reference shows a solid color. Override the reference's background even if the reference looks "fine" in its original color.
- **Body / paragraph text color** → `{{BODY_TEXT_HEX}}`
  Use this for body copy, sub-headlines, and supporting text. Override the reference's text color even when the reference uses pure black.
- **Heading / display font** → `{{FONT_HEADING}}`
  Render headlines, sub-headlines, and any display-weight type in this family. If the reference uses a chunky condensed sans and {{FONT_HEADING}} is an elegant serif, the rewrite uses the serif — preserve the reference's SCALE and WEIGHT relationships, but in the brand's family.
- **Body / paragraph font** → `{{FONT_BODY}}`
  Render body copy, bullets, fine print, and footers in this family.

Hard rules:

1. NEVER copy the reference ad's exact hex codes. The reference is a structural blueprint, not a color palette source. Sample the brand tokens above instead.
2. NEVER copy the reference ad's font family. Preserve the reference's typographic SCALE (how big the headline is relative to body, weight contrast, alignment) — but render it in {{FONT_HEADING}} / {{FONT_BODY}}.
3. The brand's color tokens are not optional. If the reference uses purple and the brand is amber, the rewrite uses amber — even if purple "would look good".
4. If a brand token is marked "(not specified)", fall back to a color or font derived from the BRAND block lower in this prompt — but still do not copy the reference's identity. The reference's identity is never the right answer.

When the brand has multiple palette colors, default to using {{PRIMARY_HEX}} for the primary brand surface and {{BG_HEX}} for the background; reach for the other palette colors only for secondary accents (badges, dividers, illustrative details) where the reference has multiple accent surfaces.

The brand wordmark (logo) shown in the BRAND block, where present, replaces any logo / brand mark slot the reference ad uses. The reference's logo does not appear in the final output.

---

GENERAL VISUAL + COPY RULES

Communicate product benefits in simple, consumer-friendly language. No jargon unless the angle's audience specifically uses it.

Do NOT change the reference ad's layout, hierarchy, composition, typography scale, or visual structure. Only swap in the new product (from the PRODUCT IMAGE), the brand's visual identity (colors + fonts above), and rewrite the copy for the angle.

All copy must be written in the LANGUAGE specified above — see the LANGUAGE — HARD RULE section. The reference ad's source language does NOT override the LANGUAGE directive under any circumstance.

---

PRODUCT FIDELITY — THE PRODUCT IS NOT REDESIGNABLE

The product shown in PRODUCT IMAGE (hero) is a real physical object. Its shape, silhouette, and proportions are fixed. You may reposition it, rescale it uniformly, rotate it slightly, or relight it to match the reference ad's composition — but you must NEVER alter its intrinsic proportions.

Hard product rules — these override any compositional temptation to "make it fit":

1. PRESERVE the product's aspect ratio EXACTLY. Height-to-width must match the PRODUCT IMAGE **and** the dimension lines on the PRODUCT REFERENCE SHEET. Do not squash, stretch, elongate, flatten, widen, narrow, or re-proportion the packaging under any circumstances. Uniform scale only — never non-uniform scale. When the hero shot and the reference sheet disagree on any proportional detail, the REFERENCE SHEET wins — it is the technical blueprint.
2. PRESERVE the product's silhouette and physical form factor. A pouch stays the same pouch shape. A bottle stays the same bottle shape. A tube stays the same tube shape. Do not redesign, redraw, or reinterpret the packaging geometry.
3. PRESERVE the label layout, label proportions, logo placement, and typographic hierarchy on the pack exactly as they appear in PRODUCT IMAGE (cross-checked against PRODUCT CONTENT IMAGE for detail). The label is not a creative canvas — reproduce it faithfully.
4. If the reference ad's product slot has a different aspect ratio than this product's actual aspect ratio, DO NOT deform the product to fit. Instead, scale the product uniformly and let it occupy the slot with correct proportions, even if that leaves some empty space — correct proportions beat filling every pixel of the reference's product area.
5. Colour, finish, and material of the packaging must match PRODUCT IMAGE. No creative reinterpretation of pack colour or texture.

If in doubt between matching the reference's product silhouette vs. matching the real product's silhouette, ALWAYS match the real product. The reference ad only dictates layout, composition, and copy pattern — it does NOT dictate what the product looks like.

---

INPUT IMAGES (in order)

1. REFERENCE AD — this is the STRUCTURAL template only. Preserve its exact layout, hierarchy, composition, typography style, and overall look. Only swap in the new product and adapt the copy. The reference's product does NOT dictate what this product should look like — use the reference purely for layout, never for product geometry.
2. PRODUCT IMAGE (hero) — the main product shot. This is the AUTHORITATIVE source of the product's shape, silhouette, aspect ratio, proportions, label layout, colours, and materials. Render the product in the final ad so it is immediately recognisable as the SAME physical object as in this image. Preserve its aspect ratio and proportions exactly — never squash, stretch, or re-proportion the packaging to match the reference ad's product slot.
3. PRODUCT REFERENCE SHEET — a technical blueprint of the product showing orthographic views (front / side / back / top), unboxed state, macro material detail, and **dimension lines in mm/cm with a human-scale reference**. This sheet is the GROUND TRUTH for the product's aspect ratio, proportions, and physical size. Cross-check the hero shot against this sheet: the ratio of height to width on the packaging you draw MUST match the ratio implied by the dimension lines. If the sheet shows a 180mm × 220mm pouch, your rendered product is taller than wide by exactly that ratio — not square, not wide, not short. This image is for YOUR reference only; it must NOT appear in the final ad.
4. PRODUCT CONTENT IMAGE (reference) — a supplementary product reference with additional packaging / labelling / detail information. Use this to get the product's visual identity right (labels, colours, proportions). It should NOT appear in the final ad; use it only to understand the product.

---

BRAND
{{brand}}

PRODUCT
{{product}}

ANGLE / AUDIENCE — THIS DRIVES EVERY PIECE OF COPY
{{angle}}

LANGUAGE (write every visible piece of copy in this language)
{{language}}

REFERENCE AD STRUCTURAL ANALYSIS (preserve this exact structure, layout, hierarchy, and composition — but replace the literal copy with angle-aligned wording)
{{deconstruction}}

{{feedback}}

---

FINAL CHECK (before you output the image)

- The headline is a REWRITE of the reference's specific claim / hook — preserving its pattern and emotional beat — not a generic pitch and not the same sentence you'd write for every other reference.
- The copy overall uses the ANGLE's vocabulary and speaks to its audience, but does not reduce every reference to the same headline.
- Bullets / supporting copy occupy the reference's copy slots with content relevant to this product + angle.
- Layout, composition, and hierarchy match the REFERENCE AD exactly.
- Colors are the BRAND tokens — primary surface is `{{PRIMARY_HEX}}`, background is `{{BG_HEX}}`, body text is `{{BODY_TEXT_HEX}}`. The reference ad's exact hex codes do NOT appear in the output.
- Fonts are the BRAND families — headlines in `{{FONT_HEADING}}`, body copy in `{{FONT_BODY}}`. The reference ad's font family does NOT appear in the output (its scale and weight relationships are preserved, but rendered in the brand family).
- The product shown is the PRODUCT IMAGE hero, rendered with the correct packaging / label details from the CONTENT IMAGE reference.
- The product's aspect ratio, silhouette, and proportions match PRODUCT IMAGE exactly — the packaging has NOT been squashed, stretched, widened, narrowed, or otherwise re-proportioned to fit the reference ad's product slot.
- The product's label layout, logo placement, colours, and materials match PRODUCT IMAGE exactly — the packaging has NOT been redesigned or reinterpreted.
- All copy is in **{{language}}** — every headline, sub-headline, bullet, badge, button, footer, and overlay. Zero words from the reference ad's source language survive in the final composition (the only exception is the real product's existing on-pack branding, which is product identity, not ad copy).
