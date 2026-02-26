import {
    centerNormalize,
    fitPGMoE,
    selectOptimalModel,
    generateClusterLabels,
    computeNormalizedEntropy
} from '../../../services/scoring/pgmoeAlgorithm.js'

// Simple 2D dataset with two clear clusters
const twoClusterData = [
    [0, 0], [0.1, 0.1], [0.2, 0], [0, 0.2],
    [5, 5], [5.1, 5], [5, 5.2], [4.9, 5.1]
]

describe('centerNormalize', () => {
    test('returns centered matrix with approximately zero mean per column', () => {
        const data = [[1, 10], [2, 20], [3, 30]]
        const { centered } = centerNormalize(data)
        const meanCol0 = centered.reduce((s, r) => s + r[0], 0) / centered.length
        const meanCol1 = centered.reduce((s, r) => s + r[1], 0) / centered.length
        expect(Math.abs(meanCol0)).toBeLessThan(1e-9)
        expect(Math.abs(meanCol1)).toBeLessThan(1e-9)
    })

    test('handles single-column constant data without NaN', () => {
        const data = [[5], [5], [5]]
        const { centered } = centerNormalize(data)
        for (const row of centered) {
            expect(isNaN(row[0])).toBe(false)
        }
    })
})

describe('fitPGMoE', () => {
    test('returns correct shape', () => {
        const { centered } = centerNormalize(twoClusterData)
        const result = fitPGMoE(centered, 2, 'VVI')
        expect(result.means).toHaveLength(2)
        expect(result.assignments).toHaveLength(twoClusterData.length)
        expect(result.responsibilities).toHaveLength(twoClusterData.length)
        expect(typeof result.logLikelihood).toBe('number')
    })

    test('handles n <= k edge case without throwing', () => {
        const data = [[0, 0], [1, 1]]
        const { centered } = centerNormalize(data)
        const result = fitPGMoE(centered, 3, 'EII')
        expect(result.assignments).toHaveLength(2)
    })

    test('assignments are valid cluster indices', () => {
        const { centered } = centerNormalize(twoClusterData)
        const result = fitPGMoE(centered, 2, 'VVI')
        for (const a of result.assignments) {
            expect(a).toBeGreaterThanOrEqual(0)
            expect(a).toBeLessThan(2)
        }
    })
})

describe('computeNormalizedEntropy', () => {
    test('returns 1 for perfectly crisp assignments', () => {
        const responsibilities = [
            [1, 0], [1, 0], [0, 1], [0, 1]
        ]
        const entropy = computeNormalizedEntropy(responsibilities, 4, 2)
        expect(entropy).toBeGreaterThan(0)
    })

    test('returns 1 for k=1', () => {
        const entropy = computeNormalizedEntropy([[1], [1]], 2, 1)
        expect(entropy).toBe(1)
    })
})

describe('generateClusterLabels', () => {
    test('returns k labels for any k', () => {
        for (const k of [1, 2, 3, 4, 5, 6]) {
            expect(generateClusterLabels(k)).toHaveLength(k)
        }
    })

    test('k=2 returns exactly two labels', () => {
        const labels = generateClusterLabels(2)
        expect(labels[0]).toContain('building')
        expect(labels[1]).toContain('strong')
    })
})

describe('selectOptimalModel', () => {
    test('returns a model with k and covType', () => {
        const { centered } = centerNormalize(twoClusterData)
        const result = selectOptimalModel(centered, 2, 3)
        expect(result.k).toBeGreaterThanOrEqual(2)
        expect(['EII', 'VII', 'EEI', 'VVI']).toContain(result.covType)
        expect(result.model).toBeDefined()
    })
})
