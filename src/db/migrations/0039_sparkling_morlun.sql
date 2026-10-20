CREATE TABLE "audio_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"recording_id" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"split_complete" boolean DEFAULT false NOT NULL,
	"source_version" text NOT NULL,
	"provider_id" text,
	"model" text,
	"transcript_fingerprint" text,
	"error" text,
	"claim_token" text,
	"lease_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_jobs" ADD CONSTRAINT "audio_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_jobs" ADD CONSTRAINT "audio_jobs_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audio_jobs_recording_user_unique" ON "audio_jobs" USING btree ("recording_id","user_id");--> statement-breakpoint
CREATE INDEX "audio_jobs_queue_idx" ON "audio_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_jobs_user_running_unique" ON "audio_jobs" USING btree ("user_id") WHERE "audio_jobs"."status" in ('splitting', 'transcribing');