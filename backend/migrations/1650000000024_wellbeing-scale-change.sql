-- =============================================================================
-- Migration 024: Slider-based questionnaire inputs (decimal support)
--   1. Wellbeing: change scale from 0-5 (smallint) to 0-10 (numeric)
--   2. SRL: change from integer-only (smallint) to decimal (numeric)
-- =============================================================================

-- ─── WELLBEING RESPONSES ─────────────────────────────────────────────────────

-- 1a. Drop existing CHECK constraints (auto-named by PostgreSQL)
ALTER TABLE public.wellbeing_responses DROP CONSTRAINT IF EXISTS wellbeing_responses_cheerfulness_check;
ALTER TABLE public.wellbeing_responses DROP CONSTRAINT IF EXISTS wellbeing_responses_calmness_check;
ALTER TABLE public.wellbeing_responses DROP CONSTRAINT IF EXISTS wellbeing_responses_vitality_check;
ALTER TABLE public.wellbeing_responses DROP CONSTRAINT IF EXISTS wellbeing_responses_restedness_check;
ALTER TABLE public.wellbeing_responses DROP CONSTRAINT IF EXISTS wellbeing_responses_interest_check;

-- 1b. Change column types from smallint to numeric(4,1)
ALTER TABLE public.wellbeing_responses ALTER COLUMN cheerfulness TYPE numeric(4,1) USING cheerfulness::numeric(4,1);
ALTER TABLE public.wellbeing_responses ALTER COLUMN calmness TYPE numeric(4,1) USING calmness::numeric(4,1);
ALTER TABLE public.wellbeing_responses ALTER COLUMN vitality TYPE numeric(4,1) USING vitality::numeric(4,1);
ALTER TABLE public.wellbeing_responses ALTER COLUMN restedness TYPE numeric(4,1) USING restedness::numeric(4,1);
ALTER TABLE public.wellbeing_responses ALTER COLUMN interest TYPE numeric(4,1) USING interest::numeric(4,1);

-- 1c. Scale existing data from 0-5 to 0-10 (multiply by 2)
UPDATE public.wellbeing_responses SET
    cheerfulness = cheerfulness * 2,
    calmness = calmness * 2,
    vitality = vitality * 2,
    restedness = restedness * 2,
    interest = interest * 2
WHERE cheerfulness IS NOT NULL OR calmness IS NOT NULL OR vitality IS NOT NULL
   OR restedness IS NOT NULL OR interest IS NOT NULL;

-- 1d. Add new CHECK constraints for 0-10 range
ALTER TABLE public.wellbeing_responses ADD CONSTRAINT wellbeing_responses_cheerfulness_check CHECK (cheerfulness BETWEEN 0.0 AND 10.0);
ALTER TABLE public.wellbeing_responses ADD CONSTRAINT wellbeing_responses_calmness_check CHECK (calmness BETWEEN 0.0 AND 10.0);
ALTER TABLE public.wellbeing_responses ADD CONSTRAINT wellbeing_responses_vitality_check CHECK (vitality BETWEEN 0.0 AND 10.0);
ALTER TABLE public.wellbeing_responses ADD CONSTRAINT wellbeing_responses_restedness_check CHECK (restedness BETWEEN 0.0 AND 10.0);
ALTER TABLE public.wellbeing_responses ADD CONSTRAINT wellbeing_responses_interest_check CHECK (interest BETWEEN 0.0 AND 10.0);

-- ─── SRL RESPONSES (decimal support for slider input) ────────────────────────

-- 2a. Drop existing CHECK constraint
ALTER TABLE public.srl_responses DROP CONSTRAINT IF EXISTS srl_responses_score_check;

-- 2b. Change score column from smallint to numeric(3,1)
ALTER TABLE public.srl_responses ALTER COLUMN score TYPE numeric(3,1) USING score::numeric(3,1);

-- 2c. Add new CHECK constraint (same 1-5 range, now with decimal)
ALTER TABLE public.srl_responses ADD CONSTRAINT srl_responses_score_check CHECK (score >= 1.0 AND score <= 5.0);

-- 2d. Change srl_annotations min/max_score to match
ALTER TABLE public.srl_annotations ALTER COLUMN min_score TYPE numeric(3,1) USING min_score::numeric(3,1);
ALTER TABLE public.srl_annotations ALTER COLUMN max_score TYPE numeric(3,1) USING max_score::numeric(3,1);
