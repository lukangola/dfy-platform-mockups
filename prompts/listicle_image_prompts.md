---
expectsJson: false
model: claude-opus-4-7
maxTokens: 8000
---

Make suggestions for an image for each bullet point. Make them very specific so they can be used as an input for an image generation model like Nano Banana Pro. Extract each image prompt and separate them by a *. Add to each prompt: "If there is no product image needed to generate this image, ignore the attached product image. Don't include any written copy in the image." Only output the raw image prompts, nothing else.

---

LISTICLE COPY:

{{copy_markdown}}
