import { severityToScore, EqualWeightStrategy } from '../../../services/scoring/scoringStrategies.js'

describe('severityToScore', () => {
    test('maps all valid severities to numbers in [0, 1]', () => {
        const severities = ['ok', 'warning', 'poor']
        for (const s of severities) {
            const score = severityToScore(s)
            expect(typeof score).toBe('number')
            expect(score).toBeGreaterThanOrEqual(0)
            expect(score).toBeLessThanOrEqual(1)
        }
    })

    test('returns 0.5 for unknown severity (defaults to warning)', () => {
        expect(severityToScore('unknown_value')).toBe(0.5)
    })

    test('ok returns 1.0 (best)', () => {
        expect(severityToScore('ok')).toBe(1)
    })

    test('poor returns 0.0 (worst)', () => {
        expect(severityToScore('poor')).toBe(0)
    })
})

describe('EqualWeightStrategy', () => {
    test('returns equal weights summing to 1', () => {
        const strategy = new EqualWeightStrategy()
        const aspects = [
            { domain: 'a', severity: 'ok' },
            { domain: 'b', severity: 'warning' },
            { domain: 'c', severity: 'poor' }
        ]
        const weights = strategy.getWeights(aspects)
        expect(weights).toHaveLength(3)
        const sum = weights.reduce((a, b) => a + b, 0)
        expect(Math.abs(sum - 1)).toBeLessThan(1e-10)
        for (const w of weights) {
            expect(Math.abs(w - 1 / 3)).toBeLessThan(1e-10)
        }
    })

    test('handles empty aspects array', () => {
        const strategy = new EqualWeightStrategy()
        const weights = strategy.getWeights([])
        expect(weights).toHaveLength(0)
    })
})
