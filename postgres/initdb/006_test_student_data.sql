-- ============================================================================
-- 10 Default Test Student Accounts
-- All passwords: "test"
-- Profiles rotate: high_achiever, average, low_achiever
--
-- Simulated data (SRL, Sleep, Screen Time, Social Media, LMS) is generated
-- automatically by the backend seedDataService on startup.
-- ============================================================================

DO $$
DECLARE
    pw_hash TEXT := '$2b$10$o4WDjkk/mAAFckP3u.q9yuDZ9XSsONFZQL4veMJgd246sjXaDttP.';  -- bcrypt("test")
BEGIN

    -- ========== Account 1: high_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0001-7890-abcd-ef1234567890', 'test1@example.com', 'Test Student 1', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0001-7890-abcd-ef1234567890',
        'Bachelor''s', 'Computer Science & Information Technology', 'Software Engineering',
        '["Reading", "Watching", "Hands-on Practice"]'::jsonb,
        '[]'::jsonb,
        'high_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'high_achiever';

    -- ========== Account 2: average ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0002-7890-abcd-ef1234567890', 'test2@example.com', 'Test Student 2', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0002-7890-abcd-ef1234567890',
        'Bachelor''s', 'Engineering & Technology', 'Mechanical Engineering',
        '["Watching", "Discussion"]'::jsonb,
        '[]'::jsonb,
        'average'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'average';

    -- ========== Account 3: low_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0003-7890-abcd-ef1234567890', 'test3@example.com', 'Test Student 3', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0003-7890-abcd-ef1234567890',
        'Master''s', 'Business & Management', 'Finance',
        '["Reading", "Discussion"]'::jsonb,
        '["Dyslexia"]'::jsonb,
        'low_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'low_achiever';

    -- ========== Account 4: high_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0004-7890-abcd-ef1234567890', 'test4@example.com', 'Test Student 4', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0004-7890-abcd-ef1234567890',
        'Bachelor''s', 'Natural Sciences', 'Biology',
        '["Hands-on Practice", "Reading"]'::jsonb,
        '[]'::jsonb,
        'high_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'high_achiever';

    -- ========== Account 5: average ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0005-7890-abcd-ef1234567890', 'test5@example.com', 'Test Student 5', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0005-7890-abcd-ef1234567890',
        'Master''s', 'Computer Science & Information Technology', 'Data Science',
        '["Watching", "Hands-on Practice", "Discussion"]'::jsonb,
        '[]'::jsonb,
        'average'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'average';

    -- ========== Account 6: low_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0006-7890-abcd-ef1234567890', 'test6@example.com', 'Test Student 6', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0006-7890-abcd-ef1234567890',
        'Bachelor''s', 'Arts & Humanities', 'English Literature',
        '["Reading"]'::jsonb,
        '["Attention Deficit Hyperactivity Disorder (ADHD)"]'::jsonb,
        'low_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'low_achiever';

    -- ========== Account 7: high_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0007-7890-abcd-ef1234567890', 'test7@example.com', 'Test Student 7', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0007-7890-abcd-ef1234567890',
        'Bachelor''s', 'Engineering & Technology', 'Electrical Engineering',
        '["Watching", "Hands-on Practice"]'::jsonb,
        '[]'::jsonb,
        'high_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'high_achiever';

    -- ========== Account 8: average ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0008-7890-abcd-ef1234567890', 'test8@example.com', 'Test Student 8', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0008-7890-abcd-ef1234567890',
        'Master''s', 'Natural Sciences', 'Chemistry',
        '["Reading", "Hands-on Practice", "Discussion"]'::jsonb,
        '[]'::jsonb,
        'average'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'average';

    -- ========== Account 9: low_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0009-7890-abcd-ef1234567890', 'test9@example.com', 'Test Student 9', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0009-7890-abcd-ef1234567890',
        'Bachelor''s', 'Social Sciences', 'Psychology',
        '["Discussion", "Reading"]'::jsonb,
        '["Working Memory Deficit"]'::jsonb,
        'low_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'low_achiever';

    -- ========== Account 10: high_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0010-7890-abcd-ef1234567890', 'test10@example.com', 'Test Student 10', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0010-7890-abcd-ef1234567890',
        'Bachelor''s', 'Computer Science & Information Technology', 'Cybersecurity',
        '["Watching", "Reading", "Hands-on Practice", "Discussion"]'::jsonb,
        '[]'::jsonb,
        'high_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'high_achiever';

    -- ========== Account 11: average ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0011-7890-abcd-ef1234567890', 'test11@example.com', 'Test Student 11', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0011-7890-abcd-ef1234567890',
        'Bachelor''s', 'Arts & Humanities', 'History',
        '["Reading", "Discussion"]'::jsonb,
        '[]'::jsonb,
        'average'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'average';

    -- ========== Account 12: low_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0012-7890-abcd-ef1234567890', 'test12@example.com', 'Test Student 12', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0012-7890-abcd-ef1234567890',
        'Master''s', 'Engineering & Technology', 'Civil Engineering',
        '["Hands-on Practice"]'::jsonb,
        '["Dyslexia"]'::jsonb,
        'low_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'low_achiever';

    -- ========== Account 13: high_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0013-7890-abcd-ef1234567890', 'test13@example.com', 'Test Student 13', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0013-7890-abcd-ef1234567890',
        'Bachelor''s', 'Natural Sciences', 'Physics',
        '["Watching", "Reading", "Hands-on Practice"]'::jsonb,
        '[]'::jsonb,
        'high_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'high_achiever';

    -- ========== Account 14: average ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0014-7890-abcd-ef1234567890', 'test14@example.com', 'Test Student 14', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0014-7890-abcd-ef1234567890',
        'Bachelor''s', 'Social Sciences', 'Sociology',
        '["Discussion", "Watching"]'::jsonb,
        '[]'::jsonb,
        'average'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'average';

    -- ========== Account 15: low_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0015-7890-abcd-ef1234567890', 'test15@example.com', 'Test Student 15', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0015-7890-abcd-ef1234567890',
        'Master''s', 'Business & Management', 'Marketing',
        '["Watching", "Discussion"]'::jsonb,
        '["Attention Deficit Hyperactivity Disorder (ADHD)"]'::jsonb,
        'low_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'low_achiever';

    -- ========== Account 16: high_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0016-7890-abcd-ef1234567890', 'test16@example.com', 'Test Student 16', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0016-7890-abcd-ef1234567890',
        'Bachelor''s', 'Computer Science & Information Technology', 'Artificial Intelligence',
        '["Reading", "Hands-on Practice", "Discussion"]'::jsonb,
        '[]'::jsonb,
        'high_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'high_achiever';

    -- ========== Account 17: average ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0017-7890-abcd-ef1234567890', 'test17@example.com', 'Test Student 17', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0017-7890-abcd-ef1234567890',
        'Bachelor''s', 'Natural Sciences', 'Mathematics',
        '["Reading", "Discussion"]'::jsonb,
        '[]'::jsonb,
        'average'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'average';

    -- ========== Account 18: low_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0018-7890-abcd-ef1234567890', 'test18@example.com', 'Test Student 18', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0018-7890-abcd-ef1234567890',
        'Master''s', 'Arts & Humanities', 'Philosophy',
        '["Reading"]'::jsonb,
        '["Working Memory Deficit"]'::jsonb,
        'low_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'low_achiever';

    -- ========== Account 19: high_achiever ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0019-7890-abcd-ef1234567890', 'test19@example.com', 'Test Student 19', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0019-7890-abcd-ef1234567890',
        'Bachelor''s', 'Engineering & Technology', 'Chemical Engineering',
        '["Watching", "Hands-on Practice", "Reading"]'::jsonb,
        '[]'::jsonb,
        'high_achiever'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'high_achiever';

    -- ========== Account 20: average ==========
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES ('a1b2c3d4-0020-7890-abcd-ef1234567890', 'test20@example.com', 'Test Student 20', pw_hash, 'student')
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        'a1b2c3d4-0020-7890-abcd-ef1234567890',
        'Bachelor''s', 'Social Sciences', 'Political Science',
        '["Discussion", "Reading", "Watching"]'::jsonb,
        '[]'::jsonb,
        'average'
    ) ON CONFLICT (user_id) DO UPDATE SET simulated_profile = 'average';

    RAISE NOTICE '20 test student accounts created (test1@example.com through test20@example.com, password: test)';
END $$;
