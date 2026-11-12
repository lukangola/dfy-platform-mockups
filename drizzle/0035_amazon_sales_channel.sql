DROP INDEX "performance_orders_brand_order_uq";--> statement-breakpoint
ALTER TABLE "performance_client_configs" ADD COLUMN "amazon_client_id" text;--> statement-breakpoint
ALTER TABLE "performance_client_configs" ADD COLUMN "amazon_client_secret_enc" text;--> statement-breakpoint
ALTER TABLE "performance_client_configs" ADD COLUMN "amazon_refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "performance_client_configs" ADD COLUMN "amazon_region" text;--> statement-breakpoint
ALTER TABLE "performance_client_configs" ADD COLUMN "amazon_marketplace_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_orders" ADD COLUMN "channel" text DEFAULT 'shopify' NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_variant_costs" ADD COLUMN "sku" text;--> statement-breakpoint
CREATE INDEX "performance_variant_costs_brand_sku_idx" ON "performance_variant_costs" USING btree ("brand_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_orders_brand_order_uq" ON "performance_orders" USING btree ("brand_id","channel","shopify_order_id");