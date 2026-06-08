-- brand_members was originally created via boot-time SQL in
-- server/index.ts (CREATE TABLE IF NOT EXISTS) and never had its own
-- drizzle migration. Including the CREATE TABLE here so drizzle's
-- journal stays consistent with schema.ts going forward — wrapped in
-- IF NOT EXISTS so prod (where the table already exists) doesn't fail.
CREATE TABLE IF NOT EXISTS "brand_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_members_brand_user_uniq" ON "brand_members" USING btree ("brand_id","user_id");
--> statement-breakpoint
-- Single source of truth for brand identity. Replaces the JSONB
-- `research` column going forward. Existing brands keep their old
-- research blob until the boot-time backfill regenerates them.
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "guidelines_markdown" text;
