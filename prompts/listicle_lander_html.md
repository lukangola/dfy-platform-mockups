---
expectsJson: false
model: claude-opus-4-7
maxTokens: 16000
---

Build a long-form editorial advertorial landing page in {{LANGUAGE}} for {{PRODUCT_NAME}},
a {{PRODUCT_CATEGORY}} targeting {{AUDIENCE_DESCRIPTION}}.

This is a LISTICLE-STYLE advertorial designed to look like an editorial article,
NOT a traditional sales page. Visitor should feel they are reading a magazine article,
not a product page. Single-column, narrow content width, mobile-first, but ALSO
correctly proportioned on desktop.

═══════════════════════════════════════
REFERENCE TEMPLATE — MATCH THIS DESIGN
═══════════════════════════════════════

The output should closely match the visual structure and rhythm of this
canonical listicle template:

  https://sensenaturals.ca/pages/10-reasons-why-best-joint-pain-remedy

Key elements from that reference to replicate (adapted to OUR content):
- Slim near-black announcement bar with brand discount + countdown timer
- Headline H1 sits tight under the bar — no hero image, no large hero spacing
- Compact author byline directly under H1 (small circular photo + name + date)
- Single bold hook callout under the byline
- Each numbered section uses the SAME visual block: bold H2 → square 1:1
  image → 2-4 short body paragraphs. Generous vertical rhythm between
  sections but no dividers
- Big bottom offer block on brand-primary background with:
  - "UP TO X% OFF FOR A LIMITED TIME ONLY" headline
  - Product image
  - Two stacked CTA buttons (primary + a repeated secondary "Yes, GET X% OFF")
  - Countdown timer
  - "Sell-Out Risk: HIGH" scarcity badge
  - "FREE shipping" + "30-Day Money Back Guarantee" trust markers
  - "Verified Lowest Price Ever" closing claim in small italic

═══════════════════════════════════════
CRITICAL LAYOUT REQUIREMENTS — READ FIRST
═══════════════════════════════════════

1. SINGLE CONTENT COLUMN, CENTERED ON THE PAGE
   The ENTIRE page uses ONE content column with max-width 720px, centered
   horizontally on the viewport with equal margins on left and right at all
   viewport widths.
   - On mobile (≤720px): content fills the viewport with ~16px side padding
   - On desktop (>720px): content is 720px wide, centered, with empty white
     space EQUALLY on the left and right
   - DO NOT use a two-column layout. DO NOT push content into a right-side
     column with empty space on the left. DO NOT use sidebars.

2. ABOVE-THE-FOLD MUST BE DENSE
   On both mobile AND desktop, the user should see within the first scroll:
     - Announcement bar
     - Headline
     - Author block
     - Hook callout
     - The H2 of reason #1 starting

   There is NO hero image. There is NO large vertical spacing before the
   listicle starts. The headline sits tight against the announcement bar.
   The author block is compact. The first H2 begins immediately after the
   hook callout.

3. ALL TEXT CONTENT IS LEFT-ALIGNED INSIDE THE 720PX COLUMN
   - H1, author block, hook callout, H2s, body paragraphs: all left-aligned
   - The 720px column itself is centered on the page, but content WITHIN it
     reads left-to-right, flush-left
   - The ONLY centered elements are: announcement bar contents (full-width),
     offer block contents (full-width), and footer

═══════════════════════════════════════
EXACT PAGE STRUCTURE (follow in this order)
═══════════════════════════════════════

SECTION 1 — TOP ANNOUNCEMENT BAR (full viewport width, slim, sticky at top)
- Background: #111111 (near-black)
- Full viewport width edge-to-edge (NOT confined to the 720px column)
- Inside the bar, content is centered as a single row, two columns:
  - LEFT (white, bold, small caps, two lines allowed):
    "{{ANNOUNCEMENT_LINE_1}}" / "{{ANNOUNCEMENT_LINE_2}}"
  - RIGHT: rounded pill-shaped countdown timer block in brand accent color
    showing HRS : MIN : SEC inline (small labels under each number)
- Height: compact, no more than ~80px on mobile, ~70px on desktop
- The countdown sits INSIDE the bar on the right, NOT below it

SECTION 2 — ARTICLE HEADER
(inside the 720px centered column, content left-aligned)
- H1 headline, large, bold sans-serif, LEFT-aligned within the column:
  "{{MAIN_HEADLINE}}"
