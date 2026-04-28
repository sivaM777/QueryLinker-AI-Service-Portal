-- Migration: 034_kb_chat_tables.sql
-- Add tables for conversational KB chat functionality

-- Table for chat sessions
CREATE TABLE kb_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for user sessions
CREATE INDEX idx_kb_chat_sessions_user_id ON kb_chat_sessions(user_id);
CREATE INDEX idx_kb_chat_sessions_updated_at ON kb_chat_sessions(updated_at);

-- Table for chat messages
CREATE TABLE kb_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES kb_chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for session messages
CREATE INDEX idx_kb_chat_messages_session_id ON kb_chat_messages(session_id);
CREATE INDEX idx_kb_chat_messages_timestamp ON kb_chat_messages(timestamp);

-- Table for user feedback on messages
CREATE TABLE kb_chat_feedback (
    session_id UUID NOT NULL REFERENCES kb_chat_sessions(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES kb_chat_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    helpful BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    PRIMARY KEY (session_id, message_id, user_id)
);

-- Index for feedback
CREATE INDEX idx_kb_chat_feedback_user_id ON kb_chat_feedback(user_id);
CREATE INDEX idx_kb_chat_feedback_helpful ON kb_chat_feedback(helpful);
