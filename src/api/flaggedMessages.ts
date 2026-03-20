import { api } from './client'

export interface Flag {
    id: string
    reason: string
    comment: string | null
    status: 'pending' | 'reviewed' | 'dismissed'
    created_at: string
    student_email: string
    student_name: string
    message_content: string
    user_message_content: string | null
    resolved_by_email: string | null
    resolved_at: string | null
}

export interface FlagListResponse {
    flags: Flag[]
    total: number
    counts: { pending: number; reviewed: number; dismissed: number }
}

export const getFlaggedMessages = (status?: string, limit = 20, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (status) params.set('status', status)
    return api.get<FlagListResponse>(`/admin/flagged-messages?${params}`)
}

export const updateFlagStatus = (flagId: string, status: 'reviewed' | 'dismissed') =>
    api.put<{ flag: Flag }>(`/admin/flagged-messages/${flagId}`, { status })

export const getFeedbackStats = () =>
    api.get<{ total_likes: number; total_dislikes: number; pending_flags: number }>('/admin/feedback-stats')

export interface UserFeedbackStats {
    id: string
    name: string
    email: string
    likes: number
    dislikes: number
}

export const getFeedbackStatsByUser = () =>
    api.get<{ users: UserFeedbackStats[] }>('/admin/feedback-stats/by-user')