- Tight spacing: H1 starts ~32px below the announcement bar (no more)
- Author block directly below H1 (~16px gap), LEFT-aligned, ONE ROW:
  - Small circular author photo (48-56px) on the LEFT
  - To the right of the photo, two stacked text lines:
    - Line 1 (bold): "By {{AUTHOR_NAME}}"
    - Line 2 (regular, smaller, muted): "Last Updated {{DATE}}"

SECTION 3 — HOOK CALLOUT
(inside the 720px centered column, full column-width)
- Callout box, light tinted background (cream / pale brand tint)
- LEFT vertical accent bar in brand primary color (4px wide, full height of box)
- Inside the box, single line, regular weight with key phrase bolded:
  "{{HOOK_LINE}}"
- Padding ~16-20px, rounded corners 6px
- Sits directly below the author block (~24px gap)

SECTION 4 — THE LISTICLE BODY
(inside the 720px centered column, starts immediately after the hook callout, ~32px gap)

DO NOT INSERT A HERO IMAGE BEFORE THIS SECTION. The first thing after the hook
callout is the H2 of reason #1.

For each reason, render in this EXACT block pattern, stacked vertically:

  [H2 heading, left-aligned, bold, larger than body, tight to image below]
  "{{REASON_N_HEADLINE}}"

  [Image, full column-width (720px max), rounded 8px, ~16-24px margin top and bottom]
  {{REASON_N_IMAGE_URL}}

  [Body paragraph(s), regular weight, comfortable line-height ~1.6,
   16-17px body size, dark gray text not pure black]
  {{REASON_N_BODY_COPY}}

Repeat this exact block for every reason.
No dividers between sections — just generous vertical spacing (~48px between reasons).
No icons, no numbered badges beyond the number already in the H2.
No pros/cons lists. No star ratings. No comparison tables.
Just headline → image → body. This is the entire pattern.

