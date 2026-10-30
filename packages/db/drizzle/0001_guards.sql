-- Database-level guards that the Drizzle schema cannot express. Hand-written.

-- site.key is the URL segment and the c15t tenantId: changing it would orphan every consent row.
CREATE FUNCTION "app"."reject_site_key_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."key" IS DISTINCT FROM OLD."key" THEN
    RAISE EXCEPTION 'app.site.key is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "site_key_immutable"
  BEFORE UPDATE OF "key" ON "app"."site"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_site_key_change"();
--> statement-breakpoint

-- consent-api LISTENs on `site_changed` and disposes the stale c15t instance. Notifying from a
-- trigger ties the message to the commit: it is sent if and only if the change is committed.
CREATE FUNCTION "app"."notify_site_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('site_changed', NEW."key");
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "site_changed_notify"
  AFTER INSERT OR UPDATE ON "app"."site"
  FOR EACH ROW EXECUTE FUNCTION "app"."notify_site_changed"();
--> statement-breakpoint

-- The admin audit log is append-only (CLAUDE.md "Authorization").
CREATE FUNCTION "app"."reject_admin_audit_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.admin_audit is append-only' USING ERRCODE = '55000';
END
$$;
--> statement-breakpoint
CREATE TRIGGER "admin_audit_append_only"
  BEFORE UPDATE OR DELETE ON "app"."admin_audit"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_admin_audit_change"();
--> statement-breakpoint
CREATE TRIGGER "admin_audit_no_truncate"
  BEFORE TRUNCATE ON "app"."admin_audit"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_admin_audit_change"();
--> statement-breakpoint

-- README D2: c15t_api reads the site registry and nothing else in `app` (the auth tables hold
-- password hashes). Guarded so the migration also runs where the role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c15t_api') THEN
    GRANT USAGE ON SCHEMA "app" TO "c15t_api";
    GRANT SELECT ON "app"."site" TO "c15t_api";
  END IF;
END
$$;
