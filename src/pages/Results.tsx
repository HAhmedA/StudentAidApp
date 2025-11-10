import { useEffect, useState } from 'react';
import { useParams } from 'react-router'
import { useReduxDispatch } from '../redux';
import { get } from '../redux/surveys';
import Dashboard from '../components/Dashboard'

const Results = () => {
    const dispatch = useReduxDispatch()
    const { id } = useParams();
    const [surveyData, surveyDataSet] = useState<any>(null)

    useEffect(() => {
        (async () => {
            const surveyAction = await dispatch(get(id as string))
            surveyDataSet(surveyAction.payload)
        })()
    }, [dispatch, id])

    return (<>
        {surveyData === null && <div>Loading...</div>}
        {surveyData === undefined && <div>Survey not found</div>}
        {!!surveyData && <>
            <h1>{'\'' + surveyData.name + '\' results'}</h1>
            <div className='sjs-results-container'>
                <Dashboard surveyId={id as string} />
            </div>
        </>}
    </>);
}

export default Results;