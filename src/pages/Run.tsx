import { useEffect, useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { post } from '../redux/results'
import { load } from '../redux/surveys'
import QuestionnaireSliders, { allAnswered, highlightMissing } from '../components/QuestionnaireSliders'
import { QUESTIONNAIRE_PAGES } from '../constants/questions'
import './Run.css'

const Run = () => {
    const dispatch = useReduxDispatch()
    const navigate = useNavigate()
    const surveys = useReduxSelector(state => state.surveys.surveys)
    const surveysStatus = useReduxSelector(state => state.surveys.status)
    const [currentPage, setCurrentPage] = useState(0)
    const [answers, setAnswers] = useState<Record<string, number>>({})
    const [submitting, setSubmitting] = useState(false)
    const [showMissing, setShowMissing] = useState(false)

    const setAnswer = useCallback((key: string, value: number) => {
        setAnswers(prev => ({ ...prev, [key]: value }))
    }, [])

    // Override parent white card (same pattern as Sleep & Screen Time pages)
    useEffect(() => {
        const el = document.querySelector('.sjs-app__content')
        if (el) el.classList.add('mood-content-override')
        return () => { if (el) el.classList.remove('mood-content-override') }
    }, [])

    useEffect(() => {
        if (surveysStatus === 'idle' && surveys.length === 0) {
            dispatch(load())
        }
    }, [dispatch, surveysStatus, surveys.length])

    const surveyId = surveys[0]?.id
    const page = QUESTIONNAIRE_PAGES[currentPage]
    const isLastPage = currentPage === QUESTIONNAIRE_PAGES.length - 1

    const handleNext = () => {
        if (!allAnswered(page.questions, answers)) {
            setShowMissing(true)
            highlightMissing()
            setTimeout(() => setShowMissing(false), 3000)
            return
        }
        setCurrentPage(prev => prev + 1)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    const handleSubmit = async () => {
        if (!allAnswered(page.questions, answers) || !surveyId) return
        setSubmitting(true)
        try {
            await dispatch(post({ postId: surveyId, surveyResult: answers, surveyResultText: JSON.stringify(answers) }))
            window.dispatchEvent(new CustomEvent('chatbot:dataUpdated', { detail: { dataType: 'learning questionnaire' } }))
            navigate('/')
        } catch {
            setSubmitting(false)
        }
    }

    if (!surveyId) {
        return (
            <div className='run-page'>
                <div className='run-container'>
                    <div className='run-card'>
                        <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '40px' }}>Loading...</div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className='run-page'>
            <div className='run-container'>
                <Link to='/' className='run-back-btn'>
                    &larr; Back to Home
                </Link>

                <div className='run-card'>
                    <h1 className='run-title'>
                        {page.name === 'wellbeing' ? '😊' : '📝'} {page.title}
                    </h1>
                    <p className='run-subtitle'>{page.description}</p>

                    <QuestionnaireSliders
                        questions={[...page.questions]}
                        answers={answers}
                        setAnswer={setAnswer}
                        min={page.scale.min}
                        max={page.scale.max}
                        step={page.scale.step}
                        defaultValue={page.scale.defaultValue}
                        showMissing={showMissing}
                    />

                    <div className='run-nav-buttons'>
                        {currentPage > 0 && (
                            <button
                                className='run-secondary-btn'
                                onClick={() => { setCurrentPage(prev => prev - 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                            >
                                &larr; Previous
                            </button>
                        )}
                        {!isLastPage ? (
                            <button className='run-primary-btn' onClick={handleNext}>
                                Next &rarr;
                            </button>
                        ) : (
                            <button
                                className='run-primary-btn'
                                onClick={handleSubmit}
                                disabled={submitting}
                            >
                                {submitting ? 'Saving...' : 'Submit'}
                            </button>
                        )}
                    </div>

                    <div className='run-progress'>
                        Page {currentPage + 1} of {QUESTIONNAIRE_PAGES.length}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Run
