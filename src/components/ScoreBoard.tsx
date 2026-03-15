import { useState, useEffect } from 'react'
import ScoreGauge from './ScoreGauge'
import { CONCEPT_IDS, CONCEPT_DISPLAY_NAMES } from '../constants/concepts'

// Inline interface — will be centralized in Phase 7
interface ConceptScore {
    conceptId: string
    conceptName: string
    score: number | null
    trend: string | null
    yesterdayScore?: number | null
    clusterLabel?: string | null
    clusterIndex?: number | null
    totalClusters?: number | null
    percentilePosition?: number | null
    clusterUserCount?: number | null
    dialMin?: number
    dialCenter?: number
    dialMax?: number
    computedAt?: string | null
    coldStart?: boolean
    noData?: boolean
    breakdown?: Record<string, {
        score: number
        weight: number
        label?: string
        category?: string
        categoryLabel?: string
        zScore?: number
    }>
    previousBreakdown?: Record<string, { score: number }> | null
}

interface Props {
    scores: ConceptScore[]
    loading: boolean
    /** Tooltip text shown in the info icon. Caller provides context-appropriate copy. */
    infoTooltip?: string
    /** Card title. Defaults to "Your Performance Scores". */
    title?: string
    /** Card description. Defaults to "Click on a gauge to see a detailed breakdown of your habits". */
    description?: string
    /** Message shown when scores array is empty. */
    emptyMessage?: string
    /** When true, pads missing concepts with "no data yet" placeholder cards. */
    showConceptPlaceholders?: boolean
}

// =============================================================================
// HELPER FUNCTIONS (pure, no side-effects)
// =============================================================================

/** Returns ordinal suffix string, e.g. 1 → "1st", 2 → "2nd", 42 → "42nd" */
function ordinal(n: number): string {
    const abs = Math.abs(Math.round(n))
    const mod100 = abs % 100
    const mod10 = abs % 10
    if (mod100 >= 11 && mod100 <= 13) return `${abs}th`
    if (mod10 === 1) return `${abs}st`
    if (mod10 === 2) return `${abs}nd`
    if (mod10 === 3) return `${abs}rd`
    return `${abs}th`
}

function formatLastUpdated(computedAt?: string | null): { text: string; stale: boolean } {
    if (!computedAt) return { text: '', stale: false }
    const diff = Date.now() - new Date(computedAt).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)
    if (hours < 1) return { text: 'Updated just now', stale: false }
    if (hours < 24) return { text: `Updated ${hours}h ago`, stale: false }
    if (days === 1) return { text: 'Updated yesterday', stale: true }
    return { text: `Updated ${days} days ago`, stale: true }
}

// Called when previous == null (first session — no comparison possible)
function getFirstSessionText(score: number, dialMin: number, dialMax: number): string {
    const range = dialMax - dialMin
    if (range <= 0) return 'This is your first recorded session'
    const position = (score - dialMin) / range
    if (position >= 0.67) return 'This is your first session — you are off to a strong start within your peer group'
    if (position >= 0.33) return 'This is your first session — your score is around the middle of your peer group'
    return 'This is your first session — this is a good area to focus on going forward'
}

// Called when previous != null but diff is within threshold (genuinely stable)
function getDialPositionText(score: number, dialMin: number, dialMax: number): string {
    const range = dialMax - dialMin
    if (range <= 0) return 'Your score has been computed'
    const position = (score - dialMin) / range
    if (position >= 0.67) return 'Your score is stable and you are doing well within your peer group'
    if (position >= 0.33) return 'Your score is stable and around the middle of your peer group'
    return 'Your score is stable — this is a good area to work on'
}

function getConceptComparisonStatement(
    current: number,
    previous: number | null | undefined,
    dialMin: number,
    dialMax: number
): { text: string; tone: 'better' | 'worse' | 'stable' } {
    const range = dialMax - dialMin
    const threshold = Math.max(3, range * 0.05)

    if (previous == null) {
        return { text: getFirstSessionText(current, dialMin, dialMax), tone: 'stable' }
    }

    const diff = current - previous
    if (diff > threshold)  return { text: 'Your current score is higher than your previous session', tone: 'better' }
    if (diff < -threshold) return { text: 'Your previous score was slightly higher — keep going', tone: 'worse' }
    return { text: getDialPositionText(current, dialMin, dialMax), tone: 'stable' }
}

