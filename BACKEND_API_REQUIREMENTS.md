# Backend API Requirements for Profile Feature

## Overview
The frontend now expects two backend endpoints to persist profile data. Until these are implemented, you'll see the 404 errors (which are now handled gracefully).

## Required Endpoints

### 1. Student Profile Endpoint

**GET `/api/profile`**
- **Purpose**: Fetch the current user's profile data
- **Response** (200 OK):
```json
{
  "user_id": "uuid-or-int",
  "edu_level": "Bachelor's",
  "field_of_study": "Computer Science & Information Technology",
  "major": "Computer Science",
  "learning_formats": ["Reading", "Hands-on Practice"],
  "disabilities": ["Dyslexia"],
  "updated_at": "2026-01-08T17:30:00Z"
}
```
- **Response** (404 Not Found): Empty profile (frontend handles gracefully)

**PUT `/api/profile`**
- **Purpose**: Update the current user's profile
- **Request Body**:
```json
{
  "edu_level": "Bachelor's",
  "field_of_study": "Computer Science & Information Technology",
  "major": "Computer Science",
  "learning_formats": ["Reading", "Hands-on Practice"],
  "disabilities": ["Dyslexia"]
}
```
- **Response** (200 OK): Same as GET response with updated `updated_at`

### 2. Admin System Prompt Endpoint

**GET `/api/admin/system-prompt`**
- **Purpose**: Fetch the latest system prompt
- **Response** (200 OK):
```json
{
  "prompt": "Be Ethical",
  "updated_at": "2026-01-08T17:30:00Z"
}
```
- **Response** (404 Not Found): Frontend will use default "Be Ethical"

**PUT `/api/admin/system-prompt`**
- **Purpose**: Update the system prompt
- **Request Body**:
```json
{
  "prompt": "New system prompt text here"
}
```
- **Response** (200 OK): Same as GET response with updated `updated_at`

## Database Schema

### Student Profile Table
```sql
CREATE TABLE student_profiles (
  user_id UUID/INT PRIMARY KEY REFERENCES users(id),
  edu_level VARCHAR(50),
  field_of_study VARCHAR(100),
  major VARCHAR(100),
  learning_formats JSONB,  -- Array of strings
  disabilities JSONB,      -- Array of strings
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### System Prompt Table
```sql
CREATE TABLE system_prompts (
  id SERIAL PRIMARY KEY,
  prompt TEXT NOT NULL DEFAULT 'Be Ethical',
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID/INT REFERENCES users(id)
);
```

## Notes
- All student profile fields are **optional** (can be empty strings or empty arrays)
- The system prompt defaults to "Be Ethical" if not found
- Frontend handles 404 errors gracefully (no red error messages shown)
- Success messages appear for 3 seconds after successful saves
- Authentication is handled via existing session/cookie mechanism
