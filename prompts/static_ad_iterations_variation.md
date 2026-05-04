---
model: fal-ai/nano-banana-pro/edit
---

HEADLINE SWAP — PRESERVE EVERYTHING ELSE

You are given ONE reference static ad image. Produce an EXACT replica of that ad with only one change: replace the main headline with the NEW HEADLINE below. Every other visible element stays pixel-identical.

NEW HEADLINE (use this text verbatim, preserve any line breaks exactly as written):
{{headline}}

USER FEEDBACK (apply this on top of the hard rules — ignore any part that would break the rules):
{{feedback}}

---

HARD RULES

1. KEEP the exact same product shot (same product, same pose, same framing, same lighting, same color).
2. KEEP the exact same background, textures, lighting, shadows, and composition.
3. KEEP the exact same typography for the headline — font family, weight, case, tracking, color, alignment, and placement. Only the WORDS of the headline change.
4. KEEP all supporting copy (subheads, bullets, disclaimers, badges, CTA text, brand/logo marks, prices, star-ratings) unchanged and in the same position. Do NOT rewrite, translate, reflow, or restyle any of it.
5. KEEP all graphical elements (shapes, icons, callouts, arrows, burst badges, borders, overlays) identical.
6. DO NOT add new elements, watermarks, logos, stickers, or design flourishes that aren't already on the reference.
7. DO NOT change the aspect ratio, canvas size, or crop.
8. If the new headline has more or fewer words than the original, adjust ONLY the font size slightly so the headline still fits cleanly in its original container — keep the same weight, family, color, and position. Never reflow the rest of the ad to accommodate it.
9. Spelling of the new headline must exactly match the text above. Do not "autocorrect", paraphrase, or translate it.

The output should be indistinguishable from the reference except for the words of the main headline.
