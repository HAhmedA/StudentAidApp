// User and auth types — canonical location for shared user interfaces

export type UserRole = 'admin' | 'student'

export interface AuthUser {
    id: string
    email: string
    name: string
    role?: UserRole
}

export interface UserProfile {
    user_id: string
    edu_level: string
    field_of_study: string
    major: string
    learning_formats: string[]
    disabilities: string[]
    onboarding_completed: boolean
    updated_at: string
}
