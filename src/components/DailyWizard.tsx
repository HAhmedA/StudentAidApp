import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { load as loadSurveys } from '../redux/surveys'
import { post as postResults } from '../redux/results'
import { logout } from '../redux/auth'
import { api } from '../api/client'
import { saveScreenTime, getTodayScreenTime } from '../api/screenTime'
import { saveSleep, getTodaySleep } from '../api/sleep'
import { getTodaySRL } from '../api/results'
import SleepSlider from './SleepSlider'
import QuestionnaireSliders, { allAnswered, highlightMissing } from './QuestionnaireSliders'
import '../pages/ScreenTimeForm.css'
import './DailyWizard.css'

// ── API helpers ──────────────────────────────────────────────
const getConsentStatus = async () => {
    const res = await api.get<{ consentGiven: boolean }>('/consent')
    return res.consentGiven === true
}
const giveConsent = async () => {
    await api.post('/consent', { consentGiven: true })
}
const getProfile = async () => {
    try {
        return await api.get<{ onboarding_completed?: boolean }>('/profile')
    } catch {
        return null
    }
}
const completeOnboarding = async () => {
    try { await api.post('/profile/onboarding-complete', {}) } catch { /* silent */ }
}

// ── WHO-5 questions (0–10 slider) ────────────────────────────
const WHO5_QUESTIONS = [
    { key: 'cheerfulness', text: 'I have felt cheerful and in good spirits.' },
    { key: 'calmness', text: 'I have felt calm and relaxed.' },
    { key: 'vitality', text: 'I have felt active and vigorous.' },
    { key: 'restedness', text: 'I woke up feeling fresh and rested.' },
    { key: 'interest', text: 'My daily life has been filled with things that interest me.' },
]

// ── SRL learning questions (1–5 slider) ──────────────────────
const SRL_QUESTIONS = [
    { key: 'efficiency', text: 'I believe I can accomplish my learning duties and learning tasks efficiently.', lowLabel: 'Strongly disagree', highLabel: 'Strongly agree' },
    { key: 'importance', text: 'I believe that my learning tasks are very important to me.', lowLabel: 'Not important', highLabel: 'Very important' },
    { key: 'tracking', text: 'I keep track of what I need to do and understand what I must do to accomplish my learning tasks.', lowLabel: 'Never', highLabel: 'Always' },
    { key: 'effort', text: 'I put enough effort into my learning tasks and stay focused while working on them.', lowLabel: 'Not enough effort', highLabel: 'A lot of effort' },
    { key: 'help_seeking', text: 'I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks.', lowLabel: 'Never seek help', highLabel: 'Always seek help' },
    { key: 'community', text: 'I am having nice interactions and feeling at home within the college community.', lowLabel: 'Not at all', highLabel: 'Very much' },
    { key: 'timeliness', text: 'I am doing my studies on time and keeping up with tasks/deadlines.', lowLabel: 'Always late', highLabel: 'Always on time' },
    { key: 'motivation', text: 'I feel motivated to learn and enjoy working on my learning tasks.', lowLabel: 'Not motivated', highLabel: 'Highly motivated' },
    { key: 'anxiety', text: 'I feel anxious or stressed working on learning tasks, assignments, or in class.', lowLabel: 'Never anxious', highLabel: 'Very anxious' },
    { key: 'reflection', text: 'I reflect on my performance and learn from feedback or mistakes to improve my learning.', lowLabel: 'Never reflect', highLabel: 'Always reflect' },
]

// ── Screen time options ──────────────────────────────────────
const VOLUME_OPTIONS = [
    { label: '0h', value: 0 },
    { label: '1h', value: 60 },
    { label: '2h', value: 120 },
    { label: '3h', value: 180 },
    { label: '4h', value: 240 },
    { label: '5h', value: 300 },
    { label: '6h', value: 360 },
    { label: '7h', value: 420 },
    { label: '8h', value: 480 },
    { label: '9h', value: 540 },
    { label: '10h+', value: 600 },
]

const LONGEST_SESSION_OPTIONS = [
    { label: 'None', value: 0 },
    { label: '< 15 min', value: 10 },
    { label: '15–30 min', value: 22 },
    { label: '30–60 min', value: 45 },
    { label: '1–2 hours', value: 90 },
    { label: '2–3 hours', value: 150 },
    { label: '3+ hours', value: 210 },
]

