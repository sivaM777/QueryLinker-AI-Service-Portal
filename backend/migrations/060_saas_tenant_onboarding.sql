ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS slug TEXT NULL,
  ADD COLUMN IF NOT EXISTS domain TEXT NULL,
  ADD COLUMN IF NOT EXISTS admin_email TEXT NULL,
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS setup_status TEXT NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE organizations
SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug_unique
  ON organizations (lower(slug))
  WHERE slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_domain_unique
  ON organizations (lower(domain))
  WHERE domain IS NOT NULL;

CREATE OR REPLACE FUNCTION set_organizations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW
EXECUTE PROCEDURE set_organizations_updated_at();

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS organization_id UUID NULL REFERENCES organizations(id);

WITH default_org AS (
  INSERT INTO organizations (name, slug, domain, admin_email, is_demo, setup_status, subscription_tier)
  VALUES ('Demo Organization', 'demo-organization', 'company.com', 'admin@company.com', true, 'READY', 'FREE')
  ON CONFLICT (name) DO UPDATE SET
    slug = COALESCE(organizations.slug, EXCLUDED.slug),
    domain = COALESCE(organizations.domain, EXCLUDED.domain),
    admin_email = COALESCE(organizations.admin_email, EXCLUDED.admin_email),
    is_demo = true
  RETURNING id
)
UPDATE teams
SET organization_id = (SELECT id FROM default_org)
WHERE organization_id IS NULL;

UPDATE users
SET organization_id = (SELECT id FROM organizations WHERE name = 'Demo Organization' LIMIT 1)
WHERE organization_id IS NULL;

UPDATE tickets
SET organization_id = u.organization_id
FROM users u
WHERE tickets.created_by = u.id
  AND tickets.organization_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teams_name_unique'
  ) THEN
    ALTER TABLE teams DROP CONSTRAINT teams_name_unique;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_org_name_unique
  ON teams (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(organization_id);
