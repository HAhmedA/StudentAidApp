import './QuestionnaireSliders.css'

export interface SliderQuestion {
    key: string
    text: string
    lowLabel?: string
    highLabel?: string
}

interface QuestionnaireProps {
    questions: SliderQuestion[]
    answers: Record<string, number>
    setAnswer: (key: string, value: number) => void
    min: number
    max: number
    step: number
    defaultValue: number
    lowDefaultLabel?: string
    highDefaultLabel?: string
    showMissing?: boolean
}

export default function QuestionnaireSliders({
    questions, answers, setAnswer,
    min, max, step, defaultValue,
    lowDefaultLabel, highDefaultLabel,
    showMissing = false,
}: QuestionnaireProps) {
    const answeredCount = questions.filter(q => answers[q.key] !== undefined).length

    return (
        <>
            <p className={`wq-answered-count ${answeredCount === questions.length ? 'complete' : ''}`}>
                {answeredCount} of {questions.length} answered
            </p>

            {questions.map((q, idx) => {
                const isAnswered = answers[q.key] !== undefined
                const isMissing = showMissing && !isAnswered
                const lo = q.lowLabel || lowDefaultLabel || String(min)
                const hi = q.highLabel || highDefaultLabel || String(max)
                return (
                    <div key={q.key} className={`wq-question ${isAnswered ? 'wq-question-answered' : 'wq-question-unanswered'} ${isMissing ? 'wq-question-missing' : ''}`}>
                        <div className='wq-question-label'>
                            <span className='wq-question-number'>{idx + 1}</span>
                            {q.text}
                        </div>
                        <div className='wq-slider-container'>
                            <div className='wq-slider-labels'>
                                <span>{min} — {lo}</span>
                                <span>{max} — {hi}</span>
                            </div>
                            <input
                                type='range'
                                className={`wq-slider ${!isAnswered ? 'wq-slider-unanswered' : ''}`}
                                min={min}
                                max={max}
                                step={step}
                                value={answers[q.key] ?? defaultValue}
                                onChange={(e) => setAnswer(q.key, parseFloat(e.target.value))}
                            />
                            <div className={`wq-slider-value ${!isAnswered ? 'wq-slider-value-unanswered' : ''}`}>
                                {isAnswered ? answers[q.key].toFixed(1) : '\u2014'}
                            </div>
                        </div>
                    </div>
                )
            })}
        </>
    )
}

/** Utility: check if all questions in a set are answered */
export function allAnswered(questions: SliderQuestion[], answers: Record<string, number>): boolean {
    return questions.every(q => answers[q.key] !== undefined)
}

/** Utility: scroll to first missing question */
export function highlightMissing(): void {
    setTimeout(() => {
        const first = document.querySelector('.wq-question-missing')
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
}
