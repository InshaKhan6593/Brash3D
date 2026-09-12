-- Read-only access for a customer's own live session, over Supabase Realtime.
--
-- Migration 015 enabled RLS everywhere and revoked every privilege from `anon`
-- and `authenticated`, which closed Supabase's PostgREST endpoint to anyone
-- holding the publishable key. That stays the posture for every table but the
-- three below, and even for these the grant is SELECT only.
--
-- What makes this safe is not the grant, it is the claim. The application
-- signs a short-lived token naming exactly one `sesiones_compra.id`, and each
-- policy compares that claim to the row. A subscription filter cannot be
-- trusted -- it is chosen by the client -- so the boundary has to be something
-- the database verifies for itself.
--
-- `anon` is deliberately left with nothing. A browser holding only the
-- publishable key can open a socket and see no rows at all; it has to present
-- a token the server minted for a session whose access token it already held.
--
-- Every write still happens server-side as the table owner. Nothing here lets
-- a browser insert, update or delete, which is what keeps the invoice out of
-- the client's hands (see SPEC_DECISIONS.md entry 1).

-- The four tables were added to this publication by migration 001.
-- `reservas` is intentionally not given a policy: the customer page does not
-- subscribe to it, so it stays deny-all like everything else.

-- `authenticated` and `anon` are roles Supabase creates with the project; a
-- plain PostgreSQL container -- which is what local development and the test
-- suite run against -- has neither, and the grant below would abort the
-- migration there. Creating them when absent is a no-op on Supabase and makes
-- the local database match production closely enough to exercise these
-- policies. Both are NOLOGIN and hold nothing except what is granted here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END
$$;

-- `auth.jwt()` is Supabase's own, reading the claims PostgREST and Realtime set
-- on the connection. A plain container has neither the schema nor the function,
-- so the policies below would not compile there.
--
-- Recreated only when the schema is absent, so Supabase's real implementation
-- is never overwritten. Locally it does exactly what Supabase's does, which
-- means the policies can be exercised for real in the test suite by setting
-- `request.jwt.claims` -- see `src/lib/store/realtime-policies.test.ts`. A
-- policy nobody can test is a policy nobody can trust.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;
    EXECUTE $fn$
      CREATE FUNCTION auth.jwt() RETURNS jsonb
      LANGUAGE sql STABLE
      AS $body$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')
        )::jsonb
      $body$;
    $fn$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  END IF;
END
$$;

GRANT SELECT ON sesiones_compra TO authenticated;
GRANT SELECT ON productos_carrito TO authenticated;
GRANT SELECT ON envios TO authenticated;

-- The session itself: totals, state, and the payment percentages.
CREATE POLICY realtime_own_session ON sesiones_compra
  FOR SELECT TO authenticated
  USING (id::text = (auth.jwt() ->> 'session_id'));

-- The live cart. This is the subscription that matters during a call.
CREATE POLICY realtime_own_cart ON productos_carrito
  FOR SELECT TO authenticated
  USING (sesion_id::text = (auth.jwt() ->> 'session_id'));

-- Shipment status, so the tracking timeline updates without a reload.
CREATE POLICY realtime_own_shipment ON envios
  FOR SELECT TO authenticated
  USING (sesion_id::text = (auth.jwt() ->> 'session_id'));
