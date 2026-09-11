-- Deny the internet direct access to every table.
--
-- Supabase serves PostgREST over the `public` schema at
-- https://<ref>.supabase.co/rest/v1/<table> to anyone holding the publishable
-- (anon) key, which is public by design and ships in any browser bundle. That
-- endpoint is live whether or not the application uses supabase-js; this one
-- does not, and connects as the table owner over `pg` instead. Before this
-- migration every table was therefore readable and writable from the internet,
-- `staff_users.password_hash` included.
--
-- Enabling row level security with no policies denies every role that is not
-- the table owner. The application keeps working untouched, because a table
-- owner bypasses RLS unless FORCE ROW LEVEL SECURITY is also set. This is the
-- deny-by-default floor specification section 8 asks for; per-customer read
-- policies are only needed if an anon key is ever given a legitimate path to
-- the data, which today it has not.

DO $$
DECLARE
  target text;
BEGIN
  FOR target IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
  END LOOP;
END
$$;

-- Defence in depth. RLS above is what actually stops the reads and writes;
-- these revokes remove the privileges Supabase grants those two roles by
-- default, so a future table created without RLS is not exposed by omission.
--
-- `anon` and `authenticated` are Supabase's roles, and REVOKE errors outright on
-- a role that does not exist. Plain PostgreSQL — a developer's Docker container,
-- and the CI service the test suite runs against — has neither, so each revoke
-- is guarded rather than assumed. RLS above needs no such guard; it is core
-- PostgreSQL and applies everywhere.
DO $$
DECLARE
  target_role text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', target_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', target_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', target_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', target_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', target_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', target_role);
    END IF;
  END LOOP;
END
$$;
