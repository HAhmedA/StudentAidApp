/**
 * Unit tests for projectDataExportService.js
 *
 * The service accepts `pool` as an argument, so we can inject a fake directly
 * without module-level mocking. No DB is touched.
 *
 * Because the service is intentionally randomized, assertions are
 * property-based: counts, ranges, label values, run-to-run variance.
 */

import { randomUUID } from 'crypto'

import {
    buildProjectDataCsv,
    generateSyntheticRow,
    toUnifiedScale,
    CSV_COLUMNS,
    WELLBEING_KEYS,
    SRL_KEYS,
    MIN_ROWS,
} from '../../services/projectDataExportService.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeSubmission(userId, date, { wellbeing, srl } = {}) {
    const wb = wellbeing ?? { cheerfulness: 7, calmness: 6, vitality: 5, restedness: 8, interest: 6 }
    const sr = srl ?? {
        efficiency: 4, importance: 4, tracking: 3, effort: 4, help_seeking: 3,
        community: 4, timeliness: 3, motivation: 4, anxiety: 2, reflection: 4,
    }
    return {
        questionnaire_id: randomUUID(),
        user_id: userId,
        submitted_date: date,
        ...wb,
        ...sr,
    }
}

function makeFakePool(rows) {
    return { query: async () => ({ rows }) }
}

function parseCsv(csv) {
    const lines = csv.split('\n')
    const header = lines[0].split(',')
    const dataRows = lines.slice(1).map(line => {
        const cells = line.split(',')
        const obj = {}
        header.forEach((h, i) => { obj[h] = cells[i] })
        return obj
    })
    return { header, rows: dataRows }
}

// ══════════════════════════════════════════════════════════════════════════════
// toUnifiedScale — pure rescale + round + clamp
// ══════════════════════════════════════════════════════════════════════════════

