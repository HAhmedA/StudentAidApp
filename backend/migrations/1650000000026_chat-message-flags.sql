-- Chat message flagging: allows students to report problematic assistant responses
CREATE TABLE public.chat_message_flags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      VARCHAR(30) NOT NULL CHECK (reason IN (
                'inaccurate', 'inappropriate', 'irrelevant', 'harmful', 'other'
              )),
  comment     TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
                'pending', 'reviewed', 'dismissed'
              )),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX idx_flags_status ON chat_message_flags(status);
CREATE INDEX idx_flags_created ON chat_message_flags(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_message_flags TO postgres;
