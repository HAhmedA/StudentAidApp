import { api } from './client'

export interface ConceptScore {
    conceptId: string
    conceptName: string
    score: number | null
    trend: string | null
    yesterdayScore?: number | null
    clusterLabel?: string | null
    dialMin: number
    dialCenter: number
    dialMax: number
    computedAt?: string | null
    coldStart?: boolean
    breakdown?: Record<string, {
        score: number
        weight: number
        label?: string
        category?: string
        categoryLabel?: string
        zScore?: number
    }>
}

export const getScores = () =>
    api.get<{ scores: ConceptScore[] }>('/scores').then(r => r.scores)

export const getScore = (conceptId: string) =>
    api.get<ConceptScore>(`/scores/${conceptId}`)
