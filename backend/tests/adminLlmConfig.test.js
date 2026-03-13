import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

const mockQuery = jest.fn()
const mockGetLlmConfig = jest.fn()
const mockFetch = jest.fn()

jest.unstable_mockModule('../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../utils/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))
jest.unstable_mockModule('../services/llmConfigService.js', () => ({
    getLlmConfig: mockGetLlmConfig,
    clearLlmConfigCache: jest.fn()
}))
jest.unstable_mockModule('../services/alignmentService.js', () => ({
    DEFAULT_ALIGNMENT_PROMPT: 'default alignment'
}))
jest.unstable_mockModule('../services/annotators/srlAnnotationService.js', () => ({
    getAnnotations: jest.fn(),
    getRawScoresForScoring: jest.fn()
}))
jest.unstable_mockModule('../config/concepts.js', () => ({
    CONCEPT_NAMES: {}, CONCEPT_IDS: {}
}))
jest.unstable_mockModule('../services/scoring/scoreQueryService.js', () => ({
    getConceptPoolSizes: jest.fn(), getUserConceptDataSet: jest.fn(),
    getClusterInfoByUser: jest.fn(), getAllUserMetrics: jest.fn()
}))

global.fetch = mockFetch

const adminRoutes = (await import('../routes/admin.js')).default

function makeApp(role = 'admin') {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => { req.session.user = { id: 'admin-1', role }; next() })
    app.use('/admin', adminRoutes)
    return app
}

describe('GET /admin/llm-config', () => {
    beforeEach(() => jest.clearAllMocks())

    it('returns masked config when api_key is set', async () => {
        mockGetLlmConfig.mockResolvedValueOnce({
            provider: 'openai', baseUrl: 'https://api.openai.com/v1',
            mainModel: 'gpt-4o', judgeModel: 'gpt-4o',
            maxTokens: 2000, temperature: 0.7, timeoutMs: 30000,
            apiKey: 'sk-real-key'
        })
        mockQuery.mockResolvedValueOnce({ rows: [{ updated_at: '2026-03-04T00:00:00Z' }] })

        const res = await request(makeApp()).get('/admin/llm-config')
        expect(res.status).toBe(200)
        expect(res.body.provider).toBe('openai')
        expect(res.body.apiKey).toBe('●●●●●●')
    })

    it('returns 403 for non-admin', async () => {
        const res = await request(makeApp('student')).get('/admin/llm-config')
        expect(res.status).toBe(403)
    })

    it('returns empty string for apiKey when no key configured', async () => {
        mockGetLlmConfig.mockResolvedValueOnce({
            provider: 'lmstudio', baseUrl: 'http://localhost:1234',
            mainModel: 'hermes-3', judgeModel: 'qwen2.5',
            maxTokens: 2000, temperature: 0.7, timeoutMs: 30000,
            apiKey: ''
        })
        mockQuery.mockResolvedValueOnce({ rows: [] })

        const res = await request(makeApp()).get('/admin/llm-config')
        expect(res.status).toBe(200)
        expect(res.body.apiKey).toBe('')
    })
})

describe('PUT /admin/llm-config', () => {
    beforeEach(() => jest.clearAllMocks())

    it('saves config and returns masked result', async () => {
        mockGetLlmConfig.mockResolvedValueOnce({ apiKey: 'existing-key' })
        mockQuery.mockResolvedValueOnce({
            rows: [{
                provider: 'openai', base_url: 'https://api.openai.com/v1',
                main_model: 'gpt-4o', judge_model: 'gpt-4o',
                max_tokens: 2000, temperature: 0.7, timeout_ms: 30000,
                api_key: 'existing-key', updated_at: '2026-03-04T00:00:00Z'
            }]
        })

        const res = await request(makeApp()).put('/admin/llm-config').send({
            provider: 'openai', baseUrl: 'https://api.openai.com/v1',
            mainModel: 'gpt-4o', judgeModel: 'gpt-4o',
            maxTokens: 2000, temperature: 0.7, timeoutMs: 30000,
            apiKey: '●●●●●●'
        })
        expect(res.status).toBe(200)
        expect(res.body.apiKey).toBe('●●●●●●')
    })

    it('rejects invalid temperature', async () => {
        const res = await request(makeApp()).put('/admin/llm-config').send({
            provider: 'openai', baseUrl: 'https://api.openai.com/v1',
            mainModel: 'gpt-4o', judgeModel: 'gpt-4o',
            maxTokens: 2000, temperature: 5.0, timeoutMs: 30000, apiKey: ''
        })
        expect(res.status).toBe(400)
    })
})

describe('POST /admin/llm-config/test', () => {
    beforeEach(() => jest.clearAllMocks())

    it('returns success when LLM responds with model list', async () => {
        mockGetLlmConfig.mockResolvedValueOnce({ apiKey: 'existing' })
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })
        })

        const res = await request(makeApp()).post('/admin/llm-config/test').send({
            provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '●●●●●●'
        })
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.models).toContain('gpt-4o')
    })

    it('returns failure when fetch throws', async () => {
        mockGetLlmConfig.mockResolvedValueOnce({ apiKey: 'existing' })
        mockFetch.mockRejectedValueOnce(new Error('connection refused'))

        const res = await request(makeApp()).post('/admin/llm-config/test').send({
            provider: 'lmstudio', baseUrl: 'http://localhost:1234', apiKey: ''
        })
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(false)
        expect(res.body.error).toMatch(/connection refused/)
    })
})
