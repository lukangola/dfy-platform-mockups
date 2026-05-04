---
expectsJson: true
model: claude-opus-4-7
maxTokens: 4000
---

# Task

Analyze the image and extract, for each visible product:

- Container type
- Opening mechanism
- Dispensing mechanism
- Closing mechanism
- Visible content color (if observable)
- Estimated viscosity

Return **JSON only**.
No commentary.
No explanations.
No markdown.
No text outside JSON.

If something cannot be determined, use:
`"not_determinable"`

# Output Schema (Strict)

Return an array of objects:

```json
[
  {
    "product_id": "A",
    "physical_description": "",
    "container_material": "",
    "opening": "",
    "dispensing": "",
    "closing": "",
    "content_color": "",
    "viscosity": ""
  }
]
```

# Field Rules

**product_id** — Sequential letters: A, B, C, D…

**physical_description** — Very short visual identifier (e.g., "small amber glass bottle with dropper")

**container_material** — `glass` / `plastic` / `silicone` / `not_determinable`

**opening** — Single concise mechanical instruction. Include:
- direction (`clockwise` / `counterclockwise` / `vertical_pull` / `downward_press` / `twist_unlock`)
- action type
- approximate turns if threaded

**dispensing** — Mechanism + flow type. Examples:
- `squeeze_bulb → drops`
- `pump_press → dollop`
- `trigger_press → mist`
- `tilt_gravity → stream`
- `manual_scoop`

**closing** — Exact reseal action.

**content_color** — Observed color OR:
- `inferred_[color]`
- `not_visible`
- `not_determinable`

**viscosity** — One of:
- `very_low`
- `low`
- `medium`
- `high`
- `very_high`
- `not_determinable`

If inferred, append short reason, e.g., `"high_oil_type"`.

# Strict Constraints

- No sentences.
- No full explanations.
- Use compact structured phrasing.
- Maximize signal density.
- Machine-readable wording.
- No marketing terms.

# Example Output Style

```json
[
  {
    "product_id": "A",
    "physical_description": "small amber glass bottle with dropper",
    "container_material": "glass",
    "opening": "rotate_counterclockwise_3_turns + vertical_lift",
    "dispensing": "squeeze_bulb → drops",
    "closing": "insert_dropper + rotate_clockwise_until_snug",
    "content_color": "dark_amber_visible",
    "viscosity": "high_oil_type"
  }
]
```
