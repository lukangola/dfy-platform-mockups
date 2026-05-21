// One-shot: list users + brand_assets stats so we know what to backfill onto whom.
import { db, schema } from "../server/lib/db.js";
import { isNull, sql } from "drizzle-orm";

async function main() {
  const users = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users);
  console.log("Users:");
  for (const u of users) console.log(`  ${u.id}  ${u.email}  (${u.name ?? "no name"})`);

  const totalRow = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.brandAssets);
  const nullRow = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.brandAssets)
    .where(isNull(schema.brandAssets.userId));
  console.log(`\nbrand_assets total: ${totalRow[0]?.n ?? 0}`);
  console.log(`brand_assets without user_id: ${nullRow[0]?.n ?? 0}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
