CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "staff_user_roles" (
	"staff_user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "staff_user_roles_staff_user_id_role_id_pk" PRIMARY KEY("staff_user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_user_roles" ADD CONSTRAINT "staff_user_roles_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_user_roles" ADD CONSTRAINT "staff_user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expiry_idx" ON "rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "staff_user_roles_role_idx" ON "staff_user_roles" USING btree ("role_id");
--> statement-breakpoint
INSERT INTO roles (key, name) VALUES ('staff', 'Staff'), ('admin', 'Administrator');
--> statement-breakpoint
INSERT INTO staff_user_roles (staff_user_id, role_id)
SELECT s.id, r.id FROM staff_users s CROSS JOIN roles r WHERE r.key = 'staff';
