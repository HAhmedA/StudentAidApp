/**
 * Integration tests for results routes
 * POST /api/results/post
 */

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

// ── Mock functions ─────────────────────────────────────────────────────────────
const mockQuery               = jest.fn()
const mockSaveResponses       = jest.fn().mockResolvedValue(undefined)
const mockComputeAnnotations  = jest.fn().mockResolvedValue(undefined)
const mockComputeAllScores    = jest.fn().mockResolvedValue(undefined)
const mockLogInfo  = jest.fn()
const mockLogError = jest.fn()

// ── ESM module mocks ──────────────────────────────────────────────────────────
jest.unstable_mockModule('../../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, warn: jest.fn(), debug: jest.fn() }
}))
jest.unstable_mockModule('../../../services/annotators/srlAnnotationService.js', () => ({
    saveResponses:      mockSaveResponses,
    computeAnnotations: mockComputeAnnotations
}))
jest.unstable_mockModule('../../../services/scoring/scoreComputationService.js', () => ({
    computeAllScores: mockComputeAllScores
}))

// ── Dynamic imports after mocks ────────────────────────────────────────────────
const { default: resultsRouter } = await import('../../../routes/results.js')

// App with authenticated session
function buildApp(userId = 'user-1') {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => {
        req.session.user = { id: userId }
        next()
    })
    app.use('/api/results', resultsRouter)
    return app
}

// App with no session user (anonymous submission)
function buildAnonApp() {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use('/api/results', resultsRouter)
    return app
}

beforeEach(() => {
    mockQuery.mockReset()
    mockSaveResponses.mockReset()
    mockComputeAnnotations.mockReset()
    mockComputeAllScores.mockReset()
    mockLogError.mockReset()
    // Restore default resolved values
    mockSaveResponses.mockResolvedValue(undefined)
    mockComputeAnnotations.mockResolvedValue(undefined)
    mockComputeAllScores.mockResolvedValue(undefined)
})

// ── POST /api/results/post ─────────────────────────────────────────────────────

describe('POST /api/results/post', () => {
    test('returns 400 when body is empty', async () => {
        const res = await request(buildApp()).post('/api/results/post').send({})
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('postId and surveyResult are required')
    })

    test('returns 400 when postId is missing', async () => {
        const res = await request(buildApp())
            .post('/api/results/post')
            .send({ surveyResult: { q: 1 } })
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('postId and surveyResult are required')
    })

    test('returns 400 when surveyResult is missing', async () => {
        const res = await request(buildApp())
            .post('/api/results/post')
            .send({ postId: 'survey-1' })
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('postId and surveyResult are required')
    })

    test('submits anonymously (no session user) — skips SRL and scoring', async () => {
        mockQuery.mockResolvedValue({ rows: [] })  // INSERT

        const res = await request(buildAnonApp())
            .post('/api/results/post')
            .send({ postId: 'survey-1', surveyResult: { mood: 4 } })

        expect(res.status).toBe(200)
        expect(res.body.postId).toBe('survey-1')
        expect(typeof res.body.id).toBe('string')
        expect(mockSaveResponses).not.toHaveBeenCalled()
        expect(mockComputeAllScores).not.toHaveBeenCalled()
    })

    test('submits with auth — calls saveResponses and computeAnnotations', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] })                              // INSERT
            .mockResolvedValueOnce({ rows: [{ json: { pages: [] } }] })      // SELECT survey

        const res = await request(buildApp())
            .post('/api/results/post')
            .send({ postId: 'survey-1', surveyResult: { mood: 3 } })

        expect(res.status).toBe(200)
        expect(res.body.postId).toBe('survey-1')
        expect(mockSaveResponses).toHaveBeenCalledTimes(1)
        expect(mockComputeAnnotations).toHaveBeenCalledTimes(1)
        // computeAllScores is fire-and-forget — just check it was called
        expect(mockComputeAllScores).toHaveBeenCalledWith('user-1')
    })
})
