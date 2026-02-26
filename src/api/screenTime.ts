import { api } from './client'

export interface ScreenTimeEntry {
    session_date: string
    total_screen_minutes: number
    longest_continuous_session: number
    late_night_screen_minutes: number
}

export interface ScreenTimePayload {
    totalMinutes: number
    longestSession: number
    preSleepMinutes: number
}

export const getTodayScreenTime = () =>
    api.get<{ entry: ScreenTimeEntry | null }>('/screen-time/today').then(r => r.entry)

export const saveScreenTime = (payload: ScreenTimePayload) =>
    api.post<{ entry: ScreenTimeEntry }>('/screen-time', payload).then(r => r.entry)
