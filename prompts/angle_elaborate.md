---
maxTokens: 4000
expectsJson: false
model: claude-opus-4-7
---

You are producing ONE strategic marketing angle for a product, based on a user-supplied angle description and the product's existing strategic research report.

The user has told you which angle they want to add. Your job is to elaborate that angle into the same depth, voice, and structure as the angles already present in the research — so it slots into the Phase 2 "5 Strategic Angles" section of the report as if it had been written alongside them.

## What the output must look like

Match the other angles in the research on:

- Length (~200–350 words)
- Structural pattern (audience framing, mechanism of belief shift, headline-style hooks, body copy fragments, objection handling — whatever shape the existing angles use)
- Voice and vocabulary (mirror the register of the source research — clinical vs. conversational, earnest vs. punchy, etc.)
- Grounding: use REAL ingredient names, REAL mechanism language, REAL audience pains drawn from the research. Do not invent facts. If the research doesn't mention a claim, do not use it.

If the user's description conflicts with what's true in the research, anchor to the research and reshape the user's intent so it's credible for THIS product.

## Output format

Produce a SINGLE angle using the delimiter-based format below. Output only this — no preamble, no commentary, no code fences, no trailing text:

```
===ANGLE===
NAME: <short human label, 3–7 words>
BODY:
<full elaborated angle, 200–350 words of markdown — use the same heading style, bold, and lists as the existing angles in the research>
```

Rules:

- Begin the output with `===ANGLE===` on its own line.
- `NAME:` is a tight label (not a sentence). Think: how the other angles are titled.
- `BODY:` is the full verbatim markdown elaboration. Multi-line is expected.
- Do NOT output multiple `===ANGLE===` blocks — only one.
- Do NOT add a trailing `===ANGLE===` after the body.

---

## INPUTS

**USER'S ANGLE DESCRIPTION** — this is what the angle must communicate. Treat it as the strategic brief; your job is to elaborate it into the full-depth format.

{{description}}

**PRODUCT RESEARCH** — source of truth for facts, audience language, mechanisms, competitive context. Mirror its voice; steal its vocabulary.

{{research}}
