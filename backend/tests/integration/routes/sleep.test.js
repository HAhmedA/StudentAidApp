/**
 * Integration tests for sleep routes
 * GET /api/sleep/today
 * POST /api/sleep
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ─────────────────────────────────────────────────────────────
const mockQuery         = jest.fn()
const mockLogInfo       = jest.fn()
const mockLogError      = jest.fn()
const mockLogWarn       = jest.fn()
const mockComputeScores = jest.fn().mockResolvedValue(undefined)

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
const { default: sleepRouter } = await import('../../../routes/sleep.js')

function buildApp(userId = 'user-1') {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => { req.session.user = { id: userId }; next() })
    app.use('/api/sleep', sleepRouter)
    return app
}

function buildUnauthApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use('/api/sleep', sleepRouter)
    return app
}

beforeEach(() => {
    mockQuery.mockReset()
    mockComputeScores.mockReset()
    mockComputeScores.mockResolvedValue(undefined)
})

describe('Authentication', () => {
    test('GET /today returns 401 when not logged in', async () => {
        const res = await request(buildUnauthApp()).get('/api/sleep/today')
        expect(res.status).toBe(401)
    })

    test('POST / returns 401 when not logged in', async () => {
        const res = await request(buildUnauthApp()).post('/api/sleep')
        expect(res.status).toBe(401)
    })
})

describe('GET /api/sleep/today', () => {
    test('returns null entry when no sleep data for yesterday', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/sleep/today')
        expect(res.status).toBe(200)
        expect(res.body.entry).toBeNull()
    })

    test('returns entry when sleep data exists', async () => {
        mockQuery.mockResolvedValue({ rows: [{
            session_date: '2026-02-25',
            bedtime: '2026-02-25T23:00:00.000Z',
            wake_time: '2026-02-26T07:00:00.000Z',
            total_sleep_minutes: 480,
            time_in_bed_minutes: 480,
            awakenings_count: 0,
            awake_minutes: 0
        }]})

        const res = await request(buildApp()).get('/api/sleep/today')
        expect(res.status).toBe(200)
        expect(res.body.entry.total_sleep_minutes).toBe(480)
    })
})

describe('POST /api/sleep', () => {
    test('returns 400 when intervals is missing', async () => {
        const res = await request(buildApp()).post('/api/sleep').send({})
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    test('returns 400 when intervals is empty array', async () => {
        const res = await request(buildApp()).post('/api/sleep').send({ intervals: [] })
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    test('returns saved entry for a single overnight interval', async () => {
        const saved = {
            session_date: '2026-02-25',
            bedtime: '2026-02-25T23:00:00.000Z',
            wake_time: '2026-02-26T07:00:00.000Z',
            total_sleep_minutes: 480,
            time_in_bed_minutes: 480,
            awakenings_count: 0,
            awake_minutes: 0
        }
        mockQuery.mockResolvedValue({ rows: [saved] })

        const res = await request(buildApp())
            .post('/api/sleep')
            .send({ intervals: [{ start: '23:00', end: '07:00' }] })
        expect(res.status).toBe(200)
        expect(res.body.entry.total_sleep_minutes).toBe(480)
    })

    test('handles fragmented sleep with multiple intervals', async () => {
        const saved = {
            session_date: '2026-02-25',
            bedtime: '2026-02-25T23:00:00.000Z',
            wake_time: '2026-02-26T07:00:00.000Z',
            total_sleep_minutes: 420,
            time_in_bed_minutes: 480,
            awakenings_count: 1,
            awake_minutes: 60
        }
        mockQuery.mockResolvedValue({ rows: [saved] })

        const res = await request(buildApp())
            .post('/api/sleep')
            .send({ intervals: [
                { start: '23:00', end: '02:00' },
                { start: '03:00', end: '07:00' }
            ]})
        expect(res.status).toBe(200)
        expect(res.body.entry.awakenings_count).toBe(1)
    })
})
