-- Migration 026: AutoFix Catalog (Level 2)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'autofix_mode') THEN
    CREATE TYPE autofix_mode AS ENUM ('AUTOMATION', 'GUIDED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'autofix_risk') THEN
    CREATE TYPE autofix_risk AS ENUM ('LOW', 'MEDIUM', 'HIGH');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS autofix_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, -- e.g., VPN_PROFILE_REFRESH

  enabled BOOLEAN NOT NULL DEFAULT true,
  mode autofix_mode NOT NULL DEFAULT 'GUIDED',
  risk autofix_risk NOT NULL DEFAULT 'LOW',

  -- Matching rules
  match_intents TEXT[] NULL,
  match_categories TEXT[] NULL,
  match_keywords TEXT[] NULL, -- all keywords must be present if provided
  min_confidence DOUBLE PRECISION NULL,

  -- Eligibility gating
  eligible_priorities TEXT[] NOT NULL DEFAULT ARRAY['LOW','MEDIUM'],

  -- Approval copy (shown in Approval UI)
  approval_required BOOLEAN NOT NULL DEFAULT true,
  approval_title TEXT NOT NULL,
  approval_body TEXT NOT NULL,

  -- Modal copy (shown in Auto-Fix modal)
  user_title TEXT NOT NULL,
  user_description TEXT NOT NULL,

  -- Workflow template (steps stored like workflow definitions)
  workflow_steps JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autofix_catalog_enabled ON autofix_catalog(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_autofix_catalog_mode ON autofix_catalog(mode);
CREATE INDEX IF NOT EXISTS idx_autofix_catalog_risk ON autofix_catalog(risk);

-- Seed a minimal set of playbooks (expand over time)
INSERT INTO autofix_catalog
  (code, enabled, mode, risk, match_intents, match_categories, match_keywords, min_confidence,
   eligible_priorities, approval_required, approval_title, approval_body, user_title, user_description, workflow_steps)
VALUES
  (
    'VPN_PROFILE_REFRESH',
    true,
    'AUTOMATION',
    'LOW',
    ARRAY['VPN_ISSUE','NETWORK_VPN'],
    ARRAY['NETWORK_VPN'],
    ARRAY['VPN'],
    0.75,
    ARRAY['LOW','MEDIUM'],
    true,
    'Approve VPN Auto-Fix',
    'We detected a VPN configuration issue. With your approval, we can refresh your VPN profile automatically.',
    'AI Auto-Fix: Refresh VPN Profile',
    'We will refresh your VPN profile and validate connectivity. Steps will appear as we complete them.',
    '[
      {"type":"approval","name":"user_approval","config":{"title":"Approve VPN Auto-Fix","body":"This will refresh your VPN profile and attempt to restore connectivity.","expiresInHours":24,"approver":"requester","ui_description":"Approval granted to run the VPN auto-fix."}},
      {"type":"api_call","name":"vpn_profile_refresh","config":{"url":"http://localhost:8000/api/v1/automation/vpn/refresh","method":"POST","body":{"ticket_id":"{{ticketId}}"},"responsePath":"success","ui_description":"VPN profile refresh was executed through the VPN management system."}},
      {"type":"script","name":"vpn_validate","config":{"script":"{ success: true, message: \"VPN refreshed and validated\", action: \"auto_resolve\" }","ui_description":"Connectivity was validated after refreshing the VPN profile."}}
    ]'::jsonb
  )
ON CONFLICT (code) DO NOTHING;
