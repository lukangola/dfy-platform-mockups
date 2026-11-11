ALTER TABLE "performance_client_configs" ADD COLUMN "shopify_refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "performance_client_configs" ADD COLUMN "shopify_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "performance_client_configs" ADD COLUMN "shopify_installed_at" timestamp with time zone;