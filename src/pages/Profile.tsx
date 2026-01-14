import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReduxSelector, useReduxDispatch } from '../redux'
import { fetchProfile, updateProfile } from '../redux/profile'
import { fetchPrompts, updatePrompt } from '../redux/admin'
import {
    educationLevels,
    fieldsOfStudy,
    majorsByField,
    learningFormatOptions,
    disabilityCategories
} from '../models/profile-constants'
import './Profile.css'

const Profile = () => {
    const navigate = useNavigate()
    const dispatch = useReduxDispatch()
    const user = useReduxSelector(state => state.auth.user)
    const userName = user?.name || user?.email || 'User'
    const isAdmin = user?.role === 'admin' || user?.email === 'admin@example.com'

    // Admin State
    const adminState = useReduxSelector(state => state.admin)
    const [systemPrompt, setSystemPrompt] = useState('')
    const [alignmentPrompt, setAlignmentPrompt] = useState('')

    // Student State
    const profileState = useReduxSelector(state => state.profile)
    const [educationLevel, setEducationLevel] = useState('')
    const [fieldOfStudy, setFieldOfStudy] = useState('')
    const [major, setMajor] = useState('')
    const [learningFormats, setLearningFormats] = useState<string[]>([])
    const [disabilities, setDisabilities] = useState<string[]>([])

    // Success message state
    const [showSystemSuccess, setShowSystemSuccess] = useState(false)
    const [showAlignmentSuccess, setShowAlignmentSuccess] = useState(false)
    const [showStudentSuccess, setShowStudentSuccess] = useState(false)

    // Load Initial Data
    useEffect(() => {
        if (isAdmin) {
            dispatch(fetchPrompts())
        } else {
            dispatch(fetchProfile())
        }
    }, [isAdmin, dispatch])

    // Update local state when redux state changes
    useEffect(() => {
        if (isAdmin) {
            setSystemPrompt(adminState.systemPrompt)
            setAlignmentPrompt(adminState.alignmentPrompt)
        }
    }, [isAdmin, adminState.systemPrompt, adminState.alignmentPrompt])

    useEffect(() => {
        if (!isAdmin && profileState.data) {
            setEducationLevel(profileState.data.edu_level || '')
            setFieldOfStudy(profileState.data.field_of_study || '')
            setMajor(profileState.data.major || '')
            setLearningFormats(profileState.data.learning_formats || [])
            setDisabilities(profileState.data.disabilities || [])
        }
    }, [isAdmin, profileState.data])


    const handleLearningFormatChange = (format: string) => {
        setLearningFormats(prev =>
            prev.includes(format)
                ? prev.filter(f => f !== format)
                : [...prev, format]
        )
    }

    const handleDisabilityChange = (disability: string) => {
        setDisabilities(prev =>
            prev.includes(disability)
                ? prev.filter(d => d !== disability)
                : [...prev, disability]
        )
    }

    const handleSystemPromptSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const result = await dispatch(updatePrompt({ prompt: systemPrompt, type: 'system' }))
        if (result.type.endsWith('/fulfilled')) {
            setShowSystemSuccess(true)
            setTimeout(() => setShowSystemSuccess(false), 3000)
        }
    }

    const handleAlignmentPromptSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const result = await dispatch(updatePrompt({ prompt: alignmentPrompt, type: 'alignment' }))
        if (result.type.endsWith('/fulfilled')) {
            setShowAlignmentSuccess(true)
            setTimeout(() => setShowAlignmentSuccess(false), 3000)
        }
    }

    const handleStudentSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const payload = {
            edu_level: educationLevel,
            field_of_study: fieldOfStudy,
            major,
            learning_formats: learningFormats,
            disabilities
        }
        const result = await dispatch(updateProfile(payload))
        if (result.type.endsWith('/fulfilled')) {
            setShowStudentSuccess(true)
            setTimeout(() => setShowStudentSuccess(false), 3000)
        }
    }

    const availableMajors = fieldOfStudy ? (majorsByField[fieldOfStudy] || []) : []

    if (isAdmin) {
        return (
            <div className='profile-wrapper'>
                <div className='profile-container'>
                    <button className='profile-back' onClick={() => navigate('/')}>
                        ← Back
                    </button>
                    <h1 className='profile-title'>System Configuration</h1>
                    <div className='profile-content'>
                        {/* System Prompt */}
                        <form onSubmit={handleSystemPromptSubmit} className='profile-form'>
                            <div className='profile-form-group'>
                                <label className='profile-label' htmlFor="system-prompt">
                                    System Prompt
                                    <span style={{ fontWeight: 'normal', color: '#6B7280', marginLeft: '8px' }}>
                                        (Instructions for the chatbot)
                                    </span>
                                </label>
                                <textarea
                                    id="system-prompt"
                                    className='profile-textarea'
                                    value={systemPrompt}
                                    onChange={(e) => setSystemPrompt(e.target.value)}
                                    rows={10}
                                    style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', minHeight: '200px' }}
                                />
                                {adminState.systemLastUpdated && (
                                    <p className="profile-last-updated" style={{ fontSize: '0.8rem', color: '#666', marginTop: '5px' }}>
                                        Last updated: {new Date(adminState.systemLastUpdated).toLocaleString()}
                                    </p>
                                )}
                            </div>
                            <div className='profile-form-actions'>
                                <button
                                    type='submit'
                                    className='profile-submit-button'
                                    disabled={adminState.status === 'loading'}
                                >
                                    {adminState.status === 'loading' ? 'Updating...' : 'Update System Prompt'}
                                </button>
                            </div>
                            {showSystemSuccess && <p className="success-message" style={{ color: 'green', marginTop: '10px' }}>System prompt updated successfully!</p>}
                        </form>

                        <hr style={{ margin: '30px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

                        {/* Alignment Prompt */}
                        <form onSubmit={handleAlignmentPromptSubmit} className='profile-form'>
                            <div className='profile-form-group'>
                                <label className='profile-label' htmlFor="alignment-prompt">
                                    Alignment Prompt
                                    <span style={{ fontWeight: 'normal', color: '#6B7280', marginLeft: '8px' }}>
                                        (Instructions for the LLM judge)
                                    </span>
                                </label>
                                <textarea
                                    id="alignment-prompt"
                                    className='profile-textarea'
                                    value={alignmentPrompt}
                                    onChange={(e) => setAlignmentPrompt(e.target.value)}
                                    rows={10}
                                    style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', minHeight: '200px' }}
                                />
                                {adminState.alignmentLastUpdated && (
                                    <p className="profile-last-updated" style={{ fontSize: '0.8rem', color: '#666', marginTop: '5px' }}>
                                        Last updated: {new Date(adminState.alignmentLastUpdated).toLocaleString()}
                                    </p>
                                )}
                            </div>
                            <div className='profile-form-actions'>
                                <button
                                    type='submit'
                                    className='profile-submit-button'
                                    disabled={adminState.status === 'loading'}
                                >
                                    {adminState.status === 'loading' ? 'Updating...' : 'Update Alignment Prompt'}
                                </button>
                            </div>
                            {showAlignmentSuccess && <p className="success-message" style={{ color: 'green', marginTop: '10px' }}>Alignment prompt updated successfully!</p>}
                        </form>

                        {adminState.error && adminState.status === 'failed' && <p className="error-message" style={{ color: 'red', marginTop: '10px' }}>{adminState.error}</p>}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className='profile-wrapper'>
            <div className='profile-container'>
                <button className='profile-back' onClick={() => navigate('/')}>
                    ← Back
                </button>
                <h1 className='profile-title'>{userName}'s profile</h1>
                <div className='profile-content'>
                    <form onSubmit={handleStudentSubmit} className='profile-form'>
                        {/* Education Level */}
                        <div className='profile-form-group'>
                            <label className='profile-label'>
                                Current education level <span style={{ fontWeight: 'normal', color: '#6B7280' }}>(optional)</span>
                            </label>
                            <select
                                className='profile-select'
                                value={educationLevel}
                                onChange={(e) => setEducationLevel(e.target.value)}
                            >
                                <option value=''>Select education level</option>
                                {educationLevels.map(level => (
                                    <option key={level} value={level}>{level}</option>
                                ))}
                            </select>
                        </div>

                        {/* Field of Study */}
                        <div className='profile-form-group'>
                            <label className='profile-label'>
                                Field of study <span style={{ fontWeight: 'normal', color: '#6B7280' }}>(optional)</span>
                            </label>
                            <select
                                className='profile-select'
                                value={fieldOfStudy}
                                onChange={(e) => {
                                    setFieldOfStudy(e.target.value)
                                    setMajor('') // Reset major when field changes
                                }}
                            >
                                <option value=''>Select field of study</option>
                                {fieldsOfStudy.map(field => (
                                    <option key={field} value={field}>{field}</option>
                                ))}
                            </select>
                        </div>

                        {/* Major */}
                        {fieldOfStudy && (
                            <div className='profile-form-group'>
                                <label className='profile-label'>
                                    Major <span style={{ fontWeight: 'normal', color: '#6B7280' }}>(optional)</span>
                                </label>
                                <select
                                    className='profile-select'
                                    value={major}
                                    onChange={(e) => setMajor(e.target.value)}
                                >
                                    <option value=''>Select major</option>
                                    {availableMajors.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Preferred Learning Formats */}
                        <div className='profile-form-group'>
                            <label className='profile-label'>
                                Preferred learning formats <span style={{ fontWeight: 'normal', color: '#6B7280' }}>(optional)</span>
                            </label>
                            <div className='profile-checkbox-group'>
                                {learningFormatOptions.map(format => (
                                    <label key={format} className='profile-checkbox-label'>
                                        <input
                                            type='checkbox'
                                            className='profile-checkbox'
                                            checked={learningFormats.includes(format)}
                                            onChange={() => handleLearningFormatChange(format)}
                                        />
                                        <span>{format}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Disabilities */}
                        <div className='profile-form-group'>
                            <label className='profile-label'>
                                Disabilities <span style={{ fontWeight: 'normal', color: '#6B7280' }}>(optional)</span>
                            </label>
                            <div className='profile-disabilities-container'>
                                {Object.entries(disabilityCategories).map(([category, items]) => (
                                    <div key={category} className='profile-disability-category'>
                                        <h3 className='profile-disability-category-title'>{category}</h3>
                                        <div className='profile-checkbox-group'>
                                            {items.map(disability => (
                                                <label key={disability} className='profile-checkbox-label'>
                                                    <input
                                                        type='checkbox'
                                                        className='profile-checkbox'
                                                        checked={disabilities.includes(disability)}
                                                        onChange={() => handleDisabilityChange(disability)}
                                                    />
                                                    <span>{disability}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className='profile-form-actions'>
                            <button
                                type='submit'
                                className='profile-submit-button'
                                disabled={profileState.status === 'loading'}
                            >
                                {profileState.status === 'loading' ? 'Saving...' : 'Save Profile'}
                            </button>
                        </div>
                        {profileState.error && profileState.status === 'failed' && <p className="error-message" style={{ color: 'red', marginTop: '10px' }}>{profileState.error}</p>}
                        {showStudentSuccess && <p className="success-message" style={{ color: 'green', marginTop: '10px' }}>Profile saved successfully!</p>}
                    </form>
                </div>
            </div>
        </div>
    )
}

export default Profile
