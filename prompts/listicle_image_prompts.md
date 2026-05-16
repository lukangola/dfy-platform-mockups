---
expectsJson: false
model: claude-opus-4-7
maxTokens: 8000
---

Make suggestions for an image for each bullet point. Make them very specific so they can be used as an input for an image generation model like Nano Banana Pro. Extract each image prompt and separate them by a *. Add to each prompt: "If there is no product image needed to generate this image, ignore the attached product image. Do not add any ad copy, captions, headlines, or text overlays to the image. If the product appears in the scene, keep the packaging exactly as shown in the reference image — preserve the original logo, brand name, and all label text verbatim; do not invent, alter, translate, or remove any text on the packaging." Only output the raw image prompts, nothing else.

---

LISTICLE COPY:

{{copy_markdown}}
