ALTER TABLE "competitors" ADD COLUMN "gethookd_brand_id" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "brandspy_active" boolean DEFAULT false NOT NULL;