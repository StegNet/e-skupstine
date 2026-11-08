CREATE TABLE "agenda_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "assembly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'redovna' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"join_code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"host_id" text NOT NULL,
	"guest_access" boolean DEFAULT false NOT NULL,
	"statut_confirmed_at" timestamp with time zone,
	"quorum_percent" integer DEFAULT 50 NOT NULL,
	"threshold" integer DEFAULT 2 NOT NULL,
	"seal_method" text DEFAULT 'certilia_app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assembly_joinCode_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"assembly_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"member_id" uuid,
	"is_guest" boolean NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "attendance_assembly_id_user_id_pk" PRIMARY KEY("assembly_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"assembly_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "ballot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"bundle" text NOT NULL,
	"receipt" text NOT NULL,
	CONSTRAINT "ballot_receipt_unique" UNIQUE("receipt")
);
--> statement-breakpoint
CREATE TABLE "committee_member" (
	"assembly_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"enc_public_key" jsonb,
	"sign_public_key" jsonb,
	CONSTRAINT "committee_member_assembly_id_user_id_pk" PRIMARY KEY("assembly_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oib" text NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date,
	"email" text,
	"category" text,
	"joined_at" date,
	"left_at" date,
	"voting_right" boolean DEFAULT true NOT NULL,
	CONSTRAINT "member_oib_unique" UNIQUE("oib")
);
--> statement-breakpoint
CREATE TABLE "participation" (
	"question_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "participation_question_id_member_id_pk" PRIMARY KEY("question_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agenda_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"options" jsonb NOT NULL,
	"max_choices" integer DEFAULT 1 NOT NULL,
	"majority_base" text DEFAULT 'votes_cast' NOT NULL,
	"majority_fraction" text DEFAULT 'half' NOT NULL,
	"results_visibility" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"present_at_open" integer,
	"eligible_at_open" integer,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "result" (
	"question_id" uuid PRIMARY KEY NOT NULL,
	"counts" jsonb NOT NULL,
	"valid" integer NOT NULL,
	"invalid" integer NOT NULL,
	"adopted" boolean,
	"receipts_digest" text NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_confirmation" (
	"question_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_confirmation_question_id_user_id_pk" PRIMARY KEY("question_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "seal" (
	"assembly_id" uuid PRIMARY KEY NOT NULL,
	"pdf" "bytea" NOT NULL,
	"pdf_sha256" text NOT NULL,
	"signed_pdf" "bytea",
	"signed_pdf_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sealed_at" timestamp with time zone,
	CONSTRAINT "seal_pdfSha256_unique" UNIQUE("pdf_sha256"),
	CONSTRAINT "seal_signedPdfSha256_unique" UNIQUE("signed_pdf_sha256")
);
--> statement-breakpoint
CREATE TABLE "seal_signature" (
	"assembly_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"signature" text,
	"signer_name" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seal_signature_assembly_id_user_id_pk" PRIMARY KEY("assembly_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "share_submission" (
	"question_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"shares" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_submission_question_id_user_id_pk" PRIMARY KEY("question_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_assembly_id_assembly_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assembly"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly" ADD CONSTRAINT "assembly_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_assembly_id_assembly_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assembly"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot" ADD CONSTRAINT "ballot_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_member" ADD CONSTRAINT "committee_member_assembly_id_assembly_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assembly"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_member" ADD CONSTRAINT "committee_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_agenda_item_id_agenda_item_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."agenda_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result" ADD CONSTRAINT "result_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_confirmation" ADD CONSTRAINT "result_confirmation_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_confirmation" ADD CONSTRAINT "result_confirmation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal" ADD CONSTRAINT "seal_assembly_id_assembly_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assembly"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_signature" ADD CONSTRAINT "seal_signature_assembly_id_assembly_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assembly"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_signature" ADD CONSTRAINT "seal_signature_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_submission" ADD CONSTRAINT "share_submission_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_submission" ADD CONSTRAINT "share_submission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_index" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_index" ON "verification" USING btree ("identifier");