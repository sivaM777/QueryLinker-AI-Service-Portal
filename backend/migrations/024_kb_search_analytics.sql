-- KB MVP: search analytics

CREATE TABLE IF NOT EXISTS kb_search_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  results_count INTEGER NOT NULL,
  clicked_article_id UUID NULL REFERENCES kb_articles(id) ON DELETE SET NULL,
  user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_search_analytics_created_at ON kb_search_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_kb_search_analytics_query ON kb_search_analytics(query);
CREATE INDEX IF NOT EXISTS idx_kb_search_analytics_clicked ON kb_search_analytics(clicked_article_id);
