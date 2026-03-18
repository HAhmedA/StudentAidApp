/**
 * Unit tests for sleepAnnotationService.js
 * Validates science-based duration thresholds (NSF 7–9h) and
 * count-only continuity thresholds (0–1 ok, 2–3 warning, 4+ poor).
 */

import {
    evaluateDuration,
    evaluateContinuity,
    DURATION_RANGES,
    CONTINUITY_THRESHOLDS
} from '../../services/annotators/sleepAnnotationService.js';

// Default baseline for duration tests (personal average used for context, not severity)
const DEFAULT_BASELINE = {
    avg_total_sleep_minutes: 450,   // 7.5h personal average
    avg_bedtime_hour: 23.0,
    avg_wake_time_hour: 7.0,
    sessions_count: 7
};

// ══════════════════════════════════════════════════════════════════════════════
// Duration thresholds (science-based: 7–9h optimal)
// ══════════════════════════════════════════════════════════════════════════════

describe('evaluateDuration — science-based thresholds', () => {
    const session = (mins) => ({ total_sleep_minutes: mins });

    test('300 min (5h) → poor (very short)', () => {
        const result = evaluateDuration(session(300), DEFAULT_BASELINE);
        expect(result.severity).toBe('poor');
        expect(result.judgment_key).toBe('sleep_duration_very_short');
    });

    test('359 min → poor (just under 6h)', () => {
        const result = evaluateDuration(session(359), DEFAULT_BASELINE);
        expect(result.severity).toBe('poor');
        expect(result.judgment_key).toBe('sleep_duration_very_short');
    });

    test('390 min (6.5h) → warning (short)', () => {
        const result = evaluateDuration(session(390), DEFAULT_BASELINE);
        expect(result.severity).toBe('warning');
        expect(result.judgment_key).toBe('sleep_duration_short');
    });

    test('420 min (7h) → ok (start of optimal)', () => {
        const result = evaluateDuration(session(420), DEFAULT_BASELINE);
        expect(result.severity).toBe('ok');
        expect(result.judgment_key).toBe('sleep_duration_good');
    });

    test('480 min (8h) → ok (middle of optimal)', () => {
        const result = evaluateDuration(session(480), DEFAULT_BASELINE);
        expect(result.severity).toBe('ok');
        expect(result.judgment_key).toBe('sleep_duration_good');
    });

    test('540 min (9h) → ok (end of optimal)', () => {
        const result = evaluateDuration(session(540), DEFAULT_BASELINE);
        expect(result.severity).toBe('ok');
        expect(result.judgment_key).toBe('sleep_duration_good');
    });

    test('570 min (9.5h) → warning (long)', () => {
        const result = evaluateDuration(session(570), DEFAULT_BASELINE);
        expect(result.severity).toBe('warning');
        expect(result.judgment_key).toBe('sleep_duration_long');
    });

    test('600 min (10h) → warning (upper boundary)', () => {
        const result = evaluateDuration(session(600), DEFAULT_BASELINE);
        expect(result.severity).toBe('warning');
        expect(result.judgment_key).toBe('sleep_duration_long');
    });

    test('660 min (11h) → poor (oversleep)', () => {
        const result = evaluateDuration(session(660), DEFAULT_BASELINE);
        expect(result.severity).toBe('poor');
        expect(result.judgment_key).toBe('sleep_duration_very_long');
    });

    test('personal baseline context appears when diff ≥ 15 min', () => {
        // 480 min session vs 450 min baseline = 30 min diff → should mention baseline
        const result = evaluateDuration(session(480), DEFAULT_BASELINE);
        expect(result.explanation_llm).toContain('more than your usual');
    });

    test('personal baseline context omitted when diff < 15 min', () => {
        // 455 min session vs 450 min baseline = 5 min diff → no baseline mention
        const result = evaluateDuration(session(455), DEFAULT_BASELINE);
        expect(result.explanation_llm).not.toContain('your usual');
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// Continuity thresholds (count-only: 0–1 ok, 2–3 warning, 4+ poor)
// ══════════════════════════════════════════════════════════════════════════════

describe('evaluateContinuity — count-only thresholds', () => {
    const session = (count, mins = 0) => ({
        awakenings_count: count,
        awake_minutes: mins
    });

    test('0 awakenings → ok', () => {
        const result = evaluateContinuity(session(0));
        expect(result.severity).toBe('ok');
        expect(result.judgment_key).toBe('sleep_continuous');
    });

    test('1 awakening → ok', () => {
        const result = evaluateContinuity(session(1, 5));
        expect(result.severity).toBe('ok');
        expect(result.judgment_key).toBe('sleep_continuous');
    });

    test('2 awakenings → warning', () => {
        const result = evaluateContinuity(session(2, 10));
        expect(result.severity).toBe('warning');
        expect(result.judgment_key).toBe('sleep_some_interruptions');
    });

    test('3 awakenings → warning', () => {
        const result = evaluateContinuity(session(3, 20));
        expect(result.severity).toBe('warning');
        expect(result.judgment_key).toBe('sleep_some_interruptions');
    });

    test('4 awakenings → poor', () => {
        const result = evaluateContinuity(session(4, 30));
        expect(result.severity).toBe('poor');
        expect(result.judgment_key).toBe('sleep_fragmented');
    });

    test('8 awakenings → poor', () => {
        const result = evaluateContinuity(session(8, 45));
        expect(result.severity).toBe('poor');
        expect(result.judgment_key).toBe('sleep_fragmented');
    });

    test('awake_minutes appear in explanation text but do not affect severity', () => {
        // 1 awakening with 40 minutes awake should still be ok (count-based)
        const result = evaluateContinuity(session(1, 40));
        expect(result.severity).toBe('ok');
        expect(result.explanation_llm).toContain('40 minutes awake');
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// Threshold constants sanity checks
// ══════════════════════════════════════════════════════════════════════════════

describe('threshold constants', () => {
    test('DURATION_RANGES has expected boundaries', () => {
        expect(DURATION_RANGES.poor_low).toBe(360);
        expect(DURATION_RANGES.ok_low).toBe(420);
        expect(DURATION_RANGES.ok_high).toBe(540);
        expect(DURATION_RANGES.warning_high).toBe(600);
    });

    test('CONTINUITY_THRESHOLDS has expected boundaries', () => {
        expect(CONTINUITY_THRESHOLDS.ok).toBe(1);
        expect(CONTINUITY_THRESHOLDS.warning).toBe(3);
    });
});
