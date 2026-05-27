---
model: fal-ai/nano-banana-pro/edit
aspectRatio: "9:16"
---

# PRODUCT B-ROLL IMAGE — FEEDBACK REWORK

You are given a sequence of reference images. **The FIRST image is the current frame** — the existing AI-generated still that the user wants to refine. Subsequent images are visual anchors (product hero shot, back of pack, content/texture image, reference sheet) so the product on the edited frame still matches packaging, label, and proportions.

Your job is **NOT to generate a new image from scratch.** Your job is to take the FIRST image and edit it to address the user's feedback below — keeping every other element of the frame identical to the source.

---

## USER FEEDBACK (apply this verbatim)

{{feedback}}

---

## HARD RULES — APPLY ON TOP OF THE FEEDBACK

1. **The FIRST image is the source.** Output an edited version of that exact frame. Do not invent a new composition, new framing, or a new camera angle unless the feedback explicitly asks for that.
2. **Change ONLY what the feedback asks to change.** "Warmer light on the product" → adjust lighting on the product. "Tighter crop on the box" → re-crop only. "Remove the second bottle" → remove only that element. Every other pixel of the source frame stays as close to identical as possible.
3. **Preserve product fidelity.** The product visible in the FIRST image keeps its exact packaging, label text, brand wordmark, colors, cap / pump / nozzle / lid shape, fill level, and proportions. If the feedback mentions the product itself, edit only the requested aspect; never restyle the product, change its colour, or rewrite the label.
4. **Preserve the surface / scene context.** If the source frame shows the product on a marble counter with morning light, keep the counter, the light, the props, and the surrounding objects exactly as they were unless the feedback specifically asks to change them.
5. **Preserve the source's aesthetic register.** If the source is an iPhone-candid UGC still (deep focus, no bokeh, straight-out-of-camera color), keep that. If the source is a cinematic studio still (controlled lighting, shallow depth), keep that. Do NOT swap registers based on the feedback alone — if the feedback says "make it more cinematic" on a UGC still, refuse that part and apply only the elements that don't break the look.
6. **No phone UI elements.** No status bar, no timestamps, no interface chrome, no LIVE indicator. The output is a clean full-bleed photograph.
7. **No new elements** that the feedback didn't explicitly request. Do not add text, watermarks, logos, stickers, design flourishes, ribbons, badges, or props that weren't already on the source frame.
8. **Vertical 9:16 aspect ratio** — preserve the canvas size and aspect ratio of the source.
9. **No label drift mid-edit.** If applying the feedback would force the product label / wordmark / packaging shape to change to fulfil the request (e.g. "make the bottle darker" when the bottle is part of the brand identity), refuse that part of the feedback and apply only the elements that don't break product identity.

---

## OUTPUT

A single edited image — the source frame with the feedback applied. The output should be indistinguishable from the source EXCEPT for the specific change(s) the feedback requested.
