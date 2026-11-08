ALTER TABLE "assembly" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "assembly" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ballot" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "committee_member" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "secret" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "result" ADD COLUMN "roll" jsonb;--> statement-breakpoint
ALTER TABLE "ballot" ADD CONSTRAINT "ballot_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;