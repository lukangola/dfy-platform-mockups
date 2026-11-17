CREATE TABLE "performance_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"customer_key" text NOT NULL,
	"lifetime_orders" integer NOT NULL,
	"hidden_orders" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "performance_customers_brand_key_uq" ON "performance_customers" USING btree ("brand_id","customer_key");