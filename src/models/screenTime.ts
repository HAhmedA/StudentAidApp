// Screen time data types

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
