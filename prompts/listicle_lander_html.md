---
expectsJson: false
model: claude-opus-4-7
maxTokens: 24000
---

Build a long-form editorial advertorial landing page in {{LANGUAGE}} for {{PRODUCT_NAME}},
a {{PRODUCT_CATEGORY}} targeting {{AUDIENCE_DESCRIPTION}}.

This is a LISTICLE-STYLE advertorial designed to look like an editorial article,
NOT a traditional sales page. Visitor should feel they are reading a magazine article,
not a product page. Single-column, narrow content width, mobile-first, but ALSO
correctly proportioned on desktop.

═══════════════════════════════════════
REFERENCE TEMPLATE — MATCH THIS DESIGN EXACTLY
═══════════════════════════════════════

The output MUST closely match the visual structure and rhythm of this
canonical listicle template:

  https://try.javvycoffee.com/ps/

Replicate every section EXCEPT the comparison table (which we explicitly
remove). Specifically replicate:

- Slim announcement bar at the very top with discount badge + countdown
  timer. Light background, bold text, all-caps style. May have one or
  two stacked rows.
- H1 headline sits tight under the bar — NO hero image, NO large hero
  spacing, NO navigation menu.
- **Pre-headline callout** in italic+bold appears BEFORE the H1:
  e.g. "*Read this* **BEFORE your next coffee run!**" — short, urgent,
  one line. Goes above the H1.
- Author byline directly under H1: small circular photo + bold name +
  small grey "Last Updated [date]" line.
- **NO comparison table** at the top — this is explicitly removed from
  our adaptation. The numbered list starts immediately after the byline.
- Numbered sections: H2 (with optional leading emoji + short punchy
  phrase) → square 1:1 image → 2-4 short body paragraphs → small inline
  "Learn more" link styled as the CTA microcopy ONLY on REASON 3
  through the last reason. REASON 1 and REASON 2 have NO inline CTA
  link — they're pure editorial. Generous vertical rhythm between
  sections but no dividers.
- Bottom buy box matching Javvy's structure exactly — see SECTION 5
  below for the precise layout.

═══════════════════════════════════════
CRITICAL LAYOUT REQUIREMENTS — READ FIRST
═══════════════════════════════════════

