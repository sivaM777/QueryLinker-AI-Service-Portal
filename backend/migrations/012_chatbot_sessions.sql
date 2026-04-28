-- Migration 012: Chatbot Sessions

-- Chatbot sessions table
CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL, -- Null for anonymous
  session_token TEXT NOT NULL UNIQUE, -- For anonymous sessions
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NULL -- Store session context, preferences, etc.
);

CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_user ON chatbot_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_token ON chatbot_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_activity ON chatbot_sessions(last_activity_at);

-- Chatbot messages
CREATE TABLE IF NOT EXISTS chatbot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chatbot_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  intent TEXT NULL, -- Detected intent
  confidence REAL NULL, -- Confidence score for intent
  kb_articles_suggested UUID[] NULL, -- KB articles suggested
  ticket_created_id UUID NULL REFERENCES tickets(id) ON DELETE SET NULL,
  auto_resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_session ON chatbot_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_ticket ON chatbot_messages(ticket_created_id) WHERE ticket_created_id IS NOT NULL;

-- Chatbot knowledge base embeddings (for RAG)
-- Note: Vector embeddings require pgvector extension. For now, storing as JSONB.
-- To enable vector search, install pgvector and change embedding column to VECTOR(1536)
CREATE TABLE IF NOT EXISTS kb_article_embeddings (
  article_id UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  embedding JSONB NULL, -- Store embeddings as JSONB array (can be converted to VECTOR later)
  text_chunk TEXT NOT NULL, -- Chunk of article text
  chunk_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kb_embeddings_article ON kb_article_embeddings(article_id);
-- Note: Vector similarity search requires pgvector extension
-- After installing pgvector: ALTER TABLE kb_article_embeddings ALTER COLUMN embedding TYPE VECTOR(1536) USING embedding::vector;
-- CREATE INDEX IF NOT EXISTS idx_kb_embeddings_vector ON kb_article_embeddings USING ivfflat (embedding vector_cosine_ops);

-- Function to update session activity
CREATE OR REPLACE FUNCTION update_chatbot_session_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chatbot_sessions
  SET last_activity_at = now(), updated_at = now()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update session activity on new message
DROP TRIGGER IF EXISTS trg_chatbot_session_activity ON chatbot_messages;
CREATE TRIGGER trg_chatbot_session_activity
AFTER INSERT ON chatbot_messages
FOR EACH ROW
EXECUTE FUNCTION update_chatbot_session_activity();
