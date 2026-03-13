-- Migration: cluster-exclusion
-- Adds a per-user flag to exclude specific students from the peer-clustering pool.
-- Use case: removing test accounts accidentally included in a real cohort.

ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS exclude_from_clustering BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.student_profiles.exclude_from_clustering
  IS 'When true, this user is excluded from all peer-clustering pool queries.';
