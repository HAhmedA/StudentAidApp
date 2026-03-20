-- Student-to-admin support request system
-- Students submit categorised requests; admins review and respond via the admin panel

CREATE TABLE public.support_requests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category       VARCHAR(30) NOT NULL CHECK (category IN (
                   'account_issue', 'data_concern', 'chatbot_problem',
                   'technical_bug', 'feature_request', 'other'
                 )),
  message        TEXT NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN (
                   'open', 'resolved', 'closed'
                 )),
  admin_response TEXT,
  resolved_by    UUID REFERENCES users(id),
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_requests_status  ON support_requests(status);
CREATE INDEX idx_support_requests_user    ON support_requests(user_id);
CREATE INDEX idx_support_requests_created ON support_requests(created_at DESC);
