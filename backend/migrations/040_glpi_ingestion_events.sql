-- Create GLPI Ingestion Events table
CREATE TABLE IF NOT EXISTS glpi_ingestion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  glpi_config_id UUID REFERENCES external_system_configs(id) ON DELETE CASCADE,
  external_ticket_id VARCHAR(255),
  external_url TEXT,
  action VARCHAR(50) NOT NULL, -- CREATED, UPDATED, IGNORED, ERROR
  reason TEXT,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_glpi_ingestion_events_config_id ON glpi_ingestion_events(glpi_config_id);
CREATE INDEX IF NOT EXISTS idx_glpi_ingestion_events_created_at ON glpi_ingestion_events(created_at DESC);