const PRE_SLEEP_OPTIONS = [
    { label: 'None', value: 0 },
    { label: '< 15 min', value: 10 },
    { label: '15–30 min', value: 22 },
    { label: '30–60 min', value: 45 },
    { label: '1+ hour', value: 75 },
]

// ── Types ────────────────────────────────────────────────────
type WizardStep = 'consent' | 'intro' | 'wellbeing' | 'learning' | 'screen_time' | 'sleep' | 'done'

interface StepConfig {
    key: WizardStep
    label: string
}

// ── Main Wizard ──────────────────────────────────────────────
export default function DailyWizard({ onComplete }: { onComplete: () => void }) {
    const navigate = useNavigate()
    const dispatch = useReduxDispatch()
    const surveys = useReduxSelector(s => s.surveys.surveys)
    const onCompleteRef = useRef(onComplete)
    onCompleteRef.current = onComplete

    const [loading, setLoading] = useState(true)
    const [steps, setSteps] = useState<StepConfig[]>([])
    const [currentStepIdx, setCurrentStepIdx] = useState(0)
    const [consentAgreed, setConsentAgreed] = useState(false)
    const [isFirstTime, setIsFirstTime] = useState(false)

    // Shared questionnaire answers between wellbeing + learning steps
    const [questionnaireAnswers, setQuestionnaireAnswers] = useState<Record<string, number>>({})

    const setAnswer = useCallback((key: string, value: number) => {
        setQuestionnaireAnswers(prev => ({ ...prev, [key]: value }))
    }, [])

    // Add body class to hide navbar and chatbot
    useEffect(() => {
        document.body.classList.add('wizard-active')
        return () => { document.body.classList.remove('wizard-active') }
    }, [])

    // Determine which steps are needed
    useEffect(() => {
        let cancelled = false
        async function init() {
            try {
                const [hasConsent, hasSRL, hasScreenTime, hasSleep, profile] = await Promise.all([
                    getConsentStatus(),
                    getTodaySRL(),
                    getTodayScreenTime().then(e => !!e),
                    getTodaySleep().then(e => !!e),
                    getProfile()
                ])

                if (cancelled) return

                const firstTime = !hasConsent
                setIsFirstTime(firstTime)

                const neededSteps: StepConfig[] = []

                if (!hasConsent) {
                    neededSteps.push({ key: 'consent', label: 'Consent' })
                    neededSteps.push({ key: 'intro', label: 'Introduction' })
                }

                if (!hasSRL) {
                    neededSteps.push({ key: 'wellbeing', label: 'Wellbeing' })
                    neededSteps.push({ key: 'learning', label: 'Learning' })
                }
                if (!hasScreenTime) neededSteps.push({ key: 'screen_time', label: 'Screen Time' })
                if (!hasSleep) neededSteps.push({ key: 'sleep', label: 'Sleep Log' })

                if (neededSteps.length === 0) {
                    onCompleteRef.current()
                    return
                }

                setSteps(neededSteps)
                setLoading(false)

                if (!surveys || surveys.length === 0) {
                    dispatch(loadSurveys())
                }
            } catch {
                onCompleteRef.current()
            }
        }
        init()
        return () => { cancelled = true }
    }, [dispatch, surveys])

    const currentStep = steps[currentStepIdx]

    // Weighted progress — heavier steps move the bar more
    const STEP_WEIGHT: Record<WizardStep, number> = {
        consent: 1, intro: 1, wellbeing: 2, learning: 3,
        screen_time: 1, sleep: 1, done: 0,
    }
    const totalWeight = steps.reduce((sum, s) => sum + STEP_WEIGHT[s.key], 0)
    const completedWeight = steps.slice(0, currentStepIdx + 1).reduce((sum, s) => sum + STEP_WEIGHT[s.key], 0)
    const progressPercent = Math.round((completedWeight / totalWeight) * 100)

    const goNext = useCallback(async () => {
        if (currentStepIdx < steps.length - 1) {
            setCurrentStepIdx(prev => prev + 1)
        } else {
            if (isFirstTime) {
                await completeOnboarding()
            }
            const hadDataSteps = steps.some(s =>
                ['wellbeing', 'learning', 'screen_time', 'sleep'].includes(s.key)
            )
            if (hadDataSteps) {
                window.dispatchEvent(new CustomEvent('chatbot:wizardComplete'))
            }
            onComplete()
        }
    }, [currentStepIdx, steps.length, isFirstTime, onComplete])

    const handleLogout = useCallback(() => {
        dispatch(logout())
    }, [dispatch])

    if (loading) {
        return <div className='wizard-loading'>Loading...</div>
    }

    if (!currentStep) {
        onComplete()
        return null
    }

    return (
        <div className='wizard-overlay'>
            <div className='wizard-container'>
                <div className='wizard-progress-bar'>
                    <div className='wizard-progress-fill' style={{ width: `${progressPercent}%` }} />
                </div>
                <div className='wizard-progress-text'>Step {currentStepIdx + 1} of {steps.length} · {progressPercent}%</div>

                <div className='wizard-content'>
                    {currentStep.key === 'consent' && (
                        <ConsentStep
                            agreed={consentAgreed}
                            onToggle={() => setConsentAgreed(prev => !prev)}
                            onAccept={async () => {
                                await giveConsent()
                                goNext()
                            }}
                        />
                    )}
                    {currentStep.key === 'intro' && (
                        <IntroStep onContinue={goNext} />
                    )}
                    {currentStep.key === 'wellbeing' && (
                        <WellbeingStep
                            answers={questionnaireAnswers}
                            setAnswer={setAnswer}
                            onComplete={goNext}
                        />
                    )}
                    {currentStep.key === 'learning' && (
                        <LearningStep
                            answers={questionnaireAnswers}
                            setAnswer={setAnswer}
                            surveyId={surveys?.[0]?.id}
                            onComplete={goNext}
                        />
                    )}
                    {currentStep.key === 'screen_time' && (
                        <ScreenTimeStep onComplete={goNext} />
                    )}
                    {currentStep.key === 'sleep' && (
                        <SleepStep onComplete={goNext} />
                    )}
                </div>

                <button className='wizard-logout-btn' onClick={handleLogout}>
                    Log out
                </button>
            </div>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════

// ── Consent Step ─────────────────────────────────────────────
function ConsentStep({ agreed, onToggle, onAccept }: {
    agreed: boolean; onToggle: () => void; onAccept: () => void
}) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [scrolledToBottom, setScrolledToBottom] = useState(false)

    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        if (el.scrollHeight <= el.clientHeight) {
            setScrolledToBottom(true)
        }
    }, [])

    const handleScroll = () => {
        const el = scrollRef.current
        if (!el) return
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) {
            setScrolledToBottom(true)
        }
    }

    return (
        <div className='wizard-step-consent'>
            <h2>Before We Begin</h2>
            <div className={`consent-text-wrapper ${scrolledToBottom ? '' : 'has-more'}`}>
            <div className='consent-text' ref={scrollRef} onScroll={handleScroll}>
                <h3>What data is collected</h3>
                <ul>
                    <li>Daily questionnaire responses about your learning strategies and wellbeing</li>
                    <li>Sleep log entries (bedtime, wake time, awakenings)</li>
                    <li>Screen time usage (total, longest session, pre-sleep)</li>
                    <li>LMS activity data (quiz attempts, assignment submissions, forum posts)</li>
                </ul>
                <h3>How your data is used</h3>
                <ul>
                    <li>To provide you with AI-powered personalised learning insights</li>
                    <li>To compare your patterns with anonymised peer groups</li>
                    <li>To help you reflect on and improve your study habits</li>
                </ul>
                <h3>Data protection</h3>
                <ul>
                    <li>Your data is anonymised — individual responses are never shared with identifiable information</li>
                    <li>During analysis, all data is fully anonymised — your identity is separated from responses before any research or reporting takes place</li>
                    <li>Your data will not be used for any unlawful activities</li>
                    <li>Only you and your assigned facilitator can view your individual data</li>
                    <li>Peer comparisons use anonymised, aggregated data only</li>
                </ul>
                <h3>Your rights</h3>
                <ul>
                    <li>Participation is entirely voluntary — you can withdraw at any time</li>
                    <li><strong>Your participation will NOT affect your grades in any way</strong></li>
                    <li>There will be no harm to you as a result of participating in this study</li>
                    <li>You can revoke consent at any time from your Profile page</li>
                    <li>Revoking consent permanently deletes all your collected data</li>
                </ul>
            </div>
            </div>
            <label className='consent-checkbox'>
                <input type='checkbox' checked={agreed} onChange={onToggle} />
                <span>I understand and agree to the data collection described above</span>
            </label>
            <button className='wizard-primary-btn' disabled={!agreed} onClick={onAccept}>
                Continue
            </button>
        </div>
    )
}

