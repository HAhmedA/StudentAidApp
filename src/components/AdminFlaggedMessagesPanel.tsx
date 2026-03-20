import { useEffect, useState } from 'react'
import { getFlaggedMessages, updateFlagStatus, getFeedbackStats, getFeedbackStatsByUser, Flag, UserFeedbackStats } from '../api/flaggedMessages'

type FilterStatus = 'pending' | 'reviewed' | 'dismissed' | undefined

const REASON_COLORS: Record<string, { bg: string; text: string }> = {
    inaccurate:    { bg: '#dbeafe', text: '#1e40af' },
    inappropriate: { bg: '#fecaca', text: '#991b1b' },
    irrelevant:    { bg: '#e5e7eb', text: '#374151' },
    harmful:       { bg: '#fde68a', text: '#92400e' },
    other:         { bg: '#f3f4f6', text: '#6b7280' }
}

const REASON_LABELS: Record<string, string> = {
    inaccurate:    'Inaccurate / Misleading',
    inappropriate: 'Inappropriate / Offensive',
    irrelevant:    'Irrelevant / Off-topic',
    harmful:       'Harmful / Unsafe',
    other:         'Other'
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    pending:   { bg: '#fef3c7', text: '#92400e' },
    reviewed:  { bg: '#ecfdf5', text: '#065f46' },
    dismissed: { bg: '#f3f4f6', text: '#6b7280' }
}

function timeAgo(iso: string): string {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
}

