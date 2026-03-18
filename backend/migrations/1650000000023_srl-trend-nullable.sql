-- Make trend column nullable since trend calculation was removed
ALTER TABLE public.srl_annotations ALTER COLUMN trend DROP NOT NULL;
