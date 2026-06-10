---
model: fal-ai/nano-banana-pro/edit
---

FEEDBACK EDIT — APPLY USER NOTES TO THE EXISTING AD

You are given ONE existing static ad (image 1, the PREVIOUS OUTPUT). Produce an edited version of that ad that addresses the user feedback below. Image 2 is the real product (for fidelity reference only — do not redesign or replace the product).

USER FEEDBACK (this is the change to make — apply it literally and minimally):
{{feedback}}

OUTPUT LANGUAGE: {{language}}

---

HARD RULES

1. PRESERVE everything in the PREVIOUS OUTPUT (composition, layout, hierarchy, typography, colours, copy, product placement) EXCEPT what the user feedback asks to change.
2. APPLY the feedback literally. Make the smallest change that addresses the user's intent. Do not bundle in unrequested edits, do not redesign the ad, do not regenerate from scratch.
3. KEEP the product exactly as in the PREVIOUS OUTPUT — same silhouette, label, colours, proportions, framing. If the previous output's product already matches the real product (image 2), leave it untouched.
4. KEEP the aspect ratio, canvas size, and crop identical to the PREVIOUS OUTPUT.
5. Any visible copy you re-render — including copy you change in response to the feedback — must be in {{language}}. If the previous output has any copy in another language, translate it to {{language}} as part of this edit.
6. Do NOT introduce new elements (watermarks, badges, logos, stickers, brand marks) that weren't in the PREVIOUS OUTPUT, unless the feedback explicitly asks for them.

The result should be indistinguishable from the PREVIOUS OUTPUT except for the change the user requested.
