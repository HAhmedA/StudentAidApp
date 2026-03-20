// AdminCsvMoodleIdPanel — Moodle CSV upload with auto-matching by Moodle ID.
// Three phases: Upload → Review/Approve → Import Result.
// Extracts Moodle user IDs from the Description column, matches against users.moodle_id,
// and presents suggestions for admin approval before importing.
// Also displays existing Moodle ID pairings with remove/wipe controls.

import { useState, useEffect } from 'react'
import {
    uploadCsvByMoodleId, approveAndImport, getStudentsForLinking,
    getMoodlePairings, deleteMoodlePairing, deleteMoodlePairingWithData,
    type MoodleIdUploadResult, type MoodleIdSuggestion, type MoodleIdImportResult,
    type LinkableStudent, type MoodlePairing
} from '../api/csvLog'

type Phase = 'upload' | 'review' | 'result'

interface ReviewRow extends MoodleIdSuggestion {
    checked: boolean
    manualUserId: string | null  // set when admin manually links an unmatched ID
}

const AdminCsvMoodleIdPanel = () => {
    const [phase, setPhase]             = useState<Phase>('upload')
    const [uploading, setUploading]     = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const [uploadResult, setUploadResult] = useState<MoodleIdUploadResult | null>(null)

    // Review state
    const [reviewRows, setReviewRows]   = useState<ReviewRow[]>([])
    const [linkableStudents, setLinkableStudents] = useState<LinkableStudent[]>([])

    // Import state
    const [importing, setImporting]       = useState(false)
    const [importError, setImportError]   = useState<string | null>(null)
    const [importResult, setImportResult] = useState<MoodleIdImportResult | null>(null)

    // Pairing management state
    const [pairings, setPairings] = useState<MoodlePairing[]>([])
    const [pairingsLoading, setPairingsLoading] = useState(false)

    // Load pairings on mount and when returning to upload phase
    useEffect(() => {
        if (phase !== 'upload') return
        setPairingsLoading(true)
        getMoodlePairings()
            .then(d => setPairings(d.pairings))
            .catch(() => {})
            .finally(() => setPairingsLoading(false))
    }, [phase])

    // Load linkable students when entering review phase
    useEffect(() => {
        if (phase !== 'review') return
        getStudentsForLinking()
            .then(d => setLinkableStudents(d.students))
            .catch(() => {})
    }, [phase])

    // -- Handlers --

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setUploading(true)
        setUploadError(null)
        try {
            const result = await uploadCsvByMoodleId(file)
            setUploadResult(result)

            // Build review rows from suggestions
            const rows: ReviewRow[] = result.suggestions.map(s => ({
                ...s,
                checked: s.matched,  // pre-check matched, uncheck unmatched
                manualUserId: null,
            }))
            setReviewRows(rows)
            setPhase('review')
        } catch (err: any) {
            setUploadError(err.message || 'Upload failed')
        } finally {
            setUploading(false)
        }
    }

    const handleToggleCheck = (moodleId: number) => {
        setReviewRows(prev => prev.map(r =>
            r.moodleId === moodleId ? { ...r, checked: !r.checked } : r
        ))
    }

    const handleManualLink = (moodleId: number, userId: string | null) => {
        setReviewRows(prev => prev.map(r => {
            if (r.moodleId !== moodleId) return r
            return { ...r, manualUserId: userId, checked: !!userId }
        }))
    }

    const handleApproveImport = async () => {
        if (!uploadResult) return

        const approved = reviewRows
            .filter(r => r.checked && r.matched && r.userId)
            .map(r => ({ moodleId: r.moodleId, userId: r.userId! }))

        const manualLinks = reviewRows
            .filter(r => r.checked && !r.matched && r.manualUserId)
            .map(r => ({ moodleId: r.moodleId, userId: r.manualUserId! }))

        setImporting(true)
        setImportError(null)
        try {
            const result = await approveAndImport(uploadResult.uploadId, approved, manualLinks)
            setImportResult(result)
            setPhase('result')
        } catch (err: any) {
            setImportError(err.message || 'Import failed')
        } finally {
            setImporting(false)
        }
    }

    const handleReset = () => {
        setPhase('upload')
        setUploadResult(null)
        setReviewRows([])
        setImportResult(null)
        setUploadError(null)
        setImportError(null)
    }

    const handleRemovePairing = async (userId: string) => {
        try {
            await deleteMoodlePairing(userId)
            setPairings(prev => prev.filter(p => p.id !== userId))
        } catch (err: any) {
            alert(`Could not remove pairing: ${err.message}`)
        }
    }

    const handleRemovePairingWithData = async (userId: string, email: string) => {
        if (!window.confirm(
            `Remove Moodle ID pairing AND all imported LMS sessions for ${email}?\n\nThis cannot be undone.`
        )) return
        try {
            const result = await deleteMoodlePairingWithData(userId)
            setPairings(prev => prev.filter(p => p.id !== userId))
            alert(`Removed pairing and ${result.sessionsDeleted} LMS session row${result.sessionsDeleted !== 1 ? 's' : ''} for ${email}.`)
        } catch (err: any) {
            alert(`Could not wipe data: ${err.message}`)
        }
    }

    // -- Derived counts --
    const matchedCount   = reviewRows.filter(r => r.matched).length
    const unmatchedCount = reviewRows.filter(r => !r.matched).length
    const selectedCount  = reviewRows.filter(r => r.checked && (r.matched || r.manualUserId)).length

    // -- Render --

    return (
        <div className='admin-csv-panel'>
            <h3 className='admin-csv-title'>Moodle ID Activity Log Import</h3>

            {/* -- PHASE: Upload -- */}
            {phase === 'upload' && (
                <div className='admin-csv-upload-zone'>
                    <p className='admin-csv-hint'>
                        Upload a Moodle activity log with a <strong>Description</strong> column.
                        Student Moodle IDs will be auto-detected and matched to app accounts.
                    </p>
                    <label className='admin-csv-file-label'>
                        <input
                            type='file'
                            accept='.csv'
                            onChange={handleFileChange}
                            disabled={uploading}
                            style={{ display: 'none' }}
                        />
                        {uploading ? 'Uploading...' : 'Choose CSV file'}
                    </label>
                    {uploadError && <p className='admin-csv-error'>{uploadError}</p>}
                </div>
            )}

            {/* -- Existing Moodle ID Pairings (visible in upload phase) -- */}
            {phase === 'upload' && !pairingsLoading && pairings.length > 0 && (
                <div className='admin-csv-mapping' style={{ marginTop: '16px' }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#374151' }}>
                        Existing Moodle ID Pairings ({pairings.length})
                    </h4>
                    <div className='admin-csv-pairs'>
                        {pairings.map(p => (
                            <div key={p.id} className='admin-csv-pair-row'>
                                <span className='admin-csv-pair-email'>{p.name || p.email}</span>
                                <span className='admin-csv-pair-arrow'>→</span>
                                <span className='admin-csv-pair-name'>Moodle ID {p.moodleId}</span>
                                <button
                                    className='admin-csv-pair-delete'
                                    onClick={() => handleRemovePairing(p.id)}
                                    title='Remove pairing only'
                                >✕</button>
                                <button
                                    className='admin-csv-pair-wipe'
                                    onClick={() => handleRemovePairingWithData(p.id, p.email)}
                                    title='Remove pairing and delete all imported LMS data'
                                >⊗</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* -- PHASE: Review & Approve -- */}
            {phase === 'review' && (
                <div className='admin-csv-mapping'>
                    {uploadResult && (
                        <p className='admin-csv-meta'>
                            Uploaded: <strong>{uploadResult.rowCount} rows</strong>
                            {uploadResult.dateRange.start && (
                                <> &middot; {uploadResult.dateRange.start} to {uploadResult.dateRange.end}</>
                            )}
                        </p>
                    )}

                    {/* Summary bar */}
                    <div className='admin-csv-id-summary'>
                        {matchedCount} matched &middot; {unmatchedCount} unmatched &middot;{' '}
                        <strong>{selectedCount}</strong> selected for import
                    </div>

                    {/* Suggestions table */}
                    <div className='admin-csv-id-table'>
                        <div className='admin-csv-id-header-row'>
                            <span className='admin-csv-id-col-check'></span>
                            <span className='admin-csv-id-col-id'>Moodle ID</span>
                            <span className='admin-csv-id-col-student'>App Student</span>
                            <span className='admin-csv-id-col-events'>Events</span>
                            <span className='admin-csv-id-col-status'>Status</span>
                        </div>

                        {reviewRows.map(row => {
                            // Students already linked to OTHER rows — exclude from this dropdown
                            const takenUserIds = new Set(
                                reviewRows
                                    .filter(r => r.moodleId !== row.moodleId && r.manualUserId)
                                    .map(r => r.manualUserId!)
                            )
                            const availableStudents = linkableStudents.filter(
                                s => !takenUserIds.has(s.id)
                            )

                            return (
                            <div key={row.moodleId} className='admin-csv-id-row'>
                                <span className='admin-csv-id-col-check'>
                                    <input
                                        type='checkbox'
                                        checked={row.checked}
                                        onChange={() => handleToggleCheck(row.moodleId)}
                                        disabled={!row.matched && !row.manualUserId}
                                    />
                                </span>
                                <span className='admin-csv-id-col-id'>{row.moodleId}</span>
                                <span className='admin-csv-id-col-student'>
                                    {row.matched ? (
                                        <>{row.name} ({row.email})</>
                                    ) : (
                                        <select
                                            value={row.manualUserId || ''}
                                            onChange={e => handleManualLink(
                                                row.moodleId,
                                                e.target.value || null
                                            )}
                                            className='admin-csv-id-select'
                                        >
                                            <option value=''>-- Select student --</option>
                                            {availableStudents.map(s => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name} ({s.email})
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </span>
                                <span className='admin-csv-id-col-events'>{row.eventCount}</span>
                                <span className='admin-csv-id-col-status'>
                                    {row.matched ? (
                                        <span className='admin-csv-id-badge matched'>Matched</span>
                                    ) : row.manualUserId ? (
                                        <span className='admin-csv-id-badge linked'>Linked</span>
                                    ) : (
                                        <span className='admin-csv-id-badge unmatched'>Unmatched</span>
                                    )}
                                </span>
                            </div>
                        )})}
                    </div>

                    {/* Action buttons */}
                    <div className='admin-csv-import-row'>
                        {importError && <p className='admin-csv-error'>{importError}</p>}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className='admin-csv-reset-btn'
                                onClick={handleReset}
                                disabled={importing}
                            >
                                Back
                            </button>
                            <button
                                className='admin-csv-import-btn'
                                onClick={handleApproveImport}
                                disabled={importing || selectedCount === 0}
                            >
                                {importing
                                    ? 'Importing...'
                                    : `Approve & Import (${selectedCount} student${selectedCount !== 1 ? 's' : ''})`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* -- PHASE: Result -- */}
            {phase === 'result' && importResult && (
                <div className='admin-csv-result'>
                    <div className='admin-csv-result-summary'>
                        Import complete — {importResult.imported} student{importResult.imported !== 1 ? 's' : ''} updated,
                        {' '}{importResult.skipped} skipped
                    </div>
                    <div className='admin-csv-result-table'>
                        {importResult.details.filter(d => d.daysUpdated > 0).map(d => (
                            <div key={d.moodleId || d.userId} className='admin-csv-result-row'>
                                <span className='admin-csv-result-email'>
                                    Moodle ID {d.moodleId}
                                </span>
                                <span className='admin-csv-result-meta'>
                                    {d.daysUpdated} day{d.daysUpdated !== 1 ? 's' : ''} &middot; {d.totalEvents} events
                                </span>
                            </div>
                        ))}
                    </div>
                    <button className='admin-csv-reset-btn' onClick={handleReset}>
                        Upload another file
                    </button>
                </div>
            )}
        </div>
    )
}

export default AdminCsvMoodleIdPanel
