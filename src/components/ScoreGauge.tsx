import React from 'react'
import './ScoreGauge.css'

interface ScoreGaugeProps {
    score: number          // numericScore from categories: 25, 50, or 85
    label: string          // Concept name
    trend?: string         // 'improving', 'declining', 'stable'
    size?: 'small' | 'medium' | 'large'
    category?: string      // 'requires_improvement', 'good', 'very_good'
    categoryLabel?: string // Human-readable: 'Could Improve', 'Good', 'Very Good'
    peerAverageScore?: number | null  // Peer average score (0-100)
}

// Category definitions with green shades
const CATEGORIES = [
    { key: 'requires_improvement', label: 'Could Improve', color: '#86efac', startAngle: 180, endAngle: 120 },
    { key: 'good', label: 'Good', color: '#22c55e', startAngle: 120, endAngle: 60 },
    { key: 'very_good', label: 'Very Good', color: '#15803d', startAngle: 60, endAngle: 0 }
]

// Map numeric score to category
const scoreToCategory = (score: number) => {
    if (score >= 70) return 'very_good'
    if (score >= 40) return 'good'
    return 'requires_improvement'
}

const getCategoryInfo = (cat: string) => {
    return CATEGORIES.find(c => c.key === cat) || CATEGORIES[1]
}

/**
 * ScoreGauge - A 3-segment green-only semicircular gauge
 * Shows peer-comparison categories: Could Improve, Good, Very Good
 * Supports dual needles: student (dark) and peer average (blue-gray)
 */
const ScoreGauge: React.FC<ScoreGaugeProps> = ({
    score,
    label,
    trend = 'stable',
    size = 'medium',
    category,
    categoryLabel,
    peerAverageScore
}) => {
    // Determine category from props or score
    const resolvedCategory = category || scoreToCategory(score)
    const catInfo = getCategoryInfo(resolvedCategory)
    const displayLabel = categoryLabel || catInfo.label

    // Calculate needle rotation: -90° (left) to 90° (right)
    // Map score to rotation: 25 → left section, 50 → middle, 85 → right section
    const clampedScore = Math.max(0, Math.min(100, score))
    const needleRotation = (clampedScore / 100) * 180 - 90

    // Peer average needle rotation
    const hasPeerAverage = peerAverageScore != null && peerAverageScore >= 0
    const clampedPeerScore = hasPeerAverage ? Math.max(0, Math.min(100, peerAverageScore!)) : 0
    const peerNeedleRotation = (clampedPeerScore / 100) * 180 - 90

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

    const createSegment = (startAngle: number, endAngle: number, color: string, isActive: boolean) => {
        const start = pol2cart(CX, CY, R, startAngle)
        const end = pol2cart(CX, CY, R, endAngle)
        const d = `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`
        return (
            <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={STROKE}
                opacity={isActive ? 1 : 0.3}
                key={`${startAngle}-${endAngle}`}
            />
        )
    }

    // Labels outside the arc
    const LabelRadius = R + 18
    const createArcLabel = (angle: number, text: string, isActive: boolean) => {
        const pos = pol2cart(CX, CY, LabelRadius, angle)
        return (
            <text
                x={pos.x}
                y={pos.y}
                className="gauge-segment-label"
                fontSize="7"
                fill={isActive ? '#15803d' : '#9ca3af'}
                fontWeight={isActive ? 700 : 500}
                textAnchor="middle"
                dominantBaseline="middle"
                key={text}
            >
                {text}
            </text>
        )
    }

    // Needle colors
    const STUDENT_NEEDLE_COLOR = '#1f2937'
    const PEER_NEEDLE_COLOR = '#6b7280'

    return (
        <div className={`score-gauge score-gauge-${size}`}>
            <div className="gauge-label">{label}</div>

            <div className="gauge-container">
                <svg viewBox="0 0 200 120" className="gauge-svg">
                    {/* 3 green segments */}
                    {CATEGORIES.map(seg =>
                        createSegment(seg.startAngle, seg.endAngle, seg.color, seg.key === resolvedCategory)
                    )}

                    {/* Peer average needle (rendered first so it's behind student needle) */}
                    {hasPeerAverage && (
                        <g transform={`rotate(${peerNeedleRotation} ${CX} ${CY})`}>
                            <polygon
                                points={`${CX},${CY - R + 10} ${CX - 3},${CY} ${CX + 3},${CY}`}
                                fill={PEER_NEEDLE_COLOR}
                                opacity={0.7}
                            />
                        </g>
                    )}

                    {/* Center point */}
                    <circle cx={CX} cy={CY} r="6" fill="#374151" />

                    {/* Student needle (on top) */}
                    <g transform={`rotate(${needleRotation} ${CX} ${CY})`}>
                        <polygon
                            points={`${CX},${CY - R + 5} ${CX - 4},${CY} ${CX + 4},${CY}`}
                            fill={STUDENT_NEEDLE_COLOR}
                        />
                    </g>

                    {/* Peer average center dot */}
                    {hasPeerAverage && (
                        <circle cx={CX} cy={CY} r="3.5" fill={PEER_NEEDLE_COLOR} opacity={0.7} />
                    )}

                    {/* Labels */}
                    {createArcLabel(150, 'Needs Work', resolvedCategory === 'requires_improvement')}
                    {createArcLabel(90, 'Good', resolvedCategory === 'good')}
                    {createArcLabel(30, 'Very Good', resolvedCategory === 'very_good')}
                </svg>
            </div>

            {/* Category label display (no numeric score) */}
            <div className="gauge-score-display">
                <span
                    className="gauge-category-label"
                    style={{ color: catInfo.color }}
                >
                    {displayLabel}
                </span>
                {getTrendIcon()}
            </div>

            {/* Legend for dual needles */}
            {hasPeerAverage && (
                <div className="gauge-legend">
                    <div className="gauge-legend-item">
                        <span className="gauge-legend-dot" style={{ backgroundColor: STUDENT_NEEDLE_COLOR }}></span>
                        <span className="gauge-legend-text">You</span>
                    </div>
                    <div className="gauge-legend-item">
                        <span className="gauge-legend-dot" style={{ backgroundColor: PEER_NEEDLE_COLOR }}></span>
                        <span className="gauge-legend-text">Peer Average</span>
                    </div>
                </div>
            )}
        </div>
    )
}

export default ScoreGauge
