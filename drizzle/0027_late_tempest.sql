ALTER TABLE "ad_pipeline_cards" ALTER COLUMN "language" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "ad_pipeline_cards_brand_idx" ON "ad_pipeline_cards" USING btree ("brand_id");