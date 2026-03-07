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
    disabilityCategoriesDSM5,
    DISABILITY_LEGACY_MAP
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
    const [selectedCategory, setSelectedCategory] = useState<string>('')
    const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})

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
            // Apply legacy migration — map old string labels to new DSM-5 IDs
            const rawDisabilities: string[] = profileState.data.disabilities || []
            const migrated = rawDisabilities.map(d => DISABILITY_LEGACY_MAP[d] ?? d)
            setDisabilities(Array.from(new Set(migrated)))
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
                    <div style={{
                        backgroundColor: '#eff6ff',
                        borderLeft: '4px solid #3b82f6',
                        padding: '1rem',
                        marginBottom: '1.5rem',
                        borderRadius: '0 4px 4px 0',
                        fontSize: '0.9rem',
                        color: '#1e3a8a'
                    }}>
                        <strong>Transparency Note:</strong> Filling out this profile is optional. This information is used solely to personalize the AI chatbot's guidance to your specific context (e.g., your field of study and learning preferences). Calling the chatbot will use this data to provide better answers.
                    </div>
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

                        {/* Disabilities — collapsible DSM-5 panel */}
                        <div className='profile-form-group'>
                            <label className='profile-label'>
                                Disabilities / Learning Differences <span style={{ fontWeight: 'normal', color: '#6B7280' }}>(optional)</span>
                            </label>
                            <details className='profile-disabilities-panel'>
                                <summary className='profile-disabilities-summary'>
                                    <span>
                                        {disabilities.length > 0
                                            ? `${disabilities.length} selected`
                                            : 'Click to expand'}
                                    </span>
                                    <span className='profile-disabilities-chevron'>▾</span>
                                </summary>

                                {/* Category tabs */}
                                <div className='profile-disability-tabs'>
                                    {disabilityCategoriesDSM5.map(cat => (
                                        <button
                                            key={cat.id}
                                            type='button'
                                            className={`profile-disability-tab ${selectedCategory === cat.id ? 'active' : ''}`}
                                            onClick={() => setSelectedCategory(prev => prev === cat.id ? '' : cat.id)}
                                        >
                                            {cat.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Items for selected category */}
                                {selectedCategory && (() => {
                                    const cat = disabilityCategoriesDSM5.find(c => c.id === selectedCategory)
                                    if (!cat) return null
                                    return (
                                        <div className='profile-disability-items'>
                                            {cat.items.map(item => (
                                                <label key={item.id} className='profile-checkbox-label'>
                                                    <input
                                                        type='checkbox'
                                                        className='profile-checkbox'
                                                        checked={disabilities.includes(item.id)}
                                                        onChange={() => handleDisabilityChange(item.id)}
                                                    />
                                                    <span>{item.label}</span>
                                                    {item.tooltip && (
                                                        <span className='profile-info-wrapper'>
                                                            <span className='profile-info-icon'>ℹ</span>
                                                            <span className='profile-info-tooltip'>{item.tooltip}</span>
                                                        </span>
                                                    )}
                                                </label>
                                            ))}
                                            {/* Other free-text */}
                                            <label className='profile-checkbox-label'>
                                                <input
                                                    type='checkbox'
                                                    className='profile-checkbox'
                                                    checked={disabilities.includes(cat.otherKey)}
                                                    onChange={() => handleDisabilityChange(cat.otherKey)}
                                                />
                                                <span>Other</span>
                                            </label>
                                            {disabilities.includes(cat.otherKey) && (
                                                <input
                                                    type='text'
                                                    className='profile-other-text'
                                                    placeholder='Please describe…'
                                                    value={otherTexts[cat.otherKey] || ''}
                                                    onChange={e => setOtherTexts(prev => ({ ...prev, [cat.otherKey]: e.target.value }))}
                                                />
                                            )}
                                        </div>
                                    )
                                })()}
                            </details>
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
