ALTER TABLE users
ADD COLUMN IF NOT EXISTS manager_id UUID NULL REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);

