CREATE TYPE "public"."conflict_kind" AS ENUM('stock_short', 'price_changed', 'inactive_product', 'discount_over_limit', 'clock_skew');--> statement-breakpoint
CREATE TYPE "public"."conflict_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "offline_sales" (
	"sale_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"temp_no" text NOT NULL,
	"device_sold_at" timestamp with time zone NOT NULL,
	"device_cashier_name" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" "conflict_kind" NOT NULL,
	"variant_id" uuid,
	"detail" text NOT NULL,
	"status" "conflict_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolve_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "offline_sales" ADD CONSTRAINT "offline_sales_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sales" ADD CONSTRAINT "offline_sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_conflicts" ADD CONSTRAINT "sale_conflicts_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_conflicts" ADD CONSTRAINT "sale_conflicts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_conflicts" ADD CONSTRAINT "sale_conflicts_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_conflicts" ADD CONSTRAINT "sale_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offline_sales_store_idx" ON "offline_sales" USING btree ("store_id","synced_at");--> statement-breakpoint
CREATE INDEX "sale_conflicts_store_status_idx" ON "sale_conflicts" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sale_conflicts_sale_idx" ON "sale_conflicts" USING btree ("sale_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;