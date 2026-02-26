import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Surveys from '../components/Surveys'
import SleepSlider from '../components/SleepSlider'
import AdminStudentViewer from '../components/AdminStudentViewer'
import ScoreBoard from '../components/ScoreBoard'
import { useReduxSelector, useReduxDispatch } from '../redux'
import { load } from '../redux/surveys'
import { loadAnnotations, Annotation } from '../redux/results'
import { INVERTED_CONCEPTS } from '../constants/concepts'
import { getScores } from '../api/scores'
import { getTodaySleep } from '../api/sleep'
import { getTodayScreenTime } from '../api/screenTime'
import './Home.css'

interface ConceptScore {
    conceptId: string
    conceptName: string
    score: number | null
    trend: string | null
    avg7d: number | null
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
}

interface StudentInfo { id: string; name: string; email: string }

const Home = () => {
    const user = useReduxSelector(state => state.auth.user)
    const surveys = useReduxSelector(state => state.surveys.surveys)
    const surveysStatus = useReduxSelector(state => state.surveys.status)
    const dispatch = useReduxDispatch()
    const navigate = useNavigate()
    const isAdmin = user?.role === 'admin'
    const title = isAdmin ? 'My Surveys' : 'Available Surveys'

    const [annotations7d, setAnnotations7d] = useState<Annotation[]>([])
    const [loading, setLoading] = useState(false)
    const [hasSufficientData7d, setHasSufficientData7d] = useState(false)

    // Concept scores state
    const [conceptScores, setConceptScores] = useState<ConceptScore[]>([])
    const [scoresLoading, setScoresLoading] = useState(false)

    // Admin student viewer state
    const [selectedStudentId, setSelectedStudentId] = useState<string>('')
    const [selectedStudentName, setSelectedStudentName] = useState<string>('')

    // Submission reminder state (only for non-admin students)
    const [missingSleepLog, setMissingSleepLog] = useState(false)
    const [missingScreenTime, setMissingScreenTime] = useState(false)
    const [reminderDismissed, setReminderDismissed] = useState(false)

    // Load surveys if not already loaded
    useEffect(() => {
        if (surveysStatus === 'idle' && surveys.length === 0) {
            dispatch(load())
        }
    }, [surveysStatus, dispatch, surveys.length])

    // When admin selects a student, load their scores + annotations
    useEffect(() => {
        if (isAdmin && selectedStudentId) {
            // Load scores
            setScoresLoading(true)
            fetch(`/api/admin/students/${selectedStudentId}/scores`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.scores) setConceptScores(data.scores)
                    setScoresLoading(false)
                })
                .catch(() => setScoresLoading(false))

            // Load annotations
            setLoading(true)
            fetch(`/api/admin/students/${selectedStudentId}/annotations`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    const allAnnotations = data.annotations || []
                    const week = allAnnotations.filter((a: any) => a.timeWindow === '7d')
                    setAnnotations7d(week)
                    setHasSufficientData7d(week.some((a: any) => a.hasSufficientData))
                    setLoading(false)
                })
                .catch(() => setLoading(false))
        } else if (isAdmin && !selectedStudentId) {
            // Clear data when no student selected
            setConceptScores([])
            setAnnotations7d([])
        }
    }, [isAdmin, selectedStudentId])

    // Load annotations for students
    useEffect(() => {
        if (!isAdmin && user) {
            setLoading(true)

            dispatch(loadAnnotations())
                .then((result: any) => {
                    if (result.type === 'results/loadAnnotations/fulfilled') {
                        const allAnnotations = result.payload.annotations || []

                        // Split by time window
                        const week = allAnnotations.filter((a: Annotation) => a.timeWindow === '7d')

                        setAnnotations7d(week)

                        // Check if any annotation has sufficient data
                        setHasSufficientData7d(week.some((a: Annotation) => a.hasSufficientData))
                    }
                    setLoading(false)
                })
                .catch(() => {
                    setLoading(false)
                })
        }
    }, [isAdmin, user, dispatch])

    // Load concept scores for students
    useEffect(() => {
        if (!isAdmin && user) {
            setScoresLoading(true)
            getScores()
                .then(scores => {
                    setConceptScores(scores)
                    setScoresLoading(false)

                    // If no scores yet (e.g. server still warming up), retry once after 5s
                    if (!scores || scores.length === 0) {
                        setTimeout(() => getScores().then(d => setConceptScores(d)), 5000)
                    }
                })
                .catch(() => {
                    setScoresLoading(false)
                })
        }
    }, [isAdmin, user])

    // Check whether today's sleep log and screen time have been submitted (students only)
    useEffect(() => {
        if (isAdmin || !user) return
        Promise.all([
            getTodaySleep(),
            getTodayScreenTime()
        ]).then(([sleepEntry, screenEntry]) => {
            setMissingSleepLog(!sleepEntry)
            setMissingScreenTime(!screenEntry)
        }).catch(() => { /* ignore network errors silently */ })
    }, [isAdmin, user])

    // Add class to parent main element for mood layout
    useEffect(() => {
        const mainElement = document.querySelector('.sjs-app__content')
        if (mainElement) {
            mainElement.classList.add('mood-content-override')
        }
        return () => {
            if (mainElement) {
                mainElement.classList.remove('mood-content-override')
            }
        }
    }, [isAdmin])

    // Category colors (all green shades)
    const CATEGORY_COLORS: Record<string, string> = {
        requires_improvement: '#86efac',
        good: '#22c55e',
        very_good: '#15803d'
    }

    // Helper function to convert hex to RGB
    const hexToRgb = (hex: string): [number, number, number] => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        return result
            ? [
                parseInt(result[1], 16),
                parseInt(result[2], 16),
                parseInt(result[3], 16)
            ]
            : [0, 0, 0]
    }

    // Helper function to convert RGB to hex
    const rgbToHex = (r: number, g: number, b: number): string => {
        return '#' + [r, g, b].map(x => {
            const hex = Math.round(x).toString(16)
            return hex.length === 1 ? '0' + hex : hex
        }).join('')
    }

    // Interpolate between two colors
    const interpolateColor = (color1: string, color2: string, factor: number): string => {
        const rgb1 = hexToRgb(color1)
        const rgb2 = hexToRgb(color2)
        const r = rgb1[0] + (rgb2[0] - rgb1[0]) * factor
        const g = rgb1[1] + (rgb2[1] - rgb1[1]) * factor
        const b = rgb1[2] + (rgb2[2] - rgb1[2]) * factor
        return rgbToHex(r, g, b)
    }

    const getConstructColor = (average: number | null, isInverted: boolean = false): string => {
        if (average === null || average === 0) {
            return '#F9FAFB' // Default background when no data
        }

        const lowColor = '#fdaeae'   // Red
        const midColor = '#FFFF99'   // Yellow
        const highColor = '#99FF99'  // Green
        const midpoint = 3

        // Assume rating scale is 1-5 (adjust if needed)
        const minValue = 1
        const maxValue = 5

        // Clamp average to valid range
        const clampedAverage = Math.max(minValue, Math.min(maxValue, average))

        // For inverted concepts (like anxiety), flip the color scale
        if (isInverted) {
            // High score = red (bad), Low score = green (good)
            if (clampedAverage <= midpoint) {
                const factor = (clampedAverage - minValue) / (midpoint - minValue)
                return interpolateColor(highColor, midColor, factor)  // green to yellow
            } else {
                const factor = (clampedAverage - midpoint) / (maxValue - midpoint)
                return interpolateColor(midColor, lowColor, factor)   // yellow to red
            }
        }

        // Normal: Low score = red, High score = green
        if (clampedAverage <= midpoint) {
            const factor = (clampedAverage - minValue) / (midpoint - minValue)
            return interpolateColor(lowColor, midColor, factor)
        } else {
            const factor = (clampedAverage - midpoint) / (maxValue - midpoint)
            return interpolateColor(midColor, highColor, factor)
        }
    }

    // Format construct name: remove underscores, capitalize first letter
    const formatConstructName = (name: string) => {
        return name
            .replace(/_/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ')
    }

    const renderAnnotations = (annotations: Annotation[]) => {
        if (annotations.length === 0) {
            return <div className='mood-no-data'>No survey responses yet</div>
        }

        // Filter out annotations with no data
        const annotationsWithData = annotations.filter(a =>
            a.avgScore > 0 || a.minScore > 0 || a.maxScore > 0
        )

        if (annotationsWithData.length === 0) {
            return <div className='mood-no-data'>No survey responses yet</div>
        }

        return (
            <div className='mood-constructs-grid'>
                {annotations.map((annotation) => {
                    const isInverted = annotation.isInverted || INVERTED_CONCEPTS.includes(annotation.conceptKey)
                    const backgroundColor = getConstructColor(annotation.avgScore, isInverted)
                    const formattedName = formatConstructName(annotation.conceptKey)
                    return (
                        <div
                            key={annotation.conceptKey}
                            className='mood-construct-item'
                            style={{ backgroundColor }}
                        >
                            <div className='mood-construct-name'>{formattedName}</div>
                            <div className='mood-construct-stats'>
                                <div className='mood-stat'>
                                    <span className='mood-stat-label'>Avg:</span>
                                    <span className='mood-stat-value'>{annotation.avgScore > 0 ? annotation.avgScore.toFixed(1) : 'N/A'}</span>
                                </div>
                                <div className='mood-stat'>
                                    <span className='mood-stat-label'>Min:</span>
                                    <span className='mood-stat-value'>{annotation.minScore > 0 ? annotation.minScore : 'N/A'}</span>
                                </div>
                                <div className='mood-stat'>
                                    <span className='mood-stat-label'>Max:</span>
                                    <span className='mood-stat-value'>{annotation.maxScore > 0 ? annotation.maxScore : 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    }

    // For admin users, show student selector + student dashboard
    if (isAdmin) {
        return (
            <div className='mood-home-wrapper'>
                <div className='mood-home-container'>
                    {/* Student Selector Card */}
                    <AdminStudentViewer
                        selectedStudentId={selectedStudentId}
                        onStudentSelect={(id, name) => {
                            setSelectedStudentId(id)
                            setSelectedStudentName(name)
                        }}
                    />

                    {/* Student dashboard – shown when a student is selected */}
                    {selectedStudentId && selectedStudentName && (
                        <>
                            <div className='admin-viewing-banner'>
                                Viewing dashboard for <strong>{selectedStudentName}</strong>
                            </div>

                            {/* Score Gauges Section */}
                            <ScoreBoard
                                scores={conceptScores}
                                loading={scoresLoading}
                                title='Performance Scores'
                                description='Click on a gauge to see a detailed breakdown'
                                emptyMessage='No scores available for this student.'
                                infoTooltip='Scores are calculated by comparing the student with peers who have similar behavioral patterns. The dial range (P5–P95) shows where most students in their group fall.'
                            />

                            {/* Mood Cards – 7-day annotations */}
                            <div className='mood-cards-container'>
                                <div className='mood-card'>
                                    <h2 className='mood-card-title'>Mood over the last 7 days</h2>
                                    <p className='mood-card-description'>
                                        Mood statistics for {selectedStudentName}
                                    </p>
                                    <div className='mood-card-content'>
                                        {loading ? (
                                            <div className='mood-loading'>Loading...</div>
                                        ) : (
                                            renderAnnotations(annotations7d)
                                        )}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Surveys list (always visible for admin) */}
                    <div className='mood-card' style={{ marginTop: '24px' }}>
                        <h2 className='mood-card-title'>{title}</h2>
                        <div className='mood-card-content'>
                            <Surveys />
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // Calculate total responses for display
    const totalResponses7d = annotations7d.length > 0 ? annotations7d[0].responseCount : 0
    // Get distinct day count for 7-day period
    const distinctDayCount7d = annotations7d.length > 0 ? annotations7d[0].distinctDayCount : 0

    // Build description for 7-day card
    const get7dDescription = () => {
        if (totalResponses7d === 0) {
            return 'Your mood statistics over the past week'
        }
        let desc = `Your mood statistics over the past week, based on ${totalResponses7d} ${totalResponses7d === 1 ? 'response' : 'responses'}`
        if (distinctDayCount7d && distinctDayCount7d > 0) {
            desc += `, from ${distinctDayCount7d} ${distinctDayCount7d === 1 ? 'day' : 'days'}`
        }
        return desc
    }

    // Get first survey for "Fill Survey" button
    const firstSurvey = surveys.length > 0 ? surveys[0] : null

    const handleCardClick = (period: '7days') => {
        if (firstSurvey) {
            navigate(`/mood-history/${firstSurvey.id}?period=${period}`)
        }
    }

    return (
        <div className='mood-home-wrapper'>
            <div className='mood-home-container'>
                {/* Submission reminder banner — top of page */}
                {!reminderDismissed && (missingSleepLog || missingScreenTime) && (
                    <div className='reminder-banner'>
                        <div className='reminder-content'>
                            <span className='reminder-icon'>⚠</span>
                            <span className='reminder-text'>You haven't logged today yet:</span>
                            {missingSleepLog && (
                                <button
                                    className='reminder-link'
                                    onClick={() => document.getElementById('sleep-log-section')?.scrollIntoView({ behavior: 'smooth' })}
                                >Sleep log →</button>
                            )}
                            {missingScreenTime && (
                                <Link to="/screen-time" className='reminder-link'>Screen time →</Link>
                            )}
                        </div>
                        <button
                            className='reminder-dismiss'
                            onClick={() => setReminderDismissed(true)}
                            aria-label='Dismiss reminder'
                        >✕</button>
                    </div>
                )}

                {/* Score Gauges Section */}
                <ScoreBoard
                    scores={conceptScores}
                    loading={scoresLoading}
                />

                {/* Quick Action Cards */}
                <div className='quick-actions-row'>
                    {firstSurvey && (
                        <Link to={`/run/${firstSurvey.id}`} className='quick-action-card'>
                            <span className='quick-action-icon'>📝</span>
                            <div className='quick-action-text'>
                                <div className='quick-action-title'>Self-Regulated Learning Survey</div>
                                <div className='quick-action-desc'>Reflect on your study strategies</div>
                            </div>
                            <span className='quick-action-arrow'>→</span>
                        </Link>
                    )}
                    <Link to="/screen-time" className='quick-action-card'>
                        <span className='quick-action-icon'>📱</span>
                        <div className='quick-action-text'>
                            <div className='quick-action-title'>Daily Screen Time</div>
                            <div className='quick-action-desc'>Log your screen usage from yesterday</div>
                        </div>
                        <span className='quick-action-arrow'>→</span>
                    </Link>
                </div>

                {/* Sleep Log */}
                <div id='sleep-log-section'>
                    <SleepSlider onSaved={() => setMissingSleepLog(false)} />
                </div>

                <div className='mood-cards-container'>
                    <div
                        className='mood-card mood-card-clickable'
                        onClick={() => handleCardClick('7days')}
                    >
                        <h2 className='mood-card-title'>Mood over the last 7 days</h2>
                        <p className='mood-card-description'>
                            {get7dDescription()}
                        </p>
                        <div className='mood-card-content'>
                            {loading ? (
                                <div className='mood-loading'>Loading...</div>
                            ) : (
                                renderAnnotations(annotations7d)
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Home
