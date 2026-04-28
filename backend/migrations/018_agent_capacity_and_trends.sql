-- Agent capacity (used for smart assignment)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS max_concurrent_tickets INTEGER NOT NULL DEFAULT 20;

-- Trend/spike detection storage
CREATE TABLE IF NOT EXISTS incident_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  current_count INTEGER NOT NULL,
  baseline_mean REAL NOT NULL,
  spike_ratio REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_trends_created_at ON incident_trends(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_trends_category ON incident_trends(category, created_at DESC);

