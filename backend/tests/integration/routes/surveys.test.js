/**
 * Integration tests for survey routes
 * GET /api/surveys/getActive
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ─────────────────────────────────────────────────────────────
const mockQuery   = jest.fn()
const mockLogInfo = jest.fn()
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
const { default: surveysRouter } = await import('../../../routes/surveys.js')

function buildApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use('/api/surveys', surveysRouter)
    return app
}

beforeEach(() => mockQuery.mockReset())

describe('GET /api/surveys/getActive', () => {
    test('returns empty array when no surveys exist', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/surveys/getActive')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body)).toBe(true)
        expect(res.body).toHaveLength(0)
    })

    test('returns mapped surveys when data exists', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { id: 'abc', name: 'SRL', json: { title: 'SRL' } }
        ]})

        const res = await request(buildApp()).get('/api/surveys/getActive')
        expect(res.status).toBe(200)
        expect(res.body[0].id).toBe('abc')
        expect(res.body[0].name).toBe('SRL')
    })
})
