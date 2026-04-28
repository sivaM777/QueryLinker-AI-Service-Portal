-- Migration 011: KB Suggestions and Trend Analysis

-- KB article suggestions table (stores AI-generated suggestions)
CREATE TABLE IF NOT EXISTS kb_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern TEXT NOT NULL,
  frequency INTEGER NOT NULL,
  suggested_title TEXT NOT NULL,
  suggested_body TEXT NOT NULL,
  related_ticket_ids UUID[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'created'
  created_article_id UUID NULL REFERENCES kb_articles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kb_suggestions_status ON kb_suggestions(status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_kb_suggestions_pattern ON kb_suggestions(pattern);

-- KB article effectiveness tracking
CREATE TABLE IF NOT EXISTS kb_article_effectiveness (
  article_id UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  views_count INTEGER NOT NULL DEFAULT 0,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  resolved_tickets_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ NULL,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_effectiveness_views ON kb_article_effectiveness(views_count DESC);
CREATE INDEX IF NOT EXISTS idx_kb_effectiveness_resolved ON kb_article_effectiveness(resolved_tickets_count DESC);

-- Function to track KB article view
CREATE OR REPLACE FUNCTION track_kb_article_view(article_id_param UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO kb_article_effectiveness (article_id, views_count, last_viewed_at, last_updated_at)
  VALUES (article_id_param, 1, now(), now())
  ON CONFLICT (article_id) DO UPDATE SET
    views_count = kb_article_effectiveness.views_count + 1,
    last_viewed_at = now(),
    last_updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Function to track KB article helpfulness
CREATE OR REPLACE FUNCTION track_kb_article_helpful(article_id_param UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO kb_article_effectiveness (article_id, helpful_count, last_updated_at)
  VALUES (article_id_param, 1, now())
  ON CONFLICT (article_id) DO UPDATE SET
    helpful_count = kb_article_effectiveness.helpful_count + 1,
    last_updated_at = now();
END;
$$ LANGUAGE plpgsql;
