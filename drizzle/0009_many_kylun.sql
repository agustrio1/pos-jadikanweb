ALTER TABLE "products" ADD COLUMN "taxable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "tax_amount" integer DEFAULT 0 NOT NULL;