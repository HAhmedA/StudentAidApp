-- Migration: Drop unused profile columns from student_profiles
-- These columns (edu_level, field_of_study, major, learning_formats, disabilities)
-- were part of a user profile editing feature that has been removed.
-- The student_profiles table now only tracks onboarding state and simulation metadata.

ALTER TABLE public.student_profiles
  DROP COLUMN IF EXISTS edu_level,
  DROP COLUMN IF EXISTS field_of_study,
  DROP COLUMN IF EXISTS major,
  DROP COLUMN IF EXISTS learning_formats,
  DROP COLUMN IF EXISTS disabilities;
