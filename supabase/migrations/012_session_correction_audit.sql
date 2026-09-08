-- Admin-only session reopening must be auditable.

CREATE TABLE session_audit_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid NOT NULL REFERENCES sesiones_compra(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL REFERENCES staff_users(id),
  event_type varchar(64) NOT NULL CHECK (event_type IN ('reopened_for_correction')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_audit_events_session_index ON session_audit_events (session_id, created_at DESC);