// ── Intro Step ───────────────────────────────────────────────
function IntroStep({ onContinue }: { onContinue: () => void }) {
    return (
        <div className='wizard-step-intro'>
            <h2>Welcome to Your Learning Dashboard</h2>
            <p>This system helps you understand and improve your learning habits by tracking three key areas:</p>
            <div className='intro-areas'>
                <div className='intro-area'>
                    <span className='intro-area-icon'>📝</span>
                    <div>
                        <strong>Learning Strategies & Wellbeing</strong>
                        <p>Daily reflections on how you study and how you feel</p>
                    </div>
                </div>
                <div className='intro-area'>
                    <span className='intro-area-icon'>📱</span>
                    <div>
                        <strong>Screen Time</strong>
                        <p>Track your daily screen usage patterns</p>
                    </div>
                </div>
                <div className='intro-area'>
                    <span className='intro-area-icon'>🌙</span>
                    <div>
                        <strong>Sleep</strong>
                        <p>Log your sleep to understand its impact on learning</p>
                    </div>
                </div>
            </div>
            <p className='intro-note'>Your AI assistant uses this data to give you personalised insights. Everything is private — only you and your facilitator can see your data.</p>
            <button className='wizard-primary-btn' onClick={onContinue}>Let's Get Started</button>
        </div>
    )
}

