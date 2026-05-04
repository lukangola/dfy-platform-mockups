CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"brand_url" text,
	"logo_url" text,
	"research" jsonb,
	"research_status" text DEFAULT 'pending' NOT NULL,
	"research_error" text
);
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "product_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "fact_sheet" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_back_image_url" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
-- Seed the initial brand row to absorb any pre-existing products/assets.
-- Uses a deterministic id so repeated runs are idempotent.
INSERT INTO "brands" ("id", "name", "research_status")
VALUES ('00000000-0000-0000-0000-000000000001', 'Alkami Elements', 'pending')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "products" SET "brand_id" = '00000000-0000-0000-0000-000000000001' WHERE "brand_id" IS NULL;--> statement-breakpoint
UPDATE "brand_assets" SET "brand_id" = '00000000-0000-0000-0000-000000000001' WHERE "brand_id" IS NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "brand_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_assets" ALTER COLUMN "brand_id" SET NOT NULL;
