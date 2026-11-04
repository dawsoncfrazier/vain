-- Existing rows cannot be reliably attributed to an authenticated account.
-- Keep them unassigned rather than exposing them to the first user who signs in.
ALTER TABLE messages ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
ALTER TABLE memory_entries ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_messages_owner_session ON messages(owner_id,session_id,id);
CREATE INDEX IF NOT EXISTS idx_memory_owner_category ON memory_entries(owner_id,category,id);
