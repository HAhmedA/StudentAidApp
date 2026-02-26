import { CONCEPTS, CONCEPT_IDS, CONCEPT_NAMES } from '../../../config/concepts.js'

describe('concepts config', () => {
    test('CONCEPT_IDS contains exactly the four expected concepts', () => {
        expect(CONCEPT_IDS).toHaveLength(4)
        expect(CONCEPT_IDS).toContain('sleep')
        expect(CONCEPT_IDS).toContain('srl')
        expect(CONCEPT_IDS).toContain('lms')
        expect(CONCEPT_IDS).toContain('screen_time')
    })

    test('each concept has required fields', () => {
        for (const id of CONCEPT_IDS) {
            const c = CONCEPTS[id]
            expect(c.id).toBe(id)
            expect(typeof c.displayName).toBe('string')
            expect(c.displayName.length).toBeGreaterThan(0)
            expect(typeof c.table).toBe('string')
            expect(Array.isArray(c.dimensions)).toBe(true)
        }
    })

    test('CONCEPT_NAMES maps all ids to non-empty strings', () => {
        for (const id of CONCEPT_IDS) {
            expect(typeof CONCEPT_NAMES[id]).toBe('string')
            expect(CONCEPT_NAMES[id].length).toBeGreaterThan(0)
        }
    })

    test('CONCEPT_NAMES keys match CONCEPT_IDS', () => {
        expect(Object.keys(CONCEPT_NAMES).sort()).toEqual([...CONCEPT_IDS].sort())
    })
})
