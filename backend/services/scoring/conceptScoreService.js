// Concept Score Service
// Aggregates per-domain scores into single concept scores
// Supports both legacy severity-based and PGMoE cluster-based raw scoring

/**
 * @typedef {Object} AspectScore
 * @property {number} score
 * @property {number} weight
 * @property {number} contribution
 * @property {string} [label]
 * @property {string} [category]
 * @property {string} [categoryLabel]
 * @property {number} [zScore]
 */

/**
 * @typedef {Object} ConceptScore
 * @property {string} conceptId
 * @property {string} conceptName
 * @property {number} score
 * @property {'improving'|'declining'|'stable'} trend
 * @property {number|null} avg7d
 * @property {string} computedAt
 * @property {Record<string, AspectScore>} [breakdown]
 */

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import { severityToScore, EqualWeightStrategy } from './scoringStrategies.js';
import { CONCEPT_NAMES } from '../../config/concepts.js';
import { withTransaction } from '../../utils/withTransaction.js';

// Default strategy (can be swapped for custom strategies later)
const DEFAULT_STRATEGY = new EqualWeightStrategy();

// =============================================================================
// CORE SCORING FUNCTIONS
// =============================================================================

/**
 * Compute a single concept score from aspect severities
 * 
 * @param {Array<{domain: string, severity: string}>} aspects - Array of aspects with severity
 * @param {Object} strategy - Scoring strategy (default: EqualWeightStrategy)
 * @returns {Object} - { score: number, breakdown: Object }
 */
function computeScore(aspects, strategy = DEFAULT_STRATEGY) {
    if (!aspects || aspects.length === 0) {
        return { score: 0, breakdown: {} };
    }

    // Get weights from strategy
    const weights = strategy.getWeights(aspects);

    // Compute weighted sum
    let weightedSum = 0;
    const breakdown = {};

    for (let i = 0; i < aspects.length; i++) {
        const aspect = aspects[i];
        const numericScore = severityToScore(aspect.severity);
        const weight = weights[i];

        weightedSum += numericScore * weight;
        breakdown[aspect.domain] = {
            severity: aspect.severity,
            score: numericScore,
            weight: weight,
            contribution: numericScore * weight
        };
    }

    // Scale to 0-100
    const finalScore = Math.round(weightedSum * 100);

    return { score: finalScore, breakdown };
}

/**
 * Calculate trend by comparing today's score to 7-day average
 * 
 * @param {number} todayScore - Today's score (0-100)
 * @param {number|null} avg7d - 7-day average score (0-100)
 * @returns {string} - 'improving', 'declining', or 'stable'
 */
function calculateTrend(todayScore, avg7d) {
    if (avg7d === null || avg7d === undefined) {
        return 'stable'; // Not enough data
    }

    const difference = todayScore - avg7d;
    const threshold = 10; // 10 point change is significant

    if (difference >= threshold) {
        return 'improving';
    } else if (difference <= -threshold) {
        return 'declining';
    }
    return 'stable';
}

/**
 * Get 7-day average score for a concept
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @returns {Promise<number|null>} - Average score or null if no history
 */
async function get7DayAverage(userId, conceptId) {
    const { rows } = await pool.query(
        `SELECT AVG(score) as avg_score
         FROM public.concept_score_history
         WHERE user_id = $1 
           AND concept_id = $2 
           AND score_date >= CURRENT_DATE - INTERVAL '7 days'
           AND score_date < CURRENT_DATE`,
        [userId, conceptId]
    );

    return rows[0]?.avg_score ? parseFloat(rows[0].avg_score) : null;
}

/**
 * Store concept score in database
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @param {number} score - Score (0-100)
 * @param {string} trend - Trend ('improving', 'declining', 'stable')
 * @param {Object} breakdown - Aspect breakdown for debugging
 * @param {number|null} avg7d - 7-day average
 */
async function storeScore(userId, conceptId, score, trend, breakdown, avg7d) {
    await withTransaction(pool, async (client) => {
        // Upsert current score; preserve previous breakdown for self-comparison in UI
        await client.query(
            `INSERT INTO public.concept_scores
             (user_id, concept_id, score, trend, aspect_breakdown, avg_7d, computed_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (user_id, concept_id) DO UPDATE SET
               score = EXCLUDED.score,
               trend = EXCLUDED.trend,
               previous_aspect_breakdown = concept_scores.aspect_breakdown,
               aspect_breakdown = EXCLUDED.aspect_breakdown,
               avg_7d = EXCLUDED.avg_7d,
               computed_at = NOW()`,
            [userId, conceptId, score, trend, JSON.stringify(breakdown), avg7d]
        );

        // Also store in history (for future trend calculations and self-comparison)
        await client.query(
            `INSERT INTO public.concept_score_history
             (user_id, concept_id, score, aspect_breakdown, score_date, computed_at)
             VALUES ($1, $2, $3, $4, CURRENT_DATE, NOW())
             ON CONFLICT (user_id, concept_id, score_date) DO UPDATE SET
               score = EXCLUDED.score,
               aspect_breakdown = EXCLUDED.aspect_breakdown,
               computed_at = NOW()`,
            [userId, conceptId, score, JSON.stringify(breakdown)]
        );
    });

    logger.info(`Stored ${conceptId} score: ${score}/100 (${trend}) for user ${userId}`);
}

