ALTER TABLE "characters" ADD COLUMN "seedance_sheet_url" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "seedance_portrait_url" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "seedance_prep_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "seedance_prep_error" text;