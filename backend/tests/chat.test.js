/**
 * Integration tests for chat routes
 * GET  /api/chat/initial
 * POST /api/chat/message
 * GET  /api/chat/history
 * GET  /api/chat/session
 * POST /api/chat/reset
 *
 * Uses jest.unstable_mockModule to mock the service layer.
 * No real database connection is required.
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ─────────────────────────────────────────────────────────────
const mockSendMessage          = jest.fn()
const mockGenerateGreeting     = jest.fn()
const mockGetSessionHistory    = jest.fn()
const mockGetUserSessions      = jest.fn()
const mockGetOrCreateSession   = jest.fn()
const mockResetSession         = jest.fn()
const mockLogError             = jest.fn()
const mockLogInfo              = jest.fn()

// ── ESM module mocks ──────────────────────────────────────────────────────────
jest.unstable_mockModule('../services/contextManagerService.js', () => ({
    sendMessage:             mockSendMessage,
    generateInitialGreeting: mockGenerateGreeting,
    getSessionHistory:       mockGetSessionHistory,
    getUserSessions:         mockGetUserSessions,
    getOrCreateSession:      mockGetOrCreateSession,
    resetSession:            mockResetSession
}))
jest.unstable_mockModule('../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, warn: jest.fn(), debug: jest.fn() }
}))

// ── Dynamic import after mocks ─────────────────────────────────────────────────
const { default: chatRouter } = await import('../routes/chat.js')

// ── Test app factories ─────────────────────────────────────────────────────────
function buildApp(userId = null) {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: true }))
    if (userId) {
        app.use((req, _res, next) => {
            req.session.user = { id: userId, email: 'test@test.com', role: 'student' }
            next()
        })
    }
    app.use('/api/chat', chatRouter)
    return app
}

const authApp   = buildApp('user-123')
const unauthApp = buildApp()

beforeEach(() => {
    mockSendMessage.mockReset()
    mockGenerateGreeting.mockReset()
    mockGetSessionHistory.mockReset()
    mockGetOrCreateSession.mockReset()
    mockResetSession.mockReset()
    mockLogError.mockReset()
})

// ── Authentication tests ───────────────────────────────────────────────────────
describe('Authentication — all routes return 401 when not logged in', () => {
    test('GET /initial returns 401', async () => {
        const res = await request(unauthApp).get('/api/chat/initial')
        expect(res.status).toBe(401)
        expect(res.body.error).toBe('not_authenticated')
    })

    test('POST /message returns 401', async () => {
        const res = await request(unauthApp).post('/api/chat/message').send({ message: 'Hello' })
        expect(res.status).toBe(401)
        expect(res.body.error).toBe('not_authenticated')
    })

    test('POST /reset returns 401', async () => {
        const res = await request(unauthApp).post('/api/chat/reset')
        expect(res.status).toBe(401)
        expect(res.body.error).toBe('not_authenticated')
    })

    test('GET /session returns 401', async () => {
        const res = await request(unauthApp).get('/api/chat/session')
        expect(res.status).toBe(401)
        expect(res.body.error).toBe('not_authenticated')
    })

    test('GET /history returns 401', async () => {
        const res = await request(unauthApp).get('/api/chat/history?sessionId=test')
        expect(res.status).toBe(401)
        expect(res.body.error).toBe('not_authenticated')
    })
})

// ── Input validation tests ─────────────────────────────────────────────────────
describe('POST /api/chat/message — input validation', () => {
    test('returns 400 for empty message', async () => {
        const res = await request(authApp).post('/api/chat/message').send({ message: '' })
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('message is required')
    })

    test('returns 400 when message field is missing', async () => {
        const res = await request(authApp).post('/api/chat/message').send({})
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('message is required')
    })

    test('returns 400 for whitespace-only message', async () => {
        const res = await request(authApp).post('/api/chat/message').send({ message: '   ' })
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('message is required')
    })

    test('returns 400 for message exceeding 5000 characters', async () => {
        const res = await request(authApp)
            .post('/api/chat/message')
            .send({ message: 'a'.repeat(5001) })
        expect(res.status).toBe(400)
        expect(res.body.error).toContain('too long')
    })
})

describe('GET /api/chat/history — input validation', () => {
    test('returns 400 without sessionId', async () => {
        const res = await request(authApp).get('/api/chat/history')
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('sessionId is required')
    })
})

// ── Service interaction tests ──────────────────────────────────────────────────
describe('GET /api/chat/initial', () => {
    test('returns greeting for new session', async () => {
        mockGetOrCreateSession.mockResolvedValue({ sessionId: 'sess-1', isNew: true })
        mockGenerateGreeting.mockResolvedValue({
            greeting: 'Hello!',
            sessionId: 'sess-1',
            suggestedPrompts: ['How am I doing?'],
            success: true
        })

        const res = await request(authApp).get('/api/chat/initial')
        expect(res.status).toBe(200)
        expect(res.body.greeting).toBe('Hello!')
        expect(res.body.hasExistingSession).toBe(false)
    })

    test('returns existing messages for returning session', async () => {
        mockGetOrCreateSession.mockResolvedValue({ sessionId: 'sess-1', isNew: false })
        mockGetSessionHistory.mockResolvedValue([
            { id: 'm1', role: 'assistant', content: 'Welcome back!', created_at: '2026-01-01' }
        ])

        const res = await request(authApp).get('/api/chat/initial')
        expect(res.status).toBe(200)
        expect(res.body.hasExistingSession).toBe(true)
        expect(res.body.messages).toHaveLength(1)
    })
})

describe('POST /api/chat/message', () => {
    test('returns assistant response on success', async () => {
        mockSendMessage.mockResolvedValue({
            response: 'Great question!',
            sessionId: 'sess-1',
            suggestedPrompts: [],
            success: true
        })

        const res = await request(authApp)
            .post('/api/chat/message')
            .send({ message: 'How am I doing?' })
        expect(res.status).toBe(200)
        expect(res.body.response).toBe('Great question!')
    })

    test('returns 500 when service throws', async () => {
        mockSendMessage.mockRejectedValue(new Error('LLM unavailable'))

        const res = await request(authApp)
            .post('/api/chat/message')
            .send({ message: 'Hello' })
        expect(res.status).toBe(500)
    })
})

describe('POST /api/chat/reset', () => {
    test('returns new session greeting on successful reset', async () => {
        mockResetSession.mockResolvedValue({ success: true, newSessionId: 'sess-2' })
        mockGenerateGreeting.mockResolvedValue({
            greeting: 'Fresh start!',
            sessionId: 'sess-2',
            suggestedPrompts: [],
            success: true
        })

        const res = await request(authApp).post('/api/chat/reset')
        expect(res.status).toBe(200)
        expect(res.body.greeting).toBe('Fresh start!')
        expect(res.body.success).toBe(true)
    })
})
