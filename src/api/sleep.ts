import { api } from './client'

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

export const getTodaySleep = () =>
    api.get<{ entry: SleepEntry | null }>('/sleep/today').then(r => r.entry)

export const saveSleep = (intervals: SleepInterval[], manualAwakenings?: number | null) =>
    api.post<{ entry: SleepEntry }>('/sleep', {
        intervals,
        ...(manualAwakenings != null && { manualAwakenings })
    }).then(r => r.entry)
