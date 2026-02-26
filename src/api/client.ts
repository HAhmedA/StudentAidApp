// Base API client — single source of truth for all fetch calls.
// All domain API modules import from here.

const BASE = (process.env.REACT_APP_API_BASE as string) || '/api'

export class ApiError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        ...options,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options?.headers }
    })
    if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new ApiError(res.status, err.error || 'UNKNOWN', err.message || res.statusText)
    }
    return res.json()
}

export const api = {
    get:    <T>(path: string)                => request<T>(path),
    post:   <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
    put:    <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
    delete: <T>(path: string)               => request<T>(path, { method: 'DELETE' }),
}

// Re-export BASE for cases where callers need to know the base URL
// (e.g., axios-based redux slices during migration)
export const API_BASE = BASE
