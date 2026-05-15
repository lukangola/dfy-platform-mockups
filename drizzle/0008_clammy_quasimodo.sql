CREATE TABLE "listicle_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"listicle_id" uuid NOT NULL,
	"section_idx" integer NOT NULL,
	"section_headline" text,
	"image_prompt" text,
	"image_url" text,
	"image_status" text DEFAULT 'idle' NOT NULL,
	"image_approval" text DEFAULT 'pending' NOT NULL,
	"image_feedback" text,
	"image_error" text
);
--> statement-breakpoint
CREATE TABLE "listicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'drafting' NOT NULL,
	"angle_name" text,
	"language" text DEFAULT 'en' NOT NULL,
	"destination_url" text,
	"offer_extract" jsonb,
	"copy_markdown" text,
	"guidance" text,
	"rendered_html" text,
	"html_feedback" text,
	"landerlab_lander_id" text,
	"landerlab_variant_id" text,
	"landerlab_encrypted_variant_id" text,
	"landerlab_domain_id" text,
	"published_url" text,
	"preview_url" text,
	"editor_url" text,
	"error" text
);
