-- Migration 041: Add Team Hierarchy and Description

ALTER TABLE teams ADD COLUMN IF NOT EXISTS parent_team_id UUID NULL REFERENCES teams(id);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS description TEXT NULL;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS roles_and_responsibilities JSONB NULL DEFAULT '[]';

-- Add a recursive index for parent_team_id
CREATE INDEX IF NOT EXISTS idx_teams_parent_team ON teams(parent_team_id);
