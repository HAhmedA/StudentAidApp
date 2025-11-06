-- Insert sample users for testing
-- Password for admin: "admin"
-- Password for student: "student"
INSERT INTO public.users (email, name, password_hash) VALUES
('admin@example.com', 'Admin User', '$2b$10$N6oXGrgZone4.NibAZb2W.tJxEt.t7L/HdS0GSDQNazHuzBnsDBhO')
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.users (email, name, password_hash) VALUES
('student@example.com', 'Student User', '$2b$10$SiaZsiznc1J23J2uPVlE7ODUmXGfMYhhX228RwldzdAhN3Hs8HCnS')
ON CONFLICT (email) DO NOTHING;

