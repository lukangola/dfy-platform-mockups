CREATE TABLE "ad_pipeline_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"stage" text DEFAULT 'idea' NOT NULL,
	"source_type" text NOT NULL,
	"format" text NOT NULL,
	"brief" jsonb NOT NULL,
	"source_url" text,
	"original_script" text,
	"reference_image_url" text,
	"static_reference_id" uuid,
	"product_id" uuid,
	"angle_name" text,
	"language" text DEFAULT 'en',
	"bg_job_status" text DEFAULT 'pending' NOT NULL,
	"bg_job_error" text
);
