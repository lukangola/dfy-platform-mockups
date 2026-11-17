DROP INDEX "performance_spend_brand_platform_account_hour_uq";--> statement-breakpoint
ALTER TABLE "performance_spend_hours" ADD COLUMN "country" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "performance_spend_brand_platform_account_hour_country_uq" ON "performance_spend_hours" USING btree ("brand_id","platform","account_id","hour","country");