// =============================================================================
// NO-DATA PLACEHOLDER HELPERS
// =============================================================================

const NO_DATA_ICONS: Record<string, string> = {
    sleep: '🌙',
    screen_time: '📱',
    lms: '📚',
    srl: '📝',
}

const NO_DATA_HINTS: Record<string, string> = {
    sleep: 'Log your sleep to unlock this score',
    screen_time: 'Log your screen time to unlock this score',
    lms: 'Your LMS activity will appear here automatically',
    srl: 'Complete an SRL survey to unlock this score',
}

// =============================================================================
// COMPONENT
// =============================================================================

const ScoreBoard = ({
    scores,
    loading,
    infoTooltip,
    title = 'Your Performance Scores',
    description = 'Click on a gauge to see a detailed breakdown of your habits',
    emptyMessage = 'No scores available yet. Complete your profile and surveys to see your performance.',
    showConceptPlaceholders = false,
}: Props) => {
    const [expandedConceptId, setExpandedConceptId] = useState<string | null>(null)
    const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 700)

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth <= 700)
        window.addEventListener('resize', handler)
        return () => window.removeEventListener('resize', handler)
    }, [])

    const displayScores = showConceptPlaceholders
        ? CONCEPT_IDS.map(id => scores.find(s => s.conceptId === id) ?? {
            conceptId: id,
            conceptName: CONCEPT_DISPLAY_NAMES[id],
            score: null,
            trend: null,
            noData: true,
        })
        : scores

    const handleGaugeClick = (conceptId: string) => {
        setExpandedConceptId(prev => prev === conceptId ? null : conceptId)
    }

    const defaultTooltip = 'Your score is calculated by comparing you with students who have similar behavioral patterns. The dial range (P5–P95) shows where most students in your group fall. The two needles show your progress from yesterday to today.'

    // Shared breakdown content — used by both the inline mobile slot and the desktop panel
    const renderBreakdownContent = (score: ConceptScore, twoColumns = false) => {
        if (!score.breakdown) return null

        const dialMin = score.dialMin ?? 0
        const dialMax = score.dialMax ?? 100
        const comparison = getConceptComparisonStatement(score.score!, score.yesterdayScore, dialMin, dialMax)
        const toneBg = comparison.tone === 'better' ? '#f0fdf4' : comparison.tone === 'worse' ? '#fffbeb' : '#f9fafb'
        const toneBorder = comparison.tone === 'better' ? '#bbf7d0' : comparison.tone === 'worse' ? '#fde68a' : '#e5e7eb'
        const toneColor = comparison.tone === 'better' ? '#15803d' : comparison.tone === 'worse' ? '#92400e' : '#374151'

        const isTop = score.clusterIndex === (score.totalClusters ?? 0) - 1
        const isBottom = score.clusterIndex === 0
        const badgeBg = isTop ? '#ECFDF5' : isBottom ? '#FFFBEB' : '#EFF6FF'
        const badgeBorder = isTop ? '#6EE7B7' : isBottom ? '#FCD34D' : '#BFDBFE'
        const badgeColor = isTop ? '#065F46' : isBottom ? '#78350F' : '#1E3A5F'
        const badgeDot = isTop ? '🟢' : isBottom ? '🟡' : '🔵'
        const showBadge = score.clusterLabel != null && score.clusterIndex != null && score.totalClusters != null

        // Summary block: cluster badge + comparison statement
        const summaryBlock = (
            <>
                {showBadge && (
                    <div className='cluster-badge' style={{
                        backgroundColor: badgeBg,
                        border: `1px solid ${badgeBorder}`,
                        borderRadius: '8px',
                        padding: '8px 12px',
                        marginBottom: '10px',
                        color: badgeColor
                    }}>
                        <div className='cluster-badge-label'>{badgeDot} {score.clusterLabel}</div>
                        {score.percentilePosition != null && (
                            <div className='cluster-badge-detail'>
                                You are at the {ordinal(score.percentilePosition)} percentile of this group
                            </div>
                        )}
                        {score.clusterUserCount != null && (
                            <div className='cluster-badge-detail'>
                                {score.clusterUserCount} student{score.clusterUserCount !== 1 ? 's' : ''} in this group
                            </div>
                        )}
                    </div>
                )}
                <div style={{
                    backgroundColor: toneBg,
                    border: `1px solid ${toneBorder}`,
                    borderRadius: '6px',
                    padding: '8px 10px',
                    marginBottom: twoColumns ? 0 : '10px',
                    fontSize: '13px',
                    color: toneColor,
                    lineHeight: '1.4'
                }}>
                    {comparison.text}
                </div>
            </>
        )

        if (twoColumns) {
            return (
                <div className='breakdown-two-col'>
                    <div className='breakdown-col-left' style={{ flex: 1 }}>
                        <div className='score-details-title' style={{ marginBottom: '12px' }}>Your Status</div>
                        {summaryBlock}
                    </div>
                </div>
            )
        }

        return (
            <>
                <div className='score-details-title' style={{ marginBottom: '12px' }}>Your Status</div>
                {summaryBlock}
            </>
        )
    }

    // Desktop: full-width panel below the grid (text only, no gauge dial)
    const expandedScore = expandedConceptId
        ? displayScores.find(s => s.conceptId === expandedConceptId)
        : null

    const renderDesktopPanel = () => {
        if (!expandedScore || !expandedScore.breakdown) return null
        return (
            <div className='gauge-expanded-panel'>
                <div className='gauge-expanded-panel-text-only'>
                    {renderBreakdownContent(expandedScore, true)}
                </div>
            </div>
        )
    }

    return (
        <div className='mood-card'>
            <div className='mood-card-header-row'>
                <div>
                    <h2 className='mood-card-title'>{title}</h2>
                    <p className='mood-card-description'>{description}</p>
                </div>
                <div className="gauge-info-wrapper">
                    <span className="gauge-info-icon">ℹ</span>
                    <div className="gauge-info-tooltip">
                        {infoTooltip ?? defaultTooltip}
                    </div>
                </div>
            </div>
            <div className='mood-card-content'>
                {loading ? (
                    <div className='mood-loading'>Loading scores...</div>
                ) : displayScores.length === 0 ? (
                    <div className='mood-no-data'>{emptyMessage}</div>
                ) : (
                    <>
                        <div className='score-gauges-grid'>
                            {displayScores.map(score => (
                                <div
                                    className={`score-gauge-wrapper ${expandedConceptId === score.conceptId ? 'expanded' : ''}`}
                                    onClick={() => !score.coldStart && !score.noData && handleGaugeClick(score.conceptId)}
                                    key={score.conceptId}
                                    data-cold-start={score.coldStart ? 'true' : undefined}
                                    data-no-data={score.noData ? 'true' : undefined}
                                    style={{ cursor: (score.coldStart || score.noData) ? 'default' : 'pointer' }}
                                >
                                    {score.coldStart ? (
                                        <div className='cold-start-placeholder'>
                                            <div className='cold-start-icon'>⏳</div>
                                            <div className='cold-start-label'>{score.conceptName}</div>
                                            <div className='cold-start-message'>Building your profile — check back once more students have joined.</div>
                                        </div>
                                    ) : score.noData ? (
                                        <div className='no-data-placeholder'>
                                            <div className='no-data-icon'>{NO_DATA_ICONS[score.conceptId] ?? '📊'}</div>
                                            <div className='no-data-label'>{score.conceptName}</div>
                                            <div className='no-data-message'>{NO_DATA_HINTS[score.conceptId] ?? 'No data yet'}</div>
                                        </div>
                                    ) : (
                                        <>
                                            <ScoreGauge
                                                score={score.score!}
                                                label={score.conceptName}
                                                trend={score.trend ?? undefined}
                                                size="medium"
                                                yesterdayScore={score.yesterdayScore}
                                                clusterLabel={score.clusterLabel}
                                                dialMin={score.dialMin}
                                                dialCenter={score.dialCenter}
                                                dialMax={score.dialMax}
                                            />
                                            {(() => {
                                                const lu = formatLastUpdated(score.computedAt)
                                                return lu.text
                                                    ? <div className={`gauge-last-updated${lu.stale ? ' stale' : ''}`}>{lu.text}</div>
                                                    : null
                                            })()}
                                            {/* Mobile: inline breakdown right below this gauge */}
                                            {isMobile && expandedConceptId === score.conceptId && score.breakdown && (
                                                <div className='gauge-inline-breakdown'>
                                                    {renderBreakdownContent(score)}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                        {/* Desktop: full-width text panel below the entire gauge row */}
                        {!isMobile && renderDesktopPanel()}
                    </>
                )}
            </div>
        </div>
    )
}

export default ScoreBoard
