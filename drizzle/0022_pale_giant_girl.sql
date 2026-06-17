ALTER TABLE "ad_creatives" ADD COLUMN "shares" integer;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "likes" integer;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "deep_link_url" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "adspy_advertiser_id" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "adspy_verified" boolean DEFAULT false NOT NULL;