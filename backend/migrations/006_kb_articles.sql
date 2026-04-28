CREATE TABLE IF NOT EXISTS kb_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON kb_articles(category);
CREATE INDEX IF NOT EXISTS idx_kb_articles_updated_at ON kb_articles(updated_at);

DROP TRIGGER IF EXISTS trg_kb_articles_updated_at ON kb_articles;
CREATE TRIGGER trg_kb_articles_updated_at
BEFORE UPDATE ON kb_articles
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();
