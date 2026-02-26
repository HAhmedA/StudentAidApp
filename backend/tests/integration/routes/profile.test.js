/**
 * Integration tests for profile routes
 * GET /api/profile, PUT /api/profile, POST /api/profile/onboarding-complete
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ─────────────────────────────────────────────────────────────
const mockQuery    = jest.fn()
const mockLogInfo  = jest.fn()
const mockLogError = jest.fn()
const mockLogWarn  = jest.fn()

// ── ESM module mocks ──────────────────────────────────────────────────────────
jest.unstable_mockModule('../../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, warn: mockLogWarn, debug: jest.fn() }
}))

// ── Dynamic imports after mocks ────────────────────────────────────────────────
const { default: profileRouter } = await import('../../../routes/profile.js')

function buildApp(userId = 'user-1') {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => { req.session.user = { id: userId }; next() })
    app.use('/api/profile', profileRouter)
    return app
}

beforeEach(() => mockQuery.mockReset())

describe('GET /api/profile', () => {
    test('returns 404 when profile not found', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/profile')
        expect(res.status).toBe(404)
        expect(res.body.error).toBe('NOT_FOUND')
    })

    test('returns 200 with profile data when found', async () => {
        const profile = {
            user_id: 'user-1', edu_level: 'undergrad', field_of_study: 'CS',
            major: 'CS', learning_formats: [], disabilities: [],
            onboarding_completed: false, updated_at: null
        }
        mockQuery.mockResolvedValue({ rows: [profile] })

        const res = await request(buildApp()).get('/api/profile')
        expect(res.status).toBe(200)
        expect(res.body.user_id).toBe('user-1')
    })
})

describe('POST /api/profile/onboarding-complete', () => {
    test('returns 200 with success: true', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).post('/api/profile/onboarding-complete')
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })
})

describe('PUT /api/profile', () => {
    test('returns 200 with updated profile', async () => {
        const updated = {
            user_id: 'user-1', edu_level: 'grad', field_of_study: 'Math',
            major: 'Math', learning_formats: ['online'], disabilities: [], updated_at: null
        }
        mockQuery.mockResolvedValue({ rows: [updated] })

        const res = await request(buildApp())
            .put('/api/profile')
            .send({ edu_level: 'grad', field_of_study: 'Math' })
        expect(res.status).toBe(200)
        expect(res.body.edu_level).toBe('grad')
    })
})