// ── Wellbeing Step (sliders 0–10) ────────────────────────────
function WellbeingStep({ answers, setAnswer, onComplete }: {
    answers: Record<string, number>
    setAnswer: (key: string, value: number) => void
    onComplete: () => void
}) {
    const complete = allAnswered(WHO5_QUESTIONS, answers)
    const [showMissing, setShowMissing] = useState(false)

    const handleAttemptSubmit = () => {
        if (complete) { onComplete(); return }
        setShowMissing(true)
        highlightMissing()
        setTimeout(() => setShowMissing(false), 3000)
    }

    return (
        <div className='wq-section'>
            <h2>How are you feeling today?</h2>
            <p className='wq-section-desc'>Rate how you have felt over the past day.</p>

            <QuestionnaireSliders
                questions={WHO5_QUESTIONS}
                answers={answers}
                setAnswer={setAnswer}
                min={0}
                max={10}
                step={0.1}
                defaultValue={5}
                lowDefaultLabel='At no time'
                highDefaultLabel='All of the time'
                showMissing={showMissing}
            />

            <button
                className='wizard-primary-btn'
                onClick={handleAttemptSubmit}
            >
                Continue to Learning Questions
            </button>
        </div>
    )
}

// ── Learning Step (sliders 1–5) ──────────────────────────────
function LearningStep({ answers, setAnswer, surveyId, onComplete }: {
    answers: Record<string, number>
    setAnswer: (key: string, value: number) => void
    surveyId?: string
    onComplete: () => void
}) {
    const dispatch = useReduxDispatch()
    const [submitting, setSubmitting] = useState(false)

    const srlComplete = allAnswered(SRL_QUESTIONS, answers)
    const wellbeingComplete = allAnswered(WHO5_QUESTIONS, answers)
    const canSubmit = srlComplete && wellbeingComplete
    const [showMissing, setShowMissing] = useState(false)

    const handleSubmit = async () => {
        if (!canSubmit || !surveyId) return
        setSubmitting(true)
        try {
            await dispatch(postResults({
                postId: surveyId,
                surveyResult: answers,
                surveyResultText: JSON.stringify(answers)
            }))
            onComplete()
        } catch {
            setSubmitting(false)
        }
    }

    const handleAttemptSubmit = () => {
        if (canSubmit) { handleSubmit(); return }
        setShowMissing(true)
        highlightMissing()
        setTimeout(() => setShowMissing(false), 3000)
    }

    return (
        <div className='wq-section'>
            <h2>Your Learning Today</h2>
            <p className='wq-section-desc'>Reflect on your learning strategies and experience.</p>

            <QuestionnaireSliders
                questions={SRL_QUESTIONS}
                answers={answers}
                setAnswer={setAnswer}
                min={1}
                max={5}
                step={0.1}
                defaultValue={3}
                showMissing={showMissing}
            />

            <button
                className='wizard-primary-btn'
                onClick={handleAttemptSubmit}
                disabled={submitting}
            >
                {submitting ? 'Saving...' : 'Submit & Continue'}
            </button>
        </div>
    )
}

