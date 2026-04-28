-- Migration 055: Add team ownership by manager

ALTER TABLE teams
ADD COLUMN IF NOT EXISTS manager_id UUID NULL REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_teams_manager_id ON teams(manager_id);

WITH default_manager AS (
  SELECT id
  FROM users
  WHERE role IN ('MANAGER', 'ADMIN')
  ORDER BY CASE WHEN role = 'MANAGER' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
UPDATE teams
SET manager_id = (SELECT id FROM default_manager)
WHERE manager_id IS NULL
  AND EXISTS (SELECT 1 FROM default_manager);

UPDATE users u
SET manager_id = t.manager_id
FROM teams t
WHERE u.team_id = t.id
  AND u.role = 'AGENT'
  AND u.manager_id IS NULL
  AND t.manager_id IS NOT NULL;
