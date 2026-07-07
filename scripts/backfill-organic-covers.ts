// One-shot backfill: re-host every organic post's cover on fal.storage so the
// Ad Console's Trending Organic thumbnails stop 403-ing (TikTok/IG signed cover
// URLs expire within hours). For already-expired TikTok rows the cover is
// refetched fresh via public oEmbed — no paid re-scrape. Idempotent: rows whose
// thumbnail is already a fal.media URL are skipped, so it's safe to re-run.
//
//   Dev:  pnpm tsx --env-file=.env.local scripts/backfill-organic-covers.ts
//   Prod: railway run pnpm tsx scripts/backfill-organic-covers.ts
//
// Optional: --limit=N caps how many rows to process this run.
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../server/lib/db.js";
import { persistOrganicCover, isDurableCoverUrl } from "../server/lib/adConsoleCovers.js";

const CONCURRENCY = 6;

function parseLimit(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  if (!arg) return null;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

async function main() {
  const limit = parseLimit();
  const rows = await db
    .select({
      id: schema.organicPosts.id,
      source: schema.organicPosts.source,
      externalId: schema.organicPosts.externalId,
      postUrl: schema.organicPosts.postUrl,
      thumbnailUrl: schema.organicPosts.thumbnailUrl,
    })
    .from(schema.organicPosts)
    .where(isNotNull(schema.organicPosts.thumbnailUrl));

  const stale = rows.filter((r) => !isDurableCoverUrl(r.thumbnailUrl));
  const targets = limit ? stale.slice(0, limit) : stale;
  console.log(
    `${rows.length} posts with a cover · ${rows.length - stale.length} already durable · ${stale.length} to re-host` +
      (limit ? ` (processing ${targets.length} this run)` : ""),
  );

  let ok = 0;
  let unresolved = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (r) => {
        const durable = await persistOrganicCover({
          source: r.source,
          coverUrl: r.thumbnailUrl,
          postUrl: r.postUrl,
          externalId: r.externalId,
        });
        if (durable && durable !== r.thumbnailUrl) {
          // Guard the write with the still-non-durable predicate so a concurrent
          // ingest that just re-hosted this row isn't overwritten.
          await db
            .update(schema.organicPosts)
            .set({ thumbnailUrl: durable })
            .where(and(eq(schema.organicPosts.id, r.id), eq(schema.organicPosts.thumbnailUrl, r.thumbnailUrl!)));
          ok++;
        } else {
          unresolved++;
        }
      }),
    );
    console.log(`  ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}  (re-hosted=${ok}, unresolved=${unresolved})`);
  }

  console.log(`\nDone: ${ok} cover(s) re-hosted to fal.storage, ${unresolved} unresolved (kept original URL).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
