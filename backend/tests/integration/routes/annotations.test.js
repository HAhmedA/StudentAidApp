/**
 * Integration tests for annotation routes
 * GET /api/annotations         — annotations for UI display
 * GET /api/annotations/chatbot — annotations formatted for LLM
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ─────────────────────────────────────────────────────────────
const mockGetAnnotations          = jest.fn()
const mockGetAnnotationsForChatbot = jest.fn()

// ── ESM module mocks ──────────────────────────────────────────────────────────
jest.unstable_mockModule('../../../config/database.js', () => ({
    default: { query: jest.fn() }
}))
jest.unstable_mockModule('../../../utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}))
jest.unstable_mockModule('../../../services/annotators/srlAnnotationService.js', () => ({
    getAnnotations:           mockGetAnnotations,
    getAnnotationsForChatbot: mockGetAnnotationsForChatbot
}))

// ── Dynamic imports after mocks ────────────────────────────────────────────────
const { default: annotationsRouter } = await import('../../../routes/annotations.js')

function buildApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => {
        req.session.user = { id: 'user-1', email: 'user@test.com', role: 'student' }
        next()
    })
    app.use('/api/annotations', annotationsRouter)
    return app
}

function buildUnauthApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use('/api/annotations', annotationsRouter)
    return app
}

beforeEach(() => {
    mockGetAnnotations.mockReset()
    mockGetAnnotationsForChatbot.mockReset()
})

// ── Authentication ─────────────────────────────────────────────────────────────

describe('Authentication', () => {
    test('GET / returns 401 when not logged in', async () => {
        const res = await request(buildUnauthApp()).get('/api/annotations')
        expect(res.status).toBe(401)
        expect(res.body.error).toBe('not_authenticated')
    })

    test('GET /chatbot returns 401 when not logged in', async () => {
        const res = await request(buildUnauthApp()).get('/api/annotations/chatbot')
        expect(res.status).toBe(401)
        expect(res.body.error).toBe('not_authenticated')
    })
})

// ── GET / ──────────────────────────────────────────────────────────────────────

describe('GET /api/annotations', () => {
    test('returns annotations for the current user', async () => {
        const fakeAnnotations = [{ id: 'a1', text: 'Good sleep pattern', domain: 'sleep' }]
        mockGetAnnotations.mockResolvedValue(fakeAnnotations)

        const res = await request(buildApp()).get('/api/annotations')

        expect(res.status).toBe(200)
        expect(res.body.annotations).toEqual(fakeAnnotations)
        expect(mockGetAnnotations).toHaveBeenCalledWith(
            expect.anything(),  // pool
            'user-1',
            undefined,          // timeWindow (not passed)
            false
        )
    })
})

// ── GET /chatbot ───────────────────────────────────────────────────────────────

describe('GET /api/annotations/chatbot', () => {
    test('returns annotationsText for the current user', async () => {
        mockGetAnnotationsForChatbot.mockResolvedValue('Sleep is good. Screen time is moderate.')

        const res = await request(buildApp()).get('/api/annotations/chatbot')

        expect(res.status).toBe(200)
        expect(res.body.annotationsText).toBe('Sleep is good. Screen time is moderate.')
        expect(mockGetAnnotationsForChatbot).toHaveBeenCalledWith(
            expect.anything(),  // pool
            'user-1'
        )
    })
})
