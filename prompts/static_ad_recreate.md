---
model: fal-ai/nano-banana-pro/edit
---

RECREATION PROMPT

You are adapting a reference static ad to a new product. Preserve the reference's visual structure exactly, but rewrite EVERY piece of visible copy so it speaks directly to the audience defined by the selected ANGLE.

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

BRAND + VISUAL RULES

Apply the BRAND tone, colour palette, and visual identity — but honor the reference ad's style first. Use the brand colour palette only where it fits naturally; do not flood the composition with it.

Communicate product benefits in simple, consumer-friendly language. No jargon unless the angle's audience specifically uses it.

Do NOT change the reference ad's layout, hierarchy, composition, typography scale, or visual structure. Only swap in the new product (from the PRODUCT IMAGE) and rewrite the copy for the angle.

All copy must be written in the LANGUAGE specified.

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
- The product shown is the PRODUCT IMAGE hero, rendered with the correct packaging / label details from the CONTENT IMAGE reference.
- The product's aspect ratio, silhouette, and proportions match PRODUCT IMAGE exactly — the packaging has NOT been squashed, stretched, widened, narrowed, or otherwise re-proportioned to fit the reference ad's product slot.
- The product's label layout, logo placement, colours, and materials match PRODUCT IMAGE exactly — the packaging has NOT been redesigned or reinterpreted.
- All copy is in the specified LANGUAGE.
