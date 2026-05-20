/**
 * Capture screenshots of the Character B-Roll walkthrough for the public
 * docs page (/docs/character-broll). Drives the local dev app with
 * Puppeteer, signs in by minting a session row directly in the dev DB
 * (no password needed), walks through the configured stages, screenshots
 * at each.
 *
 * Output:
 *   client/public/docs-screenshots/character-broll/
 *     01-setup.png    — Project Input step with product/character/angle picked
 *     02-shot-list.png — Shot List step with the generated shots
 *     03-images.png   — Images step after generation (best-effort partial OK)
 *     04-videos.png   — Videos step after generation (best-effort partial OK)
 *
 * Prerequisites:
 *   - Dev stack running (pnpm dev) on http://localhost:3000
 *   - User row marcus@lvrg-consulting.com exists on dev DB
 *   - Wellbe brand has at least one researched product (Shape & Glow)
 *   - FAL_KEY + ANTHROPIC_API_KEY env vars set on dev:server (.env.local)
 *
 * Run:
 *   pnpm tsx --env-file=.env.local scripts/capture-character-broll-docs.ts
 *
 * Options (env vars):
 *   STAGES=1,2,3,4   (default "1,2") — which stages to capture
 *   FULL_SHOTS=1     — generate ALL shots' images (cost $$). Default skips
 *                      to a sampling.
 */
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import pg from "pg";

const DEV_DB_URL = process.env.DATABASE_URL;
if (!DEV_DB_URL) {
  console.error("DATABASE_URL is required (run with --env-file=.env.local)");
  process.exit(1);
}

const BASE_URL = "http://localhost:3000";
const USER_EMAIL = "marcus@lvrg-consulting.com";
const BRAND_ID = "7a8d1cfa-0f69-41cb-921c-0965fbfea2d0"; // wellbe
const PRODUCT_NAME_HINT = "Shape & Glow";

const SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  "client/public/docs-screenshots/character-broll",
);

const STAGES = new Set(
  (process.env.STAGES ?? "1,2,3,4").split(",").map((s) => parseInt(s.trim(), 10)),
);

const VIEWPORT = { width: 1600, height: 900 };

async function mintSession(): Promise<{ token: string; userId: string }> {
  const client = new pg.Client({ connectionString: DEV_DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email=$1`,
      [USER_EMAIL],
    );
    if (rows.length === 0) throw new Error(`No user ${USER_EMAIL} on dev DB`);
    const userId = rows[0].id;
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await client.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, token, expiresAt],
    );
    return { token, userId };
  } finally {
    await client.end();
  }
}

async function revokeSession(token: string): Promise<void> {
  const client = new pg.Client({ connectionString: DEV_DB_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM sessions WHERE token=$1`, [token]);
  } finally {
    await client.end();
  }
}

/** Find the first product card on the page matching the name hint. */
async function pickProduct(page: Page): Promise<void> {
  // Wait for the "SELECT PRODUCT" label to appear, then click its dropdown
  await page.waitForFunction(
    () => /SELECT PRODUCT/i.test(document.body.innerText),
    { timeout: 15_000 },
  );
  // Click the dropdown button — it's the one whose text contains
  // "Choose a researched product..."
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.find((b) =>
      /Choose a researched product/i.test(b.textContent ?? ""),
    );
    (btn as HTMLElement | null)?.click();
  });
  await sleep(800);
  // Click the option matching the product name hint. Avoid inner function
  // declarations inside evaluate() (tsx/esbuild injects __name decorators
  // that aren't defined in the page context). Inline everything.
  const clicked = await page.evaluate((hint: string) => {
    const all = Array.from(document.querySelectorAll<HTMLElement>("*"));
    const matches: HTMLElement[] = [];
    for (const el of all) {
      // own text only (direct text nodes, no descendants)
      let own = "";
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 3 /* TEXT_NODE */) own += n.textContent ?? "";
      }
      if (own.trim().startsWith(hint)) matches.push(el);
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    let el: HTMLElement | null = matches[0];
    while (el) {
      const tag = el.tagName.toLowerCase();
      const cursor = getComputedStyle(el).cursor;
      if (tag === "button" || el.getAttribute("role") === "button" || cursor === "pointer") {
        el.click();
        return el.textContent?.slice(0, 80) ?? tag;
      }
      el = el.parentElement;
    }
    return null;
  }, PRODUCT_NAME_HINT);
  console.log(`  picked product: ${clicked}`);
  await sleep(600);
}

