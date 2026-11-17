CREATE TABLE "performance_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_id" text NOT NULL,
	"title" text NOT NULL,
	"variant_title" text,
	"sku" text,
	"product_id" text,
	"variant_id" text,
	"quantity" integer NOT NULL,
	"gross" numeric(12, 2) NOT NULL,
	"net" numeric(12, 2) NOT NULL,
	"product_line" text DEFAULT 'OTH' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_spend_campaign_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"day" text NOT NULL,
	"day_start" timestamp with time zone NOT NULL,
	"day_end" timestamp with time zone NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"spend" numeric(12, 4) NOT NULL,
	"product_line" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_client_configs" ADD COLUMN "product_lines" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "performance_order_lines_order_line_uq" ON "performance_order_lines" USING btree ("order_id","line_id");--> statement-breakpoint
CREATE INDEX "performance_order_lines_brand_idx" ON "performance_order_lines" USING btree ("brand_id","product_line");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_spend_campaign_days_uq" ON "performance_spend_campaign_days" USING btree ("brand_id","platform","account_id","campaign_id","day","country");--> statement-breakpoint
CREATE INDEX "performance_spend_campaign_days_brand_day_idx" ON "performance_spend_campaign_days" USING btree ("brand_id","day_start");