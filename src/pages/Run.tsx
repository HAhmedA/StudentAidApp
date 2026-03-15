import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import { useReduxDispatch } from '../redux'
import { post } from '../redux/results'
import { get } from '../redux/surveys'
import { Model } from 'survey-core'
import { Survey } from 'survey-react-ui'
import 'survey-core/survey-core.css'
import './Run.css'

const Run = () => {
    const dispatch = useReduxDispatch()
    const navigate = useNavigate()
    const location = useLocation()
    const fromWizard = location.state?.fromWizard === true
    const { id } = useParams();
    const [surveyData, surveyDataSet] = useState<any>(null)
    const [surveyModel, surveyModelSet] = useState<Model>()

    useEffect(() => {
        const el = document.querySelector('.sjs-app__content')
        if (el) el.classList.add('mood-content-override')
        return () => { if (el) el.classList.remove('mood-content-override') }
    }, [])

    useEffect(() => {
        (async () => {
            const surveyAction = await dispatch(get(id as string))
            surveyDataSet(surveyAction.payload)
            
            // Make all questions mandatory by modifying the JSON before creating the model
            const surveyJson = JSON.parse(JSON.stringify(surveyAction.payload?.json || {}))
            if (surveyJson.pages) {
                surveyJson.pages.forEach((page: any) => {
                    if (page.elements) {
                        page.elements.forEach((element: any) => {
                            element.isRequired = true
                        })
                    }
                })
            }
            
            const model = new Model(surveyJson)
            
            model.requiredText = '*'
            model.showProgressBar = 'bottom'
            model.showQuestionNumbers = 'on'

            model.onComplete.add(async (sender: Model) => {
                await dispatch(post({postId: id as string, surveyResult: sender.data, surveyResultText: JSON.stringify(sender.data)}))
                window.dispatchEvent(new CustomEvent('chatbot:dataUpdated', { detail: { dataType: 'SRL questionnaire' } }))
                if (fromWizard) {
                    navigate('/', { state: { wizardReturning: true } })
                } else {
                    navigate('/')
                }
            })
            
            surveyModelSet(model)
        })()
    }, [dispatch, id, navigate])

    return (
        <div className='run-page-wrapper'>
            <button
                className='run-back-button'
                onClick={() => navigate('/')}
            >
                ← Back
            </button>
            {surveyData === null && <div>Loading...</div>}
            {surveyData === undefined && <div>Survey not found</div>}
            {!!surveyData && !!surveyModel && !surveyModel.title && <>
                <h1>{surveyData.name}</h1>
            </>}
            {!!surveyModel && <>
                <Survey model={surveyModel}/>
            </>}
        </div>
    );
}

export default Run;