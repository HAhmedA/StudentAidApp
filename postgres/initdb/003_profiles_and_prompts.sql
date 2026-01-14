-- Migration: Add student_profiles and system_prompts tables
-- This migration adds support for student profile data and admin system prompts

-- Student profiles table (1-to-1 with users)
CREATE TABLE IF NOT EXISTS public.student_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    edu_level VARCHAR(50),
    field_of_study VARCHAR(100),
    major VARCHAR(100),
    learning_formats JSONB DEFAULT '[]'::jsonb,
    disabilities JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- System prompts table (for admin configuration)
-- Note: Default prompt is seeded by backend from prompts/system_prompt.txt on first startup
CREATE TABLE IF NOT EXISTS public.system_prompts (
    id SERIAL PRIMARY KEY,
    prompt TEXT NOT NULL,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON public.student_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_system_prompts_updated_at ON public.system_prompts(updated_at DESC);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_profiles TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_prompts TO postgres;
GRANT USAGE, SELECT ON SEQUENCE public.system_prompts_id_seq TO postgres;
