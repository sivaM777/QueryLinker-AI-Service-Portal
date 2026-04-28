DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_tier') THEN
    CREATE TYPE subscription_tier AS ENUM ('FREE', 'PREMIUM');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  subscription_tier subscription_tier NOT NULL DEFAULT 'FREE',
  ai_usage_this_month INTEGER NOT NULL DEFAULT 0,
  ai_usage_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS organization_id UUID NULL REFERENCES organizations(id);

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS organization_id UUID NULL REFERENCES organizations(id);

ALTER TABLE chatbot_sessions
  ADD COLUMN IF NOT EXISTS organization_id UUID NULL REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_org_id ON tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_org_id ON chatbot_sessions(organization_id);
