-- Migration: 035_pgvector_rag.sql
-- Enable pgvector extension and add embedding support for semantic search

-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to KB articles for semantic search
ALTER TABLE kb_articles ADD COLUMN embedding vector(384);

-- Create index for similarity search on embeddings
CREATE INDEX idx_kb_articles_embedding ON kb_articles USING ivfflat (embedding vector_cosine_ops);

-- Create table for tracking KB article embedding generation
CREATE TABLE kb_embedding_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(article_id)
);

-- Index for pending jobs
CREATE INDEX idx_kb_embedding_jobs_status ON kb_embedding_jobs(status);

-- Table for storing user queries and their embeddings (for analytics and improvement)
CREATE TABLE kb_search_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_text TEXT NOT NULL,
    query_embedding vector(384),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    results_count INTEGER,
    clicked_article_id UUID REFERENCES kb_articles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for similarity search on queries
CREATE INDEX idx_kb_search_queries_embedding ON kb_search_queries USING ivfflat (query_embedding vector_cosine_ops);

-- Function to search KB articles by semantic similarity
CREATE OR REPLACE FUNCTION search_kb_semantic(
    query_embedding vector(384),
    match_threshold FLOAT,
    match_count INT
)
RETURNS TABLE(
    id UUID,
    title TEXT,
    body TEXT,
    category TEXT,
    tags TEXT[],
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        kb_articles.id,
        kb_articles.title,
        kb_articles.body,
        kb_articles.category,
        kb_articles.tags,
        1 - (kb_articles.embedding <=> query_embedding) AS similarity
    FROM kb_articles
    WHERE kb_articles.embedding IS NOT NULL
      AND 1 - (kb_articles.embedding <=> query_embedding) > match_threshold
    ORDER BY kb_articles.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Function to hybrid search (combines text search with semantic similarity)
CREATE OR REPLACE FUNCTION search_kb_hybrid(
    query_text TEXT,
    query_embedding vector(384),
    match_count INT
)
RETURNS TABLE(
    id UUID,
    title TEXT,
    body TEXT,
    category TEXT,
    tags TEXT[],
    text_rank FLOAT,
    semantic_similarity FLOAT,
    combined_score FLOAT
) AS $$
BEGIN
    RETURN QUERY
    WITH text_matches AS (
        SELECT
            kb_articles.id,
            kb_articles.title,
            kb_articles.body,
            kb_articles.category,
            kb_articles.tags,
            kb_articles.embedding,
            similarity(kb_articles.title || ' ' || kb_articles.body, query_text) AS text_rank
        FROM kb_articles
        WHERE kb_articles.title ILIKE '%' || query_text || '%'
           OR kb_articles.body ILIKE '%' || query_text || '%'
    ),
    semantic_matches AS (
        SELECT
            kb_articles.id,
            kb_articles.title,
            kb_articles.body,
            kb_articles.category,
            kb_articles.tags,
            kb_articles.embedding,
            1 - (kb_articles.embedding <=> query_embedding) AS semantic_similarity
        FROM kb_articles
        WHERE kb_articles.embedding IS NOT NULL
          AND 1 - (kb_articles.embedding <=> query_embedding) > 0.7
    )
    SELECT
        COALESCE(t.id, s.id) AS id,
        COALESCE(t.title, s.title) AS title,
        COALESCE(t.body, s.body) AS body,
        COALESCE(t.category, s.category) AS category,
        COALESCE(t.tags, s.tags) AS tags,
        COALESCE(t.text_rank, 0) AS text_rank,
        COALESCE(s.semantic_similarity, 0) AS semantic_similarity,
        (COALESCE(t.text_rank, 0) * 0.3 + COALESCE(s.semantic_similarity, 0) * 0.7) AS combined_score
    FROM text_matches t
    FULL OUTER JOIN semantic_matches s ON t.id = s.id
    ORDER BY combined_score DESC
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
