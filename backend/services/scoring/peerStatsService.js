// Peer Stats Service
// Z-score based peer comparison (fallback/supplementary to PGMoE clustering)
// Computes population mean/stddev per metric dimension, then categorizes each user
//
// Categories (all green shades — positive framing):
//   requires_improvement  (Z < -0.5)
//   good                  (−0.5 ≤ Z ≤ 0.5)
//   very_good             (Z > 0.5)

import logger from '../../utils/logger.js';
import { getAllUserMetrics } from './scoreQueryService.js';

// =============================================================================
// CATEGORY MAPPING
// =============================================================================

const CATEGORY_MAP = {
    requires_improvement: { label: 'Could Improve', numericScore: 25 },
    good: { label: 'Good', numericScore: 50 },
    very_good: { label: 'Very Good', numericScore: 85 }
};

/**
 * Map a Z-score to one of 3 categories
 * @param {number} z - Z-score (already sign-corrected for inverted metrics)
 * @returns {string} - category key
 */
function zScoreToCategory(z) {
    if (z > 0.5) return 'very_good';
    if (z >= -0.5) return 'good';
    return 'requires_improvement';
}

/**
 * Compute mean and stddev for an array of numbers
 */
function computeStats(values) {
    if (!values || values.length === 0) return { mean: 0, stddev: 0 };
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return { mean, stddev: Math.sqrt(variance) };
}

/**
 * Compute Z-score, returning 0 if stddev is 0
 */
function zScore(value, mean, stddev) {
    if (stddev === 0) return 0;
    return (value - mean) / stddev;
}

// Metric queries are provided by scoreQueryService.js (single source of truth).

// =============================================================================
// DIMENSION DEFINITIONS (which metrics map to which domains, and inversion)
// =============================================================================

// For non-SRL concepts: { dimensionKey: { metric, inverted } }
// "inverted" means lower values are better (screen time, awakenings, etc.)
const DIMENSION_DEFS = {
    lms: {
        volume: { metric: 'total_active_minutes', inverted: false },
        consistency: { metric: 'days_active', inverted: false },
        participation_variety: { metric: 'participation_score', inverted: false },
        session_quality: { metric: 'avg_session_duration', inverted: false }
    },
    sleep: {
        duration:             { metric: 'duration',            inverted: true },   // lower deviation from 7–9h = better
        duration_consistency: { metric: 'sleep_duration_mad',  inverted: true },   // lower MAD = more consistent
        continuity:           { metric: 'awakenings',          inverted: true },   // fewer = better
        timing:               { metric: 'bedtime_mad',         inverted: true }    // lower MAD = more consistent
    },
    screen_time: {
        volume: { metric: 'screen_minutes', inverted: true },  // less = better
        distribution: { metric: 'longest_session', inverted: true },  // shorter = better
        pre_sleep: { metric: 'late_night', inverted: true }   // less = better
    }
};

// =============================================================================
// MAIN PUBLIC API
// =============================================================================

/**
 * Compute peer-comparison Z-scores and categories for a user in a given concept
 *
 * @param {Object} dbPool - Database pool (unused, we use the imported pool)
 * @param {string} conceptId - 'lms', 'sleep', 'screen_time', 'srl'
 * @param {string} userId - Target user ID
 * @param {number} days - Look-back window (default 7)
 * @returns {Array<{domain, category, categoryLabel, zScore}>}
 */
async function computePeerZScores(dbPool, conceptId, userId, days = 7) {
    const allMetrics = await getAllUserMetrics(conceptId, days);

    if (!allMetrics[userId]) {
        logger.debug(`peerStatsService: no ${conceptId} data for user ${userId}`);
        return [];
    }

    // SRL is special — variable number of dimensions per user
    if (conceptId === 'srl') {
        return computeSRLZScores(allMetrics, userId);
    }

    const dims = DIMENSION_DEFS[conceptId];
    if (!dims) return [];

    const userMetrics = allMetrics[userId];
    const results = [];

    for (const [domain, def] of Object.entries(dims)) {
        // Collect this metric across all users
        const allValues = Object.values(allMetrics).map(m => m[def.metric]).filter(v => v != null);
        const { mean, stddev } = computeStats(allValues);

        let z = zScore(userMetrics[def.metric], mean, stddev);

        // For inverted metrics (less is better), negate so higher Z = better
        if (def.inverted) z = -z;

        const category = zScoreToCategory(z);

        results.push({
            domain,
            category,
            categoryLabel: CATEGORY_MAP[category].label,
            numericScore: CATEGORY_MAP[category].numericScore,
            zScore: Math.round(z * 100) / 100
        });
    }

    return results;
}

/**
 * SRL-specific Z-score computation (14 concept dimensions)
 */
function computeSRLZScores(allMetrics, userId) {
    const userDims = allMetrics[userId];
    if (!userDims) return [];

    const results = [];

    // For each concept the user has
    for (const [conceptKey, userData] of Object.entries(userDims)) {
        // Collect this concept's scores across all users who have it
        const allScores = [];
        for (const [uid, dims] of Object.entries(allMetrics)) {
            if (dims[conceptKey]) {
                allScores.push(dims[conceptKey].score);
            }
        }

        const { mean, stddev } = computeStats(allScores);
        let z = zScore(userData.score, mean, stddev);

        // For inverted SRL concepts (e.g., anxiety), negate so higher Z = better
        if (userData.isInverted) z = -z;

        const category = zScoreToCategory(z);

        results.push({
            domain: conceptKey,
            category,
            categoryLabel: CATEGORY_MAP[category].label,
            numericScore: CATEGORY_MAP[category].numericScore,
            zScore: Math.round(z * 100) / 100
        });
    }

    return results;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    computePeerZScores,
    zScoreToCategory,
    CATEGORY_MAP,
    computeStats,
    zScore
};
