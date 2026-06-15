CREATE TABLE "ad_console_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"title" text,
	"hook" text,
	"concept" text,
	"format" text,
	"angle" text,
	"rationale" text,
	"source_refs" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"model" text,
	"prompt_version" text
);
