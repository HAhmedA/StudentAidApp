-- Auto-exclude simulated/test accounts from clustering by default.
-- Idempotent: only flips accounts not already excluded.
UPDATE public.student_profiles
SET    exclude_from_clustering = true
WHERE  simulated_profile IS NOT NULL
  AND  exclude_from_clustering = false;
