-- Staff authentication, customer order access, and client-specified single outlet.

ALTER TABLE vendedores
  ADD COLUMN activo boolean NOT NULL DEFAULT true;

UPDATE vendedores
SET nombre = 'Maria Garcia', tienda_asignada = 'Nike Sawgrass', activo = true
WHERE id = '10000000-0000-4000-8000-000000000001';

UPDATE vendedores
SET activo = false
WHERE id <> '10000000-0000-4000-8000-000000000001';

DELETE FROM disponibilidad d
USING vendedores v
WHERE d.vendedor_id = v.id
  AND v.activo = false
  AND d.fecha >= current_date
  AND NOT EXISTS (
    SELECT 1 FROM reservas r WHERE r.disponibilidad_id = d.id
  );

CREATE TABLE staff_users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id uuid REFERENCES vendedores(id),
  local_team_id uuid REFERENCES equipos_locales(id),
  name varchar(255) NOT NULL,
  email varchar(255) NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  role varchar(32) NOT NULL CHECK (role IN ('admin', 'seller', 'local_team')),
  active boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_role_link_check CHECK (
    (role = 'seller' AND seller_id IS NOT NULL AND local_team_id IS NULL)
    OR (role = 'local_team' AND local_team_id IS NOT NULL AND seller_id IS NULL)
    OR (role = 'admin' AND seller_id IS NULL AND local_team_id IS NULL)
  )
);

CREATE UNIQUE INDEX staff_users_email_unique ON staff_users (lower(email));
CREATE UNIQUE INDEX staff_users_seller_unique ON staff_users (seller_id) WHERE seller_id IS NOT NULL;

CREATE TABLE staff_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text
);

CREATE INDEX staff_sessions_user_index ON staff_sessions (staff_user_id);
CREATE INDEX staff_sessions_expiry_index ON staff_sessions (expires_at);

CREATE TABLE customer_session_access (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid NOT NULL REFERENCES sesiones_compra(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_session_access_session_index ON customer_session_access (session_id);
CREATE INDEX customer_session_access_expiry_index ON customer_session_access (expires_at);

CREATE TABLE request_rate_limits (
  key text PRIMARY KEY,
  request_count integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_staff_users_updated_at BEFORE UPDATE ON staff_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
