/**
 * Unit tests for cronService.js
 *
 * recomputeAllActiveUserScores accepts injectable (dbPool, computeAllScoresFn)
 * parameters so most tests can pass mock objects directly without module-level
 * mocking. Only logger and node-cron require ESM stubs.
 */

import { jest } from '@jest/globals'

// ── Mock logger ──────────────────────────────────────────────────────────────
const mockLogInfo  = jest.fn()
const mockLogError = jest.fn()

jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, debug: jest.fn(), warn: jest.fn() }
}))

// ── Mock node-cron ───────────────────────────────────────────────────────────
const mockCronSchedule = jest.fn()
jest.unstable_mockModule('node-cron', () => ({
    default: { schedule: mockCronSchedule }
}))

// ── Mock database pool (not used directly — injected per test) ───────────────
jest.unstable_mockModule('../../config/database.js', () => ({
    default: { query: jest.fn() }
}))

// ── Mock scoreComputationService (not used directly — injected per test) ─────
jest.unstable_mockModule('../../services/scoring/scoreComputationService.js', () => ({
    computeAllScores: jest.fn(),
    batchScoreSRLCohort: jest.fn().mockResolvedValue({ usersScored: 0 })
}))

// ── Dynamic imports after mocks ──────────────────────────────────────────────
const { recomputeAllActiveUserScores, startCronJobs } = await import('../../services/cronService.js')

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock pool that returns the given rows from query() */
function makePool(rows) {
    return { query: jest.fn().mockResolvedValue({ rows }) }
}

beforeEach(() => {
    jest.clearAllMocks()
})

// =============================================================================
// recomputeAllActiveUserScores
// =============================================================================

describe('recomputeAllActiveUserScores', () => {
    test('all users succeed — logs correct counts', async () => {
        const pool = makePool([{ user_id: 'u1' }, { user_id: 'u2' }])
        const computeAllScores = jest.fn().mockResolvedValue(undefined)

        await recomputeAllActiveUserScores(pool, computeAllScores)

        expect(computeAllScores).toHaveBeenCalledTimes(2)
        expect(computeAllScores).toHaveBeenCalledWith('u1')
        expect(computeAllScores).toHaveBeenCalledWith('u2')

        const completionLog = mockLogInfo.mock.calls.find(c => c[0].includes('succeeded'))
        expect(completionLog[0]).toMatch(/✓ 2 succeeded.*✗ 0 failed/)
    })

    test('some users fail — logs correct success/failure counts, does not re-throw', async () => {
        const pool = makePool([{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }])
        const computeAllScores = jest.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('DB timeout'))
            .mockResolvedValueOnce(undefined)

        await expect(recomputeAllActiveUserScores(pool, computeAllScores)).resolves.toBeUndefined()

        const completionLog = mockLogInfo.mock.calls.find(c => c[0].includes('succeeded'))
        expect(completionLog[0]).toMatch(/✓ 2 succeeded.*✗ 1 failed/)

        const errorLog = mockLogError.mock.calls.find(c => c[0].includes('u2'))
        expect(errorLog[0]).toContain('DB timeout')
    })

    test('empty active-user list — runs without error, logs skip message', async () => {
        const pool = makePool([])
        const computeAllScores = jest.fn()

        await expect(recomputeAllActiveUserScores(pool, computeAllScores)).resolves.toBeUndefined()

        expect(computeAllScores).not.toHaveBeenCalled()
        const skipLog = mockLogInfo.mock.calls.find(c => c[0].includes('No active users'))
        expect(skipLog).toBeDefined()
    })

    test('DB query failure — catches error, logs it, does not crash', async () => {
        const pool = { query: jest.fn().mockRejectedValue(new Error('connection refused')) }
        const computeAllScores = jest.fn()

        await expect(recomputeAllActiveUserScores(pool, computeAllScores)).resolves.toBeUndefined()

        expect(computeAllScores).not.toHaveBeenCalled()
        const errorLog = mockLogError.mock.calls.find(c => c[0].includes('connection refused'))
        expect(errorLog).toBeDefined()
    })
})

// =============================================================================
// startCronJobs
// =============================================================================

describe('startCronJobs', () => {
    test('registers a cron job at midnight schedule', () => {
        startCronJobs()

        expect(mockCronSchedule).toHaveBeenCalledTimes(1)
        expect(mockCronSchedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function))
    })

    test('logs confirmation after scheduling', () => {
        startCronJobs()

        const scheduleLog = mockLogInfo.mock.calls.find(c => c[0].includes('scheduled'))
        expect(scheduleLog).toBeDefined()
    })
})
