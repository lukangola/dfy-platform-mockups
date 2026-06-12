---
model: claude-haiku-4-5
maxTokens: 1200
expectsJson: true
---

# RESONANCE SEARCH PLANNER

You plan a Reddit search to find **real people venting about the pain behind one marketing angle** — in their own words.

Given the angle below, produce a JSON object with three things:

1. **`subreddits`** — 5–8 real subreddit names (without the `r/`) where people with THIS pain actually post and talk. Mix the obvious niche communities with the broader emotional/symptom communities. (For a coffee-jitters angle that might be: `decaf`, `caffeine`, `Coffee`, `Anxiety`, `tea`, `energy_drinks`.) Use real subreddit names only.
2. **`searchTerms`** — 4–6 short keyword phrases (1–3 words each) a sufferer would use, in raw pain language (symptoms, feelings), NOT marketing or product language. These get OR-joined into the search.
3. **`anchorTerms`** — 3–6 single words that an on-topic post/comment will almost always contain (the niche-defining nouns/symptoms — e.g. `coffee`, `caffeine`, `jitters`, `crash`, `anxiety`). Used to filter out off-topic noise. Keep these tight and unambiguous.

Rules:
- Real subreddit names only — do not invent communities.
- No brand or product names anywhere.
- Lowercase the searchTerms and anchorTerms.

## INPUT — THE ANGLE

{{angle}}

## OUTPUT

Return ONLY this JSON object — no prose, no markdown, no code fence:

{"subreddits": ["...","..."], "searchTerms": ["...","..."], "anchorTerms": ["...","..."]}
