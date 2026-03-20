import { api } from './client'

export interface SupportRequest {
    id: string
    category: string
    message: string
    status: 'open' | 'resolved' | 'closed'
    admin_response: string | null
    created_at: string
    resolved_at: string | null
    // Admin-only fields (from JOIN):
    student_email?: string
    student_name?: string
    resolved_by_email?: string
}

export interface SupportRequestCounts {
    open: number
    resolved: number
    closed: number
    total: number
}

// Student endpoints
export const submitSupportRequest = (category: string, message: string) =>
    api.post<{ request: SupportRequest }>('/profile/support-request', { category, message })

export const getMySupportRequests = () =>
    api.get<{ requests: SupportRequest[] }>('/profile/support-requests')

// Admin endpoints
export const getAdminSupportRequests = (status?: string, limit = 20, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (status) params.set('status', status)
    return api.get<{ requests: SupportRequest[]; counts: SupportRequestCounts }>(
        `/admin/support-requests?${params}`
    )
}

export const resolveAdminSupportRequest = (
    requestId: string,
    status: 'resolved' | 'closed',
    response?: string
) =>
    api.put<{ request: SupportRequest }>(
        `/admin/support-requests/${requestId}`,
        { status, response }
    )
