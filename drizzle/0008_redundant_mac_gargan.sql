ALTER TYPE "public"."payment_method" ADD VALUE 'qris';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'debit';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'credit';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reference" text;