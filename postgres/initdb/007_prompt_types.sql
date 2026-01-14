-- Migration: Add prompt_type to system_prompts table
-- Allows storing different types of prompts (system, alignment)

-- Add prompt_type column with default 'system' for existing rows
ALTER TABLE public.system_prompts 
ADD COLUMN IF NOT EXISTS prompt_type VARCHAR(20) DEFAULT 'system' NOT NULL;

-- Create index for efficient prompt type lookups
CREATE INDEX IF NOT EXISTS idx_system_prompts_type_updated 
ON public.system_prompts(prompt_type, updated_at DESC);

-- Insert default alignment prompt (seeded from alignment_prompt.txt on backend startup if not exists)
-- This is just a placeholder, actual content will be loaded from file
