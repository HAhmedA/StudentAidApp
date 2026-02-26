import { jest } from '@jest/globals'
import { withTransaction } from '../../../utils/withTransaction.js'

describe('withTransaction', () => {
    const makePool = (overrides = {}) => ({
        connect: jest.fn().mockResolvedValue({
            query:   jest.fn().mockResolvedValue({}),
            release: jest.fn(),
            ...overrides
        })
    })

    test('calls BEGIN, fn, and COMMIT on success', async () => {
        const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() }
        const pool = { connect: jest.fn().mockResolvedValue(client) }
        const fn = jest.fn().mockResolvedValue('result')

        const result = await withTransaction(pool, fn)

        expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
        expect(fn).toHaveBeenCalledWith(client)
        expect(client.query).toHaveBeenNthCalledWith(2, 'COMMIT')
        expect(client.release).toHaveBeenCalled()
        expect(result).toBe('result')
    })

    test('calls ROLLBACK and re-throws on fn failure', async () => {
        const error = new Error('db boom')
        const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() }
        const pool = { connect: jest.fn().mockResolvedValue(client) }
        const fn = jest.fn().mockRejectedValue(error)

        await expect(withTransaction(pool, fn)).rejects.toThrow('db boom')

        expect(client.query).toHaveBeenCalledWith('ROLLBACK')
        expect(client.release).toHaveBeenCalled()
    })

    test('releases client even if ROLLBACK itself throws', async () => {
        const error = new Error('fn error')
        const rollbackError = new Error('rollback error')
        const client = {
            query: jest.fn()
                .mockResolvedValueOnce({})     // BEGIN
                .mockRejectedValueOnce(rollbackError), // ROLLBACK fails
            release: jest.fn()
        }
        const pool = { connect: jest.fn().mockResolvedValue(client) }
        const fn = jest.fn().mockRejectedValue(error)

        await expect(withTransaction(pool, fn)).rejects.toBeDefined()
        expect(client.release).toHaveBeenCalled()
    })
})
