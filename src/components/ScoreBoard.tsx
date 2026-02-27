import { useState } from 'react'
import ScoreGauge from './ScoreGauge'
import { DOMAIN_DESCRIPTIONS, DOMAIN_TIPS } from '../constants/concepts'

// Inline interface — will be centralized in Phase 7
interface ConceptScore {
    conceptId: string
    conceptName: string
    score: number | null
    trend: string | null
    yesterdayScore?: number | null
    clusterLabel?: string | null
    dialMin?: number
    dialCenter?: number
    dialMax?: number
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
}

// =============================================================================
// HELPER FUNCTIONS (pure, no side-effects)
// =============================================================================

function formatAspectName(key: string) {
    return key.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
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
// COMPONENT
// =============================================================================

const ScoreBoard = ({
    scores,
    loading,
    infoTooltip,
    title = 'Your Performance Scores',
    description = 'Click on a gauge to see a detailed breakdown of your habits',
    emptyMessage = 'No scores available yet. Complete your profile and surveys to see your performance.'
}: Props) => {
    const [expandedConceptId, setExpandedConceptId] = useState<string | null>(null)

    const handleGaugeClick = (conceptId: string) => {
        setExpandedConceptId(prev => prev === conceptId ? null : conceptId)
    }

    const defaultTooltip = 'Your score is calculated by comparing you with students who have similar behavioral patterns. The dial range (P5–P95) shows where most students in your group fall. The two needles show your progress from yesterday to today.'

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
                ) : scores.length === 0 ? (
                    <div className='mood-no-data'>{emptyMessage}</div>
                ) : (
                    <div className='score-gauges-grid'>
                        {scores.map(score => (
                            <div
                                className={`score-gauge-wrapper ${expandedConceptId === score.conceptId ? 'expanded' : ''}`}
                                onClick={() => !score.coldStart && handleGaugeClick(score.conceptId)}
                                key={score.conceptId}
                            >
                                {score.coldStart ? (
                                    <div className='cold-start-placeholder'>
                                        <div className='cold-start-icon'>⏳</div>
                                        <div className='cold-start-label'>{score.conceptName}</div>
                                        <div className='cold-start-message'>Building your profile — check back once more students have joined.</div>
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
                                    </>
                                )}
                                {expandedConceptId === score.conceptId && score.breakdown && (() => {
                                    const dialMin = score.dialMin ?? 0
                                    const dialMax = score.dialMax ?? 100
                                    const comparison = getConceptComparisonStatement(
                                        score.score!,
                                        score.yesterdayScore,
                                        dialMin,
                                        dialMax
                                    )
                                    const toneBg = comparison.tone === 'better'
                                        ? '#f0fdf4'
                                        : comparison.tone === 'worse'
                                            ? '#fffbeb'
                                            : '#f9fafb'
                                    const toneBorder = comparison.tone === 'better'
                                        ? '#bbf7d0'
                                        : comparison.tone === 'worse'
                                            ? '#fde68a'
                                            : '#e5e7eb'
                                    const toneColor = comparison.tone === 'better'
                                        ? '#15803d'
                                        : comparison.tone === 'worse'
                                            ? '#92400e'
                                            : '#374151'
                                    return (
                                        <div className='score-details-list'>
                                            <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '4px', marginBottom: '8px' }}>
                                                <div className='score-details-title' style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>Detailed Breakdown</div>
                                            </div>
                                            <div style={{
                                                backgroundColor: toneBg,
                                                border: `1px solid ${toneBorder}`,
                                                borderRadius: '6px',
                                                padding: '8px 10px',
                                                marginBottom: '10px',
                                                fontSize: '13px',
                                                color: toneColor,
                                                lineHeight: '1.4'
                                            }}>
                                                {comparison.text}
                                            </div>
                                            <ul>
                                                {Object.entries(score.breakdown).map(([key]) => (
                                                    <li key={key} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '3px' }}>
                                                        <span className='detail-label' style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            {formatAspectName(key)}
                                                            {DOMAIN_DESCRIPTIONS[key] && (
                                                                <span className='domain-info-wrapper'>
                                                                    <span className='domain-info-icon'>ℹ</span>
                                                                    <span className='domain-info-tooltip'>{DOMAIN_DESCRIPTIONS[key]}</span>
                                                                </span>
                                                            )}
                                                        </span>
                                                        {DOMAIN_TIPS[key] && (
                                                            <span style={{ fontSize: '11px', color: '#6b7280', lineHeight: '1.4', paddingLeft: '2px' }}>
                                                                💡 {DOMAIN_TIPS[key]}
                                                            </span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )
                                })()}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default ScoreBoard
