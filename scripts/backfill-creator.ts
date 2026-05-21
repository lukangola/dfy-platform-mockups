// One-shot backfill: assign all brand_assets with NULL user_id to the
// (only) user in the dev DB. We checked the dev DB and Marcus is the sole
// user with any saved generations, so all 121 orphan rows belong to him.
//
// In prod (or any multi-user DB), DO NOT run this as-is — re-inspect first.
// This script intentionally aborts if there is more than one user.
import { db, schema } from "../server/lib/db.js";
import { isNull } from "drizzle-orm";

async function main() {
  const users = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users);
  if (users.length === 0) {
    console.error("No users in DB — nothing to backfill onto.");
    process.exit(1);
  }
  if (users.length > 1) {
    console.error(`Refusing to backfill: ${users.length} users in DB. Pass a specific user via --user=<id> instead.`);
    for (const u of users) console.error(`  ${u.id}  ${u.email}`);
    process.exit(1);
  }
  const targetUser = users[0]!;
  console.log(`Backfilling onto: ${targetUser.email} (${targetUser.id})`);

  const updated = await db
    .update(schema.brandAssets)
    .set({ userId: targetUser.id })
    .where(isNull(schema.brandAssets.userId))
    .returning({ id: schema.brandAssets.id });

  console.log(`Updated ${updated.length} brand_assets row(s) with user_id = ${targetUser.id}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
