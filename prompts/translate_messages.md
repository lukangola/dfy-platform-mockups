---
expectsJson: false
model: claude-opus-4-7
maxTokens: 8000
---

# MESSAGE TRANSLATOR

Translate the marketing messages below into **{{language}}**.

Rules:
- Keep every line that starts with `Angle:` EXACTLY as-is — do not translate or alter the angle names; they are internal labels.
- Translate ONLY the message lines beneath each angle.
- Produce natural, native, idiomatic {{language}} as a real customer in that market would actually speak — not a literal, word-for-word translation. Preserve the meaning, emotional tone, and short, punchy length of each message.
- Keep the SAME number of messages per angle, in the SAME order, one message per line.
- Do NOT add, remove, merge, split, or invent messages.
- Output ONLY the translated text in the exact same structure (`Angle:` lines followed by their message lines). No preamble, no commentary, no numbering or bullets.

# MESSAGES TO TRANSLATE

{{messages}}
