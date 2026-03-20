import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DailyWizard from '../components/DailyWizard'
import AdminStudentViewer from '../components/AdminStudentViewer'
import AdminClusterDiagnosticsPanel from '../components/AdminClusterDiagnosticsPanel'
import AdminCsvLogPanel from '../components/AdminCsvLogPanel'
import AdminCsvMoodleIdPanel from '../components/AdminCsvMoodleIdPanel'
import AdminLlmConfigPanel from '../components/AdminLlmConfigPanel'
import AdminFlaggedMessagesPanel from '../components/AdminFlaggedMessagesPanel'
import AdminSupportRequestsPanel from '../components/AdminSupportRequestsPanel'
import AdminTabNav from '../components/AdminTabNav'
import ScoreBoard from '../components/ScoreBoard'
import { useReduxSelector, useReduxDispatch } from '../redux'
import { api } from '../api/client'
import { getScores } from '../api/scores'
import { getFeedbackStats } from '../api/flaggedMessages'
import { getAdminSupportRequests } from '../api/supportRequests'
import { getTodaySleep } from '../api/sleep'
import { getTodayScreenTime } from '../api/screenTime'
import { getTodaySRL } from '../api/results'
import './Home.css'

type AdminTabId = 'students' | 'moderation' | 'import' | 'system'

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
    const dispatch = useReduxDispatch()
    const isAdmin = user?.role === 'admin'
    const [showWizard, setShowWizard] = useState(false)
    const [dataRefreshKey, setDataRefreshKey] = useState(0)
    const [wizardChecked, setWizardChecked] = useState(false)

    // Concept scores state
    const [conceptScores, setConceptScores] = useState<ConceptScore[]>([])
    const [scoresLoading, setScoresLoading] = useState(false)

    // Admin student viewer state
    const [selectedStudentId, setSelectedStudentId] = useState<string>('')
    const [selectedStudentName, setSelectedStudentName] = useState<string>('')

    // Admin tab navigation state
    const [activeTab, setActiveTab] = useState<AdminTabId>('students')
    const [moderationBadge, setModerationBadge] = useState(0)

    // Clear all student data state
    const [clearConfirming, setClearConfirming] = useState(false)
    const [clearLoading, setClearLoading] = useState(false)

    // Submission state (only for non-admin students)
    const [missingSleepLog, setMissingSleepLog] = useState(false)
    const [missingScreenTime, setMissingScreenTime] = useState(false)
    const [missingSRLSurvey, setMissingSRLSurvey] = useState(false)

    // Fetch moderation badge counts (pending flags + open support requests)
    useEffect(() => {
        if (!isAdmin) return
        Promise.allSettled([
            getFeedbackStats(),
            getAdminSupportRequests(undefined, 1, 0),
        ]).then(([flagResult, supportResult]) => {
            let count = 0
            if (flagResult.status === 'fulfilled') count += flagResult.value.pending_flags || 0
            if (supportResult.status === 'fulfilled') count += supportResult.value.counts?.open || 0
            setModerationBadge(count)
        })
    }, [isAdmin])

    // When admin selects a student, load their scores
    useEffect(() => {
        if (isAdmin && selectedStudentId) {
            setScoresLoading(true)
            api.get<{ scores: ConceptScore[] }>(`/admin/students/${selectedStudentId}/scores`)
                .then(data => {
                    if (data.scores) setConceptScores(data.scores)
                    setScoresLoading(false)
                })
                .catch(() => setScoresLoading(false))
        } else if (isAdmin && !selectedStudentId) {
            setConceptScores([])
        }
    }, [isAdmin, selectedStudentId])

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
    }, [isAdmin, user, dataRefreshKey])

    // Check today's submission status and decide whether to show the wizard.
    // Uses allSettled so one failing call doesn't silently block the others.
    useEffect(() => {
        if (isAdmin || !user) { setWizardChecked(true); return }
        Promise.allSettled([
            getTodaySleep(),
            getTodayScreenTime(),
            getTodaySRL()
        ]).then(([sleepResult, screenResult, srlResult]) => {
            const hasSleep = sleepResult.status === 'fulfilled' && !!sleepResult.value
            const hasScreen = screenResult.status === 'fulfilled' && !!screenResult.value
            const hasSRL = srlResult.status === 'fulfilled' && srlResult.value === true

            setMissingSleepLog(!hasSleep)
            setMissingScreenTime(!hasScreen)
            setMissingSRLSurvey(!hasSRL)

            if (!hasSleep || !hasScreen || !hasSRL) {
                setShowWizard(true)
            }
            setWizardChecked(true)
        })
    }, [isAdmin, user, dataRefreshKey])

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

    // Show loading state while checking today's status
    if (!wizardChecked && !isAdmin) {
        return <div className='wizard-loading'>Loading...</div>
    }

    // Show wizard only when genuinely needed (incomplete daily tasks)
    if (showWizard && !isAdmin) {
        return <DailyWizard onComplete={() => { setShowWizard(false); setDataRefreshKey(k => k + 1) }} />
    }

    // For admin users, show tabbed admin panel
    if (isAdmin) {
        const adminTabs = [
            { id: 'students',   label: 'Students' },
            { id: 'moderation', label: 'Moderation', badge: moderationBadge },
            { id: 'import',     label: 'Data Import' },
            { id: 'system',     label: 'System' },
        ]

        return (
            <div className='mood-home-wrapper'>
                <div className='mood-home-container'>
                    <AdminTabNav
                        tabs={adminTabs}
                        activeTab={activeTab}
                        onTabChange={id => setActiveTab(id as AdminTabId)}
                    />

                    {/* ── Students Tab ── */}
                    {activeTab === 'students' && (
                        <div className='admin-tab-content'>
                            <AdminStudentViewer
                                selectedStudentId={selectedStudentId}
                                onStudentSelect={(id, name) => {
                                    setSelectedStudentId(id)
                                    setSelectedStudentName(name)
                                }}
                            />

                            {selectedStudentId && selectedStudentName && (
                                <>
                                    <div className='admin-viewing-banner'>
                                        Viewing dashboard for <strong>{selectedStudentName}</strong>
                                    </div>
                                    <ScoreBoard
                                        scores={conceptScores}
                                        loading={scoresLoading}
                                        title='Performance Scores'
                                        description='Click on a gauge to see a detailed breakdown'
                                        emptyMessage='No scores available for this student.'
                                        infoTooltip='Scores are calculated by comparing the student with peers who have similar behavioral patterns. The dial range (P5–P95) shows where most students in their group fall.'
                                        showConceptPlaceholders
                                    />
                                </>
                            )}
                        </div>
                    )}

                    {/* ── Moderation Tab ── */}
                    {activeTab === 'moderation' && (
                        <div className='admin-tab-content'>
                            <AdminFlaggedMessagesPanel />
                            <AdminSupportRequestsPanel />
                        </div>
                    )}

                    {/* ── Data Import Tab ── */}
                    {activeTab === 'import' && (
                        <div className='admin-tab-content'>
                            <AdminCsvLogPanel />
                            <AdminCsvMoodleIdPanel />
                        </div>
                    )}

                    {/* ── System Tab ── */}
                    {activeTab === 'system' && (
                        <div className='admin-tab-content'>
                            <AdminClusterDiagnosticsPanel />
                            <AdminLlmConfigPanel />

                            {/* Danger zone: clear all student data */}
                            <div className='mood-card' style={{ marginTop: '16px', borderColor: '#dc2626' }}>
                                <h2 className='mood-card-title' style={{ color: '#dc2626' }}>Danger Zone</h2>
                                <div className='mood-card-content'>
                                    {!clearConfirming ? (
                                        <button
                                            className='btn-danger'
                                            onClick={() => setClearConfirming(true)}
                                        >
                                            Clear All Student Data
                                        </button>
                                    ) : (
                                        <div className='clear-confirm-block'>
                                            <p className='clear-confirm-text'>
                                                Are you sure? This permanently deletes all sleep, screen time, course activity, and learning data for every student. This cannot be undone.
                                            </p>
                                            <div className='clear-confirm-actions'>
                                                <button
                                                    className='btn-danger'
                                                    disabled={clearLoading}
                                                    onClick={async () => {
                                                        setClearLoading(true)
                                                        try {
                                                            await api.delete('/admin/clear-student-data')
                                                            window.location.reload()
                                                        } catch {
                                                            setClearLoading(false)
                                                            setClearConfirming(false)
                                                        }
                                                    }}
                                                >
                                                    {clearLoading ? 'Clearing…' : 'Yes, delete everything'}
                                                </button>
                                                <button
                                                    className='btn-secondary'
                                                    disabled={clearLoading}
                                                    onClick={() => setClearConfirming(false)}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className='mood-home-wrapper'>
            <div className='mood-home-container'>
                {/* Score Gauges Section */}
                <ScoreBoard
                    scores={conceptScores}
                    loading={scoresLoading}
                    showConceptPlaceholders
                />

                {/* Data Source Progress + Quick Action Cards */}
                {(() => {
                    const completedCount = [!missingSleepLog, !missingScreenTime, !missingSRLSurvey].filter(Boolean).length
                    return (
                        <>
                            <div className='data-source-progress'>
                                You have completed {completedCount} out of 3 today
                            </div>
                            <div className='quick-actions-row'>
                                <Link
                                    to="/questionnaire"
                                    className={`quick-action-card ${!missingSRLSurvey ? 'quick-action-card--done' : 'quick-action-card--pending'}`}
                                >
                                        <span className='quick-action-icon'>📝</span>
                                        <div className='quick-action-text'>
                                            <div className='quick-action-title'>Learning Questionnaire</div>
                                            <div className='quick-action-desc'>Reflect on your study strategies</div>
                                        </div>
                                        <span className='quick-action-arrow'>{!missingSRLSurvey ? '✓' : '→'}</span>
                                </Link>
                                <Link
                                    to='/screen-time'
                                    className={`quick-action-card ${!missingScreenTime ? 'quick-action-card--done' : 'quick-action-card--pending'}`}
                                >
                                    <span className='quick-action-icon'>📱</span>
                                    <div className='quick-action-text'>
                                        <div className='quick-action-title'>Daily Screen Time</div>
                                        <div className='quick-action-desc'>Log your screen usage from yesterday</div>
                                    </div>
                                    <span className='quick-action-arrow'>{!missingScreenTime ? '✓' : '→'}</span>
                                </Link>
                                <Link
                                    to='/sleep'
                                    className={`quick-action-card ${!missingSleepLog ? 'quick-action-card--done' : 'quick-action-card--pending'}`}
                                >
                                    <span className='quick-action-icon'>🌙</span>
                                    <div className='quick-action-text'>
                                        <div className='quick-action-title'>Sleep Log</div>
                                        <div className='quick-action-desc'>Track when you slept last night</div>
                                    </div>
                                    <span className='quick-action-arrow'>{!missingSleepLog ? '✓' : '→'}</span>
                                </Link>
                            </div>
                        </>
                    )
                })()}
            </div>
        </div>
    )
}

export default Home
