---
expectsJson: false
model: claude-opus-4-7
maxTokens: 8000
---

Make suggestions for an image for each bullet point. Make them very specific so they can be used as an input for an image generation model like Nano Banana Pro. Extract each image prompt and separate them by a *. Only output the raw image prompts, nothing else.

## CRITICAL — PRODUCT-IN-FRAME DECISION IS THE FIRST THING YOU DECIDE PER SECTION

**Every section: BEFORE writing the image prompt, decide YES or NO on whether the product physically appears in this shot.**

- **YES** when the section is about the product itself, its packaging, its mechanism, its ingredients shown on label, an unboxing, a hero shot, a result demo with the product visible, a "taste/flavor" shot showing the product, etc.
- **NO** when the section is a hook, a customer pain moment, a lifestyle scene, a "before" state, an emotional reaction shot, a doctor's office scene, a problem-state portrait, a result demo where only the person is shown (not the product), a generic ingredient education shot (showing the molecule or food source, not the package), a "what it doesn't contain" framing where the focus is the person looking confident, or anything else where the product physically being on screen would feel forced.

**The downstream pipeline scans your prompt text for product / packaging / brand mentions and attaches the product reference image ONLY when those mentions are present.** Therefore:

- **If YES (product in scene):**
  - Use a clear product noun in the prompt: "the pouch", "the bottle", "the jar", "the can", "the dropper", or the product's own name.
  - At the END of the prompt, append this exact text: `If the product appears in the scene, keep the packaging exactly as shown in the reference image — preserve the original logo, brand name, and all label text verbatim; do not invent, alter, translate, or remove any text on the packaging. Do not add any ad copy, captions, headlines, or text overlays to the image.`
- **If NO (product NOT in scene):**
  - DO NOT mention the product, the packaging, the brand name, the bottle, the jar, the pouch, "the can", "the box", "the dropper", or anything that could be read as the product. The prompt is a pure scene — a person, a setting, an action, an emotion.
  - DO NOT append the "preserve packaging" boilerplate. There's no packaging to preserve.
  - Append this exact strict guard at the end of the prompt — DO NOT shorten or paraphrase: `Do not add any ad copy, captions, headlines, or text overlays to the image. STRICT NO-PRODUCT RULE — render NOTHING that could be mistaken for a commercial product. NO bottle, tube, jar, pump, dropper, sachet, pouch, can, tin, box, container, packaging, label, brand name, logo, or branded item ANYWHERE in the frame — not in the foreground, not in the background, not in hand, not on counter, not on shelf, not in mirror reflection. If the scene calls for an action that involves a product (washing, applying, sipping), render ONLY the action and its visible result (lather, foam, water, droplets, glow on skin, hand reaching, etc.) — never the container itself. Generic unbranded everyday objects (a plain glass of water, a plain ceramic mug, a plain hand towel) are fine; anything bearing a label, a wordmark, or a recognizable packaging shape is FORBIDDEN.`

**Be aggressive about NO.** A 10-section listicle should have roughly 2-4 sections with the product in frame (the product-mechanism ones, the application/usage one, the taste/flavor one if relevant, the result shot if it explicitly features the package). The remaining 6-8 sections — hooks, problems, doctor's office, lifestyle moments, ingredient education, "what it isn't" framings, before-states — should be clean person/scene shots WITHOUT the product. If you put the product in every section, the listicle looks AI-made.

## ENVIRONMENT RULES — APPLIES TO EVERY PROMPT

**No "messy set-dressing" tropes.** The image model defaults to adding the same staged props (kitchen towels, coffee stains, books / keys / mail in random rooms) to every shot, which makes the listicle look AI-made. Explicitly guard against this in every prompt:

- **No kitchen / dish / tea towels anywhere in the frame.** This is the single most over-used prop the model adds.
- **No coffee stains, coffee rings, ring marks on counters, dried-spill patches, powder residue, crumb piles, smudge streaks, or fingerprint trails on glass.** Surfaces stay clean. Mess comes from objects on surfaces, not from marks left on surfaces.
- **No artfully arranged flat lays, matching palettes, or magazine-clean styled compositions.**

**Think like a UGC creator about to film: they CLEAR the counter first.** Empty cups, half-full glasses, sitting mugs, decorative items, prop books — these scream "AI set dressing." **Default prop count is zero.** Only add a prop if it falls into one of:
1. **Actively used in the shot** (the mug being sipped, the product being applied).
2. **Structural / fixed to the room** (a soap dispenser, a lamp base, a fruit bowl that lives on the counter, a kettle).
3. **Genuinely incidental and unremovable** (an open laptop they were just working on, a houseplant in the corner).

**Clutter must match the room.** Even when adding a permitted prop, never put room-mismatched objects in the frame. If a section is set in a kitchen, do NOT add books, keys, mail, envelopes, pens, charging cables, or throws. If in a bathroom, do NOT add kitchen objects or pens. Per-room references for the rare case a prop is warranted:
- **Kitchen counter:** a mug or glass currently in hand, a chopping board mid-prep, a permanent fruit bowl, a fixed spice rack, a kettle. NOT empty cups, NOT books, NOT random snacks.
- **Bathroom counter:** a soap dispenser, a small plant, a toothbrush only if mid-brushing.
- **Bedroom nightstand:** a lamp base, an alarm clock.
- **Living room:** a folded throw being reached for, a remote being held.
- **Outdoor:** sunglasses on head, a tote strap on shoulder, a coffee cup actively in hand — no interior props.

When writing each per-section prompt, append a one-line guard near the end that says: `No kitchen towel, no coffee stain, no powder residue, no empty cups or sitting glasses or staged set-dressing — surfaces clean, props only if actively in use or structurally fixed to the room.`

---

LISTICLE COPY:

{{copy_markdown}}
