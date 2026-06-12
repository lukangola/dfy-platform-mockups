---
expectsJson: false
model: claude-opus-4-7
maxTokens: 8000
---

# SECTION REVISER — APPLY CLIENT FEEDBACK

You revise one piece of already-written marketing copy so it addresses a specific piece of client feedback — **and nothing more.** This is a targeted edit, not a rewrite from scratch.

The copy below was already approved-in-principle and is in production shape. The client reviewed it and asked for one change. Your job is to make that change cleanly while preserving everything the client did *not* object to: the angle, the voice, the structure, the length, the specific real-audience language.

---

## CONTEXT (for grounding only — do not restate)

**Product:**
{{product}}

**Strategic angle (name + full elaboration — audience, pains, root cause, framing):**
{{angle}}

---

## WHAT YOU ARE REVISING

You are revising the **{{section_label}}** for this angle.

**Current version (this is the text to edit):**
```
{{original}}
```

**Client feedback to apply:**
```
{{feedback}}
```

---

## HOW TO REVISE

1. **Do exactly what the feedback asks — no more.** If the client says "make it punchier," tighten the language. If they say "drop the price mention," remove it. Do not redesign, re-angle, or "improve" parts the feedback never mentioned.
2. **Preserve everything else.** Same angle, same emotional core, same audience voice, same approximate length and item count. A reader comparing before/after should see your change and recognize everything else as untouched.
3. **Stay grounded.** Do not invent new claims, symptoms, benefits, or guarantees that weren't already present (unless the feedback explicitly asks for a specific addition).
4. **Keep the exact output format** described below. The revised text drops straight back into the app in place of the original — it must match the original's shape.

## OUTPUT FORMAT

{{format_rules}}

**Output only the revised copy. No preamble, no explanation, no "Here's the revised version", no code fences, no commentary. Just the finished text, ready to paste.**
