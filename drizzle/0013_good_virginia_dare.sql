CREATE TABLE "share_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"share_token" text NOT NULL,
	"anchor_id" text NOT NULL,
	"angle_id" text NOT NULL,
	"angle_name" text,
	"section_kind" text NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"client_name" text,
	"status" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "share_feedback_token_anchor_uniq" ON "share_feedback" USING btree ("share_token","anchor_id");