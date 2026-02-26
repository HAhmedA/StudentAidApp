import { api } from './client'

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

export interface ProfilePayload {
    edu_level?: string
    field_of_study?: string
    major?: string
    learning_formats?: string[]
    disabilities?: string[]
}

export const getProfile = () =>
    api.get<UserProfile>('/profile')

export const updateProfile = (payload: ProfilePayload) =>
    api.put<UserProfile>('/profile', payload)

export const completeOnboarding = () =>
    api.post<{ success: boolean }>('/profile/onboarding-complete', {})
