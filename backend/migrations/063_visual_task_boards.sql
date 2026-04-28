DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_board_kind') THEN
    CREATE TYPE task_board_kind AS ENUM ('FREEFORM', 'DATA_DRIVEN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_board_mode') THEN
    CREATE TYPE task_board_mode AS ENUM ('GUIDED', 'FLEXIBLE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_board_visibility') THEN
    CREATE TYPE task_board_visibility AS ENUM ('PERSONAL', 'SHARED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_board_source_entity') THEN
    CREATE TYPE task_board_source_entity AS ENUM ('TICKET');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_board_swimlane_mode') THEN
    CREATE TYPE task_board_swimlane_mode AS ENUM ('NONE', 'MANUAL', 'FIELD');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_board_member_role') THEN
    CREATE TYPE task_board_member_role AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS task_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NULL REFERENCES teams(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  kind task_board_kind NOT NULL,
  mode task_board_mode NULL,
  visibility task_board_visibility NOT NULL DEFAULT 'PERSONAL',
  source_entity task_board_source_entity NULL,
  base_filters JSONB NOT NULL DEFAULT '[]'::jsonb,
  column_field TEXT NULL,
  swimlane_mode task_board_swimlane_mode NOT NULL DEFAULT 'NONE',
  swimlane_field TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_boards_org ON task_boards(organization_id);
CREATE INDEX IF NOT EXISTS idx_task_boards_owner ON task_boards(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_task_boards_team ON task_boards(team_id);
CREATE INDEX IF NOT EXISTS idx_task_boards_visibility ON task_boards(visibility);

DROP TRIGGER IF EXISTS trg_task_boards_updated_at ON task_boards;
CREATE TRIGGER trg_task_boards_updated_at
BEFORE UPDATE ON task_boards
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

CREATE TABLE IF NOT EXISTS task_board_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role task_board_member_role NOT NULL DEFAULT 'EDITOR',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(board_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_board_members_board ON task_board_members(board_id);
CREATE INDEX IF NOT EXISTS idx_task_board_members_user ON task_board_members(user_id);

CREATE TABLE IF NOT EXISTS task_board_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  mapped_value TEXT NULL,
  filter_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  drop_update JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_board_columns_board ON task_board_columns(board_id, position);

CREATE TABLE IF NOT EXISTS task_board_swimlanes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  mapped_value TEXT NULL,
  color TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_board_swimlanes_board ON task_board_swimlanes(board_id, position);

CREATE TABLE IF NOT EXISTS task_board_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  column_id UUID NULL REFERENCES task_board_columns(id) ON DELETE SET NULL,
  swimlane_id UUID NULL REFERENCES task_board_swimlanes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  priority ticket_priority NOT NULL DEFAULT 'MEDIUM',
  assignee_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  checklist_summary JSONB NOT NULL DEFAULT '{"total":0,"completed":0}'::jsonb,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_board_cards_board ON task_board_cards(board_id, column_id, swimlane_id, position);

DROP TRIGGER IF EXISTS trg_task_board_cards_updated_at ON task_board_cards;
CREATE TRIGGER trg_task_board_cards_updated_at
BEFORE UPDATE ON task_board_cards
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

CREATE TABLE IF NOT EXISTS task_board_card_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES task_board_cards(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content BYTEA NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_board_card_attachments_card ON task_board_card_attachments(card_id, created_at);

CREATE TABLE IF NOT EXISTS task_board_card_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES task_board_cards(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_board_card_comments_card ON task_board_card_comments(card_id, created_at);

CREATE TABLE IF NOT EXISTS task_board_card_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  card_id UUID NULL REFERENCES task_board_cards(id) ON DELETE CASCADE,
  ticket_id UUID NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_board_card_events_board ON task_board_card_events(board_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_board_card_events_card ON task_board_card_events(card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_board_card_events_ticket ON task_board_card_events(ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_board_record_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  column_id UUID NULL REFERENCES task_board_columns(id) ON DELETE SET NULL,
  swimlane_key TEXT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(board_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_task_board_record_positions_board ON task_board_record_positions(board_id, column_id, swimlane_key, position);
