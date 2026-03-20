import { useEffect, useState } from 'react'
import { getAdminSupportRequests, resolveAdminSupportRequest, SupportRequest, SupportRequestCounts } from '../api/supportRequests'

type FilterStatus = 'open' | 'resolved' | 'closed' | undefined

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
    account_issue:   { bg: '#dbeafe', text: '#1e40af' },
    data_concern:    { bg: '#fef3c7', text: '#92400e' },
    chatbot_problem: { bg: '#fecaca', text: '#991b1b' },
    technical_bug:   { bg: '#ede9fe', text: '#5b21b6' },
    feature_request: { bg: '#ecfdf5', text: '#065f46' },
    other:           { bg: '#f3f4f6', text: '#6b7280' }
}

const CATEGORY_LABELS: Record<string, string> = {
    account_issue:   'Account Issue',
    data_concern:    'Data Concern',
    chatbot_problem: 'Chatbot Problem',
    technical_bug:   'Technical Bug',
    feature_request: 'Feature Request',
    other:           'Other'
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    open:     { bg: '#fef3c7', text: '#92400e' },
    resolved: { bg: '#ecfdf5', text: '#065f46' },
    closed:   { bg: '#f3f4f6', text: '#6b7280' }
}

function timeAgo(iso: string): string {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
}

