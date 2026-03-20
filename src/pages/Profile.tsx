import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReduxSelector, useReduxDispatch } from '../redux'
import { fetchPrompts, updatePrompt } from '../redux/admin'
import { api, API_BASE } from '../api/client'
import './Profile.css'

const Profile = () => {
    const navigate = useNavigate()
    const dispatch = useReduxDispatch()
    const user = useReduxSelector(state => state.auth.user)
    const userName = user?.name || user?.email || 'User'
    const isAdmin = user?.role === 'admin'

    // Admin State
    const adminState = useReduxSelector(state => state.admin)
    const [systemPrompt, setSystemPrompt] = useState('')
    const [alignmentPrompt, setAlignmentPrompt] = useState('')

    // Success message state
    const [showSystemSuccess, setShowSystemSuccess] = useState(false)
    const [showAlignmentSuccess, setShowAlignmentSuccess] = useState(false)
    const [exporting, setExporting] = useState(false)
    const [exportingUnified, setExportingUnified] = useState(false)

    // Remove white sjs-app__content card (same pattern as Sleep/Screen/Run pages)
    useEffect(() => {
        const el = document.querySelector('.sjs-app__content')
        if (el) el.classList.add('mood-content-override')
        return () => { if (el) el.classList.remove('mood-content-override') }
    }, [])

    // Load Initial Data
    useEffect(() => {
        if (isAdmin) {
            dispatch(fetchPrompts())
        }
    }, [isAdmin, dispatch])

    // Update local state when redux state changes
    useEffect(() => {
        if (isAdmin) {
            setSystemPrompt(adminState.systemPrompt)
            setAlignmentPrompt(adminState.alignmentPrompt)
        }
    }, [isAdmin, adminState.systemPrompt, adminState.alignmentPrompt])

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

    const downloadCsv = async (endpoint: string, filename: string, setLoading: (v: boolean) => void) => {
        setLoading(true)
        try {
            const res = await fetch(`${API_BASE}${endpoint}`, { credentials: 'include' })
            if (!res.ok) throw new Error('Export failed')
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            a.click()
            URL.revokeObjectURL(url)
        } catch {
            alert('Failed to export data. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const handleExport = () => downloadCsv('/profile/export', 'my-data-export.csv', setExporting)
    const handleExportUnified = () => downloadCsv('/profile/export-unified', 'my-data-unified.csv', setExportingUnified)

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
                <h1 className='profile-title'>{userName}'s Profile</h1>
                <div className='profile-content'>

                    {/* Export Data */}
                    <div style={{
                        padding: '16px',
                        border: '1px solid #3b82f6',
                        borderRadius: '8px',
                        backgroundColor: '#eff6ff',
                        marginBottom: '20px'
                    }}>
                        <h3 style={{ margin: '0 0 8px', color: '#1e40af', fontSize: '14px' }}>Export My Data</h3>
                        <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 12px' }}>
                            Download your data as a CSV file for analysis.
                        </p>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <div>
                                <button
                                    onClick={handleExport}
                                    disabled={exporting}
                                    style={{
                                        padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white',
                                        border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
                                        opacity: exporting ? 0.6 : 1
                                    }}
                                >
                                    {exporting ? 'Exporting...' : 'Download Detailed CSV'}
                                </button>
                                <p style={{ fontSize: '11px', color: '#6b7280', margin: '4px 0 0' }}>
                                    Multi-section format with detailed breakdown by category
                                </p>
                            </div>
                            <div>
                                <button
                                    onClick={handleExportUnified}
                                    disabled={exportingUnified}
                                    style={{
                                        padding: '8px 16px', backgroundColor: '#059669', color: 'white',
                                        border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
                                        opacity: exportingUnified ? 0.6 : 1
                                    }}
                                >
                                    {exportingUnified ? 'Exporting...' : 'Download Unified CSV'}
                                </button>
                                <p style={{ fontSize: '11px', color: '#6b7280', margin: '4px 0 0' }}>
                                    Single table with all data sources grouped by date
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Consent & Data Management */}
                    <div style={{ padding: '16px', border: '1px solid #ef4444', borderRadius: '8px', backgroundColor: '#fef2f2' }}>
                        <h3 style={{ margin: '0 0 8px', color: '#dc2626', fontSize: '14px' }}>Data & Consent</h3>
                        <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 12px' }}>
                            Revoking consent will permanently delete all your data including questionnaire responses,
                            sleep logs, screen time logs, chat history, and scores. This cannot be undone.
                        </p>
                        <button
                            onClick={async () => {
                                if (window.confirm('Are you sure? This will permanently delete ALL your data and log you out. This cannot be undone.')) {
                                    try {
                                        await api.post('/consent/revoke', {});
                                        window.location.href = '/login';
                                    } catch (err) {
                                        alert('Failed to revoke consent. Please try again.');
                                    }
                                }
                            }}
                            style={{
                                padding: '8px 16px', backgroundColor: '#dc2626', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
                            }}
                        >
                            Revoke Consent & Delete My Data
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Profile
