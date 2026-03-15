import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { load as loadSurveys } from '../redux/surveys'
import { api } from '../api/client'
import './DailyWizard.css'

// API helpers
const getConsentStatus = async () => {
    const res = await api.get<{ consentGiven: boolean }>('/consent')
    return res.consentGiven === true
}
const giveConsent = async () => {
    await api.post('/consent', { consentGiven: true })
}
const getTodaySRL = async () => {
    const res = await api.get<{ submitted: boolean }>('/results/today')
    return res.submitted === true
}
const getTodayScreenTime = async () => {
    const res = await api.get<{ logged: boolean }>('/screen-time/today')
    return !!res.logged
}
const getTodaySleep = async () => {
    const res = await api.get<{ logged: boolean }>('/sleep/today')
    return !!res.logged
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

type WizardStep = 'consent' | 'intro' | 'questionnaire' | 'screen_time' | 'sleep' | 'profile' | 'done'

interface StepConfig {
    key: WizardStep
    label: string
}

export default function DailyWizard({ onComplete }: { onComplete: () => void }) {
    const navigate = useNavigate()
    const dispatch = useReduxDispatch()
    const surveys = useReduxSelector(s => s.surveys.surveys)

    const [loading, setLoading] = useState(true)
    const [steps, setSteps] = useState<StepConfig[]>([])
    const [currentStepIdx, setCurrentStepIdx] = useState(0)
    const [consentAgreed, setConsentAgreed] = useState(false)
    const [isFirstTime, setIsFirstTime] = useState(false)

    // Determine which steps are needed
    useEffect(() => {
        let cancelled = false
        async function init() {
            try {
                const [hasConsent, hasSRL, hasScreenTime, hasSleep, profile] = await Promise.all([
                    getConsentStatus(),
                    getTodaySRL(),
                    getTodayScreenTime(),
                    getTodaySleep(),
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

                if (!hasSRL) neededSteps.push({ key: 'questionnaire', label: 'Questionnaire' })
                if (!hasScreenTime) neededSteps.push({ key: 'screen_time', label: 'Screen Time' })
                if (!hasSleep) neededSteps.push({ key: 'sleep', label: 'Sleep Log' })

                if (firstTime && (!profile || !profile.onboarding_completed)) {
                    neededSteps.push({ key: 'profile', label: 'Profile (Optional)' })
                }

                if (neededSteps.length === 0) {
                    onComplete()
                    return
                }

                setSteps(neededSteps)
                setLoading(false)

                if (!surveys || surveys.length === 0) {
                    dispatch(loadSurveys())
                }
            } catch {
                onComplete()
            }
        }
        init()
        return () => { cancelled = true }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const currentStep = steps[currentStepIdx]

    const goNext = useCallback(async () => {
        if (currentStepIdx < steps.length - 1) {
            setCurrentStepIdx(prev => prev + 1)
        } else {
            if (isFirstTime) await completeOnboarding()
            onComplete()
        }
    }, [currentStepIdx, steps.length, isFirstTime, onComplete])

    if (loading) {
        return <div className='wizard-loading'>Loading...</div>
    }

    if (!currentStep) {
        onComplete()
        return null
    }

    const progress = `${currentStepIdx + 1} of ${steps.length}`

    return (
        <div className='wizard-overlay'>
            <div className='wizard-container'>
                <div className='wizard-progress-bar'>
                    <div className='wizard-progress-fill' style={{ width: `${((currentStepIdx + 1) / steps.length) * 100}%` }} />
                </div>
                <div className='wizard-progress-text'>Step {progress}</div>

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
                    {currentStep.key === 'questionnaire' && (
                        <NavigateStep route={`/run/${surveys?.[0]?.id}`} navigate={navigate} />
                    )}
                    {currentStep.key === 'screen_time' && (
                        <NavigateStep route="/screen-time" navigate={navigate} />
                    )}
                    {currentStep.key === 'sleep' && (
                        <NavigateStep route="/sleep" navigate={navigate} />
                    )}
                    {currentStep.key === 'profile' && (
                        <ProfileStep
                            onNavigate={() => navigate('/profile', { state: { fromWizard: true } })}
                            onSkip={goNext}
                        />
                    )}
                </div>

                {currentStep.key !== 'consent' && (
                    <button className='wizard-skip-btn' onClick={async () => {
                        if (isFirstTime) await completeOnboarding()
                        onComplete()
                    }}>
                        Skip to Dashboard
                    </button>
                )}
            </div>
        </div>
    )
}

// --- Sub-components ---

function NavigateStep({ route, navigate }: { route: string; navigate: (to: string, opts?: any) => void }) {
    useEffect(() => {
        navigate(route, { state: { fromWizard: true } })
    }, [route, navigate])

    return <div className='wizard-step-loading'><p>Loading...</p></div>
}

function ConsentStep({ agreed, onToggle, onAccept }: {
    agreed: boolean; onToggle: () => void; onAccept: () => void
}) {
    return (
        <div className='wizard-step-consent'>
            <h2>Before We Begin</h2>
            <div className='consent-text'>
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
                <h3>Who can see your data</h3>
                <ul>
                    <li>Only you and your assigned facilitator can view your individual data</li>
                    <li>Peer comparisons use anonymised, aggregated data only</li>
                </ul>
                <h3>Your rights</h3>
                <ul>
                    <li>Participation is voluntary</li>
                    <li>You can revoke consent at any time from your Profile page</li>
                    <li>Revoking consent permanently deletes all your collected data</li>
                </ul>
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

function ProfileStep({ onNavigate, onSkip }: { onNavigate: () => void; onSkip: () => void }) {
    return (
        <div className='wizard-step-profile'>
            <h2>Set Up Your Profile (Optional)</h2>
            <p>Personalise your experience by telling us about your field of study and learning preferences.</p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                <button className='wizard-primary-btn' onClick={onNavigate}>Set Up Profile</button>
                <button className='wizard-secondary-btn' onClick={onSkip}>Skip for Now</button>
            </div>
        </div>
    )
}
