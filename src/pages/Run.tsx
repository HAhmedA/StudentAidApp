import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useReduxDispatch } from '../redux'
import { post } from '../redux/results'
import { get } from '../redux/surveys'
import QuestionnaireSliders, { allAnswered, highlightMissing, SliderQuestion } from '../components/QuestionnaireSliders'
import './Run.css'

interface SurveyPage {
    name: string
    title?: string
    description?: string
    elements: Array<{
        name: string
        title: string
        type: string
        rateMin?: number
        rateMax?: number
        rateStep?: number
        minRateDescription?: string
        maxRateDescription?: string
    }>
}

const Run = () => {
    const dispatch = useReduxDispatch()
    const navigate = useNavigate()
    const { id } = useParams()
    const [surveyData, surveyDataSet] = useState<any>(null)
    const [pages, setPages] = useState<SurveyPage[]>([])
    const [currentPage, setCurrentPage] = useState(0)
    const [answers, setAnswers] = useState<Record<string, number>>({})
    const [submitting, setSubmitting] = useState(false)
    const [showMissing, setShowMissing] = useState(false)

    const setAnswer = useCallback((key: string, value: number) => {
        setAnswers(prev => ({ ...prev, [key]: value }))
    }, [])

    useEffect(() => {
        (async () => {
            const surveyAction = await dispatch(get(id as string))
            const data = surveyAction.payload
            surveyDataSet(data)

            if (data?.json?.pages) {
                setPages(data.json.pages)
            }
        })()
    }, [dispatch, id])

    const page = pages[currentPage]
    const isLastPage = currentPage === pages.length - 1

    // Convert survey elements to SliderQuestion format
    const questionsForPage = (p: SurveyPage): SliderQuestion[] =>
        (p.elements || []).map(el => ({
            key: el.name,
            text: el.title,
            lowLabel: el.minRateDescription,
            highLabel: el.maxRateDescription,
        }))

    // Derive scale from page elements (wellbeing = 0-10, SRL = 1-5)
    const scaleForPage = (p: SurveyPage) => {
        const first = p.elements?.[0]
        const min = first?.rateMin ?? (p.name === 'wellbeing' ? 0 : 1)
        const max = first?.rateMax ?? (p.name === 'wellbeing' ? 10 : 5)
        const step = first?.rateStep ?? 0.1
        const defaultValue = (min + max) / 2
        return { min, max, step, defaultValue }
    }

    const handleNext = () => {
        if (!page) return
        const qs = questionsForPage(page)
        if (!allAnswered(qs, answers)) {
            setShowMissing(true)
            highlightMissing()
            setTimeout(() => setShowMissing(false), 3000)
            return
        }
        setCurrentPage(prev => prev + 1)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    const handleSubmit = async () => {
        if (!page) return
        const qs = questionsForPage(page)
        if (!allAnswered(qs, answers)) {
            setShowMissing(true)
            highlightMissing()
            setTimeout(() => setShowMissing(false), 3000)
            return
        }
        setSubmitting(true)
        try {
            await dispatch(post({ postId: id as string, surveyResult: answers, surveyResultText: JSON.stringify(answers) }))
            window.dispatchEvent(new CustomEvent('chatbot:dataUpdated', { detail: { dataType: 'learning questionnaire' } }))
            navigate('/')
        } catch {
            setSubmitting(false)
        }
    }

    return (
        <div className='run-page-wrapper'>
            <button
                className='run-back-button'
                onClick={() => navigate('/')}
            >
                &larr; Back
            </button>
            {surveyData === null && <div>Loading...</div>}
            {surveyData === undefined && <div>Survey not found</div>}
            {!!surveyData && pages.length > 0 && page && (() => {
                const qs = questionsForPage(page)
                const scale = scaleForPage(page)
                return (
                    <div className='run-survey-content'>
                        {surveyData.json?.title && (
                            <div className='run-survey-title'>
                                <h3>{surveyData.json.title}</h3>
                            </div>
                        )}

                        <div className='run-page-header'>
                            <h2>{page.title || `Page ${currentPage + 1}`}</h2>
                            {page.description && <p className='run-page-desc'>{page.description}</p>}
                        </div>

                        <QuestionnaireSliders
                            questions={qs}
                            answers={answers}
                            setAnswer={setAnswer}
                            min={scale.min}
                            max={scale.max}
                            step={scale.step}
                            defaultValue={scale.defaultValue}
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
                            Page {currentPage + 1} of {pages.length}
                        </div>
                    </div>
                )
            })()}
        </div>
    )
}

export default Run
