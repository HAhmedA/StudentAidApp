import React, { useEffect } from 'react'
import { load } from '../redux/surveys'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { Link } from 'react-router-dom'
import './Surveys.css'

const Surveys = (): React.ReactElement => {
    const surveys = useReduxSelector(state => state.surveys.surveys)
    const dispatch = useReduxDispatch()
    const user = useReduxSelector(state => state.auth.user)
    const isAdmin = user?.role === 'admin'

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
                            {/* Admin can run and edit; Student can only run (fill) the survey */}
                            <Link className='sjs-button' to={'run/' + survey.id}><span>{isAdmin ? 'Run' : 'Fill Survey'}</span></Link>
                            {isAdmin && <Link className='sjs-button' to={'edit/' + survey.id}><span>Edit</span></Link>}
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    </>)
}

export default Surveys