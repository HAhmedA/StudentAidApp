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
    onboarding_completed: boolean
    updated_at: string
}
