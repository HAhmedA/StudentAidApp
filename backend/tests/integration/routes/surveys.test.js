/**
 * Integration tests for survey routes
 * GET /api/surveys/getActive
 * GET /api/surveys/getSurvey
 * POST /api/surveys/changeJson
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

describe('GET /api/surveys/getSurvey', () => {
    test('returns null when survey not found', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp()).get('/api/surveys/getSurvey?surveyId=missing')
        expect(res.status).toBe(200)
        expect(res.body).toBeNull()
    })

    test('returns survey when found', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { id: 'xyz', name: 'SRL', json: { title: 'SRL' } }
        ]})

        const res = await request(buildApp()).get('/api/surveys/getSurvey?surveyId=xyz')
        expect(res.status).toBe(200)
        expect(res.body.id).toBe('xyz')
    })
})

describe('POST /api/surveys/changeJson', () => {
    test('returns 404 when survey not found', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        const res = await request(buildApp())
            .post('/api/surveys/changeJson')
            .send({ id: 'missing', json: { title: 'SRL' } })
        expect(res.status).toBe(404)
        expect(res.body.error).toBe('NOT_FOUND')
    })

    test('returns updated survey on success', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { id: 'xyz', name: 'SRL', json: { title: 'SRL', pages: [] } }
        ]})

        const res = await request(buildApp())
            .post('/api/surveys/changeJson')
            .send({ id: 'xyz', json: { title: 'SRL', pages: [] } })
        expect(res.status).toBe(200)
        expect(res.body.id).toBe('xyz')
    })

    test('injects fixed title when json has no title field', async () => {
        mockQuery.mockResolvedValue({ rows: [
            { id: 'xyz', name: 'Self-Regulated Learning Questionnaire', json: { title: 'Self-Regulated Learning Questionnaire' } }
        ]})

        const res = await request(buildApp())
            .post('/api/surveys/changeJson')
            .send({ id: 'xyz', json: { pages: [] } })
        expect(res.status).toBe(200)
    })
})
