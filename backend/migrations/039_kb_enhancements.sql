-- Add KB article comments and enhance feedback with star ratings

-- 1. Create KB Article Comments table
CREATE TABLE IF NOT EXISTS kb_article_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_comments_article_id ON kb_article_comments(article_id);
CREATE INDEX IF NOT EXISTS idx_kb_comments_created_at ON kb_article_comments(created_at);

-- 2. Add rating to feedback
ALTER TABLE kb_article_feedback
ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating >= 1 AND rating <= 5);

-- 3. Add average rating to effectiveness
ALTER TABLE kb_article_effectiveness
ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0;

-- 4. Function to update average rating
CREATE OR REPLACE FUNCTION update_kb_article_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE kb_article_effectiveness
  SET avg_rating = (
    SELECT AVG(rating)::NUMERIC(3,2)
    FROM kb_article_feedback
    WHERE article_id = NEW.article_id AND rating IS NOT NULL
  )
  WHERE article_id = NEW.article_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Trigger for rating updates
DROP TRIGGER IF EXISTS trg_update_kb_rating ON kb_article_feedback;
CREATE TRIGGER trg_update_kb_rating
AFTER INSERT OR UPDATE OF rating ON kb_article_feedback
FOR EACH ROW
EXECUTE PROCEDURE update_kb_article_rating();
