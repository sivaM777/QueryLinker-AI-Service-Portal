-- Migration 045: Audit logs schema

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action') THEN
    CREATE TYPE audit_action AS ENUM (
      'created',
      'updated',
      'deleted',
      'viewed',
      'exported',
      'printed',
      'shared'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action audit_action NOT NULL,
  field_name TEXT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT NULL,
  user_name TEXT NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  session_id TEXT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