/** Click the first character tile in the default library. */
async function pickFirstCharacter(page: Page): Promise<void> {
  await page.waitForFunction(
    () => /DEFAULT LIBRARY/i.test(document.body.innerText),
    { timeout: 10_000 },
  );
  const clicked = await page.evaluate(() => {
    // Find the DEFAULT LIBRARY heading's parent section, then click the
    // first <img> inside (its tile parent is the click target).
    const all = Array.from(document.querySelectorAll<HTMLElement>("*"));
    let libNode: HTMLElement | null = null;
    for (const el of all) {
      let own = "";
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 3) own += n.textContent ?? "";
      }
      if (own.trim().toUpperCase() === "DEFAULT LIBRARY") {
        libNode = el;
        break;
      }
    }
    if (!libNode) return null;
    // Walk up to a section/div container that has tile children
    let scope: HTMLElement | null = libNode;
    let imgs: HTMLImageElement[] = [];
    while (scope) {
      imgs = Array.from(scope.querySelectorAll("img"));
      if (imgs.length >= 1) break;
      scope = scope.parentElement;
    }
    if (imgs.length === 0) return null;
    // Click the parent of the first character image (the tile button/div)
    let target: HTMLElement = imgs[0];
    // Walk up to find a clickable ancestor (has cursor:pointer or onclick)
    let probe: HTMLElement | null = target;
    while (probe) {
      const cur = getComputedStyle(probe).cursor;
      if (
        probe.tagName === "BUTTON" ||
        probe.getAttribute("role") === "button" ||
        cur === "pointer"
      ) {
        target = probe;
        break;
      }
      probe = probe.parentElement;
    }
    target.click();
    return target.tagName + (target.id ? "#" + target.id : "");
  });
  console.log(`  picked character: ${clicked}`);
  await sleep(500);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait for the "Generate Character B-Roll Shots" button to enable + click it. */
async function clickGenerateShots(page: Page): Promise<void> {
  // Scroll to the bottom so the button is in view (it sits below the angle picker)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(600);
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    const btn = buttons.find((b) =>
      /Generate Character B[- ]Roll Shots/i.test(b.textContent ?? ""),
    );
    if (!btn) return { ok: false, reason: "no button found" };
    if (btn.disabled) return { ok: false, reason: "button disabled" };
    btn.click();
    return { ok: true };
  });
  console.log(`  clicked generate-shots: ${JSON.stringify(clicked)}`);
}

/** Click a button matching the given text pattern (used for "generate images", "generate videos"). */
async function clickButtonByText(page: Page, regex: RegExp, opts: { mustNotBeDisabled?: boolean } = {}): Promise<{ ok: boolean; reason?: string }> {
  return page.evaluate(
    (rxSource: string, rxFlags: string, mustNotBeDisabled: boolean) => {
      const rx = new RegExp(rxSource, rxFlags);
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
      const btn = buttons.find((b) => rx.test(b.textContent ?? ""));
      if (!btn) return { ok: false, reason: "no button" };
      if (mustNotBeDisabled && btn.disabled) return { ok: false, reason: "disabled" };
      btn.click();
      return { ok: true };
    },
    regex.source,
    regex.flags,
    opts.mustNotBeDisabled ?? true,
  );
}

async function captureStep(
  page: Page,
  filename: string,
  fullPage = false,
): Promise<void> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const dest = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: dest as `${string}.png`, fullPage });
  console.log(`  → saved ${dest}`);
}

