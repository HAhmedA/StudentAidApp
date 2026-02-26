import { jest } from '@jest/globals'
import { AppError, Errors, asyncRoute } from '../../../utils/errors.js'

describe('AppError', () => {
    test('creates error with correct properties', () => {
        const err = new AppError('TEST_CODE', 'test message', 418, 'detail')
        expect(err.code).toBe('TEST_CODE')
        expect(err.message).toBe('test message')
        expect(err.status).toBe(418)
        expect(err.details).toBe('detail')
        expect(err instanceof Error).toBe(true)
    })

    test('defaults status to 500 and details to null', () => {
        const err = new AppError('X', 'msg')
        expect(err.status).toBe(500)
        expect(err.details).toBeNull()
    })
})

describe('Errors factories', () => {
    test('UNAUTHORIZED returns 401', () => {
        const e = Errors.UNAUTHORIZED()
        expect(e.status).toBe(401)
        expect(e.code).toBe('UNAUTHORIZED')
    })

    test('FORBIDDEN returns 403', () => {
        const e = Errors.FORBIDDEN()
        expect(e.status).toBe(403)
    })

    test('NOT_FOUND includes resource name', () => {
        const e = Errors.NOT_FOUND('Score')
        expect(e.status).toBe(404)
        expect(e.message).toContain('Score')
    })

    test('VALIDATION returns 400', () => {
        const e = Errors.VALIDATION('bad input')
        expect(e.status).toBe(400)
        expect(e.details).toBe('bad input')
    })

    test('DB_ERROR returns 500', () => {
        const e = Errors.DB_ERROR('connection refused')
        expect(e.status).toBe(500)
        expect(e.details).toBe('connection refused')
    })

    test('UNKNOWN_CONCEPT includes concept id', () => {
        const e = Errors.UNKNOWN_CONCEPT('foo')
        expect(e.status).toBe(400)
        expect(e.message).toContain('foo')
    })
})

describe('asyncRoute', () => {
    test('calls fn and passes result through', async () => {
        const fn = async (req, res) => { res.json({ ok: true }) }
        const handler = asyncRoute(fn)
        const req = {}
        const res = { json: jest.fn() }
        const next = jest.fn()
        await handler(req, res, next)
        expect(res.json).toHaveBeenCalledWith({ ok: true })
    })

    test('catches AppError and sends correct status', async () => {
        const fn = async () => { throw Errors.UNAUTHORIZED() }
        const handler = asyncRoute(fn)
        const req = {}
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }
        const next = jest.fn()
        await handler(req, res, next)
        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'UNAUTHORIZED' }))
    })

    test('wraps non-AppError in DB_ERROR', async () => {
        const fn = async () => { throw new Error('connection failed') }
        const handler = asyncRoute(fn)
        const req = {}
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }
        const next = jest.fn()
        await handler(req, res, next)
        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'DB_ERROR' }))
    })
})
