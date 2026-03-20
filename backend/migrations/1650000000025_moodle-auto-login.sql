-- Add moodle_id column for Moodle auto-login user linking
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS moodle_id INTEGER UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_moodle_id ON public.users (moodle_id);
