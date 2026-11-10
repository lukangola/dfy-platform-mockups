CREATE TABLE "performance_client_configs" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_source" text DEFAULT 'mock' NOT NULL,
	"nc_definition" text DEFAULT 'first_ever' NOT NULL,
	"nc_window_days" integer DEFAULT 365 NOT NULL,
	"revenue_field" text DEFAULT 'total' NOT NULL,
	"region_mapping" jsonb,
	"sync_every_minutes" integer DEFAULT 10 NOT NULL,
	"shopify_shop_domain" text,
	"shopify_token_enc" text,
	"meta_token_enc" text,
	"meta_accounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"google_developer_token_enc" text,
	"google_client_id" text,
	"google_client_secret_enc" text,
	"google_refresh_token_enc" text,
	"google_login_customer_id" text,
	"google_accounts" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"shopify_order_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone,
	"customer_key" text,
	"customer_created_at" timestamp with time zone,
	"country" text,
	"region" text NOT NULL,
	"total_price" numeric(12, 2) NOT NULL,
	"subtotal_price" numeric(12, 2),
	"currency" text,
	"financial_status" text,
	"cancelled" boolean DEFAULT false NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"is_new_customer" boolean DEFAULT true NOT NULL,
	"cogs" numeric(12, 2),
	"cogs_complete" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_spend_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"region" text NOT NULL,
	"spend" numeric(12, 4) NOT NULL,
	"impressions" integer,
	"clicks" integer
);
--> statement-breakpoint
CREATE TABLE "performance_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"cursor" text,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "performance_variant_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"variant_id" text NOT NULL,
	"inventory_item_id" text,
	"unit_cost" numeric(12, 4),
	"currency" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "performance_orders_brand_order_uq" ON "performance_orders" USING btree ("brand_id","shopify_order_id");--> statement-breakpoint
CREATE INDEX "performance_orders_brand_created_idx" ON "performance_orders" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "performance_orders_brand_customer_idx" ON "performance_orders" USING btree ("brand_id","customer_key");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_spend_brand_platform_account_hour_uq" ON "performance_spend_hours" USING btree ("brand_id","platform","account_id","hour");--> statement-breakpoint
CREATE INDEX "performance_spend_brand_hour_idx" ON "performance_spend_hours" USING btree ("brand_id","hour");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_sync_state_brand_source_uq" ON "performance_sync_state" USING btree ("brand_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_variant_costs_brand_variant_uq" ON "performance_variant_costs" USING btree ("brand_id","variant_id");