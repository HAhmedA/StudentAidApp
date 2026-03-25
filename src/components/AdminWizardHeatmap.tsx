import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'

interface Student { id: string; name: string; excluded: boolean }
interface HeatmapData {
    students: Student[]
    completions: Record<string, string[]>
    startDate: string
    endDate: string
}

function toDateStr(d: Date) { return d.toISOString().slice(0, 10) }

function generateDates(start: string, end: string): string[] {
    const dates: string[] = []
    const cur = new Date(start + 'T00:00:00')
    const last = new Date(end + 'T00:00:00')
    while (cur <= last) {
        dates.push(toDateStr(cur))
        cur.setDate(cur.getDate() + 1)
    }
    return dates // oldest first (left → right)
}

function formatDateLabel(iso: string) {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const AdminWizardHeatmap = () => {
    const [collapsed, setCollapsed] = useState(true)
    const [endDate, setEndDate] = useState(() => toDateStr(new Date()))
    const [startDate, setStartDate] = useState(() =>
        toDateStr(new Date(Date.now() - 14 * 86400000))
    )
    const [data, setData] = useState<HeatmapData | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [includedOnly, setIncludedOnly] = useState(true)
    const debounceRef = useRef<ReturnType<typeof setTimeout>>()

    const fetchData = useCallback(async (s: string, e: string) => {
        if (s > e) { setError('Start date must be before end date'); return }
        setLoading(true)
        setError('')
        try {
            const res = await api.get<HeatmapData>(
                `/admin/wizard-completions?startDate=${s}&endDate=${e}`
            )
            setData(res)
        } catch (err: any) {
            setError(err?.message || 'Failed to load heatmap data')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        if (collapsed) return
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => fetchData(startDate, endDate), 300)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [collapsed, startDate, endDate, fetchData])

    const dates = data ? generateDates(data.startDate, data.endDate) : []

    // Build lookup sets for O(1) checks
    const completionSets: Record<string, Set<string>> = {}
    if (data) {
        for (const [uid, arr] of Object.entries(data.completions)) {
            completionSets[uid] = new Set(arr)
        }
    }

    // Filter students based on toggle
    const allStudents = data?.students ?? []
    const students = includedOnly ? allStudents.filter(s => !s.excluded) : allStudents

    // Per-student totals
    const studentTotals: Record<string, number> = {}
    for (const s of students) {
        studentTotals[s.id] = dates.filter(d => completionSets[s.id]?.has(d)).length
    }

    return (
        <div style={{
            background: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            marginTop: '16px',
            overflow: 'hidden'
        }}>
            {/* Collapsible header */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', gap: '12px' }}>
                <button
                    onClick={() => setCollapsed(c => !c)}
                    style={{
                        flex: 1,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: '#374151',
                        textAlign: 'left',
                        padding: 0
                    }}
                >
                    <span>Wizard Completion Heatmap</span>
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                        {collapsed ? 'Show \u25BC' : 'Hide \u25B2'}
                    </span>
                </button>
            </div>

            {!collapsed && (
                <div style={{ padding: '0 20px 20px' }}>
                    {/* Controls row */}
                    <div style={{
                        display: 'flex', gap: '16px', alignItems: 'center',
                        marginBottom: '12px', flexWrap: 'wrap'
                    }}>
                        <label style={{ fontSize: '13px', color: '#374151' }}>
                            Start{' '}
                            <input
                                type='date'
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                style={{
                                    padding: '4px 8px', borderRadius: '6px',
                                    border: '1px solid #d1d5db', fontSize: '13px'
                                }}
                            />
                        </label>
                        <label style={{ fontSize: '13px', color: '#374151' }}>
                            End{' '}
                            <input
                                type='date'
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                                style={{
                                    padding: '4px 8px', borderRadius: '6px',
                                    border: '1px solid #d1d5db', fontSize: '13px'
                                }}
                            />
                        </label>
                        <label style={{
                            fontSize: '13px', color: '#374151',
                            display: 'flex', alignItems: 'center', gap: '4px',
                            cursor: 'pointer', userSelect: 'none'
                        }}>
                            <input
                                type='checkbox'
                                checked={includedOnly}
                                onChange={e => setIncludedOnly(e.target.checked)}
                                style={{ accentColor: '#2563eb' }}
                            />
                            Included only
                        </label>
                    </div>

                    {error && (
                        <div style={{ color: '#dc2626', fontSize: '13px', marginBottom: '8px' }}>
                            {error}
                        </div>
                    )}

                    {loading && (
                        <div style={{ fontSize: '13px', color: '#6b7280', padding: '12px 0' }}>
                            Loading...
                        </div>
                    )}

                    {!loading && data && students.length === 0 && (
                        <div style={{ fontSize: '13px', color: '#6b7280', padding: '12px 0' }}>
                            No students found.
                        </div>
                    )}

                    {!loading && data && students.length > 0 && (
                        <div style={{
                            overflowX: 'auto',
                            overflowY: 'auto',
                            maxHeight: '500px',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px'
                        }}>
                            <table style={{
                                borderCollapse: 'collapse',
                                fontSize: '12px',
                                minWidth: '100%'
                            }}>
                                <thead>
                                    <tr>
                                        {/* Top-left corner: "Student" */}
                                        <th style={{
                                            position: 'sticky', left: 0, top: 0, zIndex: 3,
                                            background: '#f9fafb', padding: '6px 10px',
                                            borderBottom: '2px solid #e5e7eb',
                                            borderRight: '2px solid #e5e7eb',
                                            fontWeight: 600, color: '#374151',
                                            textAlign: 'left', minWidth: '120px'
                                        }}>
                                            Student
                                        </th>
                                        {/* Date columns */}
                                        {dates.map(date => (
                                            <th key={date} style={{
                                                position: 'sticky', top: 0, zIndex: 2,
                                                background: '#f9fafb',
                                                padding: '6px 4px',
                                                borderBottom: '2px solid #e5e7eb',
                                                fontWeight: 600, color: '#374151',
                                                whiteSpace: 'nowrap',
                                                minWidth: '38px',
                                                textAlign: 'center',
                                                fontSize: '10px'
                                            }}>
                                                {formatDateLabel(date)}
                                            </th>
                                        ))}
                                        {/* Top-right corner: "Total" */}
                                        <th style={{
                                            position: 'sticky', top: 0, right: 0, zIndex: 3,
                                            background: '#f0f9ff',
                                            padding: '6px 10px',
                                            borderBottom: '2px solid #e5e7eb',
                                            borderLeft: '2px solid #e5e7eb',
                                            fontWeight: 600, color: '#1e40af',
                                            textAlign: 'center', minWidth: '44px',
                                            fontSize: '11px'
                                        }}>
                                            Total
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {students.map(s => (
                                        <tr key={s.id}>
                                            {/* Student name — sticky left */}
                                            <td style={{
                                                position: 'sticky', left: 0, zIndex: 1,
                                                background: '#f9fafb',
                                                padding: '4px 10px',
                                                borderBottom: '1px solid #f3f4f6',
                                                borderRight: '2px solid #e5e7eb',
                                                fontWeight: 500, color: '#374151',
                                                whiteSpace: 'nowrap',
                                                maxWidth: '150px',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis'
                                            }}>
                                                {s.name}
                                            </td>
                                            {/* Date cells */}
                                            {dates.map(date => {
                                                const done = completionSets[s.id]?.has(date)
                                                return (
                                                    <td key={date} style={{
                                                        padding: '4px',
                                                        borderBottom: '1px solid #f3f4f6',
                                                        textAlign: 'center',
                                                        background: done ? '#dcfce7' : '#f9fafb',
                                                        color: done ? '#16a34a' : '#d1d5db',
                                                        fontWeight: done ? 700 : 400
                                                    }}>
                                                        {done ? '\u2713' : '\u00B7'}
                                                    </td>
                                                )
                                            })}
                                            {/* Per-student total — sticky right */}
                                            <td style={{
                                                position: 'sticky', right: 0, zIndex: 1,
                                                background: '#f0f9ff',
                                                padding: '4px 10px',
                                                borderBottom: '1px solid #e0f2fe',
                                                borderLeft: '2px solid #e5e7eb',
                                                textAlign: 'center',
                                                fontWeight: 600, color: '#1e40af'
                                            }}>
                                                {studentTotals[s.id]}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        {/* Bottom-left corner: "Count" */}
                                        <td style={{
                                            position: 'sticky', left: 0, bottom: 0, zIndex: 3,
                                            background: '#f3f4f6',
                                            padding: '6px 10px',
                                            borderTop: '2px solid #d1d5db',
                                            borderRight: '2px solid #e5e7eb',
                                            fontWeight: 700, color: '#374151'
                                        }}>
                                            Count
                                        </td>
                                        {/* Per-date totals */}
                                        {dates.map(date => {
                                            const count = students.filter(s =>
                                                completionSets[s.id]?.has(date)
                                            ).length
                                            return (
                                                <td key={date} style={{
                                                    position: 'sticky', bottom: 0, zIndex: 2,
                                                    background: '#f3f4f6',
                                                    padding: '6px 4px',
                                                    borderTop: '2px solid #d1d5db',
                                                    textAlign: 'center',
                                                    fontWeight: 700, color: '#374151'
                                                }}>
                                                    {count}
                                                </td>
                                            )
                                        })}
                                        {/* Bottom-right corner: grand total */}
                                        <td style={{
                                            position: 'sticky', right: 0, bottom: 0, zIndex: 3,
                                            background: '#dbeafe',
                                            padding: '6px 10px',
                                            borderTop: '2px solid #d1d5db',
                                            borderLeft: '2px solid #e5e7eb',
                                            textAlign: 'center',
                                            fontWeight: 700, color: '#1e40af'
                                        }}>
                                            {Object.values(studentTotals).reduce((a, b) => a + b, 0)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default AdminWizardHeatmap
