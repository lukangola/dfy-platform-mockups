---
model: fal-ai/nano-banana-pro/edit
aspectRatio: "9:16"
---

# CHARACTER B-ROLL IMAGE — FEEDBACK REWORK

You are given a sequence of reference images. **The FIRST image is the current frame** — the existing AI-generated still that the user wants to refine. Subsequent images are visual references for identity preservation (character portrait, product shots, reference sheet).

Your job is **NOT to generate a new image from scratch.** Your job is to take the FIRST image and edit it to address the user's feedback below — keeping every other element of the frame identical to the source.

---

## USER FEEDBACK (apply this verbatim)

{{feedback}}

---

## HARD RULES — APPLY ON TOP OF THE FEEDBACK

1. **The FIRST image is the source.** Output an edited version of that exact frame. Do not invent a new pose, new composition, or new framing unless the feedback explicitly asks for that.
2. **Change ONLY what the feedback asks to change.** If the feedback says "warmer light on her face" → adjust only the lighting on the face. If it says "tighter crop on the shoulders" → re-crop only. If it says "no mirror reflection" → remove only the reflection. Every other pixel-level detail of the source frame stays as close to identical as possible.
3. **Preserve character identity.** The face, skin tone, age, ethnicity, hair, build, and overall styling shown in the FIRST image (and confirmed by any additional character reference image in the input) must remain unchanged. Never swap the face. Never alter demographic features.
4. **Preserve product fidelity (if a product is in frame).** Any product visible in the FIRST image keeps its exact packaging, label, color, cap, nozzle, and proportions. If the feedback mentions the product, edit only the requested aspect; never restyle the product itself.
5. **Preserve wardrobe / outfit** unless the feedback explicitly asks to change it.
6. **Preserve the iPhone-candid aesthetic.** Deep focus across the entire frame, no bokeh, no background blur, no studio lighting, no cinematic grade, no film look, no HDR. Lit by ordinary daylight only. Straight-out-of-camera iPhone color. Real skin texture, no retouching, slight imperfect framing. If the source frame had any of these qualities, keep them. If the feedback contradicts them ("add cinematic lighting", "blur the background"), ignore that part of the feedback — it would break the look.
7. **No phone UI elements.** No status bar, no timestamps, no interface chrome, no LIVE indicator. Output is a clean full-bleed photograph.
8. **No new elements** that the feedback didn't explicitly request. Do not add text, watermarks, logos, stickers, design flourishes, or props that weren't already on the source frame.
9. **Vertical 9:16 aspect ratio** — preserve the canvas size and aspect ratio of the source.
10. **No identity drift mid-edit.** If the feedback would force the character's face to change to fulfill the request (e.g. "make her look older"), refuse that part of the feedback and apply only the elements that don't break identity.

---

## OUTPUT

A single edited image — the source frame with the feedback applied. The output should be indistinguishable from the source EXCEPT for the specific change(s) the feedback requested.
