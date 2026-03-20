import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import './Chatbot.css'
import { getInitialChat, getHistory, sendMessage as sendMessageApi, resetChat, getChatStatus, getChatPreferences, updateChatPreferences, ChatbotPreferences, flagMessage, unflagMessage, likeMessage, unlikeMessage, getMyFeedback } from '../api/chat'

interface Message {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    created_at: string
    isError?: boolean
    failedMessage?: string
}

interface ChatbotProps {
    isLoggedIn: boolean
}

// Default suggested prompts (fallback when dynamic prompts unavailable)
const DEFAULT_PROMPTS = [
    "What are the best studying strategies based on my data?",
    "Analyze my learning data",
    "What are my learning trends?",
    "How can I improve based on my history?"
]

const Chatbot = ({ isLoggedIn }: ChatbotProps) => {
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState<Message[]>([])
    const [inputValue, setInputValue] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [cooldown, setCooldown] = useState(false)

    // Enhancement states
    const [hasUnread, setHasUnread] = useState(false)
    const [cachedGreeting, setCachedGreeting] = useState<{ greeting: string | null, sessionId: string, messages: Message[] | null } | null>(null)
    const [isPrefetching, setIsPrefetching] = useState(false)

    // New UX improvement states
    const [showResetConfirm, setShowResetConfirm] = useState(false)
    const [isAwaitingResponse, setIsAwaitingResponse] = useState(false)
    const [isResetting, setIsResetting] = useState(false)
    const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>(DEFAULT_PROMPTS)

    // LLM availability status (null = unknown/loading)
    const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null)

    // "Need help?" pill — shown briefly on login
    const [showHiPill, setShowHiPill] = useState(false)

    // Settings panel + persona preferences
    const [activeView, setActiveView] = useState<'messages' | 'settings'>('messages')
    const [preferences, setPreferences] = useState<ChatbotPreferences | null>(null)
    const [isSavingPrefs, setIsSavingPrefs] = useState(false)

    // Proactive data-update banner
    const [dataUpdateBanner, setDataUpdateBanner] = useState<{ dataType: string } | null>(null)

    // Message feedback state (like / dislike-flag)
    const [likedMessageIds, setLikedMessageIds] = useState<Set<string>>(new Set())
    const [flaggedMessageIds, setFlaggedMessageIds] = useState<Set<string>>(new Set())
    const [flagModalMessageId, setFlagModalMessageId] = useState<string | null>(null)
    const [flagReason, setFlagReason] = useState<string>('')
    const [flagComment, setFlagComment] = useState<string>('')
    const [flagSubmitting, setFlagSubmitting] = useState(false)
    const [flagError, setFlagError] = useState<string | null>(null)
    const [unflagConfirmId, setUnflagConfirmId] = useState<string | null>(null)
    const [flagToast, setFlagToast] = useState<string | null>(null)

    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Ref to prevent race conditions on greeting fetch
    const isFetchingRef = useRef(false)

    // Generation counter: incremented on wizardComplete to invalidate in-flight prefetch
    const greetingGenRef = useRef(0)

    // Scroll to bottom of messages
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    // Show "Need help?" pill on login, auto-hide after 10s
    useEffect(() => {
        if (!isLoggedIn) return
        setShowHiPill(true)
        const t = setTimeout(() => setShowHiPill(false), 10000)
        return () => clearTimeout(t)
    }, [isLoggedIn])

    // Poll LLM availability every 30 seconds while logged in
    useEffect(() => {
        if (!isLoggedIn) return
        const check = () => {
            getChatStatus()
                .then(r => setLlmAvailable(r.available))
                .catch((err) => {
                    // Don't show "Offline" for auth errors — session handling
                    // will redirect to login; only mark offline for real LLM issues
                    if (err?.status === 401) return
                    setLlmAvailable(false)
                })
        }
        check()
        const interval = setInterval(check, 30000)
        return () => clearInterval(interval)
    }, [isLoggedIn])

    // Pre-fetch greeting on login (before chat is opened)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (isLoggedIn && !cachedGreeting && !isPrefetching && !isFetchingRef.current) {
            prefetchGreeting()
        }
    }, [isLoggedIn]) // Only trigger on login state change

    // When chat opens, use cached greeting if available
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (isOpen && isLoggedIn && messages.length === 0) {
            if (cachedGreeting) {
                setSessionId(cachedGreeting.sessionId)

                if (cachedGreeting.messages && cachedGreeting.messages.length > 0) {
                    // Existing session - restore cached messages
                    setMessages(cachedGreeting.messages)
                } else if (cachedGreeting.greeting) {
                    // New session - use greeting
                    setMessages([{
                        id: 'initial',
                        role: 'assistant',
                        content: cachedGreeting.greeting,
                        created_at: new Date().toISOString()
                    }])
                }
                setHasUnread(false) // Clear badge when chat is opened
            } else if (!isFetchingRef.current) {
                // Fetch if not already fetching
                loadInitialGreeting()
            }
        }
    }, [isOpen, isLoggedIn, cachedGreeting]) // Only trigger when chat opens or greeting is cached

    // Clear unread badge when chat is opened
    useEffect(() => {
        if (isOpen) {
            setHasUnread(false)
        }
    }, [isOpen])

    // Load preferences once when chat opens for the first time
    useEffect(() => {
        if (isOpen && isLoggedIn && !preferences) {
            getChatPreferences().then(setPreferences).catch(console.error)
        }
    }, [isOpen, isLoggedIn, preferences])

    // Restore feedback state (likes + flags) when session changes
    useEffect(() => {
        if (sessionId) {
            getMyFeedback(sessionId)
                .then(data => {
                    setFlaggedMessageIds(new Set(data.flaggedMessageIds))
                    setLikedMessageIds(new Set(data.likedMessageIds))
                })
                .catch(() => {}) // Feedback state is cosmetic — fail silently
        }
    }, [sessionId])

    // Listen for data-submission events from other pages/components
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { dataType: string }
            setDataUpdateBanner({ dataType: detail.dataType })
            if (!isOpen) setHasUnread(true)
        }
        window.addEventListener('chatbot:dataUpdated', handler)
        return () => window.removeEventListener('chatbot:dataUpdated', handler)
    }, [isOpen])

    // Listen for wizard completion — reset chat session so LLM generates
    // a fresh greeting that incorporates the newly submitted data
    useEffect(() => {
        const handler = async () => {
            const myGen = ++greetingGenRef.current  // Invalidate any in-flight prefetch
            isFetchingRef.current = true  // Block the open-chat effect from calling loadInitialGreeting
            setShowHiPill(false)
            setCachedGreeting(null)
            setMessages([])   // Clear immediately to prevent stale flash
            setIsOpen(true)
            setIsLoading(true)
            try {
                const res = await resetChat()
                if (greetingGenRef.current !== myGen) return  // Superseded by another event
                setSessionId(res.sessionId)
                setMessages([{
                    id: 'wizard-greeting',
                    role: 'assistant',
                    content: res.greeting,
                    created_at: new Date().toISOString()
                }])
                setSuggestedPrompts(DEFAULT_PROMPTS)
            } catch {
                // Fallback: just open with whatever we have
            } finally {
                setIsLoading(false)
                isFetchingRef.current = false
            }
        }
        window.addEventListener('chatbot:wizardComplete', handler)
        return () => window.removeEventListener('chatbot:wizardComplete', handler)
    }, [])

    // Listen for external open requests (e.g. navbar "Chat about my data" button)
    useEffect(() => {
        const handler = () => {
            setIsOpen(true)
            setShowHiPill(false)
        }
        window.addEventListener('chatbot:open', handler)
        return () => window.removeEventListener('chatbot:open', handler)
    }, [])

    // Scroll to bottom when messages change or when chat opens
    useEffect(() => {
        if (isOpen && messages.length > 0) {
            scrollToBottom()
        }
    }, [messages, isOpen, scrollToBottom])

    // Focus input when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus()
        }
    }, [isOpen])

    // Pre-fetch greeting in background (on login) with race condition protection
    const prefetchGreeting = async () => {
        if (isFetchingRef.current) return
        const myGen = greetingGenRef.current  // Snapshot current generation
        isFetchingRef.current = true
        setIsPrefetching(true)
        try {
            const data = await getInitialChat()

            // Wizard fired during prefetch — discard stale result
            if (greetingGenRef.current !== myGen) return

            if (data.hasExistingSession && data.messages) {
                // Existing session with messages - cache them, no badge (user already saw them)
                setCachedGreeting({
                    greeting: null,
                    sessionId: data.sessionId,
                    messages: data.messages
                })
                // Don't show badge for existing session (user already saw these messages)
            } else if (data.greeting) {
                // New session with fresh greeting - show badge
                setCachedGreeting({
                    greeting: data.greeting,
                    sessionId: data.sessionId,
                    messages: null
                })
                // Update suggested prompts if provided
                if (data.suggestedPrompts && Array.isArray(data.suggestedPrompts) && data.suggestedPrompts.length > 0) {
                    setSuggestedPrompts(data.suggestedPrompts)
                }
                // Show unread badge since we have a NEW message ready
                setHasUnread(true)
            }
        } catch (error) {
            console.error('Failed to prefetch greeting:', error)
            // Will fall back to loading on open
        } finally {
            setIsPrefetching(false)
            isFetchingRef.current = false
        }
    }

    const loadInitialGreeting = async () => {
        if (isFetchingRef.current) return
        const myGen = greetingGenRef.current  // Snapshot to detect wizard firing during load
        isFetchingRef.current = true
        setIsLoading(true)
        try {
            const data = await getInitialChat()

            // Wizard fired during this load — discard stale result
            if (greetingGenRef.current !== myGen) return

            setSessionId(data.sessionId)

            if (data.hasExistingSession && data.messages) {
                // Existing session - restore messages
                setMessages(data.messages.map((msg: { id: string; role: string; content: string; created_at: string }) => ({
                    id: msg.id,
                    role: msg.role as 'user' | 'assistant' | 'system',
                    content: msg.content,
                    created_at: msg.created_at
                })))
            } else if (data.greeting) {
                // New session with greeting
                setMessages([{
                    id: 'initial',
                    role: 'assistant',
                    content: data.greeting,
                    created_at: new Date().toISOString()
                }])
                // Update suggested prompts if provided
                if (data.suggestedPrompts && Array.isArray(data.suggestedPrompts) && data.suggestedPrompts.length > 0) {
                    setSuggestedPrompts(data.suggestedPrompts)
                }
            }
        } catch (error) {
            console.error('Failed to load initial greeting:', error)
            setMessages([{
                id: 'error',
                role: 'assistant',
                content: "Hello! I'm here to help you with your learning journey. How can I assist you today?",
                created_at: new Date().toISOString()
            }])
        } finally {
            setIsLoading(false)
            isFetchingRef.current = false
        }
    }

    const loadMoreHistory = async () => {
        if (!sessionId || isLoadingMore || !hasMore) return

        setIsLoadingMore(true)
        const oldestMessage = messages[0]

        try {
            const data = await getHistory(sessionId, 20, oldestMessage?.id)

            if (data.messages && data.messages.length > 0) {
                setMessages(prev => [...data.messages, ...prev])
                setHasMore(data.hasMore)
            } else {
                setHasMore(false)
            }
        } catch (error) {
            console.error('Failed to load history:', error)
        } finally {
            setIsLoadingMore(false)
        }
    }

    const handleScroll = () => {
        const container = messagesContainerRef.current
        if (container && container.scrollTop === 0 && hasMore && !isLoadingMore) {
            loadMoreHistory()
        }
    }

    // Core send function — accepts message directly to avoid stale-closure bugs.
    // Called by the input form (reads inputValue), retry, suggested prompts, and
    // data-refresh banner (all pass the text explicitly).
    const sendDirectMessage = async (text: string) => {
        const userMessage = text.trim()
        if (!userMessage || isLoading || cooldown) return

        setInputValue('')

        // Add user message immediately (random suffix prevents key collisions)
        const uid = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        setMessages(prev => [...prev, {
            id: uid,
            role: 'user',
            content: userMessage,
            created_at: new Date().toISOString()
        }])

        // Start cooldown (short guard to prevent accidental double-send)
        setCooldown(true)
        setTimeout(() => setCooldown(false), 500)

        setIsLoading(true)
        setIsAwaitingResponse(true) // Always trigger await, regardless of chat state

        try {
            const data = await sendMessageApi(userMessage)

            if (data.sessionId) {
                // Detect session change (e.g. 30min expiry created a new session)
                setSessionId(prev => {
                    if (prev && prev !== data.sessionId) {
                        // Session changed — clear stale local messages, keep only
                        // the user message we just added and the upcoming assistant reply
                        setMessages(msgs => msgs.filter(m => m.id === uid))
                        setHasMore(false)
                    }
                    return data.sessionId
                })
            }

            const aid = data.messageId || `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
            setMessages(prev => [...prev, {
                id: aid,
                role: 'assistant',
                content: data.response || "I couldn't process that. Please try again.",
                created_at: new Date().toISOString()
            }])

            // Update suggested prompts with dynamic ones from API (or keep defaults)
            if (data.suggestedPrompts && Array.isArray(data.suggestedPrompts) && data.suggestedPrompts.length > 0) {
                setSuggestedPrompts(data.suggestedPrompts)
            }

            // If chat is closed, show unread badge
            if (!isOpen) {
                setHasUnread(true)
            }
        } catch (error) {
            console.error('Failed to send message:', error)
            setMessages(prev => [...prev, {
                id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                role: 'assistant',
                content: "Something went wrong. Please try again.",
                created_at: new Date().toISOString(),
                isError: true,
                failedMessage: userMessage
            }])
        } finally {
            setIsLoading(false)
            setIsAwaitingResponse(false)
        }
    }

    // Convenience wrapper for the input field — reads inputValue from state
    const sendMessage = () => sendDirectMessage(inputValue)

    // Retry failed message — passes text directly (no stale closure)
    const handleRetry = (msg: Message) => {
        if (!msg.failedMessage) return
        setMessages(prev => prev.filter(m => m.id !== msg.id))
        sendDirectMessage(msg.failedMessage)
    }

    // Handle suggested prompt click — passes text directly (no stale closure)
    const handleSuggestedPrompt = (prompt: string) => {
        setSuggestedPrompts(prev => prev.filter(p => p !== prompt))
        sendDirectMessage(prompt)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    // Reset button click - show confirmation if messages exist
    const handleResetClick = () => {
        if (messages.length > 1) {
            setShowResetConfirm(true)
        } else {
            handleReset()
        }
    }

    const handleReset = async () => {
        if (isLoading || isResetting) return
        setShowResetConfirm(false)
        setIsResetting(true)
        setIsLoading(true)

        try {
            const data = await resetChat()

            if (data.success) {
                setSessionId(data.sessionId)
                setMessages([{
                    id: 'reset-greeting',
                    role: 'assistant',
                    content: data.greeting,
                    created_at: new Date().toISOString()
                }])
                setHasMore(false)
                // Clear cached greeting so we get fresh one next time
                setCachedGreeting(null)
                // Reset suggested prompts to defaults
                setSuggestedPrompts(DEFAULT_PROMPTS)
                // Clear flag state for old session
                setFlaggedMessageIds(new Set())
            }
        } catch (error) {
            console.error('Failed to reset session:', error)
        } finally {
            setIsLoading(false)
            setIsResetting(false)
        }
    }

    const handleRefreshSummary = () => {
        const dataType = dataUpdateBanner?.dataType ?? 'latest'
        setDataUpdateBanner(null)
        setActiveView('messages')
        sendDirectMessage(`Please give me an updated summary based on my latest ${dataType} data`)
    }

    const handlePreferenceChange = async (key: keyof ChatbotPreferences, value: string) => {
        setPreferences(prev => prev ? { ...prev, [key]: value } : null)
        setIsSavingPrefs(true)
        try {
            const updated = await updateChatPreferences({ [key]: value })
            setPreferences(updated)
        } catch (err) {
            console.error('Failed to save preference:', err)
        } finally {
            setIsSavingPrefs(false)
        }
    }

    // ── Message feedback handlers (like / dislike-flag) ────────────

    const handleLikeToggle = async (messageId: string) => {
        const wasLiked = likedMessageIds.has(messageId)

        // Optimistic update
        if (wasLiked) {
            setLikedMessageIds(prev => { const next = new Set(prev); next.delete(messageId); return next })
        } else {
            setLikedMessageIds(prev => new Set(prev).add(messageId))
            // Mutual exclusivity: clear dislike if present
            if (flaggedMessageIds.has(messageId)) {
                setFlaggedMessageIds(prev => { const next = new Set(prev); next.delete(messageId); return next })
            }
        }

        try {
            if (wasLiked) {
                await unlikeMessage(messageId)
            } else {
                await likeMessage(messageId)
            }
        } catch {
            // Rollback on error
            if (wasLiked) {
                setLikedMessageIds(prev => new Set(prev).add(messageId))
            } else {
                setLikedMessageIds(prev => { const next = new Set(prev); next.delete(messageId); return next })
            }
        }
    }

    const handleFlagSubmit = async () => {
        if (!flagModalMessageId || !flagReason) return
        setFlagSubmitting(true)
        setFlagError(null)
        try {
            await flagMessage(flagModalMessageId, flagReason, flagComment || undefined)
            setFlaggedMessageIds(prev => new Set(prev).add(flagModalMessageId))
            // Mutual exclusivity: clear like
            setLikedMessageIds(prev => { const next = new Set(prev); next.delete(flagModalMessageId); return next })
            setFlagModalMessageId(null)
            setFlagReason('')
            setFlagComment('')
            setFlagToast('Response flagged')
            setTimeout(() => setFlagToast(null), 3000)
        } catch (err: unknown) {
            const apiErr = err as { status?: number }
            if (apiErr.status === 409) {
                setFlagError('You have already flagged this message')
            } else {
                setFlagError('Failed to submit flag. Please try again.')
            }
        } finally {
            setFlagSubmitting(false)
        }
    }

    const handleUnflag = async (messageId: string) => {
        try {
            await unflagMessage(messageId)
            setFlaggedMessageIds(prev => {
                const next = new Set(prev)
                next.delete(messageId)
                return next
            })
        } catch {
            // Admin may have already reviewed — keep the flag shown
        } finally {
            setUnflagConfirmId(null)
        }
    }

    const toggleChat = () => {
        setIsOpen(!isOpen)
    }

    // Don't render if not logged in
    if (!isLoggedIn) return null

    return (
        <div className={`chatbot-container ${isOpen ? 'open' : ''}`}>
            {/* "Need help?" pill */}
            {showHiPill && !isOpen && (
                <div className="chatbot-hi-pill" onClick={toggleChat}>Let's discuss your data 💬</div>
            )}

            {/* Floating bubble button */}
            <button
                className="chatbot-bubble"
                onClick={() => { toggleChat(); setShowHiPill(false) }}
                aria-label={isOpen ? 'Close chat' : 'Open chat'}
            >
                {hasUnread && !isOpen && (
                    <span className="chatbot-badge" aria-label="New message" />
                )}
                {isAwaitingResponse && !isOpen && (
                    <span className="chatbot-processing-indicator" aria-label="Processing" />
                )}
                {isOpen ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                ) : (
                    <span role="img" aria-label="student" style={{ fontSize: '40px', lineHeight: 1, display: 'block' }}>🧑‍🎓</span>
                )}
            </button>

            {/* Chat window */}
            {isOpen && (
                <div className="chatbot-window">
                    <div className="chatbot-header">
                        <div className="chatbot-header-info">
                            <div className="chatbot-avatar">🎓</div>
                            <div className="chatbot-header-text">
                                <h3>Learning Assistant</h3>
                                <span className={`chatbot-status ${llmAvailable === false ? 'chatbot-status--offline' : ''}`}>
                                    {llmAvailable === null ? 'Checking…' : llmAvailable ? 'Online' : 'Offline'}
                                </span>
                            </div>
                        </div>
                        <button
                            className="chatbot-reset-btn"
                            onClick={handleResetClick}
                            disabled={isLoading || isResetting}
                            title="Start a new conversation"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 4V1L8 5L12 9V6C15.31 6 18 8.69 18 12C18 13.01 17.75 13.97 17.3 14.8L18.76 16.26C19.54 15.03 20 13.57 20 12C20 7.58 16.42 4 12 4ZM12 18C8.69 18 6 15.31 6 12C6 10.99 6.25 10.03 6.7 9.2L5.24 7.74C4.46 8.97 4 10.43 4 12C4 16.42 7.58 20 12 20V23L16 19L12 15V18Z" fill="currentColor" />
                            </svg>
                            <span>New Chat</span>
                        </button>
                        <button
                            className={`chatbot-gear-btn${activeView === 'settings' ? ' active' : ''}`}
                            onClick={() => setActiveView(v => v === 'settings' ? 'messages' : 'settings')}
                            title="Chatbot settings"
                            aria-label="Chatbot settings"
                        >
                            ⚙
                        </button>
                    </div>

                    {activeView === 'settings' ? (
                        <div className="chatbot-settings-panel">
                            <button
                                className="chatbot-settings-back"
                                onClick={() => setActiveView('messages')}
                            >
                                ← Back to chat
                            </button>
                            <h4 className="chatbot-settings-title">Assistant Settings</h4>
                            {isSavingPrefs && <p className="chatbot-settings-saving">Saving…</p>}

                            <div className="chatbot-settings-group">
                                <label className="chatbot-settings-label">Response Length</label>
                                <div className="chatbot-settings-options">
                                    {(['short', 'medium', 'long'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            className={`chatbot-settings-option${preferences?.response_length === opt ? ' selected' : ''}`}
                                            onClick={() => handlePreferenceChange('response_length', opt)}
                                        >
                                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="chatbot-settings-group">
                                <label className="chatbot-settings-label">Tone</label>
                                <div className="chatbot-settings-options">
                                    {(['friendly', 'formal', 'motivational', 'neutral'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            className={`chatbot-settings-option${preferences?.tone === opt ? ' selected' : ''}`}
                                            onClick={() => handlePreferenceChange('tone', opt)}
                                        >
                                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="chatbot-settings-group">
                                <label className="chatbot-settings-label">Answer Style</label>
                                <div className="chatbot-settings-options">
                                    {(['bullets', 'prose', 'mixed'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            className={`chatbot-settings-option${preferences?.answer_style === opt ? ' selected' : ''}`}
                                            onClick={() => handlePreferenceChange('answer_style', opt)}
                                        >
                                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                    <div
                        className="chatbot-messages"
                        ref={messagesContainerRef}
                        onScroll={handleScroll}
                    >
                        {/* Data update banner */}
                        {dataUpdateBanner && (
                            <div className="chatbot-data-banner">
                                <span>Your {dataUpdateBanner.dataType} data was just updated.</span>
                                <button className="chatbot-data-banner-refresh" onClick={handleRefreshSummary}>
                                    Refresh my summary
                                </button>
                                <button
                                    className="chatbot-data-banner-dismiss"
                                    onClick={() => setDataUpdateBanner(null)}
                                    aria-label="Dismiss"
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                        {/* Initial loading spinner */}
                        {messages.length === 0 && (isPrefetching || isLoading) && !isResetting && (
                            <div className="chatbot-initial-loading">
                                <div className="chatbot-spinner" />
                                <p>Loading your assistant...</p>
                            </div>
                        )}

                        {/* Reset loading spinner */}
                        {isResetting && (
                            <div className="chatbot-reset-loading">
                                <div className="chatbot-spinner" />
                                <p>Starting fresh conversation...</p>
                            </div>
                        )}

                        {/* Pagination affordance */}
                        {hasMore && !isLoadingMore && (
                            <button className="chatbot-load-more" onClick={loadMoreHistory}>
                                ↑ Load earlier messages
                            </button>
                        )}

                        {isLoadingMore && (
                            <div className="chatbot-loading-more">Loading older messages...</div>
                        )}

                        {messages.map((msg) => {
                            const isFlaggable = msg.role === 'assistant' && !msg.isError
                                && !['initial', 'reset-greeting', 'wizard-greeting', 'error'].includes(msg.id)
                                && !msg.id.startsWith('error-')
                            return (
                            <React.Fragment key={msg.id}>
                            <div
                                className={`chatbot-message ${msg.role}${msg.isError ? ' error' : ''}`}
                            >
                                <div className="chatbot-message-content">
                                    {msg.role === 'assistant'
                                        ? <ReactMarkdown>{msg.content}</ReactMarkdown>
                                        : msg.content}
                                </div>
                                {/* Like / Dislike buttons on assistant messages */}
                                {isFlaggable && (
                                    <div className="chatbot-feedback-buttons">
                                        <button
                                            className={`chatbot-like-btn${likedMessageIds.has(msg.id) ? ' liked' : ''}`}
                                            onClick={() => handleLikeToggle(msg.id)}
                                            title={likedMessageIds.has(msg.id) ? 'Remove like' : 'Good response'}
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/>
                                            </svg>
                                        </button>
                                        <button
                                            className={`chatbot-dislike-btn${flaggedMessageIds.has(msg.id) ? ' disliked' : ''}`}
                                            onClick={() => {
                                                if (flaggedMessageIds.has(msg.id)) {
                                                    setUnflagConfirmId(msg.id)
                                                } else {
                                                    setFlagModalMessageId(msg.id)
                                                    setFlagReason('')
                                                    setFlagComment('')
                                                    setFlagError(null)
                                                }
                                            }}
                                            title={flaggedMessageIds.has(msg.id) ? 'Flagged — click to unflag' : 'Report this response'}
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/>
                                            </svg>
                                        </button>
                                    </div>
                                )}
                                {/* Retry button for error messages */}
                                {msg.isError && msg.failedMessage && (
                                    <button
                                        className="chatbot-retry-btn"
                                        onClick={() => handleRetry(msg)}
                                    >
                                        ↻ Retry
                                    </button>
                                )}
                            </div>
                            {/* Flag report modal — inline, directly below the flagged message */}
                            {flagModalMessageId === msg.id && (
                                <div className="chatbot-flag-modal">
                                    <h4>Report this response</h4>
                                    <div className="flag-reasons">
                                        {([
                                            ['inaccurate', 'Inaccurate / Misleading'],
                                            ['inappropriate', 'Inappropriate / Offensive'],
                                            ['irrelevant', 'Irrelevant / Off-topic'],
                                            ['harmful', 'Harmful / Unsafe'],
                                            ['other', 'Other']
                                        ] as const).map(([value, label]) => (
                                            <label key={value} className="flag-reason-option">
                                                <input
                                                    type="radio"
                                                    name="flagReason"
                                                    value={value}
                                                    checked={flagReason === value}
                                                    onChange={() => setFlagReason(value)}
                                                />
                                                {label}
                                            </label>
                                        ))}
                                    </div>
                                    <textarea
                                        className="flag-comment"
                                        placeholder="Add a comment (optional)"
                                        value={flagComment}
                                        onChange={e => setFlagComment(e.target.value)}
                                        maxLength={1000}
                                    />
                                    {flagError && <p className="flag-error">{flagError}</p>}
                                    <div className="flag-actions">
                                        <button
                                            className="flag-cancel"
                                            onClick={() => setFlagModalMessageId(null)}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="flag-submit"
                                            onClick={handleFlagSubmit}
                                            disabled={!flagReason || flagSubmitting}
                                        >
                                            {flagSubmitting ? 'Submitting…' : 'Submit Report'}
                                        </button>
                                    </div>
                                </div>
                            )}
                            </React.Fragment>
                            )
                        })}

                        {/* Suggested prompts - shows when input is empty and not loading */}
                        {!isLoading && !inputValue.trim() && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && (
                            <div className="chatbot-suggestions">
                                <p className="suggestions-label">Try asking:</p>
                                <div className="suggestions-list">
                                    {suggestedPrompts.map((prompt, idx) => (
                                        <button
                                            key={idx}
                                            className="suggestion-chip"
                                            onClick={() => handleSuggestedPrompt(prompt)}
                                        >
                                            {prompt}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {isLoading && !isResetting && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                            <div className="chatbot-message assistant">
                                <div className="chatbot-message-content typing">
                                    <span className="typing-dot"></span>
                                    <span className="typing-dot"></span>
                                    <span className="typing-dot"></span>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                    )}

                    <div className="chatbot-input-container">
                        <input
                            ref={inputRef}
                            type="text"
                            className="chatbot-input"
                            placeholder="Type a message..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isLoading || isResetting}
                            maxLength={5000}
                        />
                        <button
                            className="chatbot-send-btn"
                            onClick={sendMessage}
                            disabled={isLoading || isResetting || !inputValue.trim() || cooldown}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>

                    {/* Unflag confirmation dialog */}
                    {unflagConfirmId && (
                        <div className="chatbot-confirm-overlay">
                            <div className="chatbot-confirm-dialog">
                                <p>Remove your flag?</p>
                                <div className="chatbot-confirm-buttons">
                                    <button onClick={() => setUnflagConfirmId(null)}>No</button>
                                    <button onClick={() => handleUnflag(unflagConfirmId)} className="confirm-btn">Yes</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Flag success toast */}
                    {flagToast && <div className="chatbot-flag-toast">{flagToast}</div>}

                    {/* Reset confirmation dialog */}
                    {showResetConfirm && (
                        <div className="chatbot-confirm-overlay">
                            <div className="chatbot-confirm-dialog">
                                <p>Start a new conversation?</p>
                                <span className="confirm-subtitle">Your current chat will be cleared.</span>
                                <div className="chatbot-confirm-buttons">
                                    <button onClick={() => setShowResetConfirm(false)}>Cancel</button>
                                    <button onClick={handleReset} className="confirm-btn">Reset</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default Chatbot
