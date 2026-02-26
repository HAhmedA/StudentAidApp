// Simulation Orchestrator Service
// Central coordinator for all data simulators (SRL, Sleep, etc.)
// Ensures student profile consistency across all data sources

import logger from '../utils/logger.js';
import {
    generateSleepData,
    generateSRLData,
    generateScreenTimeData,
    generateLMSData
} from './simulators/index.js';
import { computeAllScores } from './scoring/index.js';
import { withTransaction } from '../utils/withTransaction.js';

// =============================================================================
// PROFILE MANAGEMENT
// =============================================================================

/**
 * Get or assign a simulated profile for a user
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {string} - Profile name (high_achiever/average/low_achiever)
 */
async function getOrAssignProfile(pool, userId) {
    // Check if profile exists
    const { rows } = await pool.query(
        `SELECT simulated_profile FROM public.student_profiles WHERE user_id = $1`,
        [userId]
    );

    if (rows.length > 0 && rows[0].simulated_profile) {
        return rows[0].simulated_profile;
    }

    // Cyclic Profile Assignment (High -> Average -> Low)
    // We check the most recently assigned profile globally to ensure rotation for testing
    const lastProfileResult = await pool.query(
        `SELECT simulated_profile FROM public.student_profiles 
         WHERE simulated_profile IS NOT NULL 
         ORDER BY updated_at DESC LIMIT 1`
    );

    let profile = 'high_achiever'; // Default start

    if (lastProfileResult.rows.length > 0) {
        const lastProfile = lastProfileResult.rows[0].simulated_profile;
        switch (lastProfile) {
            case 'high_achiever':
                profile = 'average';
                break;
            case 'average':
                profile = 'low_achiever';
                break;
            case 'low_achiever':
                profile = 'high_achiever';
                break;
            default:
                profile = 'high_achiever';
        }
    }

    // Upsert profile
    await pool.query(
        `INSERT INTO public.student_profiles (user_id, simulated_profile)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           simulated_profile = COALESCE(student_profiles.simulated_profile, EXCLUDED.simulated_profile),
           updated_at = NOW()`,
        [userId, profile]
    );

    logger.info(`Orchestrator assigned profile '${profile}' to user ${userId}`);
    return profile;
}

// =============================================================================
// MAIN ORCHESTRATION
// =============================================================================

/**
 * Generate comprehensive student data for a new user
 * Called during registration or manual reset
 * 
 * @param {Object} pool - Database connection pool
 * @param {string} userId - User ID
 */
async function generateStudentData(pool, userId) {
    logger.info(`Starting data simulation for user ${userId}`);

    try {
        // 1. Assign Profile (Single Source of Truth)
        const profile = await getOrAssignProfile(pool, userId);
        logger.info(`Simulation profile: ${profile}`);

        // 2. Run Simulators inside a single transaction (sequential for atomicity).
        // Each simulator accepts a pool-compatible client via its first argument.
        await withTransaction(pool, async (client) => {
            await generateSleepData(client, userId, 7, profile);
            logger.info(`Sleep simulation complete for ${userId}`);

            await generateSRLData(client, userId, profile);
            logger.info(`SRL simulation complete for ${userId}`);

            await generateScreenTimeData(client, userId, 7, profile);
            logger.info(`Screen time simulation complete for ${userId}`);

            await generateLMSData(client, userId, 7, profile);
            logger.info(`LMS simulation complete for ${userId}`);
        });

        // 3. Compute Concept Scores (after all data is generated)
        const scores = await computeAllScores(userId);
        logger.info(`Concept scores computed for user ${userId}`);

        // 4. Seed historical scores for past 6 days (so Yesterday needle has data)
        await seedScoreHistory(pool, userId, scores);

        logger.info(`All data simulation complete for user ${userId}`);
        return profile;

    } catch (err) {
        logger.error(`Orchestrator simulation error: ${err.message}`);
        throw err;
    }
}

/**
 * Seed concept_score_history with daily entries for the past 6 days.
 * Uses the currently computed scores and adds small daily variations
 * to simulate realistic day-over-day score changes.
 */
async function seedScoreHistory(pool, userId, scores) {
    try {
        const concepts = Object.keys(scores);
        if (concepts.length === 0) return;

        for (const conceptId of concepts) {
            const baseScore = scores[conceptId]?.score;
            if (baseScore == null) continue;
            const breakdown = scores[conceptId]?.breakdown ?? null;

            // Generate scores for the past 6 days (today is already stored by computeAllScores)
            for (let daysAgo = 1; daysAgo <= 6; daysAgo++) {
                // Add +/- random variation (up to 8 points) for realistic daily fluctuation
                const variation = (Math.random() - 0.5) * 16;
                const dayScore = Math.max(0, Math.min(100,
                    Math.round((baseScore + variation) * 100) / 100
                ));

                await pool.query(
                    `INSERT INTO public.concept_score_history
                     (user_id, concept_id, score, aspect_breakdown, score_date, computed_at)
                     VALUES ($1, $2, $3, $4, CURRENT_DATE - CAST($5 || ' days' AS INTERVAL), NOW())
                     ON CONFLICT (user_id, concept_id, score_date) DO NOTHING`,
                    [userId, conceptId, dayScore, breakdown ? JSON.stringify(breakdown) : null, daysAgo]
                );
            }
        }
        logger.info(`Seeded 6-day score history for user ${userId}`);
    } catch (err) {
        logger.error(`Error seeding score history: ${err.message}`);
    }
}

export {
    generateStudentData,
    getOrAssignProfile
};

