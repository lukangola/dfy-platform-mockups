/**
 * One-shot: walk every brand row, find ones whose `logoUrl` points at an
 * SVG, and replace it with a PNG re-rendered via sharp + uploaded to
 * fal.storage. Same logic the new `ensureLogoIsPng` helper runs at brand
 * ingestion time — this script is the retroactive sweep for brands that
 * predate the conversion-on-ingest change.
 *
 * Run:
 *   DATABASE_URL="<dev or prod>" pnpm exec tsx scripts/convert-svg-logos.ts
 *   # or against the linked Railway environment:
 *   railway run --service dfy-platform-mockups pnpm exec tsx scripts/convert-svg-logos.ts
 *
 * Idempotent: brands whose logo is already PNG/JPG/WebP are left alone.
 * Safe to run repeatedly.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../server/lib/db.js";
import { ensureLogoIsPng, urlLooksLikeSvg } from "../server/lib/logoConvert.js";

async function main() {
  const all = await db.select().from(schema.brands);
  const candidates = all.filter((b) => b.logoUrl && urlLooksLikeSvg(b.logoUrl));
  console.log(`Total brands: ${all.length}, SVG logo candidates: ${candidates.length}`);

  let converted = 0;
  let unchanged = 0;
  let errored = 0;

  for (const brand of candidates) {
    const before = brand.logoUrl;
    console.log(`\n→ ${brand.id} ${JSON.stringify(brand.name)}`);
    console.log(`  before: ${before}`);
    try {
      const after = await ensureLogoIsPng(before);
      if (!after) {
        console.log(`  result: null (ensureLogoIsPng returned null)`);
        errored += 1;
        continue;
      }
      if (after === before) {
        console.log(`  result: unchanged (not actually SVG by content-type)`);
        unchanged += 1;
        continue;
      }
      await db
        .update(schema.brands)
        .set({ logoUrl: after })
        .where(eq(schema.brands.id, brand.id));
      console.log(`  after:  ${after}`);
      converted += 1;
    } catch (err) {
      console.warn(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      errored += 1;
    }
  }

  // Also sweep brands that aren't OBVIOUSLY SVG by URL but might be (no
  // .svg extension yet content-type is image/svg+xml). The helper handles
  // detection via fetch+content-type/magic-bytes, so calling it for every
  // brand will only re-upload SVG bodies — pure raster URLs are returned
  // unchanged with one HEAD/GET cost each. Skip this pass by default for
  // speed; turn on with --thorough if needed.
  if (process.argv.includes("--thorough")) {
    const rest = all.filter((b) => b.logoUrl && !urlLooksLikeSvg(b.logoUrl));
    console.log(`\nThorough sweep: probing ${rest.length} non-extension brands…`);
    for (const brand of rest) {
      try {
        const after = await ensureLogoIsPng(brand.logoUrl!);
        if (after && after !== brand.logoUrl) {
          await db.update(schema.brands).set({ logoUrl: after }).where(eq(schema.brands.id, brand.id));
          console.log(`  ${brand.id} ${JSON.stringify(brand.name)}: converted (was content-type SVG)`);
          converted += 1;
        }
      } catch {
        /* swallow — same brand will be retried next thorough sweep */
      }
    }
  }

  console.log(`\nDone. converted=${converted}, unchanged=${unchanged}, errored=${errored}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
