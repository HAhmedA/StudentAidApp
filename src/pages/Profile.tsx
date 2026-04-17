import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReduxSelector, useReduxDispatch } from '../redux'
import { fetchPrompts, updatePrompt } from '../redux/admin'
import { api, API_BASE } from '../api/client'
import { submitSupportRequest, getMySupportRequests, SupportRequest } from '../api/supportRequests'
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
    const [exportingProject, setExportingProject] = useState(false)

    // Contact admin state
    const [contactCategory, setContactCategory] = useState('')
    const [contactMessage, setContactMessage] = useState('')
    const [contactSubmitting, setContactSubmitting] = useState(false)
    const [contactSuccess, setContactSuccess] = useState(false)
    const [contactError, setContactError] = useState<string | null>(null)
    const [myRequests, setMyRequests] = useState<SupportRequest[]>([])
    const [showMyRequests, setShowMyRequests] = useState(false)
    const [contactCollapsed, setContactCollapsed] = useState(true)

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
    const handleExportProject = () => downloadCsv('/profile/export-project', 'project-data.csv', setExportingProject)

    // Load support requests for students
    useEffect(() => {
        if (!isAdmin) {
            getMySupportRequests().then(data => setMyRequests(data.requests)).catch(() => {})
        }
    }, [isAdmin])

    const handleContactSubmit = async () => {
        if (!contactCategory || !contactMessage.trim()) return
        setContactSubmitting(true)
        setContactError(null)
        try {
            const data = await submitSupportRequest(contactCategory, contactMessage)
            setMyRequests(prev => [data.request, ...prev])
            setContactCategory('')
            setContactMessage('')
            setContactSuccess(true)
            setTimeout(() => setContactSuccess(false), 3000)
        } catch (err: unknown) {
            const apiErr = err as { status?: number; message?: string }
            if (apiErr.status === 429) {
                setContactError('You have too many open requests. Please wait for existing ones to be resolved.')
            } else {
                setContactError('Failed to send request. Please try again.')
            }
        } finally {
            setContactSubmitting(false)
        }
    }

    const CONTACT_CATEGORIES = [
        { value: 'account_issue', label: 'Account Issue' },
        { value: 'data_concern', label: 'Data Concern' },
        { value: 'chatbot_problem', label: 'Chatbot Problem' },
        { value: 'technical_bug', label: 'Technical Bug' },
        { value: 'feature_request', label: 'Feature Request' },
        { value: 'other', label: 'Other' }
    ]

    const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
        open:     { bg: '#fef3c7', text: '#92400e', label: 'Open' },
        resolved: { bg: '#ecfdf5', text: '#065f46', label: 'Resolved' },
        closed:   { bg: '#f3f4f6', text: '#6b7280', label: 'Closed' }
    }

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

                    {/* Download Project Data (compiled, anonymized sample + synthetic rows) */}
                    <div style={{
                        padding: '16px',
                        border: '1px solid #8b5cf6',
                        borderRadius: '8px',
                        backgroundColor: '#f5f3ff',
                        marginBottom: '20px'
                    }}>
                        <h3 style={{ margin: '0 0 8px', color: '#6d28d9', fontSize: '14px' }}>Download Project Data</h3>
                        <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 12px' }}>
                            CSV file contains data for the Project. The data represent answers of the self-regulation
                            and well-being questionnaires. All data on a scale of 1-5.
                        </p>
                        <button
                            onClick={handleExportProject}
                            disabled={exportingProject}
                            style={{
                                padding: '8px 16px', backgroundColor: '#7c3aed', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
                                opacity: exportingProject ? 0.6 : 1
                            }}
                        >
                            {exportingProject ? 'Compiling...' : 'Download Project Data'}
                        </button>
                    </div>

                    {/* Contact Admin */}
                    <div style={{
                        padding: '16px',
                        border: '1px solid #a5b4fc',
                        borderRadius: '8px',
                        backgroundColor: '#eef2ff',
                        marginBottom: '20px'
                    }}>
                        <button
                            onClick={() => setContactCollapsed(v => !v)}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                padding: 0, margin: 0, display: 'flex', alignItems: 'center', gap: '6px',
                                width: '100%', textAlign: 'left'
                            }}
                        >
                            <span style={{ fontSize: '12px', color: '#3730a3' }}>{contactCollapsed ? '▶' : '▼'}</span>
                            <h3 style={{ margin: 0, color: '#3730a3', fontSize: '14px' }}>Contact Admin</h3>
                        </button>

                        {!contactCollapsed && <>
                        <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 12px' }}>
                            Have an issue or suggestion? Send a message to the admin team.
                        </p>

                        <select
                            value={contactCategory}
                            onChange={e => setContactCategory(e.target.value)}
                            style={{
                                width: '100%', padding: '8px 12px', fontSize: '13px',
                                border: '1px solid #d1d5db', borderRadius: '6px', marginBottom: '8px',
                                backgroundColor: 'white', color: contactCategory ? '#1f2937' : '#9ca3af'
                            }}
                        >
                            <option value="" disabled>Select a category...</option>
                            {CONTACT_CATEGORIES.map(c => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                        </select>

                        <div style={{ position: 'relative' }}>
                            <textarea
                                placeholder="Describe your issue or suggestion..."
                                value={contactMessage}
                                onChange={e => setContactMessage(e.target.value)}
                                maxLength={2000}
                                style={{
                                    width: '100%', minHeight: '80px', padding: '8px 12px', fontSize: '13px',
                                    border: '1px solid #d1d5db', borderRadius: '6px', resize: 'vertical',
                                    fontFamily: 'inherit', boxSizing: 'border-box'
                                }}
                            />
                            <span style={{
                                position: 'absolute', bottom: '8px', right: '12px',
                                fontSize: '11px', color: contactMessage.length > 1900 ? '#dc2626' : '#9ca3af'
                            }}>
                                {contactMessage.length}/2000
                            </span>
                        </div>

                        {contactError && (
                            <p style={{ fontSize: '12px', color: '#dc2626', margin: '4px 0' }}>{contactError}</p>
                        )}
                        {contactSuccess && (
                            <p style={{ fontSize: '12px', color: '#059669', margin: '4px 0' }}>Request sent successfully!</p>
                        )}

                        <button
                            onClick={handleContactSubmit}
                            disabled={!contactCategory || !contactMessage.trim() || contactSubmitting}
                            style={{
                                padding: '8px 16px', backgroundColor: '#4f46e5', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
                                marginTop: '8px',
                                opacity: (!contactCategory || !contactMessage.trim() || contactSubmitting) ? 0.5 : 1
                            }}
                        >
                            {contactSubmitting ? 'Sending...' : 'Send Request'}
                        </button>

                        {/* Previous requests */}
                        {myRequests.length > 0 && (
                            <div style={{ marginTop: '16px', borderTop: '1px solid #c7d2fe', paddingTop: '12px' }}>
                                <button
                                    onClick={() => setShowMyRequests(v => !v)}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        fontSize: '13px', color: '#4f46e5', fontWeight: 500, padding: 0
                                    }}
                                >
                                    {showMyRequests ? '▼' : '▶'} My Previous Requests ({myRequests.length})
                                </button>
                                {showMyRequests && (
                                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {myRequests.map(req => {
                                            const badge = STATUS_BADGE[req.status] || STATUS_BADGE.open
                                            return (
                                                <div key={req.id} style={{
                                                    padding: '10px 12px', background: 'white',
                                                    border: '1px solid #e5e7eb', borderRadius: '8px'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                                                        <span style={{
                                                            fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                                                            background: badge.bg, color: badge.text, fontWeight: 600
                                                        }}>
                                                            {badge.label}
                                                        </span>
                                                        <span style={{ fontSize: '12px', color: '#6b7280' }}>
                                                            {CONTACT_CATEGORIES.find(c => c.value === req.category)?.label || req.category}
                                                        </span>
                                                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                                                            · {new Date(req.created_at).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                    <p style={{ fontSize: '13px', color: '#374151', margin: '4px 0', whiteSpace: 'pre-wrap' }}>
                                                        {req.message}
                                                    </p>
                                                    {req.admin_response && (
                                                        <div style={{
                                                            marginTop: '8px', padding: '8px 10px',
                                                            background: '#ecfdf5', border: '1px solid #a7f3d0',
                                                            borderRadius: '6px', fontSize: '12px', color: '#065f46'
                                                        }}>
                                                            <strong>Admin:</strong> {req.admin_response}
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                        </>}
                    </div>

                    {/* Consent & Data Management */}
                    <div style={{ padding: '16px', border: '1px solid #ef4444', borderRadius: '8px', backgroundColor: '#fef2f2' }}>
                        <h3 style={{ margin: '0 0 8px', color: '#dc2626', fontSize: '14px' }}>Data & Consent</h3>

                        {/* Option 1: Delete Data Only */}
                        <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 8px' }}>
                            Removes all your data (questionnaire responses, sleep logs, screen time logs, chat history,
                            and scores) but keeps your account active. You can continue using the app.
                        </p>
                        <button
                            onClick={async () => {
                                if (window.confirm('Are you sure? This will permanently delete ALL your data and log you out. Your account will remain active.')) {
                                    try {
                                        await api.post('/consent/revoke', {});
                                        window.location.href = '/login';
                                    } catch (err) {
                                        alert('Failed to delete data. Please try again.');
                                    }
                                }
                            }}
                            style={{
                                padding: '8px 16px', backgroundColor: '#dc2626', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
                            }}
                        >
                            Delete My Data
                        </button>

                        <hr style={{ margin: '14px 0', border: 'none', borderTop: '1px solid #fca5a5' }} />

                        {/* Option 2: Delete Account */}
                        <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 8px' }}>
                            Permanently deletes your account and all associated data. You will not be able to log back in.
                        </p>
                        <button
                            onClick={async () => {
                                if (window.confirm('This will permanently delete your account and ALL your data. You will not be able to log back in.')) {
                                    if (window.confirm('Are you absolutely sure? This cannot be undone.')) {
                                        try {
                                            await api.post('/consent/delete-account', {});
                                            window.location.href = '/login';
                                        } catch (err) {
                                            alert('Failed to delete account. Please try again.');
                                        }
                                    }
                                }
                            }}
                            style={{
                                padding: '8px 16px', backgroundColor: '#7f1d1d', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
                            }}
                        >
                            Delete My Account
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Profile
