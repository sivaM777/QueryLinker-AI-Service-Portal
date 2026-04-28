-- KB MVP: add not_helpful_count + feedback table

ALTER TABLE kb_article_effectiveness
ADD COLUMN IF NOT EXISTS not_helpful_count INTEGER NOT NULL DEFAULT 0;

-- Function to track KB article NOT helpful
CREATE OR REPLACE FUNCTION track_kb_article_not_helpful(article_id_param UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO kb_article_effectiveness (article_id, not_helpful_count, last_updated_at)
  VALUES (article_id_param, 1, now())
  ON CONFLICT (article_id) DO UPDATE SET
    not_helpful_count = kb_article_effectiveness.not_helpful_count + 1,
    last_updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Optional: per-vote storage (for future de-dup / reasons)
CREATE TABLE IF NOT EXISTS kb_article_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  helpful BOOLEAN NOT NULL,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_article_feedback_article_id ON kb_article_feedback(article_id);
CREATE INDEX IF NOT EXISTS idx_kb_article_feedback_created_at ON kb_article_feedback(created_at);
