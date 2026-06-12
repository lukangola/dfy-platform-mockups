ALTER TABLE "products" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_share_token_unique" UNIQUE("share_token");