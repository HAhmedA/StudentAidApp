/**
 * Unit tests for clusterPeerService.js
 * Covers cold start, normal PGMoE path, and the diagnostic sampling cap (P-C1).
 */

import { jest } from '@jest/globals'

// ── Mock functions ──────────────────────────────────────────────────────────────
const mockGetAllUserMetrics         = jest.fn()
const mockCenterNormalize           = jest.fn()
const mockSelectOptimalModel        = jest.fn()
const mockGenerateClusterLabels     = jest.fn()
const mockComputeSilhouetteScore    = jest.fn()
const mockComputeDaviesBouldinIndex = jest.fn()
const mockStoreClusterResults       = jest.fn()
const mockStoreUserAssignment       = jest.fn()
const mockStoreDiagnostics          = jest.fn()
const mockWithTransaction           = jest.fn()
const mockLogInfo  = jest.fn()
const mockLogError = jest.fn()

// ── ESM module mocks ────────────────────────────────────────────────────────────
jest.unstable_mockModule('../../config/database.js', () => ({
    default: { query: jest.fn() }
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: { info: mockLogInfo, error: mockLogError, debug: jest.fn(), warn: jest.fn() }
}))
jest.unstable_mockModule('../../services/scoring/scoreQueryService.js', () => ({
    getAllUserMetrics: mockGetAllUserMetrics
}))
jest.unstable_mockModule('../../services/scoring/pgmoeAlgorithm.js', () => ({
    centerNormalize:           mockCenterNormalize,
    fitPGMoE:                  jest.fn(),
    selectOptimalModel:        mockSelectOptimalModel,
    generateClusterLabels:     mockGenerateClusterLabels,
    computeSilhouetteScore:    mockComputeSilhouetteScore,
    computeDaviesBouldinIndex: mockComputeDaviesBouldinIndex
}))
jest.unstable_mockModule('../../services/scoring/clusterStorageService.js', () => ({
    storeClusterResults:  mockStoreClusterResults,
    storeUserAssignment:  mockStoreUserAssignment,
    storeDiagnostics:     mockStoreDiagnostics
}))
jest.unstable_mockModule('../../utils/withTransaction.js', () => ({
    withTransaction: mockWithTransaction
}))

// ── Dynamic import after mocks ──────────────────────────────────────────────────
const { computeClusterScores } = await import('../../services/scoring/clusterPeerService.js')

// ── Helper: build N-user metrics map ───────────────────────────────────────────
const TARGET_USER = 'target-user'

function makeMetrics(n) {
    const metrics = {}
    for (let i = 0; i < n - 1; i++) {
        metrics[`user-${i}`] = {
            total_active_minutes: 60 + i * 2,
            days_active: 5,
            participation_score: 50 + i,
            avg_session_duration: 30
        }
    }
    metrics[TARGET_USER] = {
        total_active_minutes: 120,
        days_active: 7,
        participation_score: 75,
        avg_session_duration: 45
    }
    return metrics
}

// ── Helper: build mock model ────────────────────────────────────────────────────
function makeModel(n, k = 2) {
    return {
        assignments: Array.from({ length: n }, (_, i) => i % k),
        means: Array.from({ length: k }, (_, i) => [0.5 + i * 0.2, 0.5, 0.4, 0.3])
    }
}

// ── Setup ───────────────────────────────────────────────────────────────────────
beforeEach(() => {
    jest.clearAllMocks()
    // Default: withTransaction calls the callback with a mock client
    mockWithTransaction.mockImplementation(async (_pool, fn) => {
        await fn({ query: jest.fn().mockResolvedValue({ rows: [] }) })
    })
    // Default: storage calls resolve
    mockStoreClusterResults.mockResolvedValue(undefined)
    mockStoreUserAssignment.mockResolvedValue(undefined)
    mockStoreDiagnostics.mockResolvedValue(undefined)
    // Default: diagnostic functions return sensible values
    mockComputeSilhouetteScore.mockReturnValue(0.55)
    mockComputeDaviesBouldinIndex.mockReturnValue(0.72)
    mockGenerateClusterLabels.mockReturnValue(['Low Engagement', 'High Engagement'])
})

// ══════════════════════════════════════════════════════════════════════════════
// Cold start / early-exit paths
// ══════════════════════════════════════════════════════════════════════════════

