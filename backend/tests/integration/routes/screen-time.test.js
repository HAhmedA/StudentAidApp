/**
 * Integration tests for screen-time routes
 * GET /api/screen-time/today
 * POST /api/screen-time
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ─────────────────────────────────────────────────────────────
const mockQuery          = jest.fn()
const mockLogInfo        = jest.fn()
const mockLogError       = jest.fn()
const mockLogWarn        = jest.fn()
const mockComputeScores  = jest.fn().mockResolvedValue(undefined)

// ── ESM module mocks ──────────────────────────────────────────────────────────
jest.unstable_mockModule('../../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, warn: mockLogWarn, debug: jest.fn() }
}))
jest.unstable_mockModule('../../../services/scoring/scoreComputationService.js', () => ({
    computeAllScores: mockComputeScores
}))

// ── Dynamic imports after mocks ────────────────────────────────────────────────
const { default: screenTimeRouter } = await import('../../../routes/screen-time.js')

function buildApp(userId = 'user-1') {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => { req.session.user = { id: userId }; next() })
    app.use('/api/screen-time', screenTimeRouter)
    return app
}

function buildUnauthApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use('/api/screen-time', screenTimeRouter)
    return app
}

beforeEach(() => {
    mockQuery.mockReset()
    mockComputeScores.mockReset()
    mockComputeScores.mockResolvedValue(undefined)
})

describe('Authentication', () => {
    test('GET /today returns 401 when not logged in', async () => {
        const res = await request(buildUnauthApp()).get('/api/screen-time/today')
        expect(res.status).toBe(401)
    })

    test('POST / returns 401 when not logged in', async () => {
        const res = await request(buildUnauthApp()).post('/api/screen-time')
        expect(res.status).toBe(401)
    })
})

describe('GET /api/screen-time/today', () => {
    test('returns null entry when no data for yesterday', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/screen-time/today')
        expect(res.status).toBe(200)
        expect(res.body.entry).toBeNull()
    })

    test('returns entry when data exists', async () => {
        mockQuery.mockResolvedValue({ rows: [{
            session_date: '2026-02-25',
            total_screen_minutes: 240,
            longest_continuous_session: 90,
            late_night_screen_minutes: 30
        }]})

        const res = await request(buildApp()).get('/api/screen-time/today')
        expect(res.status).toBe(200)
        expect(res.body.entry.total_screen_minutes).toBe(240)
    })
})

describe('POST /api/screen-time', () => {
    test('returns 400 when required fields are missing', async () => {
        const res = await request(buildApp())
            .post('/api/screen-time')
            .send({ totalMinutes: 120 })
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    test('returns 400 when body is empty', async () => {
        const res = await request(buildApp())
            .post('/api/screen-time')
            .send({})
        expect(res.status).toBe(400)
    })

    test('returns saved entry on valid submission', async () => {
        // baseline lookup
        mockQuery.mockResolvedValueOnce({ rows: [{ avg_total_minutes: '300' }] })
        // upsert returning
        mockQuery.mockResolvedValueOnce({ rows: [{
            session_date: '2026-02-25',
            total_screen_minutes: 180,
            longest_continuous_session: 60,
            late_night_screen_minutes: 20
        }]})

        const res = await request(buildApp())
            .post('/api/screen-time')
            .send({ totalMinutes: 180, longestSession: 60, preSleepMinutes: 20 })
        expect(res.status).toBe(200)
        expect(res.body.entry.total_screen_minutes).toBe(180)
    })

    test('uses default baseline 300 when no existing baseline', async () => {
        // no baseline
        mockQuery.mockResolvedValueOnce({ rows: [] })
        // upsert
        mockQuery.mockResolvedValueOnce({ rows: [{
            session_date: '2026-02-25',
            total_screen_minutes: 200,
            longest_continuous_session: 45,
            late_night_screen_minutes: 10
        }]})

        const res = await request(buildApp())
            .post('/api/screen-time')
            .send({ totalMinutes: 200, longestSession: 45, preSleepMinutes: 10 })
        expect(res.status).toBe(200)
        expect(res.body.entry.total_screen_minutes).toBe(200)
    })
})
