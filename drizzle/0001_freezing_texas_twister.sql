CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'Uncategorized' NOT NULL,
	"product_url" text NOT NULL,
	"product_image_url" text,
	"content_image_url" text,
	"research" jsonb,
	"research_status" text DEFAULT 'pending' NOT NULL,
	"research_error" text
);