describe('toUnifiedScale', () => {
    test('wellbeing 0-10 maps to integer 1-5', () => {
        expect(toUnifiedScale(0, 0, 10)).toBe(1)
        expect(toUnifiedScale(2.5, 0, 10)).toBe(2)
        expect(toUnifiedScale(5, 0, 10)).toBe(3)
        expect(toUnifiedScale(7.5, 0, 10)).toBe(4)
        expect(toUnifiedScale(10, 0, 10)).toBe(5)
    })

    test('SRL 1-5 rounds to integer 1-5', () => {
        expect(toUnifiedScale(1, 1, 5)).toBe(1)
        expect(toUnifiedScale(2.4, 1, 5)).toBe(2)
        expect(toUnifiedScale(3, 1, 5)).toBe(3)
        expect(toUnifiedScale(3.5, 1, 5)).toBe(4)   // round half to even or up — JS Math.round rounds up
        expect(toUnifiedScale(4.7, 1, 5)).toBe(5)
        expect(toUnifiedScale(5, 1, 5)).toBe(5)
    })

    test('null and undefined pass through as null', () => {
        expect(toUnifiedScale(null, 0, 10)).toBeNull()
        expect(toUnifiedScale(undefined, 1, 5)).toBeNull()
    })

    test('out-of-range values are clamped', () => {
        expect(toUnifiedScale(-5, 0, 10)).toBe(1)
        expect(toUnifiedScale(20, 0, 10)).toBe(5)
        expect(toUnifiedScale(0.5, 1, 5)).toBe(1)
        expect(toUnifiedScale(999, 1, 5)).toBe(5)
    })

    test('non-numeric strings return null', () => {
        expect(toUnifiedScale('hello', 0, 10)).toBeNull()
    })

    test('numeric strings are coerced', () => {
        expect(toUnifiedScale('7.5', 0, 10)).toBe(4)
        expect(toUnifiedScale('3', 1, 5)).toBe(3)
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// generateSyntheticRow — profile-based synthesis
// ══════════════════════════════════════════════════════════════════════════════

describe('generateSyntheticRow', () => {
    test('produces a row with all required fields', () => {
        const row = generateSyntheticRow()
        expect(row.source).toBe('synthetic')
        expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        for (const k of WELLBEING_KEYS) expect(typeof row[k]).toBe('number')
        for (const k of SRL_KEYS) expect(typeof row[k]).toBe('number')
    })

    test('wellbeing scores stay within native 0-10 range before rescaling', () => {
        for (let i = 0; i < 50; i++) {
            const row = generateSyntheticRow()
            for (const k of WELLBEING_KEYS) {
                expect(row[k]).toBeGreaterThanOrEqual(0)
                expect(row[k]).toBeLessThanOrEqual(10)
            }
        }
    })

    test('SRL scores stay within native 1-5 range before rescaling', () => {
        for (let i = 0; i < 50; i++) {
            const row = generateSyntheticRow()
            for (const k of SRL_KEYS) {
                expect(row[k]).toBeGreaterThanOrEqual(1)
                expect(row[k]).toBeLessThanOrEqual(5)
            }
        }
    })

    test('two successive calls produce different rows (randomness sanity)', () => {
        const a = generateSyntheticRow()
        const b = generateSyntheticRow()
        // It's astronomically unlikely that every SRL+wellbeing value is identical.
        const identical = [...WELLBEING_KEYS, ...SRL_KEYS].every(k => a[k] === b[k])
        expect(identical).toBe(false)
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// buildProjectDataCsv — end-to-end with injected fake pool
// ══════════════════════════════════════════════════════════════════════════════

describe('buildProjectDataCsv', () => {
    test('empty DB produces >=70 synthetic rows', async () => {
        const csv = await buildProjectDataCsv(makeFakePool([]))
        const { header, rows } = parseCsv(csv)
        expect(header).toEqual(CSV_COLUMNS)
        expect(rows.length).toBeGreaterThanOrEqual(MIN_ROWS)
    })

    test('row_ids are 1..N sequential', async () => {
        const csv = await buildProjectDataCsv(makeFakePool([]))
        const { rows } = parseCsv(csv)
        rows.forEach((r, i) => expect(r.row_id).toBe(String(i + 1)))
    })

    test('every value column is an integer in [1, 5]', async () => {
        const csv = await buildProjectDataCsv(makeFakePool([]))
        const { rows } = parseCsv(csv)
        for (const r of rows) {
            for (const k of [...WELLBEING_KEYS, ...SRL_KEYS]) {
                const n = Number(r[k])
                expect(Number.isInteger(n)).toBe(true)
                expect(n).toBeGreaterThanOrEqual(1)
                expect(n).toBeLessThanOrEqual(5)
            }
        }
    })

    test('single user with 1 submission → >=70 rows total', async () => {
        const rows = [makeFakeSubmission('user-1', '2026-04-01')]
        const csv = await buildProjectDataCsv(makeFakePool(rows))
        const { rows: out } = parseCsv(csv)
        expect(out.length).toBeGreaterThanOrEqual(MIN_ROWS)
    })

    test('plentiful DB (3 users × 40 submissions) still hits >=70 rows', async () => {
        const dbRows = []
        const users = ['u1', 'u2', 'u3']
        for (const u of users) {
            for (let d = 0; d < 40; d++) {
                dbRows.push(makeFakeSubmission(u, `2026-03-${String((d % 28) + 1).padStart(2, '0')}`))
            }
        }
        const csv = await buildProjectDataCsv(makeFakePool(dbRows))
        const { rows: out } = parseCsv(csv)
        expect(out.length).toBeGreaterThanOrEqual(MIN_ROWS)
    })

    test('two consecutive runs produce different content (randomization)', async () => {
        const pool = makeFakePool([])
        const a = await buildProjectDataCsv(pool)
        const b = await buildProjectDataCsv(pool)
        expect(a).not.toBe(b)   // different string content
    })

    test('no student identifier column in header', async () => {
        const csv = await buildProjectDataCsv(makeFakePool([]))
        const { header } = parseCsv(csv)
        expect(header).not.toContain('user_id')
        expect(header).not.toContain('student')
        expect(header).not.toContain('student_id')
    })

    test('no source column in header', async () => {
        const csv = await buildProjectDataCsv(makeFakePool([]))
        const { header } = parseCsv(csv)
        expect(header).not.toContain('source')
    })

})
