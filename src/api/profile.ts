import { api } from './client'

export interface UserProfile {
    user_id: string
    onboarding_completed: boolean
    updated_at: string
}

export const getProfile = () =>
    api.get<UserProfile>('/profile')

export const completeOnboarding = () =>
    api.post<{ success: boolean }>('/profile/onboarding-complete', {})