SECTION 5 — OFFER BLOCK
(full viewport width, breaks out of the 720px column. Match the
sensenaturals reference template feel — bold, urgent, dense.)
- Background: brand primary color, full viewport width edge-to-edge
- Inside, content centered with max-width 720px, generous vertical padding
  (~64px top and bottom):
  - Small caps label at top: "{{OFFER_LABEL}}"
  - Product image, centered, max 300px wide
  - H1, white, centered, large and bold (3xl on mobile, 4xl on desktop):
    "{{OFFER_HEADLINE}}"
  - Subline, centered (max-width ~500px so it doesn't sprawl):
    "{{OFFER_SUBLINE}}"
  - **PRIMARY CTA button** (large, full-column-width on mobile, ~360px on
    desktop, contrasting accent color, white text, all-caps, bold):
    "{{CTA_TEXT}}" → links to {{CTA_URL}}
  - Compact stack below the primary button, centered, white text on the
    primary-colored background:
    - "{{COUNTDOWN_LABEL}}" with countdown timer (HH:MM:SS) — visually
      prominent
    - **Scarcity badge** (small pill, lighter background tint within the
      offer block): "Sell-Out Risk: {{SCARCITY_LINE}}" (e.g. "HIGH")
    - "{{SHIPPING_LINE}}" — small, ✓ marker
    - "{{GUARANTEE_LINE}}" — small, ✓ marker
  - **SECONDARY CTA button** (slightly smaller than the primary, same
    accent color, same destination URL — repeats the offer to capture
    bottom-of-page intent): "{{SECONDARY_CTA_TEXT}}" → also links to
    {{CTA_URL}}
  - Trust line at very bottom, small italic, off-white: "{{TRUST_LINE}}"
    (e.g. "Verified Lowest Price Ever")

SECTION 6 — FOOTER
(full viewport width, content centered)
- Centered brand logo: {{BRAND_LOGO_URL}}
- Single-line tagline: "{{BRAND_TAGLINE}}"
- Small links row: {{FOOTER_LINKS}}
- Copyright line: "© {{YEAR}}, {{BRAND_NAME}}"

═══════════════════════════════════════
DESIGN SYSTEM (apply globally)
═══════════════════════════════════════

COLORS:
- Primary brand color: {{PRIMARY_HEX}}
- Accent / CTA color: {{ACCENT_HEX}}
- Announcement bar background: #111111
- Hook callout background: {{HOOK_BG_HEX}} (light tinted)
- Body background: #FFFFFF
- Body text: #1F1F1F (near-black for editorial feel)
- Muted text (dates, captions): #6B6B6B

TYPOGRAPHY:
- Headings: {{HEADING_FONT}}, weight 700-800
- Body: {{BODY_FONT}}, weight 400, size 16-17px, line-height 1.6
- H1: 32-40px on mobile, 40-48px on desktop, bold
- H2: 24-28px, bold
- Editorial feel — heavy bold headlines, no decorative fonts

LAYOUT — THE CRITICAL PART:
- ONE content column, max-width 720px, ALWAYS centered horizontally on the viewport
- Empty white space appears EQUALLY on the left and right of the column on desktop
- The 720px column applies to: article header, hook callout, listicle body
- Full-viewport-width applies to: announcement bar, offer block, footer
- Mobile-first responsive — single column always, no side-by-side layouts ever
- TIGHT vertical spacing in the above-the-fold area
- ~48px vertical spacing between reason blocks
- All images full column-width (720px max) with 8px rounded corners
- No sidebars, no navigation menu, no top header logo bar

TONE OF FINAL PAGE:
- Editorial, journalistic
- Second person ("you" / "du" depending on language)
- No exclamation marks in body copy (only in announcement bar and offer block headline)
- {{LANGUAGE_SPECIFIC_NOTES}}

═══════════════════════════════════════
CONTENT TO INSERT (use exactly, do not rewrite)
═══════════════════════════════════════

ANNOUNCEMENT_LINE_1: {{ANNOUNCEMENT_LINE_1}}
ANNOUNCEMENT_LINE_2: {{ANNOUNCEMENT_LINE_2}}
MAIN_HEADLINE: {{MAIN_HEADLINE}}
AUTHOR_NAME: {{AUTHOR_NAME}}
AUTHOR_PHOTO_URL: {{AUTHOR_PHOTO_URL}}
DATE: {{DATE}}
HOOK_LINE: {{HOOK_LINE}}

REASONS:
{{REASONS_BLOCK}}

OFFER_LABEL: {{OFFER_LABEL}}
OFFER_PRODUCT_IMAGE_URL: {{OFFER_PRODUCT_IMAGE_URL}}
OFFER_HEADLINE: {{OFFER_HEADLINE}}
OFFER_SUBLINE: {{OFFER_SUBLINE}}
CTA_TEXT: {{CTA_TEXT}}
CTA_URL: {{CTA_URL}}
COUNTDOWN_LABEL: {{COUNTDOWN_LABEL}}
SCARCITY_LINE: {{SCARCITY_LINE}}
SHIPPING_LINE: {{SHIPPING_LINE}}
GUARANTEE_LINE: {{GUARANTEE_LINE}}
SECONDARY_CTA_TEXT: {{SECONDARY_CTA_TEXT}}
TRUST_LINE: {{TRUST_LINE}}
BRAND_NAME: {{BRAND_NAME}}
BRAND_LOGO_URL: {{BRAND_LOGO_URL}}
BRAND_TAGLINE: {{BRAND_TAGLINE}}
FOOTER_LINKS: {{FOOTER_LINKS}}
YEAR: {{YEAR}}

═══════════════════════════════════════
USER FEEDBACK ON THE PREVIOUS RENDER (apply on top, do not throw away the rest)
═══════════════════════════════════════

{{HTML_FEEDBACK}}

═══════════════════════════════════════
CRITICAL RULES — DO NOT VIOLATE
═══════════════════════════════════════
- DO NOT use a two-column layout on desktop. The content column is centered,
  with equal empty margin on left and right.
- DO NOT push the article content into a right-side column.
- DO NOT add a hero image before the listicle. The H2 of reason #1 starts
  immediately after the hook callout.
- DO NOT center the H1 or the author block. They are LEFT-aligned within the
  720px column (which itself is centered on the page).
- DO NOT stack the author photo above the byline. Photo is to the LEFT of the byline.
- DO NOT add excessive white space above the headline. Headline sits tight under the bar.
- DO NOT invent or rewrite any of the body copy. Use what is provided verbatim.
- DO NOT add sections that are not in the structure above (no testimonials carousel,
  no FAQ unless specified, no ingredient breakdowns).
- DO NOT add stock images. Use only the image URLs provided.
- All reasons follow the IDENTICAL block pattern. Do not vary the layout per reason.
- Keep the page mobile-first single-column at all viewport widths.

═══════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════

Output a single complete HTML document — `<!DOCTYPE html>` to `</html>`.
Inline CSS in a `<style>` tag in `<head>`.
No markdown code fences around the output.
No commentary, no preamble.
The first character of your output is `<` and the last character is `>`.

Include this stylesheet link in `<head>` so LanderLab applies its own framework:
```
<link rel="stylesheet" href="https://resources.landerlab.io/css/styles.css" landerlab-styles>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta charset="UTF-8">
```

The page must function correctly when loaded as a standalone HTML page — all CSS inline or via the LanderLab CSS link, no external dependencies beyond that.