const AdminFlaggedMessagesPanel = () => {
    const [collapsed, setCollapsed] = useState(true)
    const [flags, setFlags] = useState<Flag[]>([])
    const [counts, setCounts] = useState({ pending: 0, reviewed: 0, dismissed: 0 })
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(false)
    const [activeFilter, setActiveFilter] = useState<FilterStatus>('pending')
    const [expandedFlagId, setExpandedFlagId] = useState<string | null>(null)
    const [feedbackStats, setFeedbackStats] = useState<{ total_likes: number; total_dislikes: number } | null>(null)
    const [userStats, setUserStats] = useState<UserFeedbackStats[]>([])
    const [showUserBreakdown, setShowUserBreakdown] = useState(false)

    const loadFlags = async (status: FilterStatus) => {
        setLoading(true)
        try {
            const data = await getFlaggedMessages(status, 50, 0)
            setFlags(data.flags)
            setCounts(data.counts)
            setTotal(data.total)
        } catch {
            // Silently fail
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!collapsed) {
            loadFlags(activeFilter)
            getFeedbackStats().then(setFeedbackStats).catch(() => {})
            getFeedbackStatsByUser().then(d => setUserStats(d.users)).catch(() => {})
        }
    }, [collapsed, activeFilter])

    const handleResolve = async (flagId: string, status: 'reviewed' | 'dismissed') => {
        // Optimistic update
        setFlags(prev => prev.map(f =>
            f.id === flagId ? { ...f, status, resolved_at: new Date().toISOString() } : f
        ))
        setCounts(prev => {
            const oldFlag = flags.find(f => f.id === flagId)
            if (!oldFlag || oldFlag.status === status) return prev
            return {
                ...prev,
                [oldFlag.status]: Math.max(0, prev[oldFlag.status as keyof typeof prev] - 1),
                [status]: prev[status as keyof typeof prev] + 1
            }
        })

        try {
            await updateFlagStatus(flagId, status)
        } catch {
            // Rollback on error
            loadFlags(activeFilter)
        }
    }

    const filterPills: { label: string; status: FilterStatus; count: number }[] = [
        { label: 'Pending',   status: 'pending',   count: counts.pending },
        { label: 'Reviewed',  status: 'reviewed',  count: counts.reviewed },
        { label: 'Dismissed', status: 'dismissed', count: counts.dismissed },
        { label: 'All',       status: undefined,   count: total }
    ]

    return (
        <div style={{ marginTop: 16 }}>
            {/* Collapsible header */}
            <div
                onClick={() => setCollapsed(c => !c)}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 20px', cursor: 'pointer', borderRadius: collapsed ? 12 : '12px 12px 0 0',
                    background: 'linear-gradient(135deg, #fee2e2, #fef3c7)',
                    border: '1px solid #fca5a5', borderBottom: collapsed ? undefined : 'none',
                    transition: 'border-radius 0.2s ease'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>⚑</span>
                    <span style={{ fontWeight: 600, fontSize: 15, color: '#991b1b' }}>Chatbot Feedback</span>
                    {feedbackStats && (
                        <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 400 }}>
                            👍 {feedbackStats.total_likes} · 👎 {feedbackStats.total_dislikes}
                        </span>
                    )}
                    {counts.pending > 0 && (
                        <span style={{
                            background: '#dc2626', color: 'white', fontSize: 11, padding: '2px 8px',
                            borderRadius: 10, fontWeight: 600
                        }}>
                            {counts.pending} pending
                        </span>
                    )}
                </div>
                <span style={{ fontSize: 13, color: '#666', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </div>

            {/* Panel content */}
            {!collapsed && (
                <div style={{
                    border: '1px solid #fca5a5', borderTop: 'none',
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
                                    background: activeFilter === pill.status ? '#dc2626' : 'white',
                                    color: activeFilter === pill.status ? 'white' : '#374151',
                                    fontWeight: activeFilter === pill.status ? 600 : 400,
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                {pill.label} ({pill.count})
                            </button>
                        ))}
                    </div>

                    {/* Per-user breakdown */}
                    {userStats.length > 0 && (
                        <div style={{ padding: '0 20px' }}>
                            <button
                                onClick={() => setShowUserBreakdown(b => !b)}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    fontSize: 13, color: '#6b7280', padding: '10px 0',
                                    display: 'flex', alignItems: 'center', gap: 6
                                }}
                            >
                                <span style={{
                                    display: 'inline-block', fontSize: 10,
                                    transform: showUserBreakdown ? 'rotate(90deg)' : 'none',
                                    transition: 'transform 0.2s'
                                }}>▶</span>
                                Per-user breakdown ({userStats.length} users)
                            </button>
                            {showUserBreakdown && (
                                <table style={{
                                    width: '100%', borderCollapse: 'collapse', fontSize: 13,
                                    marginBottom: 12
                                }}>
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                                            <th style={{ padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Student</th>
                                            <th style={{ padding: '6px 8px', color: '#6b7280', fontWeight: 600, textAlign: 'center' }}>👍</th>
                                            <th style={{ padding: '6px 8px', color: '#6b7280', fontWeight: 600, textAlign: 'center' }}>👎</th>
                                            <th style={{ padding: '6px 8px', color: '#6b7280', fontWeight: 600, textAlign: 'center' }}>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {userStats.map(u => (
                                            <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                                <td style={{ padding: '8px 8px' }}>
                                                    <div style={{ fontWeight: 500, color: '#374151' }}>{u.name || 'Unnamed'}</div>
                                                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{u.email}</div>
                                                </td>
                                                <td style={{ padding: '8px 8px', textAlign: 'center', color: u.likes > 0 ? '#3b82f6' : '#d1d5db', fontWeight: 600 }}>
                                                    {u.likes}
                                                </td>
                                                <td style={{ padding: '8px 8px', textAlign: 'center', color: u.dislikes > 0 ? '#ef4444' : '#d1d5db', fontWeight: 600 }}>
                                                    {u.dislikes}
                                                </td>
                                                <td style={{ padding: '8px 8px', textAlign: 'center', color: '#374151', fontWeight: 600 }}>
                                                    {u.likes + u.dislikes}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}

                    {/* Loading */}
                    {loading && (
                        <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
                            Loading flagged messages...
                        </div>
                    )}

                    {/* Empty state */}
                    {!loading && flags.length === 0 && (
                        <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                            No flagged messages{activeFilter ? ` with status "${activeFilter}"` : ''}.
                        </div>
                    )}

                    {/* Flag cards */}
                    {!loading && flags.map(flag => {
                        const expanded = expandedFlagId === flag.id
                        const reasonColor = REASON_COLORS[flag.reason] || REASON_COLORS.other
                        const statusColor = STATUS_COLORS[flag.status] || STATUS_COLORS.pending
                        const isDimmed = flag.status !== 'pending'

                        return (
                            <div
                                key={flag.id}
                                style={{
                                    margin: '0 20px 12px', border: `1px solid ${isDimmed ? '#e5e7eb' : '#fca5a5'}`,
                                    borderRadius: 12, overflow: 'hidden', background: isDimmed ? '#f9fafb' : 'white',
                                    opacity: isDimmed ? 0.7 : 1, transition: 'opacity 0.2s'
                                }}
                            >
                                {/* Card header (always visible) */}
                                <div
                                    onClick={() => setExpandedFlagId(expanded ? null : flag.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '12px 16px', cursor: 'pointer',
                                        background: expanded && !isDimmed ? '#fef2f2' : 'transparent',
                                        borderBottom: expanded ? '1px solid #fecaca' : 'none'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                        <span style={{
                                            background: reasonColor.bg, color: reasonColor.text,
                                            fontSize: 11, padding: '3px 10px', borderRadius: 6, fontWeight: 600
                                        }}>
                                            {REASON_LABELS[flag.reason] || flag.reason}
                                        </span>
                                        <span style={{ fontSize: 12, color: '#6b7280' }}>
                                            by <strong>{flag.student_email}</strong>
                                        </span>
                                        <span style={{ fontSize: 12, color: '#9ca3af' }}>
                                            · {timeAgo(flag.created_at)}
                                        </span>
                                        <span style={{
                                            background: statusColor.bg, color: statusColor.text,
                                            fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 500
                                        }}>
                                            {flag.status === 'reviewed' ? '✓ ' : ''}{flag.status.charAt(0).toUpperCase() + flag.status.slice(1)}
                                        </span>
                                    </div>
                                    <span style={{ fontSize: 14, color: '#9ca3af', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
                                </div>

                                {/* Expanded content */}
                                {expanded && (
                                    <div style={{ padding: 16 }}>
                                        {flag.user_message_content && (
                                            <div style={{ marginBottom: 12 }}>
                                                <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Student asked:</div>
                                                <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#374151' }}>
                                                    {flag.user_message_content}
                                                </div>
                                            </div>
                                        )}
                                        <div style={{ marginBottom: 12 }}>
                                            <div style={{ fontSize: 11, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>⚑ Flagged response:</div>
                                            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#374151' }}>
                                                {flag.message_content}
                                            </div>
                                        </div>
                                        {flag.comment && (
                                            <div style={{ marginBottom: 16 }}>
                                                <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Student comment:</div>
                                                <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>"{flag.comment}"</div>
                                            </div>
                                        )}
                                        {flag.resolved_by_email && (
                                            <div style={{ marginBottom: 16, fontSize: 12, color: '#9ca3af' }}>
                                                Resolved by {flag.resolved_by_email} · {flag.resolved_at ? timeAgo(flag.resolved_at) : ''}
                                            </div>
                                        )}
                                        {flag.status === 'pending' && (
                                            <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                                                <button
                                                    onClick={() => handleResolve(flag.id, 'reviewed')}
                                                    style={{
                                                        padding: '6px 16px', borderRadius: 8, border: '1px solid #059669',
                                                        background: '#ecfdf5', color: '#059669', fontSize: 13, cursor: 'pointer', fontWeight: 500
                                                    }}
                                                >
                                                    ✓ Mark Reviewed
                                                </button>
                                                <button
                                                    onClick={() => handleResolve(flag.id, 'dismissed')}
                                                    style={{
                                                        padding: '6px 16px', borderRadius: 8, border: '1px solid #d1d5db',
                                                        background: 'white', color: '#6b7280', fontSize: 13, cursor: 'pointer'
                                                    }}
                                                >
                                                    Dismiss
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}

                    {/* Bottom padding */}
                    {!loading && flags.length > 0 && <div style={{ height: 8 }} />}
                </div>
            )}
        </div>
    )
}

export default AdminFlaggedMessagesPanel