async function run() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  console.log("Minting dev session...");
  const { token } = await mintSession();

  console.log("Launching puppeteer...");
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: VIEWPORT,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    // Inject the session cookie + active brand before navigating
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.setCookie({
      name: "dfy_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    });
    await page.evaluate((brandId: string) => {
      localStorage.setItem("activeBrandId", brandId);
    }, BRAND_ID);

    // ── Step 1: Setup ──
    if (STAGES.has(1) || STAGES.has(2) || STAGES.has(3) || STAGES.has(4)) {
      console.log("\nStep 1 — Setup");
      await page.goto(`${BASE_URL}/workspace/apps/character-broll`, {
        waitUntil: "networkidle2",
        timeout: 30_000,
      });
      await sleep(2000);
      // Close any auto-opened dropdowns by clicking an empty area
      await page.mouse.click(1400, 400);
      await sleep(300);
      await pickProduct(page);
      await sleep(800);
      await pickFirstCharacter(page);
      await sleep(800);
      if (STAGES.has(1)) await captureStep(page, "01-setup.png");
    }

    // ── Step 2: Shot list ──
    if (STAGES.has(2) || STAGES.has(3) || STAGES.has(4)) {
      console.log("\nStep 2 — Shot list (~30s Claude call)");

      // Inspect the generate button BEFORE clicking — verify it's enabled
      const btnState = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
        const btn = buttons.find((b) =>
          /Generate Character B[- ]Roll Shots/i.test(b.textContent ?? ""),
        );
        if (!btn) return { found: false };
        return {
          found: true,
          disabled: btn.disabled,
          text: btn.textContent?.trim().slice(0, 80),
          visible: btn.offsetParent !== null,
        };
      });
      console.log("  generate-shots btn state:", JSON.stringify(btnState));

      await clickGenerateShots(page);

      // Better success indicator: the page shows a step-2 indicator becoming
      // active, OR new fal.media images appear (each shot has a placeholder).
      // The most reliable: look for the SHOT LIST step heading + an actual
      // list of shot row elements (not just the stepper nav text).
      // We use "GENERATE ALL IMAGES" button as the canary — it only exists
      // on the shot list view.
      let advanced = false;
      for (let i = 0; i < 60; i++) {
        // up to 3 min @ 3s each
        const status = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
          const genAllImagesBtn = buttons.find((b) =>
            /generate all images|generate images/i.test(b.textContent ?? ""),
          );
          return {
            hasGenAllImagesBtn: !!genAllImagesBtn,
            shotsTitle: document.querySelector("h1, h2, h3")?.textContent?.trim().slice(0, 100),
            url: location.pathname,
          };
        });
        if (status.hasGenAllImagesBtn) {
          advanced = true;
          break;
        }
        if (i === 0 || i === 9 || i === 29) {
          console.log(`  poll ${i}: ${JSON.stringify(status)}`);
        }
        await sleep(3000);
      }
      if (!advanced) {
        console.log("  WARNING: shot list view never appeared. Capturing current state.");
      } else {
        console.log("  shot list page detected");
      }
      await sleep(1500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);
      if (STAGES.has(2)) await captureStep(page, "02-shot-list.png");
    }

    // ── Step 3: Images ──
    if (STAGES.has(3) || STAGES.has(4)) {
      console.log(
        "\nStep 3 — Images (generates one image per shot, ~$0.10 each)\n" +
          "  Step is slow: character_broll_image_prompts (~3 min Claude) → batched fal calls",
      );
      const res = await clickButtonByText(page, /generate all images|generate images/i, {
        mustNotBeDisabled: true,
      });
      console.log("  clicked generate-images:", res);
      if (!res.ok) {
        console.log("  could not find generate-images button — script needs an update");
      } else {
        // Poll for image completions with status logging every 30s. Wait for
        // at least 4 done OR 10 min total, then screenshot (a partially-
        // populated grid is fine — it shows real generated images alongside
        // remaining placeholders, which is realistic for docs).
        const startedAt = Date.now();
        const POLL_INTERVAL = 15_000;
        const TARGET_DONE = 4;
        const MAX_WAIT_MS = 12 * 60 * 1000;
        let lastCount = 0;
        while (Date.now() - startedAt < MAX_WAIT_MS) {
          const status = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img"));
            const falImgs = imgs.filter((i) => /fal\.media|fal-cdn/.test(i.src));
            // Find the IMAGES (X / Y) counter in the header
            const header = Array.from(document.querySelectorAll("h1, h2, h3, div, span"))
              .map((e) => e.textContent ?? "")
              .find((t) => /IMAGES\s*\(\s*\d+\s*\/\s*\d+\s*\)/i.test(t));
            return { fal: falImgs.length, header: header?.match(/\(\s*\d+\s*\/\s*\d+\s*\)/)?.[0] };
          });
          if (status.fal !== lastCount) {
            const sec = Math.round((Date.now() - startedAt) / 1000);
            console.log(`  [+${sec}s] fal images on page: ${status.fal}  header: ${status.header ?? "-"}`);
            lastCount = status.fal;
          }
          if (status.fal >= TARGET_DONE) break;
          await sleep(POLL_INTERVAL);
        }
        await sleep(1500);
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(500);
        if (STAGES.has(3)) await captureStep(page, "03-images.png");
      }
    }

    // ── Step 4: Videos ──
    if (STAGES.has(4)) {
      console.log("\nStep 4 — Videos (generates 5s video per shot, ~$2.50 each)");
      const res = await clickButtonByText(page, /generate all videos|generate videos/i, {
        mustNotBeDisabled: true,
      });
      console.log("  clicked generate-videos:", res);
      if (!res.ok) {
        console.log("  could not find generate-videos button — script needs an update");
      } else {
        await page.waitForFunction(
          () => {
            const vids = Array.from(document.querySelectorAll<HTMLVideoElement>("video"));
            return vids.length >= 2 && vids.slice(0, 2).every((v) => v.src);
          },
          { timeout: 600_000 /* 10 min */ },
        ).catch(() => {
          console.log("  (timed out waiting for videos — capturing what's on screen)");
        });
        await sleep(2000);
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(500);
        await captureStep(page, "04-videos.png");
      }
    }

    console.log("\nDone.");
  } finally {
    if (browser) await browser.close();
    console.log("Cleaning up session...");
    await revokeSession(token);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
