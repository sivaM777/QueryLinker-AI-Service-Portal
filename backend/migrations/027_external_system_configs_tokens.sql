-- Migration 027: Add token fields to external_system_configs for GLPI/Solman integrations

ALTER TABLE external_system_configs
  ADD COLUMN IF NOT EXISTS app_token TEXT NULL,
  ADD COLUMN IF NOT EXISTS user_token TEXT NULL;
