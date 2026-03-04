-- backend/migrations/1650000000018_llm_config.sql
CREATE TABLE IF NOT EXISTS public.llm_config (
    id          SERIAL PRIMARY KEY,
    provider    VARCHAR(50)   NOT NULL DEFAULT 'lmstudio',
    base_url    VARCHAR(500)  NOT NULL DEFAULT 'http://host.docker.internal:1234',
    main_model  VARCHAR(100)  NOT NULL DEFAULT 'hermes-3-llama-3.2-3b',
    judge_model VARCHAR(100)  NOT NULL DEFAULT 'qwen2.5-3b-instruct',
    max_tokens  INT           NOT NULL DEFAULT 2000,
    temperature DECIMAL(3,2)  NOT NULL DEFAULT 0.70,
    timeout_ms  INT           NOT NULL DEFAULT 30000,
    api_key     VARCHAR(500)  NOT NULL DEFAULT '',
    updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_config_updated_at
    ON public.llm_config (updated_at DESC);
