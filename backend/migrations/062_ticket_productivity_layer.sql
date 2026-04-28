DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_comment_visibility') THEN
    CREATE TYPE ticket_comment_visibility AS ENUM ('INTERNAL_NOTE', 'REQUESTER_COMMENT');
  END IF;
END$$;

ALTER TABLE ticket_comments
  ADD COLUMN IF NOT EXISTS visibility ticket_comment_visibility;

UPDATE ticket_comments
SET visibility = CASE
  WHEN is_internal THEN 'INTERNAL_NOTE'::ticket_comment_visibility
  ELSE 'REQUESTER_COMMENT'::ticket_comment_visibility
END
WHERE visibility IS NULL;

ALTER TABLE ticket_comments
  ALTER COLUMN visibility SET DEFAULT 'REQUESTER_COMMENT';

CREATE OR REPLACE FUNCTION sync_ticket_comment_visibility()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.visibility IS NULL THEN
    NEW.visibility := CASE
      WHEN COALESCE(NEW.is_internal, false) THEN 'INTERNAL_NOTE'::ticket_comment_visibility
      ELSE 'REQUESTER_COMMENT'::ticket_comment_visibility
    END;
  END IF;

  NEW.is_internal := NEW.visibility = 'INTERNAL_NOTE'::ticket_comment_visibility;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_comments_visibility_sync ON ticket_comments;
CREATE TRIGGER trg_ticket_comments_visibility_sync
BEFORE INSERT OR UPDATE ON ticket_comments
FOR EACH ROW
EXECUTE PROCEDURE sync_ticket_comment_visibility();

CREATE TABLE IF NOT EXISTS ticket_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NULL REFERENCES teams(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL DEFAULT 'ticket',
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'PERSONAL' CHECK (scope IN ('PERSONAL', 'TEAM')),
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  filters JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_field TEXT NOT NULL DEFAULT 'updated',
  sort_order TEXT NOT NULL DEFAULT 'desc',
  page_size INTEGER NOT NULL DEFAULT 50 CHECK (page_size BETWEEN 10 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_saved_views_owner_name
  ON ticket_saved_views (owner_user_id, lower(name), entity_type, scope);

CREATE INDEX IF NOT EXISTS idx_ticket_saved_views_org_scope
  ON ticket_saved_views (organization_id, scope, team_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_ticket_saved_views_updated_at ON ticket_saved_views;
CREATE TRIGGER trg_ticket_saved_views_updated_at
BEFORE UPDATE ON ticket_saved_views
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

CREATE TABLE IF NOT EXISTS ticket_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NULL REFERENCES teams(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'PERSONAL' CHECK (scope IN ('PERSONAL', 'TEAM')),
  description TEXT NULL,
  title TEXT NULL,
  body TEXT NULL,
  ticket_type ticket_type NOT NULL DEFAULT 'INCIDENT',
  category TEXT NULL,
  priority ticket_priority NOT NULL DEFAULT 'MEDIUM',
  assigned_team UUID NULL REFERENCES teams(id) ON DELETE SET NULL,
  assigned_agent UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  default_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_templates_owner_name
  ON ticket_templates (owner_user_id, lower(name), scope);

CREATE INDEX IF NOT EXISTS idx_ticket_templates_org_scope
  ON ticket_templates (organization_id, scope, team_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_ticket_templates_updated_at ON ticket_templates;
CREATE TRIGGER trg_ticket_templates_updated_at
BEFORE UPDATE ON ticket_templates
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

CREATE TABLE IF NOT EXISTS ticket_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  color TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_tags_org_name_unique
  ON ticket_tags (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name);

CREATE INDEX IF NOT EXISTS idx_ticket_tags_org_created
  ON ticket_tags (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_tag_links (
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES ticket_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_tag_links_tag
  ON ticket_tag_links (tag_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_watchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_watchers_ticket
  ON ticket_watchers (ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_watchers_user
  ON ticket_watchers (user_id, created_at DESC);
