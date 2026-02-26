import React from 'react'
import './ScoreGauge.css'

interface ScoreGaugeProps {
    score: number              // Today's composite score (0-100)
    label: string              // Concept name
    trend?: string             // 'improving', 'declining', 'stable'
    size?: 'small' | 'medium' | 'large'
    category?: string          // 'requires_improvement', 'good', 'very_good'
    categoryLabel?: string     // Human-readable: 'Could Improve', 'Good', 'Very Good'
    yesterdayScore?: number | null  // Yesterday's score (0-100)
    clusterLabel?: string | null   // e.g. "Students with balanced patterns"
    dialMin?: number           // P5 of cluster (default 0)
    dialCenter?: number        // P50 of cluster (default 50)
    dialMax?: number           // P95 of cluster (default 100)
}

// Gradient colors for the continuous arc
const ARC_COLORS = {
    low: '#86efac',    // Light green
    mid: '#22c55e',    // Medium green
    high: '#15803d'    // Dark green
}

/**
 * Map a score to a needle rotation angle within the dial range.
 * The dial spans from -90° (left) to +90° (right).
 * The score is mapped relative to dialMin..dialMax.
 */
const scoreToRotation = (score: number, dialMin: number, dialMax: number): number => {
    const range = dialMax - dialMin
    if (range <= 0) return 0 // Avoid division by zero
    // Clamp score within a slightly extended range for visual
    const clamped = Math.max(dialMin - range * 0.05, Math.min(dialMax + range * 0.05, score))
    const normalized = (clamped - dialMin) / range
    return normalized * 180 - 90 // -90° to 90°
}

/**
 * ScoreGauge - Cluster-based semicircular gauge with Current/Previous needles
 *
 * The dial range is defined by the student's cluster percentiles:
 *   - Left edge = P5 (5th percentile)
 *   - Center = P50 (median)
 *   - Right edge = P95 (95th percentile)
 * 
 * Two needles show personal progress:
 *   - Previous (gray) — where the student was
 *   - Current (dark) — where they are now
 */
