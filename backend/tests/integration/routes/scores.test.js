/**
 * Integration tests for GET /api/scores and GET /api/scores/:conceptId
 *
 * Uses jest.unstable_mockModule (required for ESM modules).
 * All mock functions are defined before mock registration so factories
 * never call jest.fn() in a potentially uninitialized context.
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions (defined before any jest.unstable_mockModule call) ─────────
const mockQuery   = jest.fn()
const mockLogInfo  = jest.fn()
const mockLogError = jest.fn()
const mockLogWarn  = jest.fn()
const mockLogDebug = jest.fn()

// ── ESM module mocks (must come before dynamic imports) ───────────────────────
jest.unstable_mockModule('../../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, warn: mockLogWarn, debug: mockLogDebug }
}))

// ── Dynamic imports (after mocks) ─────────────────────────────────────────────
const { default: scoresRouter } = await import('../../../routes/scores.js')

// ── Test app factory ──────────────────────────────────────────────────────────
function buildApp(userId = 'user-1') {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => { req.session.user = { id: userId }; next() })
    app.use('/api/scores', scoresRouter)
    return app
}

beforeEach(() => {
    mockQuery.mockReset()
    mockLogError.mockReset()
})

describe('GET /api/scores', () => {
    test('returns 200 with empty scores array when no data', async () => {
        mockQuery.mockResolvedValue({ rows: [] })

        const res = await request(buildApp()).get('/api/scores')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body.scores)).toBe(true)
    })

    test('returns 200 with mapped scores when data exists', async () => {
        // concept_scores query
        mockQuery
            .mockResolvedValueOnce({ rows: [
                { concept_id: 'sleep', score: '72.5', trend: 'improving', aspect_breakdown: null, computed_at: '2026-01-01' }
            ]})
            // yesterday scores
            .mockResolvedValueOnce({ rows: [] })
            // cluster info
            .mockResolvedValueOnce({ rows: [] })
            // getConceptPoolSizes (UNION ALL)
            .mockResolvedValueOnce({ rows: [] })
            // getUserConceptDataSet (UNION ALL)
            .mockResolvedValueOnce({ rows: [] })

        const res = await request(buildApp()).get('/api/scores')
        expect(res.status).toBe(200)
        expect(res.body.scores[0].conceptId).toBe('sleep')
        expect(res.body.scores[0].score).toBe(72.5)
    })

    test('returns 401 when no session user', async () => {
        const app = express()
        app.use(express.json())
        app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
        app.use('/api/scores', scoresRouter)

        const res = await request(app).get('/api/scores')
        expect(res.status).toBe(401)
    })
})

describe('GET /api/scores/:conceptId', () => {
    test('returns 404 when score not found', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/scores/sleep')
        expect(res.status).toBe(404)
        expect(res.body.error).toBe('NOT_FOUND')
    })

    test('returns 200 with score data when found', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { concept_id: 'sleep', score: '80.0', trend: 'stable', aspect_breakdown: {}, computed_at: '2026-01-01' }
        ]})

        const res = await request(buildApp()).get('/api/scores/sleep')
        expect(res.status).toBe(200)
        expect(res.body.conceptId).toBe('sleep')
        expect(res.body.score).toBe(80.0)
    })
})
