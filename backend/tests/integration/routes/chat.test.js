/**
 * Integration tests for chat routes — focusing on the IDOR guard (CRIT-T2).
 *
 * GET /api/chat/history must verify that the requesting user owns the session
 * before returning any messages. A user supplying another user's sessionId must
 * receive 403, not 200.
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ────────────────────────────────────────────────────────────
const mockQuery          = jest.fn()
const mockLogInfo        = jest.fn()
const mockLogError       = jest.fn()
const mockGetHistory     = jest.fn()
const mockGetSessions    = jest.fn()
const mockGetOrCreate    = jest.fn()
const mockSendMessage    = jest.fn()
const mockGreeting       = jest.fn()
const mockResetSession   = jest.fn()

// ── ESM module mocks ──────────────────────────────────────────────────────────
jest.unstable_mockModule('../../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, warn: jest.fn(), debug: jest.fn() }
}))
jest.unstable_mockModule('../../../services/contextManagerService.js', () => ({
    sendMessage:            mockSendMessage,
    generateInitialGreeting: mockGreeting,
    getSessionHistory:      mockGetHistory,
    getUserSessions:        mockGetSessions,
    getOrCreateSession:     mockGetOrCreate,
    resetSession:           mockResetSession,
}))

// ── Dynamic imports after mocks ───────────────────────────────────────────────
const { default: chatRouter } = await import('../../../routes/chat.js')

// ── App factory ──────────────────────────────────────────────────────────────
function buildApp(userId = 'user-a') {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    // Inject an authenticated session for the given userId
    app.use((req, _res, next) => {
        req.session.user = { id: userId, role: 'student' }
        next()
    })
    app.use('/api/chat', chatRouter)
    return app
}

beforeEach(() => {
    mockQuery.mockReset()
    mockGetHistory.mockReset()
    mockGetSessions.mockReset()
    mockGetOrCreate.mockReset()
})

// ── CRIT-T2: IDOR guard on GET /api/chat/history ─────────────────────────────
describe('GET /api/chat/history — IDOR guard (CRIT-T2)', () => {

    it('returns 400 when sessionId is missing', async () => {
        const res = await request(buildApp()).get('/api/chat/history')
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/sessionId is required/i)
    })

    it('returns 403 when the session belongs to a different user', async () => {
        // The DB ownership check finds no row for user-a / other-user-session
        mockQuery.mockResolvedValueOnce({ rows: [] })

        const res = await request(buildApp('user-a'))
            .get('/api/chat/history?sessionId=other-user-session-uuid')

        expect(res.status).toBe(403)
        expect(res.body.error).toBe('forbidden')
        // History should NOT be fetched
        expect(mockGetHistory).not.toHaveBeenCalled()
    })

    it('returns 200 with messages when the session belongs to the requesting user', async () => {
        const sessionId = 'user-a-session-uuid'
        const fakeMessages = [
            { role: 'user', content: 'Hello', created_at: new Date().toISOString() },
            { role: 'assistant', content: 'Hi!', created_at: new Date().toISOString() },
        ]

        // Ownership check passes — row found
        mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] })
        mockGetHistory.mockResolvedValueOnce(fakeMessages)

        const res = await request(buildApp('user-a'))
            .get(`/api/chat/history?sessionId=${sessionId}`)

        expect(res.status).toBe(200)
        expect(res.body.messages).toHaveLength(2)
        // Route fetches limit+1 to detect hasMore; default limit=20 → 21
        expect(mockGetHistory).toHaveBeenCalledWith(sessionId, 21, null)
    })

    it('enforces the ownership check with the correct userId from session — not from query params', async () => {
        // User B tries to access user A's session by knowing the UUID
        const userASessionId = 'user-a-private-session'
        mockQuery.mockResolvedValueOnce({ rows: [] }) // ownership check: no match for user-b

        const res = await request(buildApp('user-b'))
            .get(`/api/chat/history?sessionId=${userASessionId}`)

        expect(res.status).toBe(403)
        // Verify the DB query used user-b's ID, not user-a's
        expect(mockQuery).toHaveBeenCalledWith(
            expect.stringContaining('user_id'),
            [userASessionId, 'user-b']
        )
    })

    it('respects the limit cap — cannot request more than 50 messages', async () => {
        const sessionId = 'session-uuid'
        mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] })
        mockGetHistory.mockResolvedValueOnce([])

        await request(buildApp('user-a'))
            .get(`/api/chat/history?sessionId=${sessionId}&limit=999`)

        // parsedLimit capped at 50; route fetches +1 for hasMore probe → 51
        expect(mockGetHistory).toHaveBeenCalledWith(sessionId, 51, null)
    })
})
