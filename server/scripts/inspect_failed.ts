import { db, schema } from "../lib/db.js";
import { desc } from "drizzle-orm";

async function main() {
  const rows = await db.select().from(schema.characters).orderBy(desc(schema.characters.createdAt));
  console.log(`\n${rows.length} characters total:\n`);
  for (const r of rows) {
    console.log(`  ${r.id.slice(0, 8)}  ${r.seedancePrepStatus.padEnd(8)}  sheet=${r.seedanceSheetUrl ? "✓" : "·"}  portrait=${r.seedancePortraitUrl ? "✓" : "·"}  brandId=${r.brandId ?? "NULL  "}  ${r.title.slice(0, 50)}`);
  }
  process.exit(0);
}
main();
