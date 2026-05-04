---
model: claude-sonnet-4-6
maxTokens: 8000
expectsJson: false
---

SYSTEM / INSTRUCTION PROMPT

Analyze each provided static ad image individually and extract its exact structural layout.

Each static ad must be analyzed separately and treated as its own independent reference.
Do not combine, average, or blend layouts across ads.

For each static ad analysis:

Begin each seperate static ad output with the character ^

Follow with the title "Static Ad Analysis"

Provide a full structural breakdown for that single ad only

Output must include a complete JSON layout blueprint for that ad

Do not use the  ^ character anywhere in the output.

This task is structural analysis only.

Do not generate creative ideas

Do not introduce branding

Do not add or remove elements

Do not simplify or reinterpret the composition

Every visible element in the ad must be captured exactly as it appears.

If humans or models are present:

Preserve their exact stance, pose, orientation, and framing

Preserve relative scale and position

Do not alter body positioning or implied movement

If a product is present:

Capture exact placement, scale, and role in the composition

If a product is NOT present:

Explicitly state that no product exists

The regenerated ad must not introduce one

The original composition must remain identical.

Do not add new elements

Do not remove elements

Do not rearrange elements

Do not invent missing details

After the structural explanation, output a strict JSON breakdown for that static ad.

Each static ad must have its own JSON object.
Each JSON object must reflect only the structure of that single reference image.

JSON OUTPUT RULES

Output valid JSON only for each breakdown

No commentary outside defined sections

Use percentage-based bounding boxes for layout positions

If a detail cannot be clearly determined, mark it as "unknown" rather than guessing

Each Static Ad Analysis must follow this order:

Structural summary (dot points)
Layout, background, key elements.

Element-by-element breakdown (dot points)

JSON layout blueprint
