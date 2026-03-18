-- =============================================================================
-- Migration 022: Questionnaire restructure + wellbeing + consent
-- =============================================================================

-- 1. Wipe old questionnaire/SRL data (pre-production, no migration needed)
DELETE FROM public.srl_annotations;
DELETE FROM public.srl_responses;
DELETE FROM public.questionnaire_results;

-- Also wipe concept scores and cluster assignments that depend on SRL data
DELETE FROM public.concept_scores WHERE concept_id = 'srl';
DELETE FROM public.concept_score_history WHERE concept_id = 'srl';
DELETE FROM public.user_cluster_assignments WHERE concept_id = 'srl';
DELETE FROM public.peer_clusters WHERE concept_id = 'srl';

-- 2. User consent tracking
CREATE TABLE IF NOT EXISTS public.user_consents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    consent_given boolean NOT NULL DEFAULT false,
    consent_version varchar(20) NOT NULL DEFAULT '1.0',
    consent_given_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_consent UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user ON public.user_consents(user_id);

-- 3. Wellbeing responses (WHO-5 style, separate from SRL)
CREATE TABLE IF NOT EXISTS public.wellbeing_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    questionnaire_id uuid NOT NULL REFERENCES public.questionnaire_results(id) ON DELETE CASCADE,
    cheerfulness smallint CHECK (cheerfulness BETWEEN 0 AND 5),
    calmness smallint CHECK (calmness BETWEEN 0 AND 5),
    vitality smallint CHECK (vitality BETWEEN 0 AND 5),
    restedness smallint CHECK (restedness BETWEEN 0 AND 5),
    interest smallint CHECK (interest BETWEEN 0 AND 5),
    submitted_at timestamptz NOT NULL DEFAULT NOW(),
    is_simulated boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_wellbeing_user_time ON public.wellbeing_responses(user_id, submitted_at);