/**
 * Compute and store a concept score (legacy - uses severity mapping)
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @param {Array<{domain: string, severity: string}>} aspects - Aspect severities
 * @param {Object} strategy - Scoring strategy (optional)
 * @returns {Promise<{score: number, trend: string, breakdown: Object}>}
 */
async function computeAndStoreScore(userId, conceptId, aspects, strategy = DEFAULT_STRATEGY) {
    // Compute score
    const { score, breakdown } = computeScore(aspects, strategy);

    // Get 7-day average for trend
    const avg7d = await get7DayAverage(userId, conceptId);

    // Calculate trend
    const trend = calculateTrend(score, avg7d);

    // Store in database
    await storeScore(userId, conceptId, score, trend, breakdown, avg7d);

    return { score, trend, breakdown, avg7d };
}

/**
 * Compute and store a concept score from raw scores (supports both legacy 0-100 and peer-comparison categories)
 * 
 * For peer-comparison: rawScores have { domain, category, categoryLabel, numericScore, label }
 * For legacy: rawScores have { domain, score, label }
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @param {Array} rawScores - Array of domain/score pairs
 * @returns {Promise<{score: number, trend: string, breakdown: Object}>}
 */
async function computeAndStoreRawScore(userId, conceptId, rawScores) {
    if (!rawScores || rawScores.length === 0) {
        return { score: 0, trend: 'stable', breakdown: {} };
    }

    // Use numericScore (from peer comparison) if available, otherwise use score (legacy)
    const getScore = (r) => r.numericScore != null ? r.numericScore : (r.score || 0);

    // Compute average of all raw scores
    const total = rawScores.reduce((sum, r) => sum + getScore(r), 0);
    const score = Math.round((total / rawScores.length) * 100) / 100;

    // Build breakdown for frontend consumption
    const breakdown = {};
    for (const r of rawScores) {
        breakdown[r.domain] = {
            score: getScore(r),
            weight: 1 / rawScores.length,
            contribution: getScore(r) / rawScores.length,
            label: r.label,
            // Peer comparison fields (if present)
            ...(r.category && { category: r.category }),
            ...(r.categoryLabel && { categoryLabel: r.categoryLabel }),
            ...(r.zScore != null && { zScore: r.zScore })
        };
    }

    // Get 7-day average for trend
    const avg7d = await get7DayAverage(userId, conceptId);

    // Calculate trend
    const trend = calculateTrend(score, avg7d);

    // Store in database
    await storeScore(userId, conceptId, score, trend, breakdown, avg7d);

    return { score, trend, breakdown, avg7d };
}

// =============================================================================
// CHATBOT OUTPUT FUNCTIONS
// =============================================================================

/**
 * Format a single concept score for chatbot consumption
 * 
 * @param {string} conceptId - Concept ID
 * @param {number} score - Score (0-100)
 * @param {string} trend - Trend
 * @returns {string} - Formatted string
 */
function formatScoreForChatbot(conceptId, score, trend) {
    const trendDescriptions = {
        improving: 'improving from last week',
        declining: 'declining from last week',
        stable: 'stable'
    };

    const name = CONCEPT_NAMES[conceptId] || conceptId;
    const trendDesc = trendDescriptions[trend] || trend;

    return `${name}: ${score}/100 (${trendDesc})`;
}

/**
 * Get all concept scores for a user, formatted for chatbot
 * 
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Formatted markdown string
 */
async function getAllScoresForChatbot(userId) {
    const { rows } = await pool.query(
        `SELECT concept_id, score, trend 
         FROM public.concept_scores 
         WHERE user_id = $1
         ORDER BY concept_id`,
        [userId]
    );

    if (rows.length === 0) {
        return 'No data summaries available yet.';
    }

    let result = '## Student Data Summary\n\n';

    for (const row of rows) {
        result += `- ${formatScoreForChatbot(row.concept_id, row.score, row.trend)}\n`;
    }

    return result;
}

/**
 * Get a single concept score for chatbot
 * 
 * @param {string} userId - User ID
 * @param {string} conceptId - Concept ID
 * @returns {Promise<string>} - Formatted string
 */
async function getScoreForChatbot(userId, conceptId) {
    const { rows } = await pool.query(
        `SELECT score, trend FROM public.concept_scores 
         WHERE user_id = $1 AND concept_id = $2`,
        [userId, conceptId]
    );

    if (rows.length === 0) {
        return `No ${conceptId} data available.`;
    }

    return formatScoreForChatbot(conceptId, rows[0].score, rows[0].trend);
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    // Core scoring
    computeScore,
    computeAndStoreScore,
    computeAndStoreRawScore,
    calculateTrend,
    get7DayAverage,

    // Chatbot output
    getAllScoresForChatbot,
    getScoreForChatbot,
    formatScoreForChatbot,

    // Storage
    storeScore
};

