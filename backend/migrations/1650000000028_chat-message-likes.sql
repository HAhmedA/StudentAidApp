-- Like feedback for chatbot assistant messages
-- Separate from chat_message_flags (which handles dislikes/reports with admin workflow)
-- Mutual exclusivity with flags is enforced at the application layer

CREATE TABLE public.chat_message_likes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX idx_likes_message ON chat_message_likes(message_id);
CREATE INDEX idx_likes_created ON chat_message_likes(created_at DESC);