describe('computeClusterScores — cold start', () => {
    test('returns { coldStart: true } when cohort has fewer than 10 users', async () => {
        mockGetAllUserMetrics.mockResolvedValue(makeMetrics(5))

        const result = await computeClusterScores(null, 'lms', TARGET_USER)

        expect(result).toEqual({ coldStart: true })
        expect(mockSelectOptimalModel).not.toHaveBeenCalled()
    })

    test('returns null when target user has no metrics data', async () => {
        const metrics = makeMetrics(15)
        delete metrics[TARGET_USER]
        mockGetAllUserMetrics.mockResolvedValue(metrics)

        const result = await computeClusterScores(null, 'lms', TARGET_USER)

        expect(result).toBeNull()
        expect(mockSelectOptimalModel).not.toHaveBeenCalled()
    })

    test('returns null for an unknown conceptId', async () => {
        mockGetAllUserMetrics.mockResolvedValue(makeMetrics(15))

        const result = await computeClusterScores(null, 'unknown_concept', TARGET_USER)

        expect(result).toBeNull()
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// Normal path
// ══════════════════════════════════════════════════════════════════════════════

describe('computeClusterScores — normal path (lms, 15 users)', () => {
    const N = 15

    function setupNormalMocks() {
        const metrics = makeMetrics(N)
        mockGetAllUserMetrics.mockResolvedValue(metrics)
        const centered = Array.from({ length: N }, () => [0.1, 0.2, -0.1, 0.3])
        mockCenterNormalize.mockReturnValue({ centered })
        mockSelectOptimalModel.mockReturnValue({
            k: 2,
            covType: 'spherical',
            model: makeModel(N, 2),
            diagnostics: { selected: { k: 2, covType: 'spherical' }, candidates: [] }
        })
    }

    test('calls PGMoE algorithm and returns a valid cluster result', async () => {
        setupNormalMocks()

        const result = await computeClusterScores(null, 'lms', TARGET_USER)

        expect(mockSelectOptimalModel).toHaveBeenCalledTimes(1)
        expect(mockWithTransaction).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({
            clusterLabel:    expect.any(String),
            clusterIndex:    expect.any(Number),
            percentileScore: expect.any(Number),
            compositeScore:  expect.any(Number),
            dialMin:         expect.any(Number),
            dialCenter:      expect.any(Number),
            dialMax:         expect.any(Number),
            userCount:       expect.any(Number),
            domains:         expect.any(Array)
        })
    })

    test('domains array contains the 4 lms dimension keys', async () => {
        setupNormalMocks()

        const result = await computeClusterScores(null, 'lms', TARGET_USER)

        const domainNames = result.domains.map(d => d.domain)
        expect(domainNames).toEqual(
            expect.arrayContaining(['volume', 'consistency', 'participation_variety', 'session_quality'])
        )
    })

    test('storeDiagnostics failure does not propagate to caller (fire-and-forget)', async () => {
        setupNormalMocks()
        mockStoreDiagnostics.mockRejectedValue(new Error('Diagnostics table unavailable'))

        await expect(computeClusterScores(null, 'lms', TARGET_USER))
            .resolves.toMatchObject({ clusterLabel: expect.any(String) })
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// Diagnostic sampling cap — Sprint 2 P-C1 fix validation
// ══════════════════════════════════════════════════════════════════════════════

describe('computeClusterScores — diagnostic sampling cap (P-C1)', () => {
    function setupSamplingMocks(n) {
        mockGetAllUserMetrics.mockResolvedValue(makeMetrics(n))
        const centered = Array.from({ length: n }, () => [0.1, 0.2, -0.1, 0.3])
        mockCenterNormalize.mockReturnValue({ centered })
        mockSelectOptimalModel.mockReturnValue({
            k: 2,
            covType: 'spherical',
            model: makeModel(n, 2),
            diagnostics: { selected: { k: 2, covType: 'spherical' }, candidates: [] }
        })
    }

    test('passes all N points to silhouette when N <= 100', async () => {
        const N = 50
        setupSamplingMocks(N)

        await computeClusterScores(null, 'lms', TARGET_USER)

        const [calledCentered] = mockComputeSilhouetteScore.mock.calls[0]
        expect(calledCentered).toHaveLength(N)
    })

    test('passes exactly 100 samples to silhouette when N > 100', async () => {
        const N = 150
        setupSamplingMocks(N)

        await computeClusterScores(null, 'lms', TARGET_USER)

        const [calledCentered] = mockComputeSilhouetteScore.mock.calls[0]
        expect(calledCentered).toHaveLength(100)
    })

    test('nUsers in storeDiagnostics reflects the real cohort size (not the sample)', async () => {
        const N = 150
        setupSamplingMocks(N)

        await computeClusterScores(null, 'lms', TARGET_USER)

        await new Promise(resolve => setImmediate(resolve))

        expect(mockStoreDiagnostics).toHaveBeenCalledWith(
            'lms',
            expect.objectContaining({ nUsers: N })
        )
    })
})
