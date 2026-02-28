/**
 * Unit tests for clusterStorageService.js
 * Validates the Sprint 1 fix: storeUserAssignment must propagate errors
 * when externalClient is provided (so withTransaction can rollback).
 */

import { jest } from '@jest/globals'

// ── Mock functions ──────────────────────────────────────────────────────────────
const mockQuery       = jest.fn()
const mockWithTransaction = jest.fn()
const mockGenerateClusterLabels = jest.fn()
const mockPercentile  = jest.fn()
const mockLogError    = jest.fn()

// ── ESM module mocks ────────────────────────────────────────────────────────────
jest.unstable_mockModule('../../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../../utils/withTransaction.js', () => ({
    withTransaction: mockWithTransaction
}))
jest.unstable_mockModule('../../services/scoring/pgmoeAlgorithm.js', () => ({
    generateClusterLabels: mockGenerateClusterLabels,
    fitPGMoE: jest.fn(),
    selectOptimalModel: jest.fn(),
    computeSilhouetteScore: jest.fn(),
    computeDaviesBouldinIndex: jest.fn(),
    centerNormalize: jest.fn()
}))
jest.unstable_mockModule('../../utils/stats.js', () => ({
    percentile: mockPercentile
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: { error: mockLogError, info: jest.fn(), debug: jest.fn(), warn: jest.fn() }
}))

// ── Dynamic import after mocks ──────────────────────────────────────────────────
const { storeUserAssignment, storeClusterResults } =
    await import('../../services/scoring/clusterStorageService.js')

// ── Setup ───────────────────────────────────────────────────────────────────────
beforeEach(() => {
    mockQuery.mockReset()
    mockWithTransaction.mockReset()
    mockLogError.mockReset()
    mockGenerateClusterLabels.mockReset()
    mockPercentile.mockReset()
})

// ══════════════════════════════════════════════════════════════════════════════
// storeUserAssignment
// ══════════════════════════════════════════════════════════════════════════════

describe('storeUserAssignment — with externalClient', () => {
    test('calls client.query with correct params', async () => {
        const mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }) }
        await storeUserAssignment('user-1', 'sleep', 0, 'Low', 25.5, mockClient)

        expect(mockClient.query).toHaveBeenCalledTimes(1)
        const [sql, params] = mockClient.query.mock.calls[0]
        expect(sql).toContain('INSERT INTO public.user_cluster_assignments')
        expect(params).toEqual(['user-1', 'sleep', 0, 'Low', 25.5])
    })

    test('propagates errors so withTransaction can rollback', async () => {
        const mockClient = { query: jest.fn().mockRejectedValue(new Error('DB timeout')) }
        await expect(storeUserAssignment('user-1', 'sleep', 0, 'Low', 25.5, mockClient))
            .rejects.toThrow('DB timeout')
    })
})

describe('storeUserAssignment — standalone (no externalClient)', () => {
    test('resolves and calls pool.query on success', async () => {
        mockQuery.mockResolvedValue({ rows: [] })
        await expect(storeUserAssignment('user-1', 'sleep', 0, 'Low', 25.5))
            .resolves.toBeUndefined()
        expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    test('swallows errors and logs them — does not throw', async () => {
        mockQuery.mockRejectedValue(new Error('Connection refused'))
        await expect(storeUserAssignment('user-1', 'sleep', 0, 'Low', 25.5))
            .resolves.toBeUndefined()
        expect(mockLogError).toHaveBeenCalledWith(
            expect.stringContaining('Error storing user cluster assignment')
        )
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// storeClusterResults
// ══════════════════════════════════════════════════════════════════════════════

const sampleComposites = [
    { userId: 'u1', composite: 70, cluster: 0 },
    { userId: 'u2', composite: 30, cluster: 1 },
]
const sampleClusterRemap  = { 0: 1, 1: 0 }
const sampleClusterMeans  = [{ cluster: 1, mean: 30 }, { cluster: 0, mean: 70 }]
const sampleModel         = { means: [[0.5, 0.5], [0.3, 0.3]] }

describe('storeClusterResults — with externalClient', () => {
    test('calls client.query (DELETE stale + INSERT per cluster)', async () => {
        const mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }) }
        mockGenerateClusterLabels.mockReturnValue(['Low', 'High'])
        mockPercentile.mockReturnValue(50)

        await storeClusterResults('sleep', sampleComposites, sampleClusterRemap,
            sampleClusterMeans, 2, sampleModel, mockClient)

        expect(mockClient.query).toHaveBeenCalled()
        // First call is the DELETE stale clusters statement
        const [firstSql] = mockClient.query.mock.calls[0]
        expect(firstSql).toContain('DELETE FROM public.peer_clusters')
    })
})

describe('storeClusterResults — standalone', () => {
    test('delegates to withTransaction', async () => {
        mockWithTransaction.mockImplementation(async (_pool, fn) => {
            await fn({ query: jest.fn().mockResolvedValue({ rows: [] }) })
        })
        mockGenerateClusterLabels.mockReturnValue(['Low', 'High'])
        mockPercentile.mockReturnValue(50)

        await storeClusterResults('sleep', sampleComposites, sampleClusterRemap,
            sampleClusterMeans, 2, sampleModel)

        expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    })
})
