// Sleep data types

export interface SleepInterval {
    start: string // HH:mm
    end: string   // HH:mm
}

export interface SleepEntry {
    session_date: string
    bedtime: string
    wake_time: string
    total_sleep_minutes: number
    time_in_bed_minutes: number
    awakenings_count: number
    awake_minutes: number
}
