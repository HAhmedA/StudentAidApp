import React, { useEffect } from 'react'
import { load } from '../redux/surveys'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { Link } from 'react-router-dom'
import './Surveys.css'

const Surveys = (): React.ReactElement => {
    const surveys = useReduxSelector(state => state.surveys.surveys)
    const dispatch = useReduxDispatch()

    const status = useReduxSelector(state => state.surveys.status)

    useEffect(() => {
        if (status === 'idle' && surveys.length === 0) {
            dispatch(load())
        }
    }, [status, dispatch, surveys])

    return (<>
        <table className='sjs-surveys-list'>
            <tbody>
                {surveys.map(survey =>
                    <tr key={survey.id} className='sjs-surveys-list__row'>
                        <td><span>{survey.json?.title || survey.name}</span></td>
                        <td>
                            <Link className='sjs-button' to="/questionnaire"><span>Fill Survey</span></Link>
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    </>)
}

export default Surveys
