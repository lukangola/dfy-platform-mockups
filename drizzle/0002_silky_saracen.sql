CREATE TABLE "brand_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"title" text NOT NULL,
	"source_app" text NOT NULL,
	"product_id" uuid,
	"metadata" jsonb
);
