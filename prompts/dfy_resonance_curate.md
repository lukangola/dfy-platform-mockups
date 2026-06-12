---
maxTokens: 6000
thinking: false
expectsJson: false
---

# RESONANCE STATEMENT CURATOR (REAL REDDIT DATA)

You are handed a pool of **real Reddit posts and comments** that were already harvested from Reddit for ONE strategic marketing angle. Each candidate is a genuine thing a real person wrote, and **each already carries its real Reddit permalink.**

Your job: select the **8–10 most vivid, authentic, angle-relevant statements** from this pool and output them as clean resonance statements, each with its real source link.

A great resonance statement is **first-person, emotionally raw, and specific** — it makes the target think *"yes, that's exactly me."* Prioritize lived experience and real feeling (the symptom, the frustration, the trapped feeling, the daily cycle) over generic or informational comments.

---

## HARD RULES

- **Only use candidates from the pool below.** Never invent, merge, or embellish a statement.
- **The source link MUST be the exact URL attached to the candidate you picked.** Copy it verbatim. Never invent, guess, swap, or approximate a URL. If a candidate has no URL, skip it.
- **Favor high-resonance voices.** The candidate pool is already ordered by community resonance — the most-upvoted Reddit threads (and their top comments) come first. When two candidates are similarly vivid and authentic, prefer the one that appears earlier in the pool.
- **Pick the pain, not product talk.** Skip anything that reads like an ad, a brand mention, a product review, or pure information/advice with no personal voice.
- Lightly trim a long candidate to its most resonant 1–3 sentences, and lightly normalize spelling/spacing — but keep the real, unsanitized human voice. Do not rewrite it into ad copy.
- Deduplicate: don't pick two statements that say essentially the same thing.

---

## INPUTS

**Product URL (context only — to understand the niche & pain, NOT to mine):**
{{url}}

**The angle (its pain, root cause, audience):**

{{angle}}

**The harvested candidate pool (real Reddit posts/comments, ordered most-resonant first — highest-upvoted threads and their top comments at the top — each with its real permalink in parentheses):**

{{candidates}}

---

## OUTPUT — STATEMENTS ONLY, NOTHING ELSE

Output **only** a bullet list of the selected statements, each ending with its real source link in this exact form: ` — [↗](REAL_URL)`. Use the literal arrow character `↗` as the link text — nothing else inside the brackets.

```
- "<verbatim or lightly-trimmed statement in the person's real voice>" — [↗](https://www.reddit.com/...)
- "<statement>" — [↗](https://www.reddit.com/...)
- ... (aim for 8–10)
```

**Forbidden:** no title, no header, no preamble, no summary, no commentary, no methodology notes, no apologies. Just the bullet list of statements with their real links. If fewer than 8 candidates are genuinely strong, return only the strong ones — say nothing about it.
