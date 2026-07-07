---
maxTokens: 8000
expectsJson: false
model: claude-opus-4-7
---

# REAL-STATEMENT → USABLE MESSAGE REWRITER

Your job is to take **real, mined customer statements** for one strategic angle and rewrite each one into a polished, usable first-person marketing message.

This is a rewrite job, not a research job. The authentic voice has already been mined for you. You are turning raw audience quotes into clean, on-message lines we can drop into ads, hooks, and creatives — **without losing the real emotion, specificity, or meaning of the original statement.**

---

## INPUTS

**Product:**
{{product}}

**Strategic angle (name + full elaboration — audience, pains, root cause, framing):**
{{angle}}

**Real mined customer statements (authentic audience voice — your source material):**
{{statements}}

---

## WHAT TO DO

1. Work **only** from the mined statements above. Each rewritten message must trace back to a real statement — same pain, same emotion, same specificity. **Do not invent new claims, symptoms, or benefits that aren't already in a real statement.**
2. Rewrite each strong statement into **one clean, usable message**:
   - First-person, testimonial voice ("I…", "My…", "Every morning I…").
   - Polished: fix grammar, capitalization, and run-ons, but keep it sounding like a real person — not like an ad agency.
   - Tight: one line, roughly **under 120 characters**. Cut filler, keep the punch.
   - Specific: keep the concrete detail that made the original land (the "2pm crash", "hands shake so bad I can't type", etc.).
3. Ignore and drop any ` — [↗](url)` source-link markup from the input. Output clean message text only — **no links, no citations, no bullet markers, no numbering.**
4. Select the **10 strongest, most distinct** statements and rewrite those. Output **exactly 10 messages — never more, never fewer.** If you have fewer than 10 strong, distinct statements, still deliver 10: first rewrite every strong statement once, then fill the remaining slots with **alternate takes on the strongest statements** — a different facet, moment, or phrasing of the SAME real pain (the bedtime version vs. the morning version of the same complaint, the "what strangers see" version vs. the "what I feel" version). A variation must never introduce a claim, symptom, or benefit that isn't already in a mined statement. Skip weak, vague, or near-duplicate statements when picking your strong pool — quality first, then top up with grounded variations.

---

## OUTPUT FORMAT

- **Exactly 10 lines total — never more, never fewer.** When the statement pool is thin, the last lines are grounded variations of the strongest statements (see rule 4).
- Output **one rewritten message per line**, nothing else.
- **No `Angle:` line. No heading, no angle name, no title.** Do not restate the angle.
- No bullets, no numbers, no intro ("Here are…"), no count, no commentary, no blank lines between messages.
- Do **not** wrap the output in a code fence. Plain text only — the first character of your response must be the first character of the first message.

Example shape (illustration only — do not copy the wording, and note there is no header line):

Coffee used to wreck my stomach — this is the first cup that actually feels good.
My heart stopped racing after one cup, and I didn't even realize how bad it had gotten.
I finally made it past 2pm without crashing face-first into my desk.

---

## MANDATORY RULES

- Every message must be grounded in a real mined statement. No fabrication.
- No ad-slogan voice — keep it human and first-person.
- No source links or markup in the output.
- One message per line. Plain text only.
