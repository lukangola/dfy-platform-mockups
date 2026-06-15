CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'facebook_ads' NOT NULL,
	"external_id" text NOT NULL,
	"advertiser_name" text,
	"page_id" text,
	"page_url" text,
	"media_urls" jsonb,
	"thumbnail_url" text,
	"format" text,
	"copy" text,
	"cta" text,
	"landing_url" text,
	"ad_start" timestamp with time zone,
	"ad_stop" timestamp with time zone,
	"runtime_days" integer,
	"is_active" boolean,
	"variation_count" integer,
	"traction_score" numeric(10, 4),
	"hook" text,
	"transcript" text,
	"niche_stream_id" uuid,
	"competitor_id" uuid,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "brand_keyword_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"product_id" uuid,
	"angle_id" text NOT NULL,
	"angle_name" text,
	"problem_keywords" jsonb,
	"outcome_keywords" jsonb,
	"product_keywords" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"model" text,
	"prompt_version" text
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fb_page_url" text,
	"fb_page_id" text,
	"ig_handle" text,
	"tiktok_handle" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"discovery_reason" text,
	"dedupe_key" text NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "feed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"feed_item_id" uuid NOT NULL,
	"user_id" uuid,
	"event" text NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "feed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"ad_creative_id" uuid,
	"organic_post_id" uuid,
	"rail" text NOT NULL,
	"ref_key" text NOT NULL,
	"relevance_score" numeric(10, 4),
	"composite_score" numeric(10, 4),
	"matched_keywords" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"tier2_enriched" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niche_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"niche" text NOT NULL,
	"display_name" text NOT NULL,
	"keywords" jsonb,
	"leading_advertisers" jsonb,
	"pain_point_keywords" jsonb,
	"config" jsonb,
	"last_refreshed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organic_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"handle" text,
	"profile_name" text,
	"post_url" text,
	"media_url" text,
	"thumbnail_url" text,
	"caption" text,
	"hashtags" jsonb,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"posted_at" timestamp with time zone,
	"transcript" text,
	"format" text DEFAULT 'video' NOT NULL,
	"traction_score" numeric(10, 4),
	"hook" text,
	"niche_stream_id" uuid,
	"raw_json" jsonb
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "niche_type" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_creatives_source_external_uniq" ON "ad_creatives" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_keyword_sets_brand_angle_uniq" ON "brand_keyword_sets" USING btree ("brand_id","angle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_brand_dedupe_uniq" ON "competitors" USING btree ("brand_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_items_brand_ref_uniq" ON "feed_items" USING btree ("brand_id","ref_key");--> statement-breakpoint
CREATE UNIQUE INDEX "niche_streams_niche_uniq" ON "niche_streams" USING btree ("niche");--> statement-breakpoint
CREATE UNIQUE INDEX "organic_posts_source_external_uniq" ON "organic_posts" USING btree ("source","external_id");