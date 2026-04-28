-- Migration 056: Azure AD identity binding

ALTER TABLE users
ADD COLUMN IF NOT EXISTS azure_ad_id VARCHAR(100) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_azure_ad_id_unique
  ON users(azure_ad_id)
  WHERE azure_ad_id IS NOT NULL;