const AdminSupportRequestsPanel = () => {
    const [collapsed, setCollapsed] = useState(true)
    const [requests, setRequests] = useState<SupportRequest[]>([])
    const [counts, setCounts] = useState<SupportRequestCounts>({ open: 0, resolved: 0, closed: 0, total: 0 })
    const [loading, setLoading] = useState(false)
    const [activeFilter, setActiveFilter] = useState<FilterStatus>('open')
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [responseText, setResponseText] = useState<Record<string, string>>({})

    const loadRequests = async (status: FilterStatus) => {
        setLoading(true)
        try {
            const data = await getAdminSupportRequests(status, 50, 0)
            setRequests(data.requests)
            setCounts(data.counts)
        } catch {
            // Silently fail
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!collapsed) loadRequests(activeFilter)
    }, [collapsed, activeFilter])

    const handleResolve = async (requestId: string, status: 'resolved' | 'closed') => {
        const adminResponse = responseText[requestId]?.trim() || undefined

        // Optimistic update
        setRequests(prev => prev.map(r =>
            r.id === requestId ? { ...r, status, admin_response: adminResponse || r.admin_response, resolved_at: new Date().toISOString() } : r
        ))
        setCounts(prev => {
            const old = requests.find(r => r.id === requestId)
            if (!old || old.status === status) return prev
            return {
                ...prev,
                [old.status]: Math.max(0, prev[old.status as keyof SupportRequestCounts] as number - 1),
                [status]: (prev[status as keyof SupportRequestCounts] as number) + 1
            }
        })

        try {
            await resolveAdminSupportRequest(requestId, status, adminResponse)
        } catch {
            loadRequests(activeFilter)
        }
    }

    const filterPills: { label: string; status: FilterStatus; count: number }[] = [
        { label: 'Open',     status: 'open',     count: counts.open },
        { label: 'Resolved', status: 'resolved', count: counts.resolved },
        { label: 'Closed',   status: 'closed',   count: counts.closed },
        { label: 'All',      status: undefined,   count: counts.total }
    ]

    return (
        <div style={{ marginTop: 16 }}>
            {/* Collapsible header */}
            <div
                onClick={() => setCollapsed(c => !c)}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 20px', cursor: 'pointer', borderRadius: collapsed ? 12 : '12px 12px 0 0',
                    background: 'linear-gradient(135deg, #ede9fe, #dbeafe)',
                    border: '1px solid #a5b4fc', borderBottom: collapsed ? undefined : 'none',
                    transition: 'border-radius 0.2s ease'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>✉</span>
                    <span style={{ fontWeight: 600, fontSize: 15, color: '#3730a3' }}>Support Requests</span>
                    {counts.open > 0 && (
                        <span style={{
                            background: '#4f46e5', color: 'white', fontSize: 11, padding: '2px 8px',
                            borderRadius: 10, fontWeight: 600
                        }}>
                            {counts.open} open
                        </span>
                    )}
                </div>
                <span style={{ fontSize: 13, color: '#666', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </div>

            {/* Panel content */}
            {!collapsed && (
                <div style={{
                    border: '1px solid #a5b4fc', borderTop: 'none',
                    borderRadius: '0 0 12px 12px', background: '#fff'
                }}>
                    {/* Filter pills */}
                    <div style={{
                        display: 'flex', gap: 8, padding: '12px 20px',
                        background: '#f9fafb', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap', alignItems: 'center'
                    }}>
                        <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>Filter:</span>
                        {filterPills.map(pill => (
                            <button
                                key={pill.label}
                                onClick={() => setActiveFilter(pill.status)}
                                style={{
                                    padding: '4px 12px', borderRadius: 16, fontSize: 12, cursor: 'pointer',
                                    border: '1px solid #d1d5db',
                                    background: activeFilter === pill.status ? '#4f46e5' : 'white',
                                    color: activeFilter === pill.status ? 'white' : '#374151',
                                    fontWeight: activeFilter === pill.status ? 600 : 400,
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                {pill.label} ({pill.count})
                            </button>
                        ))}
                    </div>

                    {/* Loading */}
                    {loading && (
                        <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
                            Loading support requests...
                        </div>
                    )}

                    {/* Empty state */}
                    {!loading && requests.length === 0 && (
                        <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                            No support requests{activeFilter ? ` with status "${activeFilter}"` : ''}.
                        </div>
                    )}

                    {/* Request cards */}
                    {!loading && requests.map(req => {
                        const expanded = expandedId === req.id
                        const catColor = CATEGORY_COLORS[req.category] || CATEGORY_COLORS.other
                        const statusColor = STATUS_COLORS[req.status] || STATUS_COLORS.open
                        const isDimmed = req.status !== 'open'

                        return (
                            <div
                                key={req.id}
                                style={{
                                    margin: '0 20px 12px', border: `1px solid ${isDimmed ? '#e5e7eb' : '#a5b4fc'}`,
                                    borderRadius: 12, overflow: 'hidden', background: isDimmed ? '#f9fafb' : 'white',
                                    opacity: isDimmed ? 0.7 : 1, transition: 'opacity 0.2s'
                                }}
                            >
                                {/* Card header */}
                                <div
                                    onClick={() => setExpandedId(expanded ? null : req.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '12px 16px', cursor: 'pointer',
                                        background: expanded && !isDimmed ? '#eef2ff' : 'transparent',
                                        borderBottom: expanded ? '1px solid #c7d2fe' : 'none'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                        <span style={{
                                            background: catColor.bg, color: catColor.text,
                                            fontSize: 11, padding: '3px 10px', borderRadius: 6, fontWeight: 600
                                        }}>
                                            {CATEGORY_LABELS[req.category] || req.category}
                                        </span>
                                        <span style={{ fontSize: 12, color: '#6b7280' }}>
                                            by <strong>{req.student_email}</strong>
                                        </span>
                                        <span style={{ fontSize: 12, color: '#9ca3af' }}>
                                            · {timeAgo(req.created_at)}
                                        </span>
                                        <span style={{
                                            background: statusColor.bg, color: statusColor.text,
                                            fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 500
                                        }}>
                                            {req.status === 'resolved' ? '✓ ' : ''}{req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                                        </span>
                                    </div>
                                    <span style={{ fontSize: 14, color: '#9ca3af', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
                                </div>

                                {/* Expanded content */}
                                {expanded && (
                                    <div style={{ padding: 16 }}>
                                        <div style={{ marginBottom: 12 }}>
                                            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Message:</div>
                                            <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' }}>
                                                {req.message}
                                            </div>
                                        </div>

                                        {req.admin_response && (
                                            <div style={{ marginBottom: 12 }}>
                                                <div style={{ fontSize: 11, color: '#065f46', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Admin response:</div>
                                                <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#374151' }}>
                                                    {req.admin_response}
                                                </div>
                                            </div>
                                        )}

                                        {req.resolved_by_email && (
                                            <div style={{ marginBottom: 16, fontSize: 12, color: '#9ca3af' }}>
                                                Resolved by {req.resolved_by_email} · {req.resolved_at ? timeAgo(req.resolved_at) : ''}
                                            </div>
                                        )}

                                        {req.status === 'open' && (
                                            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                                                <textarea
                                                    placeholder="Response to student (optional)"
                                                    value={responseText[req.id] || ''}
                                                    onChange={e => setResponseText(prev => ({ ...prev, [req.id]: e.target.value }))}
                                                    style={{
                                                        width: '100%', minHeight: 60, padding: '8px 12px', fontSize: 13,
                                                        border: '1px solid #d1d5db', borderRadius: 8, resize: 'vertical',
                                                        fontFamily: 'inherit', marginBottom: 8, boxSizing: 'border-box'
                                                    }}
                                                />
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    <button
                                                        onClick={() => handleResolve(req.id, 'resolved')}
                                                        style={{
                                                            padding: '6px 16px', borderRadius: 8, border: '1px solid #059669',
                                                            background: '#ecfdf5', color: '#059669', fontSize: 13, cursor: 'pointer', fontWeight: 500
                                                        }}
                                                    >
                                                        ✓ Mark Resolved
                                                    </button>
                                                    <button
                                                        onClick={() => handleResolve(req.id, 'closed')}
                                                        style={{
                                                            padding: '6px 16px', borderRadius: 8, border: '1px solid #d1d5db',
                                                            background: 'white', color: '#6b7280', fontSize: 13, cursor: 'pointer'
                                                        }}
                                                    >
                                                        Close
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}

                    {/* Bottom padding */}
                    {!loading && requests.length > 0 && <div style={{ height: 8 }} />}
                </div>
            )}
        </div>
    )
}

export default AdminSupportRequestsPanel
