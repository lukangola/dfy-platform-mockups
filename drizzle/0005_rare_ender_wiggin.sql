CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid,
	"title" text NOT NULL,
	"image_url" text NOT NULL,
	"thumbnail_url" text,
	"source_path" text,
	"source_signature" text
);
