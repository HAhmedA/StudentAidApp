// Canonical score types — shared across Home.tsx, ScoreBoard, admin views, etc.

export interface AspectScore {
    score: number
    weight: number
    contribution?: number
    label?: string
    category?: string
    categoryLabel?: string
    zScore?: number
}

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
    breakdown?: Record<string, AspectScore>
    previousBreakdown?: Record<string, { score: number }> | null
}
