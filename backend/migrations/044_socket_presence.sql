-- Migration 044: Socket presence + field locks

CREATE TABLE IF NOT EXISTS user_presence (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ticket_id UUID NULL REFERENCES tickets(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'viewing',
  socket_id TEXT NULL,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_ticket ON user_presence(ticket_id);
CREATE INDEX IF NOT EXISTS idx_user_presence_last_activity ON user_presence(last_activity);

CREATE TABLE IF NOT EXISTS field_locks (
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  locked_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (ticket_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_field_locks_expires ON field_locks(expires_at);