// ── Screen Time Step (inline) ────────────────────────────────
function ScreenTimeStep({ onComplete }: { onComplete: () => void }) {
    const [totalMinutes, setTotalMinutes] = useState<number | null>(null)
    const [longestSession, setLongestSession] = useState<number | null>(null)
    const [preSleepMinutes, setPreSleepMinutes] = useState<number | null>(null)
    const [submitting, setSubmitting] = useState(false)

    const isComplete = totalMinutes !== null && longestSession !== null && preSleepMinutes !== null
    const sessionExceedsTotal = longestSession !== null && totalMinutes !== null && longestSession > totalMinutes

    const handleSubmit = async () => {
        if (!isComplete || sessionExceedsTotal) return
        setSubmitting(true)
        try {
            await saveScreenTime({ totalMinutes: totalMinutes!, longestSession: longestSession!, preSleepMinutes: preSleepMinutes! })
            onComplete()
        } catch {
            setSubmitting(false)
        }
    }

    return (
        <div className='wizard-screen-time'>
            <h2>📱 Daily Screen Time</h2>
            <p className='wq-section-desc'>Answer these 3 quick questions about your screen usage yesterday (excluding studying).</p>

            {/* Q1: Total screen time */}
            <div className='st-question'>
                <label className='st-question-label'>
                    <span className='st-question-number'>1</span>
                    Roughly how many hours did you spend on your phone/laptop yesterday (excluding studying)?
                </label>
                <div className='st-options'>
                    {VOLUME_OPTIONS.map(opt => (
                        <label className='st-option' key={opt.value}>
                            <input
                                type='radio'
                                name='wiz-totalMinutes'
                                value={opt.value}
                                checked={totalMinutes === opt.value}
                                onChange={() => {
                                    setTotalMinutes(opt.value)
                                    if (opt.value > 0 && longestSession === 0) setLongestSession(null)
                                    if (opt.value === 0) setLongestSession(0)
                                }}
                            />
                            <span className='st-option-label'>{opt.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className='st-divider' />

            {/* Q2: Longest session */}
            <div className='st-question'>
                <label className='st-question-label'>
                    <span className='st-question-number'>2</span>
                    What was your longest uninterrupted screen session yesterday?
                </label>
                <div className='st-options'>
                    {LONGEST_SESSION_OPTIONS
                        .filter(opt => !totalMinutes || opt.value !== 0)
                        .map(opt => (
                        <label className='st-option' key={opt.value}>
                            <input
                                type='radio'
                                name='wiz-longestSession'
                                value={opt.value}
                                checked={longestSession === opt.value}
                                onChange={() => setLongestSession(opt.value)}
                            />
                            <span className='st-option-label'>{opt.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            {sessionExceedsTotal && (
                <p className='st-validation-warning'>
                    Your longest session can't be longer than your total screen time. Please adjust one of your answers.
                </p>
            )}

            <div className='st-divider' />

            {/* Q3: Pre-sleep screen time */}
            <div className='st-question'>
                <label className='st-question-label'>
                    <span className='st-question-number'>3</span>
                    How much time did you spend on a screen before going to sleep last night?
                </label>
                <div className='st-options'>
                    {PRE_SLEEP_OPTIONS.map(opt => (
                        <label className='st-option' key={opt.value}>
                            <input
                                type='radio'
                                name='wiz-preSleepMinutes'
                                value={opt.value}
                                checked={preSleepMinutes === opt.value}
                                onChange={() => setPreSleepMinutes(opt.value)}
                            />
                            <span className='st-option-label'>{opt.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            <button
                className='wizard-primary-btn'
                onClick={handleSubmit}
                disabled={submitting || !isComplete || sessionExceedsTotal}
            >
                {submitting ? 'Saving...' : 'Save & Continue'}
            </button>
        </div>
    )
}

// ── Sleep Step (inline, reuses SleepSlider) ──────────────────
function SleepStep({ onComplete }: { onComplete: () => void }) {
    return (
        <div className='wizard-sleep'>
            <SleepSlider onSaved={onComplete} suppressChatbotEvent />
        </div>
    )
}
