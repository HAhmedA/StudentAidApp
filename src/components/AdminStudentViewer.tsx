import { useEffect, useState } from 'react'
import {
    getMoodleConnectionStatus,
    getStudentSyncStatus,
    syncAllStudents,
    syncStudent,
    type MoodleConnectionStatus,
    type StudentLmsSyncStatus,
    type SyncAllResult,
} from '../api/lms'

const API_BASE = '/api'

interface StudentInfo { id: string; name: string; email: string; exclude_from_clustering: boolean }

interface Props {
    onStudentSelect: (studentId: string, studentName: string) => void
    selectedStudentId: string
}

const AdminStudentViewer = ({ onStudentSelect, selectedStudentId }: Props) => {
    // ── existing student list (for dropdown) ──────────────────────────────
    const [students, setStudents] = useState<StudentInfo[]>([])
    const [studentsLoading, setStudentsLoading] = useState(false)

    // ── Moodle integration state ───────────────────────────────────────────
    const [connectionStatus, setConnectionStatus] = useState<MoodleConnectionStatus | null>(null)
    const [syncStatuses, setSyncStatuses] = useState<StudentLmsSyncStatus[]>([])
    const [syncAllLoading, setSyncAllLoading] = useState(false)
    const [syncAllResult, setSyncAllResult] = useState<SyncAllResult | null>(null)
    const [perStudentSyncing, setPerStudentSyncing] = useState<Set<string>>(new Set())
    const [syncSearch, setSyncSearch] = useState('')
    const [excludeLoading, setExcludeLoading] = useState<Set<string>>(new Set())

    useEffect(() => {
        // Load students for dropdown
        setStudentsLoading(true)
        fetch(`${API_BASE}/admin/students`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (data.students) setStudents(data.students)
                setStudentsLoading(false)
            })
            .catch(() => setStudentsLoading(false))

        // Load Moodle connection status and student sync statuses
        getMoodleConnectionStatus()
            .then(setConnectionStatus)
            .catch(() => setConnectionStatus({ connected: false, sitename: null, moodleConfigured: false }))

        getStudentSyncStatus()
            .then(setSyncStatuses)
            .catch(() => {})
    }, [])

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value
        const student = students.find(s => s.id === id)
        onStudentSelect(id, student?.name ?? '')
    }

    const handleSyncAll = async () => {
        setSyncAllLoading(true)
        setSyncAllResult(null)
        try {
            const result = await syncAllStudents()
            setSyncAllResult(result)
            // Refresh sync statuses after bulk sync
            const updated = await getStudentSyncStatus()
            setSyncStatuses(updated)
        } catch {
            // Connection error surfaced via the result banner
        } finally {
            setSyncAllLoading(false)
        }
    }

    const handleSyncStudent = async (userId: string) => {
        setPerStudentSyncing(prev => new Set(prev).add(userId))
        try {
            await syncStudent(userId)
            const updated = await getStudentSyncStatus()
            setSyncStatuses(updated)
        } catch {
            // Individual sync errors are silently ignored in the UI
        } finally {
            setPerStudentSyncing(prev => {
                const next = new Set(prev)
                next.delete(userId)
                return next
            })
        }
    }

    const handleToggleExclusion = async (userId: string, currentExcluded: boolean) => {
        const newValue = !currentExcluded
        // Optimistic update
        setStudents(prev => prev.map(s => s.id === userId ? { ...s, exclude_from_clustering: newValue } : s))
        setExcludeLoading(prev => new Set(prev).add(userId))
        try {
            await fetch(`${API_BASE}/admin/students/${userId}/cluster-exclusion`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exclude: newValue })
            })
        } catch {
            // Roll back on network error
            setStudents(prev => prev.map(s => s.id === userId ? { ...s, exclude_from_clustering: currentExcluded } : s))
        } finally {
            setExcludeLoading(prev => { const next = new Set(prev); next.delete(userId); return next })
        }
    }

    const formatLastSync = (ts: string | null) => {
        if (!ts) return '—'
        return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }

    return (
        <div className='admin-student-selector'>

            {/* ── Moodle connection badge + bulk sync ── */}
            <div className='admin-moodle-header'>
                <div className='admin-moodle-badge-row'>
                    {connectionStatus === null ? (
                        <span className='admin-moodle-badge badge-neutral'>Checking Moodle...</span>
                    ) : !connectionStatus.moodleConfigured ? (
                        <span className='admin-moodle-badge badge-warning'>Moodle not configured — set MOODLE_BASE_URL and MOODLE_TOKEN</span>
                    ) : connectionStatus.connected ? (
                        <span className='admin-moodle-badge badge-success'>Connected to {connectionStatus.sitename}</span>
                    ) : (
                        <span className='admin-moodle-badge badge-error'>Moodle unreachable{connectionStatus.error ? ` — ${connectionStatus.error}` : ''}</span>
                    )}

                    <button
                        className='admin-sync-btn'
                        onClick={handleSyncAll}
                        disabled={syncAllLoading || !connectionStatus?.connected}
                    >
                        {syncAllLoading ? 'Syncing...' : 'Sync All from Moodle'}
                    </button>
                </div>

                {syncAllResult && (
                    <div className={`admin-sync-result ${syncAllResult.skipped.length > 0 ? 'has-skipped' : ''}`}>
                        {syncAllResult.synced}/{syncAllResult.total} students synced
                        {syncAllResult.skipped.length > 0 && (
                            <span> — {syncAllResult.skipped.length} skipped
                                ({syncAllResult.skipped.map(s => `${s.email}: ${s.reason}`).join(', ')})
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* ── Student LMS sync table ── */}
            {syncStatuses.length > 0 && (() => {
                const q = syncSearch.trim().toLowerCase()
                const filtered = q
                    ? syncStatuses.filter(s => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
                    : syncStatuses
                const syncedCount = syncStatuses.filter(s => s.hasMoodleData).length
                // Build exclusion lookup from the students list (now includes exclude_from_clustering)
                const exclusionByUserId = new Map(students.map(s => [s.id, s.exclude_from_clustering]))
                return (
                    <div className='admin-lms-section'>
                        <div className='admin-lms-search-row'>
                            <input
                                className='admin-lms-search'
                                type='text'
                                placeholder='Search students…'
                                value={syncSearch}
                                onChange={e => setSyncSearch(e.target.value)}
                            />
                            <span className='admin-lms-count'>{syncedCount}/{syncStatuses.length} synced</span>
                        </div>
                        <div className='admin-lms-table-wrapper'>
                            <table className='admin-lms-table'>
                                <thead>
                                    <tr>
                                        <th>Student</th>
                                        <th>Email</th>
                                        <th>LMS</th>
                                        <th>Last Sync</th>
                                        <th>Cluster</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.length === 0 ? (
                                        <tr><td colSpan={6} className='admin-lms-empty'>No students match</td></tr>
                                    ) : filtered.map(s => {
                                        const isExcluded = exclusionByUserId.get(s.userId) ?? false
                                        return (
                                            <tr key={s.userId} className={isExcluded ? 'cluster-excluded-row' : ''}>
                                                <td>{s.name}</td>
                                                <td className='admin-lms-email'>{s.email}</td>
                                                <td className={s.hasMoodleData ? 'lms-synced' : 'lms-none'}>
                                                    {s.hasMoodleData ? '✓' : '—'}
                                                </td>
                                                <td className='admin-lms-date'>{formatLastSync(s.lastSync)}</td>
                                                <td>
                                                    {isExcluded
                                                        ? <span className='cluster-excluded-badge'>Excluded</span>
                                                        : <span className='cluster-included-badge'>Included</span>
                                                    }
                                                </td>
                                                <td className='admin-lms-actions'>
                                                    <button
                                                        className='admin-sync-row-btn'
                                                        onClick={() => handleSyncStudent(s.userId)}
                                                        disabled={perStudentSyncing.has(s.userId) || !connectionStatus?.connected}
                                                    >
                                                        {perStudentSyncing.has(s.userId) ? '…' : 'Sync'}
                                                    </button>
                                                    <button
                                                        className={`admin-exclude-row-btn ${isExcluded ? 'is-excluded' : ''}`}
                                                        onClick={() => handleToggleExclusion(s.userId, isExcluded)}
                                                        disabled={excludeLoading.has(s.userId)}
                                                        title={isExcluded ? 'Re-include in clustering pool' : 'Exclude from clustering pool'}
                                                    >
                                                        {excludeLoading.has(s.userId) ? '…' : isExcluded ? 'Include' : 'Exclude'}
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            })()}

            {/* ── Existing student selector (unchanged) ── */}
            <div className='admin-selector-header'>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <h2>View Student Dashboard</h2>
            </div>
            <p className='admin-selector-description'>Select a student to view their performance dashboard</p>
            <select
                className='admin-student-select'
                value={selectedStudentId}
                onChange={handleChange}
            >
                <option value=''>— Select a student —</option>
                {studentsLoading ? (
                    <option disabled>Loading...</option>
                ) : (
                    students.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                    ))
                )}
            </select>
        </div>
    )
}

export default AdminStudentViewer
