CREATE TABLE "static_ad_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"niche" text NOT NULL,
	"image_url" text NOT NULL,
	"thumbnail_url" text,
	"source_path" text,
	"source_signature" text,
	"deconstruction" jsonb,
	"deconstruction_status" text DEFAULT 'pending' NOT NULL,
	"deconstruction_error" text,
	"deconstruction_generated_at" timestamp with time zone,
	"prompt_version" text,
	"model" text
);
