ALTER TABLE public.llm_config
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE public.llm_config
    ALTER COLUMN api_key DROP NOT NULL,
    ALTER COLUMN api_key DROP DEFAULT;