1. SINGLE CONTENT COLUMN, CENTERED ON THE PAGE
   The ENTIRE page uses ONE content column with max-width 768px (48rem,
   matching Javvy's `.container-tiny`), centered horizontally on the
   viewport with equal margins on left and right at all viewport widths.
   - On mobile (≤768px): content fills the viewport with ~32px side
     padding (matches Javvy's `.padding-global-8` rule).
   - On desktop (>768px): content is 768px wide, centered, with empty
     white space EQUALLY on the left and right.
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
   - The 768px column itself is centered on the page, but content WITHIN it
     reads left-to-right, flush-left
   - The ONLY centered elements are: announcement bar contents (full-width),
     offer block contents (full-width), and footer

═══════════════════════════════════════
EXACT PAGE STRUCTURE (follow in this order)
═══════════════════════════════════════

SECTION 1 — TOP ANNOUNCEMENT BAR (match Javvy reference EXACTLY)

Full-viewport-width sticky bar at the very top of the page,
edge-to-edge (NOT confined to the 768px column).

**This section's markup must be a near-verbatim copy of Javvy's own
header.** I'm giving you the EXACT structure, classes, inline styles,
and sizes pulled from `https://try.javvycoffee.com/ps/` and its
stylesheet. Reproduce these CSS rules in inline `style="..."`
attributes (do NOT add new class names — use inline styles so the
output is self-contained).

JAVVY HEADER MARKUP (your output must match this structure exactly,
substituting only the text content and the brand background color):

```html
<div style="z-index:99999;position:sticky;top:0;width:100%;">
  <div style="display:flex;flex-flow:column;width:100%;position:relative;">
    <div style="display:flex;width:100%;color:{{ANN_TEXT_HEX}};background-color:{{ANN_BG_HEX}};justify-content:center;align-items:center;padding:10px 3%;gap:20px;">
      <!-- TEXT BLOCK -->
      <div style="display:flex;flex-flow:column;justify-content:center;align-items:center;line-height:1.2;">
        <div class="ann-bar-line1" style="text-transform:uppercase;font-size:18px;font-weight:900;line-height:1.2;white-space:nowrap;">{{ANNOUNCEMENT_LINE_1}}</div>
        <div class="ann-bar-line2" style="text-transform:uppercase;font-size:14px;font-weight:700;line-height:1.2;display:block;white-space:nowrap;">{{ANNOUNCEMENT_LINE_2}}</div>
      </div>
      <!-- COUNTDOWN PILL — 3 columns: Hrs / Min / Sec -->
      <div class="js-countdown-bar ann-bar-pill" data-countdown-seconds="14400" data-countdown-key="main"
           style="display:flex;justify-content:center;align-items:flex-start;background:#fff;border-radius:5px;width:150px;padding:5px 10px;gap:1px;flex-shrink:0;">
        <div style="display:flex;flex-flow:column;justify-content:center;align-items:center;">
          <div data-cd-h class="ann-bar-num" style="color:{{ANN_BG_HEX}};font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:900;line-height:1;">00</div>
          <div class="ann-bar-lbl" style="color:{{ANN_BG_HEX}};text-transform:uppercase;font-size:12px;font-weight:500;line-height:1.2;">Hrs</div>
        </div>
        <div style="color:{{ANN_BG_HEX}};padding:0 0.15rem;font-weight:800;line-height:1;align-self:flex-start;">:</div>
        <div style="display:flex;flex-flow:column;justify-content:center;align-items:center;">
          <div data-cd-m class="ann-bar-num" style="color:{{ANN_BG_HEX}};font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:900;line-height:1;">00</div>
          <div class="ann-bar-lbl" style="color:{{ANN_BG_HEX}};text-transform:uppercase;font-size:12px;font-weight:500;line-height:1.2;">Min</div>
        </div>
        <div style="color:{{ANN_BG_HEX}};padding:0 0.15rem;font-weight:800;line-height:1;align-self:flex-start;">:</div>
        <div style="display:flex;flex-flow:column;justify-content:center;align-items:center;">
          <div data-cd-s class="ann-bar-num" style="color:{{ANN_BG_HEX}};font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:900;line-height:1;">00</div>
          <div class="ann-bar-lbl" style="color:{{ANN_BG_HEX}};text-transform:uppercase;font-size:12px;font-weight:500;line-height:1.2;">Sec</div>
        </div>
      </div>
    </div>
  </div>
</div>
```

CRITICAL DETAILS — do not deviate:

- **Background color is `{{ANN_BG_HEX}}`** — the darkest color in the
  brand's actual palette (the brand's navy / charcoal / deep
  terracotta — whatever the brand uses for its strongest dark band).
  Do NOT invent a navy. Do NOT use any hex that isn't one of the
  template variables.
- **Text color on the bar is `{{ANN_TEXT_HEX}}`** — auto-picked for
  contrast (white on dark bars, near-black on light bars).
- **Countdown numbers inside the white pill** use the SAME `{{ANN_BG_HEX}}`
  hex so the digits read against the white pill as the same dark
  brand color.
- **Bar height is set by content + 10px padding top/bottom**. Do NOT
  add additional padding. Do NOT add `min-height`. The bar should
  read as ~60-68px tall on desktop, no more.
- **Text block**: `align-items: center` — both lines CENTERED within
  the text block (not left-aligned).
- **Line 1 (desktop)**: `font-size: 18px`, `font-weight: 900` (very bold).
- **Line 2 (desktop)**: `font-size: 14px`, `font-weight: 700`.
- **Pill width is exactly 150px** on desktop, 122px on mobile.
- **Pill numbers are 22px / weight 900** on desktop, 19px on mobile.
- **Pill labels are 12px / weight 500** "Hrs" / "Min" / "Sec" — source
  text mixed case, the `text-transform:uppercase` CSS displays them
  uppercase (matches Javvy's rendered "HRS MIN SEC").
- **Pill dividers are colons** (`:`) between each Hrs/Min/Sec column,
  same color as the numbers, weight 800.
- **The `data-cd-h`, `data-cd-m`, `data-cd-s` attributes are
  REQUIRED** — the countdown script targets them to update each
  number every second. Do not rename or omit them.
- **The `data-countdown-key="main"` attribute is REQUIRED** so this
  countdown stays in lockstep with the buy-box countdown.
- If `{{ANNOUNCEMENT_LINE_2}}` is empty, OMIT the line-2 `<div>`
  entirely (don't render an empty line). Do not fabricate text.

MOBILE — line 1 must fit on a SINGLE line at 414px viewport width:
- Add this `@media` block inside the `<head>` `<style>` tag so line 1
  scales down on narrow viewports (otherwise "ZEITLICH BEGRENZTES
  ANGEBOT" at 18px wraps to 2 lines on phones):

  ```css
  @media (max-width: 768px) {
    .ann-bar-line1 { font-size: 13px !important; }
    .ann-bar-line2 { font-size: 11px !important; }
    .ann-bar-pill { width: 122px !important; padding: 4px 8px !important; }
    .ann-bar-num  { font-size: 19px !important; }
    .ann-bar-lbl  { font-size: 10px !important; }
  }
  @media (max-width: 380px) {
    .ann-bar-line1 { font-size: 11px !important; }
    .ann-bar-line2 { font-size: 10px !important; }
  }
  ```

- Add the corresponding class names to the markup above:
  - Line 1 `<div>` gets `class="ann-bar-line1"`
  - Line 2 `<div>` gets `class="ann-bar-line2"`
  - Pill `<div>` gets `class="ann-bar-pill"` (in addition to the
    existing `js-countdown-bar`)
  - Each number `<div>` gets `class="ann-bar-num"`
  - Each label `<div>` gets `class="ann-bar-lbl"`

- Do NOT stack the pill below the text block on mobile — the layout
  stays "text left, pill right, same row" at all viewport widths.

SECTION 2 — ARTICLE HEADER
(inside the 768px centered column, content left-aligned)

**CRITICAL — NO PRE-HEADLINE CALLOUT ABOVE THE H1.** The source listicle
markdown begins with an italic + bold "Read this **BEFORE**..." callout
on its very first line. **Do NOT render that line above the H1 in the
HTML.** The announcement bar is the ONLY thing between the top of the
page and the H1. The "Read this BEFORE..." line is supplied separately
as {{HOOK_LINE}} below and is rendered ONCE in SECTION 3 (the hook
callout below the byline). Rendering it twice produces a visible
duplicate — strip it from the article header.

The H1 starts immediately after the announcement bar (with a ~32px gap).
Nothing else above it.

- **H1 headline — match Javvy exactly:**
  - Content: "{{MAIN_HEADLINE}}"
  - **font-size: 2.75rem (44px) on desktop**, 2.5rem (40px) on tablet,
    7.75vw on mobile (≈30-36px depending on viewport)
  - **font-weight: 700** (NOT 900, NOT 800 — exactly 700)
  - **letter-spacing: -0.08rem** (tight, ~-1.3px — gives headlines
    the dense editorial look Javvy has)
  - **line-height: 1.2**
  - LEFT-aligned within the column. Not centered.
  - Use the heading font ({{HEADING_FONT}}), sans-serif.
  - Tight spacing: H1 starts ~32px below the announcement bar.
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
(inside the 720px centered column; starts immediately after the hook
callout, ~32px gap)

DO NOT INSERT A HERO IMAGE BEFORE THIS SECTION. The first thing after the
hook callout is the H2 of reason #1.

LAYOUT — FULLY STACKED, SAME ORDER ON DESKTOP AND MOBILE:

Every numbered section uses a single-column stacked layout with the
elements in this **exact vertical order**:

  1. H2 headline (top)
  2. Square 1:1 image
  3. Body paragraphs
  4. Inline CTA link (only on REASON 3+ — see Element details below)

This applies at ALL viewport widths. There is NO 2-column desktop
variant — desktop stacks the same way as mobile, just with the
content sitting inside the 720px centered column instead of taking
the full mobile width.

  Layout (every breakpoint, every section):
  ┌─────────────────────┐
  │  [H2 headline]      │
  │  [Image 1:1]        │
  │  [Body paragraphs]  │
  │  [→ CTA on #3+]     │
  └─────────────────────┘

Element details:
- **H2 headline — match Javvy exactly:**
  - Content: "{{REASON_N_HEADLINE}}"
  - **font-size: 1.75rem (28px) on desktop**, 2rem (32px) on tablet,
    ~24px on small mobile
  - **font-weight: 700** (NOT 800, NOT 900 — exactly 700)
  - **letter-spacing: -0.05rem** (tight)
  - **line-height: 1.2**
  - LEFT-aligned within the column. Not centered. (Buy-box headline
    is centered — that's a DIFFERENT element. Listicle section H2s
    are always left-aligned.)
  - Use the heading font ({{HEADING_FONT}}), sans-serif.
  - Color: dark navy / body color {{BODY_TEXT_HEX}}.
- Image: square 1:1 aspect ratio, rounded ~10-12px corners
  Source: {{REASON_N_IMAGE_URL}}
- **Body paragraph(s) — match Javvy exactly:**
  - Content: {{REASON_N_BODY_COPY}}
  - **font-size: 1.15rem (~18px)** (NOT 16px)
  - **font-weight: 400**
  - **letter-spacing: -0.02em** (very subtle tightening)
  - **line-height: 1.5** (NOT 1.6)
  - Color: dark gray {{BODY_TEXT_HEX}}
  - Use the body font ({{BODY_FONT}})
- **Inline CTA link (conditional)** — small text link directly below the
  last body paragraph, styled as inline CTA microcopy (brand-primary
  color, semibold, underlined on hover, ~14-15px, may include a leading
  arrow or pointing emoji like `→` or `👉`). Content example:
  `→ <a href="{{CTA_URL}}">Read the full study</a>` or
  `→ <a href="{{CTA_URL}}">Try it risk-free today</a>`. Phrase it so it
  feels organic to the section's argument, NOT generic "Click here".
  Always points to {{CTA_URL}}.

  **HARD RULE — this inline CTA link renders ONLY on REASON 3 and
  later. REASON 1 has NO inline CTA link. REASON 2 has NO inline CTA
  link. Reasons 1 and 2 end with the last body paragraph — nothing
  below it. From REASON 3 onward, every numbered section ends with
  this inline CTA link.**

Repeat the same two-column block pattern for every numbered section.
No dividers between sections — just generous vertical spacing
(~64-80px between sections on desktop, ~48px on mobile).
No icons, no numbered badges beyond the number already in the H2.
No pros/cons lists. No star ratings. No comparison tables.
Just image + headline + body (+ inline CTA link on #3+). This is the
entire pattern.

SECTION 5 — BUY BOX (MATCH JAVVY REFERENCE PIXEL-PRECISELY)

Open the reference (https://try.javvycoffee.com/ps/) and scroll to the
bottom. The output MUST mirror that buy box's structure, layout, and
colors as closely as possible. The card must look like Javvy's, just
re-skinned with this brand's colors.

**ABSOLUTE RULES FOR THIS SECTION — NON-NEGOTIABLE:**
- DO NOT invent a ratings line, review-count line, star-rating line, or
  social-proof line. If {{TRUST_LINE}} is empty, omit the trust line
  element entirely. NEVER write "Über X Bewertungen", "X reviews",
  "4.X★", "X,XXX customers", etc. unless that exact text comes from
  {{TRUST_LINE}}.
- DO NOT invent a "PREMIUM-FORMEL", "MADE IN GERMANY", "LAB-TESTED",
  "PHYSICIAN-FORMULATED", or any badge that is not specified below.
- DO NOT write a body paragraph between the headline and the CTA
  describing the product (e.g. "wellbe Beauty Kollagen with Rejuva
  Complex Formula — for tight, smooth skin and pain-free joints..."
  is FORBIDDEN). The only text between the headline and the CTA is the
  short scarcity sentence in step 3 below.
- DO NOT use brand-primary background for the card body — the card is
  the BRAND'S cream / soft-tint page surface, not the CTA color.

OUTER CARD WRAPPER:
- Card background: **{{CARD_BG_HEX}}** — derived from the brand's
  actual page background (a brand cream when the brand uses one,
  otherwise white). NOT pure-white-when-the-brand-uses-cream. NOT
  brand primary CTA color.
- Dashed border around the card: 2px dashed using **{{ACCENT_HEX}}**
  (the brand's secondary accent) — never an invented yellow. Card
  border-radius: **{{CARD_RADIUS}}**.
- Max-width 880px (slightly wider than the 768px article column so the
  two-column layout has room on desktop). Centered on viewport.
- Generous internal padding: ~40-56px desktop, ~24px mobile.
- Margin from the previous section: ~64-80px gap.

TOP BADGE PILL (centered, sits at the very top of the card, visually
overlapping the top edge of the card — translateY -50% so it half-
overlays the card's top border):
- Background: dark navy / brand-primary color
- White text, bold, all-caps, ~14px
- Rounded fully (pill shape), ~8-12px horizontal padding
- Content rules:
  - If HAS_FREE_GIFTS = "yes" → write **"🎁 FREE GIFTS WITH YOUR ORDER"**
    (translated to {{LANGUAGE}}: in German "🎁 GRATIS-GESCHENKE ZU DEINER BESTELLUNG").
  - Else → write **"✨ LIMITED-TIME OFFER ✨"** (in German "✨ ZEITLICH BEGRENZTES ANGEBOT ✨").
- DO NOT put the discount label / discount % in this pill — the
  discount appears in the big headline (step 2 of the right column),
  not here. Avoid duplication.

INNER LAYOUT — TWO-COLUMN ON DESKTOP, STACKED ON MOBILE:
- **Desktop (≥768px):** Use CSS grid `grid-template-columns: 1fr 1fr`
  with ~24-32px gap. LEFT column = product image. RIGHT column = all
  the textual content listed below.
- **Mobile (<768px):** Single column, image on top (full width, ~240px
  max), then text below.

LEFT COLUMN (product image):
- {{OFFER_PRODUCT_IMAGE_URL}} as a single `<img>` element
- Rounded ~12px corners
- `object-fit: cover`, full column width
- A soft brand-derived background block behind it (in case the image
  has transparency). Use **{{HOOK_BG_HEX}}** (the brand's hook /
  callout background tint — already brand-derived). Rounded
  **{{CARD_RADIUS}}** corners. Never invent a lavender or any other
  off-brand color.

RIGHT COLUMN (content), in this exact vertical order — NO other
elements may appear in this column. **The right column container uses
`display: flex; flex-direction: column; align-items: center; text-align:
center;` so EVERY child element is horizontally centered. The headline,
scarcity sentence, CTA button, countdown, pill bar, and guarantee line
are ALL centered within the column.**

1. **🎁 FREE GIFTS WITH YOUR ORDER** divider row — only if
   HAS_FREE_GIFTS = "yes". Small caps, dark navy / primary color text,
   bold, with horizontal separator lines on either side. Single
   horizontal row. Example markup:
   ```
   <div style="display:flex;align-items:center;gap:12px;color:{{BODY_TEXT_HEX}};font-weight:700;text-transform:uppercase;font-size:13px;letter-spacing:0.05em;">
     <hr style="flex:1;border:0;border-top:1px solid currentColor;"/>
     <span>🎁 FREE GIFTS WITH YOUR ORDER</span>
     <hr style="flex:1;border:0;border-top:1px solid currentColor;"/>
   </div>
   ```
   Translate the text to {{LANGUAGE}}. In German: "GRATIS-GESCHENKE ZU DEINER BESTELLUNG".
   If HAS_FREE_GIFTS = "no", OMIT this divider row entirely.

2. **Big discount headline — match Javvy's `.adv_cta_heading-2`:**
   - Single `<h2>` element, **`text-align: center`** explicitly (don't
     rely on parent flex alignment alone — set `text-align: center` on
     the headline element itself).
   - **font-size: 1.7rem (~27px) on desktop**, 1.4rem (~22px) mobile
   - **font-weight: 700** (NOT 900, NOT 800 — exactly 700, same as the
     section H2s)
   - line-height: 1.2
   - Use the heading font ({{HEADING_FONT}}), sans-serif.
   - Two coloured spans inside the same headline:
     - PART A (RED #DC2626, weight 700): "UP TO {{DISCOUNT_PERCENT}}% OFF"
       (English) / "BIS ZU {{DISCOUNT_PERCENT}}% RABATT" (German)
     - PART B ({{BODY_TEXT_HEX}}, weight 700): " FOR A LIMITED TIME ONLY!"
       (English) / " NUR FÜR KURZE ZEIT!" (German)
   - Same font-family + weight on both spans — only the color differs.
   - If {{DISCOUNT_PERCENT}} is empty, fall back to {{DISCOUNT_LABEL}}
     in RED followed by the localized "FOR A LIMITED TIME ONLY!".
   - Example markup:
     ```html
     <h2 style="text-align:center;font-size:1.7rem;font-weight:700;line-height:1.2;font-family:{{HEADING_FONT}};margin:0;">
       <span style="color:#DC2626;">UP TO {{DISCOUNT_PERCENT}}% OFF</span><span style="color:{{BODY_TEXT_HEX}};"> FOR A LIMITED TIME ONLY!</span>
     </h2>
     ```

3. **Scarcity description** — ONE short paragraph, regular weight,
   body color, max ~480px width. Exactly this content (translated to
   {{LANGUAGE}}):
   - English: "This limited-time deal is in high demand and stock keeps selling out."
   - German: "Dieses zeitlich begrenzte Angebot ist stark nachgefragt und ständig ausverkauft."
   - Do NOT add a second paragraph. Do NOT describe the product here.

4. **PRIMARY CTA button** — large, full-width within the right column,
   centered text. The button design MATCHES THE BRAND'S OWN BUTTON STYLE
   from brand.guidelinesMarkdown § 9 Design System (parsed and passed in
   as the vars below). Do NOT invent your own chunky-shadow-with-thick-
   border CTA style — use the brand's actual values verbatim:
   - **background: {{PRIMARY_HEX}}** — extracted from the brand's
     design system as the actual CTA color (NOT a pastel hero color).
   - **color: {{BTN_TEXT_COLOR}}** — brand's CTA text color (usually
     white or near-black).
   - **font-family: {{HEADING_FONT}}, sans-serif**
   - **font-weight: {{BTN_FONT_WEIGHT}}**
   - **text-transform: {{BTN_FONT_TRANSFORM}}** — usually `uppercase`
     for DTC.
   - **letter-spacing: {{BTN_LETTER_SPACING}}**
   - **border-radius: {{BTN_RADIUS}}** — the brand's actual radius. If
     the brand uses pills (`999px`) honour that. If they use sharp (`0`),
     honour that too.
   - **padding: {{BTN_PADDING}}** — verbatim, e.g. `14px 28px`.
   - **border: {{BTN_BORDER}}** — usually `none`, occasionally a thin
     outline.
   - **box-shadow: {{BTN_SHADOW}}** — apply VERBATIM. If the brand
     uses an offset-solid pattern (e.g. `4px 4px 0 #FFFFFF`), the
     button will visibly sit on a stacked-paper underlayer — that's
     CORRECT and brand-required. Do not "improve" it by adding a blur
     or softening it. If the brand uses `none`, the button is flat.
   - **Hover behaviour**: implement a `:hover` that matches "{{BTN_HOVER}}"
     — e.g. for "darkens ~8%" emit `filter: brightness(0.92);`, for
     "scales 1.02" emit `transform: scale(1.02);`.
   - Width: full width of the right column on desktop, full width of
     the card on mobile.
   - Content: if {{DISCOUNT_PERCENT}} is non-empty, write
     "GET {{DISCOUNT_PERCENT}}% OFF →" (English) or
     "SICHERE DIR {{DISCOUNT_PERCENT}}% RABATT →" (German).
     Otherwise fall back to "{{CTA_TEXT}} →".
   - `<a>` element with `href="{{CTA_URL}}"` — this MUST be the literal
     destination URL the user provided (NEVER `#`, NEVER the article
     anchor).

5. **"DEAL ENDING IN" row** — single horizontal row, centered, with a
   real working JS countdown:
   - Layout: one `<div>` centered horizontally inside the column, using
     `display:inline-flex; align-items:baseline; gap:10px;` so the label
     and timer sit side-by-side on the same baseline.
   - Label (left side): "{{COUNTDOWN_LABEL}}" (e.g. "DEAL ENDING IN:" /
     "ANGEBOT ENDET IN:") — small caps, bold, dark navy, ~12-13px.
   - Timer (right side): monospace `HH:MM:SS` in RED (#DC2626), ~16-18px
     (NOT 24-28px — the timer must NOT dominate this row), bold. The
     timer element MUST have **`class="js-countdown"`**,
     **`data-countdown-seconds="14400"`** (4 hours = 14400s), and
     **`data-countdown-key="main"`** so it ticks in lockstep with the
     announcement-bar countdown (both elements share the same end-time
     via the matching `data-countdown-key`). Initial visible text:
     `04:00:00`.
   - On mobile the label + timer can wrap to two centered lines if needed.

6. **Trust pill bar** — single pill containing two trust facts
   separated by a vertical divider. Background: **{{TRUST_BG_HEX}}**
   (a slightly darker tint of the brand's page bg — derived, never
   invented). Rounded fully, ~12-16px padding:
   - LEFT half: "Sell-Out Risk: **{{SCARCITY_LINE}}**" (the
     scarcity-level word like "High" in RED bold). In German:
     "Sell-Out Risk: **Hoch**".
   - VERTICAL DIVIDER between halves
   - RIGHT half: "**{{SHIPPING_LINE}}**" (e.g. "FREE shipping" /
     "Kostenloser Versand") — bold, dark navy
   - LAYOUT IS HORIZONTAL: both halves on one row, separated by a thin
     vertical line. NOT stacked. NOT two pills.

7. **Guarantee trust line** — small text below the pill, centered or
   left-aligned: "Try it today with a **{{GUARANTEE_LINE}}**!" (English)
   or "Probiere es heute mit einer **{{GUARANTEE_LINE}}**!" (German).
   The guarantee text is bolded.

— After the main right-column content, FULL-WIDTH elements that span
the entire card (below both columns), in this order:

8. **SECONDARY CTA button** — only render if "{{SECONDARY_CTA_TEXT}}"
   is non-empty. Full card width, same brand-primary background, same
   destination URL ({{CTA_URL}}): "{{SECONDARY_CTA_TEXT}} →".
   If "{{SECONDARY_CTA_TEXT}}" is empty, OMIT this entire element.

9. **Disclaimer fine print** — very small, light gray, italic,
    centered. Generate ONE sentence of sensible disclaimer text
    (English: "*Special sale discount is valid only on first delivery.
    Auto-renews monthly at the standard price.*" / German: "*Der
    Aktionsrabatt gilt nur für die erste Bestellung. Solange der
    Vorrat reicht. Alle Preise inkl. MwSt.*"). Short and benign — no
    specific dollar amounts unless they're in the offer extract.

**FORBIDDEN in the buy box (do not render these under any
circumstances):**
- A trust line / reviews line / star-rating line / customer-count line
  below the guarantee. The card ends after the disclaimer (or after the
  secondary CTA + disclaimer if a secondary CTA exists).
- A "✓ AUTO-APPLIED" / "✓ FREE GIFTS UNLOCKED" badges row.
- Any "Verified Lowest Price" / "Best Price Guarantee" caption.
- Any small-print bullet list of features below the guarantee.

CRITICAL: the two-column desktop layout is non-negotiable. The buy box
on desktop MUST split image-left / content-right. On mobile MUST stack.
ALL links in this section point to "{{CTA_URL}}" — never use `#`, never
use any other destination.

SECTION 6 — FOOTER
(full viewport width, content centered, minimal)
- Centered brand logo: {{BRAND_LOGO_URL}} (~40-56px high, max-width 200px)
- Single-line tagline: "{{BRAND_TAGLINE}}" (small, muted gray, ~12px)
- **Policy link bar (centered, ~12px, muted gray)**: insert the
  pre-rendered HTML from `FOOTER_LINKS_HTML` verbatim — it already
  contains the brand's actual published policy links (Impressum,
  Datenschutzerklärung, AGB, Widerruf, etc.) discovered from the
  brand's homepage at render time. Each link is an `<a>` tag with a
  real absolute URL that resolves in production. If
  `FOOTER_LINKS_HTML` is empty, OMIT this row entirely (do NOT
  fabricate /privacy or /terms placeholders — those would 404). Wrap
  it like this:
  ```
  <div style="margin-top:12px;font-size:12px;color:{{MUTED_TEXT_HEX}};text-align:center;">{{FOOTER_LINKS_HTML}}</div>
  ```
  Style links with `color:{{MUTED_TEXT_HEX}};text-decoration:none;` and
  `text-decoration:underline` on hover.
- Copyright line below the policy links: "© {{YEAR}}, {{BRAND_NAME}}" (smaller, ~11px)
- DO NOT invent additional links beyond what {{FOOTER_LINKS_HTML}}
  provides. DO NOT add a "Contact us" mailto:. DO NOT add `#`
  placeholders. The footer outputs exactly what's given.

═══════════════════════════════════════
DESIGN SYSTEM (apply globally)
═══════════════════════════════════════

COLORS — STRICT RULE: every hex code in the rendered HTML must come
from THIS LIST. No inventing colors. No copying from the source
template. No grabbing colors from the angle / product / reference. If
you find yourself about to write a hex code that isn't in this list,
stop and pick the closest brand variable instead.

The ONLY allowed hex sources:
- **Brand variables** (all derived from brand.guidelinesMarkdown):
  - `{{PAGE_BG_HEX}}` — body + full-width section background
  - `{{PRIMARY_HEX}}` — primary CTA color, link color, action emphasis
  - `{{ACCENT_HEX}}` — secondary highlight / accent border / divider
  - `{{HOOK_BG_HEX}}` — hook callout / image card behind product
  - `{{ANN_BG_HEX}}` — announcement bar background (brand's darkest)
  - `{{ANN_TEXT_HEX}}` — announcement bar text (auto-contrast)
  - `{{TRUST_BG_HEX}}` — trust pill background (page bg, darkened)
  - `{{CARD_BG_HEX}}` — buy-box / feature card background
  - `{{BODY_TEXT_HEX}}` — body text (brand-tinted dark — navy / charcoal / dark brown depending on brand, NOT always #1F1F1F)
  - `{{MUTED_TEXT_HEX}}` — muted text / captions / placeholders
- **Universal hardcoded colors** (the only hex values you may write
  literally without a template variable):
  - `#FFFFFF` — white text on dark surfaces (when {{ANN_TEXT_HEX}}
    isn't appropriate, e.g. on the dark CTA when button text is
    explicitly meant to be white)
  - `#DC2626` — sale / discount red, used ONLY for the percent-off
    headline and the live countdown timer digits
- ALWAYS uppercase the hex digits in your output.
- DO NOT use rgba() with custom hex values — only `rgba(0,0,0, x)` for
  shadows is allowed.

CARD / SECTION CONTAINERS (apply to feature sections, FAQ items,
testimonial cards, buy box — anywhere the source layout uses a card-
like container):
- border-radius: {{CARD_RADIUS}}
- border: {{CARD_BORDER}}
- box-shadow: {{CARD_SHADOW}}
- background: #FFFFFF (or the brand's cream page bg if the page bg
  is colored — use white-on-cream contrast for card surfaces)

TYPOGRAPHY (Javvy-exact — apply these values verbatim, do not adjust):

- **Article H1** ("{{MAIN_HEADLINE}}"):
  - font-family: {{HEADING_FONT}}, sans-serif
  - font-size: 2.75rem (44px) desktop, 2.5rem (40px) tablet, ~7.75vw mobile
  - font-weight: 700 (exactly)
  - letter-spacing: -0.08rem (tight)
  - line-height: 1.2
  - LEFT-aligned in the article column

- **Section H2** (each numbered reason headline):
  - font-family: {{HEADING_FONT}}, sans-serif
  - font-size: 1.75rem (28px) desktop, 2rem (32px) tablet, ~24px mobile
  - font-weight: 700 (exactly)
  - letter-spacing: -0.05rem (tight)
  - line-height: 1.2
  - LEFT-aligned

- **Buy-box discount H2** ("UP TO X% OFF FOR A LIMITED TIME ONLY!"):
  - font-family: {{HEADING_FONT}}, sans-serif
  - font-size: 1.7rem (~27px) desktop, 1.4rem (~22px) mobile
  - font-weight: 700 (exactly)
  - line-height: 1.2
  - **`text-align: center`** explicitly on the headline itself

- **Body paragraphs**:
  - font-family: {{BODY_FONT}}, sans-serif
  - font-size: 1.15rem (~18.4px)
  - font-weight: 400
  - letter-spacing: -0.02em (very subtle tightening)
  - line-height: 1.5
  - color: {{BODY_TEXT_HEX}}
  - LEFT-aligned

- **Hook callout copy**, **author byline**, **scarcity text**, **trust
  text** etc. share the body font/weight/color unless explicitly
  overridden in their section spec.

DO NOT use font-weight 800 or 900 for H1/H2 — those are reserved for
the announcement-bar text (line 1 = 900) and the announcement-bar
countdown numbers (= 900). All article and buy-box headlines are
weight 700.

LAYOUT — THE CRITICAL PART:
- ONE content column, max-width 768px (48rem), ALWAYS centered horizontally on the viewport
- Empty white space appears EQUALLY on the left and right of the column on desktop
- The 768px column applies to: article header, hook callout, listicle body
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

— SECTION COUNT GUARANTEE (read-once verification before you ship the HTML) —

The REASONS block above lists numbered items as `REASON 1:`, `REASON 2:`,
… `REASON N:`. **You MUST render every single REASON as its own
`<section>` with its own numbered H2.** Count the REASONs in the block
above, count the `<section>` elements you emit, and verify they match.
If the block has 11 REASONs, the body has 11 numbered sections. If it
has 10, the body has 10. Never fewer.

**The closing offer block is SEPARATE and ADDITIONAL** — it is not a
substitute for the last numbered reason. Even when the last REASON's
copy says "the offer is the obvious next step", that REASON gets its
own numbered `<section>` first, THEN the offer block follows.

If you're at the end and the section count doesn't match, GO BACK and
add the missing section before closing `<body>` — do not output a
truncated page.

OFFER_LABEL: {{OFFER_LABEL}}
OFFER_PRODUCT_IMAGE_URL: {{OFFER_PRODUCT_IMAGE_URL}}
OFFER_HEADLINE: {{OFFER_HEADLINE}}
OFFER_SUBLINE: {{OFFER_SUBLINE}}
DISCOUNT_PERCENT: {{DISCOUNT_PERCENT}}
DISCOUNT_LABEL: {{DISCOUNT_LABEL}}
HAS_FREE_GIFTS: {{HAS_FREE_GIFTS}}
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
FOOTER_LINKS_HTML: {{FOOTER_LINKS_HTML}}
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
  768px column (which itself is centered on the page).
- DO NOT stack the author photo above the byline. Photo is to the LEFT of the byline.
- DO NOT add excessive white space above the headline. Headline sits tight under the bar.
- DO NOT invent or rewrite any of the body copy. Use what is provided verbatim.
- DO NOT add sections that are not in the structure above (no testimonials carousel,
  no FAQ unless specified, no ingredient breakdowns).
- DO NOT add stock images. Use only the image URLs provided.
- All reasons follow the IDENTICAL block pattern. Do not vary the layout per reason.
- Keep the page mobile-first single-column at all viewport widths.
- **Every numbered section is stacked in this exact order: H2 headline
  → square 1:1 image → body paragraphs → optional inline CTA (#3+ only).**
  DO NOT use a 2-column grid inside a numbered section. DO NOT put the
  image to the left or right of the body. The image always sits
  BETWEEN the headline and the body, full column-width.
- **DO NOT add an inline CTA link / "Learn more" link / arrow link to
  REASON 1 or REASON 2.** Those sections end with their last body
  paragraph. The inline CTA link is reserved for REASON 3 onward.
  If you render an inline CTA on REASON 1 or REASON 2, the output is
  considered broken — review your draft before emitting.

═══════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════

Output a single complete HTML document — `<!DOCTYPE html>` to `</html>`.
Inline CSS in a `<style>` tag in `<head>`.
No markdown code fences around the output.
No commentary, no preamble.
The first character of your output is `<` and the last character is `>`.

Include this stylesheet link AND this body reset in `<head>`. The reset
is REQUIRED: LanderLab's `styles.css` sets `body { padding: 14px;
border: 1px solid #f3f3f3; }` which would inset-frame the entire page
and break the edge-to-edge announcement bar + footer. Our reset
overrides it with `!important` since LanderLab's stylesheet may load
AFTER our inline `<style>`.

```html
<link rel="stylesheet" href="https://resources.landerlab.io/css/styles.css" landerlab-styles>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta charset="UTF-8">
<style>
  /* Override LanderLab base — keep body edge-to-edge and frame-free */
  html, body { margin: 0 !important; padding: 0 !important; border: 0 !important; }
  body { background: {{PAGE_BG_HEX}}; }
  * { box-sizing: border-box; }
  /* Prevent the announcement bar text lines from wrapping mid-line
     (otherwise trailing emojis fall to their own row). The mobile
     @media block below scales them down so they still fit on phones. */
  .ann-bar-line1, .ann-bar-line2 { white-space: nowrap; }
</style>
```

The page must function correctly when loaded as a standalone HTML page — all CSS inline or via the LanderLab CSS link, no external dependencies beyond that.

═══════════════════════════════════════
REQUIRED INLINE COUNTDOWN SCRIPT
═══════════════════════════════════════

Immediately before `</body>` you MUST include this exact `<script>` tag
verbatim — do not modify it, do not reformat it, do not change variable
names. It powers the working countdowns in the announcement bar and the
buy box:

```html
<script>
(function () {
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmt(secs) {
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = secs % 60;
    return pad(h) + ":" + pad(m) + ":" + pad(s);
  }
  function init(el) {
    // Persist end-time across reloads using sessionStorage so the user
    // doesn't see the timer restart if they refresh mid-visit. ALL
    // elements with the same data-countdown-key share the same key —
    // so the announcement-bar countdown and the buy-box countdown tick
    // in lockstep and display identical times.
    var key = "ll_cd_" + (el.dataset.countdownKey || "main");
    var endAt = parseInt(sessionStorage.getItem(key) || "0", 10);
    var now = Date.now();
    if (!endAt || endAt < now) {
      var secs = parseInt(el.dataset.countdownSeconds || "14400", 10);
      endAt = now + secs * 1000;
      sessionStorage.setItem(key, String(endAt));
    }
    // Detect mode: if the element contains separate per-part children
    // (Javvy 3-column pattern with [data-cd-h]/[data-cd-m]/[data-cd-s]),
    // update each part individually. Otherwise treat the element as a
    // single text node holding "HH:MM:SS".
    var hEl = el.querySelector("[data-cd-h]");
    var mEl = el.querySelector("[data-cd-m]");
    var sEl = el.querySelector("[data-cd-s]");
    var parts = !!(hEl && mEl && sEl);
    function tick() {
      var remaining = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
      if (parts) {
        var h = Math.floor(remaining / 3600);
        var m = Math.floor((remaining % 3600) / 60);
        var s = remaining % 60;
        hEl.textContent = pad(h);
        mEl.textContent = pad(m);
        sEl.textContent = pad(s);
      } else {
        el.textContent = fmt(remaining);
      }
      if (remaining > 0) requestAnimationFrame(function () { setTimeout(tick, 1000); });
    }
    tick();
  }
  function ready() {
    var els = document.querySelectorAll(".js-countdown, .js-countdown-bar");
    for (var i = 0; i < els.length; i++) init(els[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
</script>
```

The countdown depends on TWO things you must render correctly:
1. The announcement-bar countdown element has `class="js-countdown-bar"`
   and `data-countdown-seconds="14400"` (4 hours).
2. The buy-box countdown element has `class="js-countdown"`
   and `data-countdown-seconds="14400"`.

If you forget the script OR the class names OR the data attributes, the
timers won't work. Render them exactly as specified.