const ScoreGauge: React.FC<ScoreGaugeProps> = ({
    score,
    label,
    trend = 'stable',
    size = 'medium',
    category,
    categoryLabel,
    yesterdayScore,
    clusterLabel,
    dialMin = 0,
    dialCenter = 50,
    dialMax = 100
}) => {
    // Computed needle rotations
    const todayRotation = scoreToRotation(score, dialMin, dialMax)
    const hasYesterday = yesterdayScore != null && yesterdayScore >= 0
    const yesterdayRotation = hasYesterday ? scoreToRotation(yesterdayScore!, dialMin, dialMax) : 0

    // Center tick rotation (P50)
    const centerTickRotation = scoreToRotation(dialCenter, dialMin, dialMax)

    const getTrendIcon = () => {
        switch (trend) {
            case 'improving':
                return <span className="gauge-trend gauge-trend-up">↑</span>
            case 'declining':
                return <span className="gauge-trend gauge-trend-down">↓</span>
            default:
                return <span className="gauge-trend gauge-trend-stable">→</span>
        }
    }

    // Resolve display label
    const resolvedCategory = category || (score >= 70 ? 'very_good' : score >= 40 ? 'good' : 'requires_improvement')
    const displayLabel = clusterLabel || categoryLabel || (
        resolvedCategory === 'very_good' ? 'Very Good' :
            resolvedCategory === 'good' ? 'Good' : 'Could Improve'
    )

    // SVG Geometry Constants
    const CX = 100
    const CY = 105
    const R = 70
    const STROKE = 14

    const pol2cart = (cx: number, cy: number, r: number, angleDeg: number) => {
        const rad = (angleDeg * Math.PI) / 180
        return {
            x: cx + r * Math.cos(rad),
            y: cy - r * Math.sin(rad)
        }
    }

    // Create gradient arc segments (smooth continuous gradient)
    const createGradientArc = () => {
        const segments = 20 // Number of gradient steps
        const paths = []

        for (let i = 0; i < segments; i++) {
            const startAngle = 180 - (i / segments) * 180
            const endAngle = 180 - ((i + 1) / segments) * 180
            const t = i / (segments - 1) // 0 to 1

            // Interpolate color: light green → medium green → dark green
            let color: string
            if (t < 0.5) {
                const f = t * 2
                color = interpolateColor(ARC_COLORS.low, ARC_COLORS.mid, f)
            } else {
                const f = (t - 0.5) * 2
                color = interpolateColor(ARC_COLORS.mid, ARC_COLORS.high, f)
            }

            const start = pol2cart(CX, CY, R, startAngle)
            const end = pol2cart(CX, CY, R, endAngle)
            const d = `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`

            paths.push(
                <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={STROKE}
                    opacity={0.85}
                    key={`seg-${i}`}
                />
            )
        }
        return paths
    }

    // Needle colors
    const TODAY_NEEDLE_COLOR = '#1f2937'
    const YESTERDAY_NEEDLE_COLOR = '#9ca3af'

    // Arrow needle dimensions
    const NEEDLE_LENGTH = R - 8       // How far the arrow tip reaches from center
    const SHAFT_WIDTH = 2.5           // Arrow shaft thickness
    const HEAD_WIDTH = 8              // Arrowhead base width
    const HEAD_LENGTH = 10            // Arrowhead length

    const yesterdayOpacity = 0.65

    return (
        <div className={`score-gauge score-gauge-${size}`}>
            <div className="gauge-label">{label}</div>

            <div className="gauge-container">
                <svg viewBox="0 0 200 120" className="gauge-svg">
                    {/* Continuous gradient arc */}
                    {createGradientArc()}

                    {/* Previous arrow (only rendered when data exists) */}
                    {hasYesterday && <g transform={`rotate(${yesterdayRotation} ${CX} ${CY})`} opacity={yesterdayOpacity}>
                        {/* Shaft */}
                        <rect
                            x={CX - SHAFT_WIDTH / 2}
                            y={CY - NEEDLE_LENGTH + HEAD_LENGTH}
                            width={SHAFT_WIDTH}
                            height={NEEDLE_LENGTH - HEAD_LENGTH - 6}
                            fill={YESTERDAY_NEEDLE_COLOR}
                            rx="1"
                        />
                        {/* Arrowhead */}
                        <polygon
                            points={`${CX},${CY - NEEDLE_LENGTH} ${CX - HEAD_WIDTH / 2},${CY - NEEDLE_LENGTH + HEAD_LENGTH} ${CX + HEAD_WIDTH / 2},${CY - NEEDLE_LENGTH + HEAD_LENGTH}`}
                            fill={YESTERDAY_NEEDLE_COLOR}
                        />
                    </g>}

                    {/* Center pivot */}
                    <circle cx={CX} cy={CY} r="6" fill="#374151" />

                    {/* Today arrow (on top) */}
                    <g transform={`rotate(${todayRotation} ${CX} ${CY})`}>
                        {/* Shaft */}
                        <rect
                            x={CX - SHAFT_WIDTH / 2}
                            y={CY - NEEDLE_LENGTH + HEAD_LENGTH}
                            width={SHAFT_WIDTH}
                            height={NEEDLE_LENGTH - HEAD_LENGTH - 6}
                            fill={TODAY_NEEDLE_COLOR}
                            rx="1"
                        />
                        {/* Arrowhead */}
                        <polygon
                            points={`${CX},${CY - NEEDLE_LENGTH} ${CX - HEAD_WIDTH / 2},${CY - NEEDLE_LENGTH + HEAD_LENGTH} ${CX + HEAD_WIDTH / 2},${CY - NEEDLE_LENGTH + HEAD_LENGTH}`}
                            fill={TODAY_NEEDLE_COLOR}
                        />
                    </g>

                    {/* Center dot on top of both */}
                    <circle cx={CX} cy={CY} r="4" fill="white" />
                    <circle cx={CX} cy={CY} r="3" fill="#374151" />

                    {/* Dial edge labels */}
                    <text x="22" y={CY + 12} className="gauge-segment-label" fontSize="5.5" fill="#9ca3af" textAnchor="middle">
                        Needs
                    </text>
                    <text x="22" y={CY + 18} className="gauge-segment-label" fontSize="5.5" fill="#9ca3af" textAnchor="middle">
                        Improvement
                    </text>
                    <text x="178" y={CY + 15} className="gauge-segment-label" fontSize="5.5" fill="#15803d" textAnchor="middle">
                        Good
                    </text>
                </svg>
            </div>

            {/* Trend icon only (cluster label removed) */}
            <div className="gauge-score-display">
                {getTrendIcon()}
            </div>

            {/* Legend — always shows both arrows */}
            <div className="gauge-legend">
                <div className="gauge-legend-item">
                    <svg width="14" height="10" viewBox="0 0 14 10" className="gauge-legend-arrow">
                        <polygon points="7,0 2,5 5,5 5,10 9,10 9,5 12,5" fill={TODAY_NEEDLE_COLOR} />
                    </svg>
                    <span className="gauge-legend-text">Current</span>
                </div>
                <div className="gauge-legend-item">
                    <svg width="14" height="10" viewBox="0 0 14 10" className="gauge-legend-arrow">
                        <polygon points="7,0 2,5 5,5 5,10 9,10 9,5 12,5" fill={YESTERDAY_NEEDLE_COLOR} />
                    </svg>
                    <span className="gauge-legend-text">{hasYesterday ? 'Previous' : 'Previous (no data)'}</span>
                </div>
            </div>
        </div>
    )
}

// Helper: interpolate between two hex colors
function interpolateColor(c1: string, c2: string, factor: number): string {
    const hex = (c: string) => {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c)
        return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0]
    }
    const [r1, g1, b1] = hex(c1)
    const [r2, g2, b2] = hex(c2)
    const r = Math.round(r1 + (r2 - r1) * factor)
    const g = Math.round(g1 + (g2 - g1) * factor)
    const b = Math.round(b1 + (b2 - b1) * factor)
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

export default ScoreGauge
