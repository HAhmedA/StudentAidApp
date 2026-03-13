// Cron Service
// Schedules recurring background jobs.
//
// Jobs:
//   - Nightly score recomputation (midnight): recomputes all concept scores
//     for every user who has submitted data in the last 30 days, keeping
//     cluster assignments and peer percentiles up to date as the cohort grows.

import cron from 'node-cron';
import pool from '../config/database.js';
import logger from '../utils/logger.js';
import { computeAllScores, batchScoreSRLCohort } from './scoring/scoreComputationService.js';

// Mirror the SIM_FILTER pattern from scoreQueryService: only exclude simulated rows
// when SIMULATION_MODE is explicitly 'false' (production). In dev/test mode all users
// (including simulated ones) are rescored so the Previous needle has data.
const SIM_FILTER_CRON = process.env.SIMULATION_MODE === 'false' ? `AND is_simulated = false` : ``;

/**
 * Recompute scores for all users who have been active in the last 30 days.
 * "Active" means they have at least one non-simulated data record across any domain.
 *
 * Runs each user sequentially to avoid hammering the DB with parallel PGMoE fits.
 *
 * @param {import('pg').Pool} [dbPool] - DB pool (defaults to module-level pool; injectable for tests)
 * @param {Function} [computeAllScoresFn] - Score computation fn (injectable for tests)
 */
export async function recomputeAllActiveUserScores(dbPool = pool, computeAllScoresFn = computeAllScores) {
    logger.info('Cron: Starting nightly score recomputation...');

    try {
        // Collect distinct user IDs that have submitted real data recently.
        // lms_sessions is included so students whose only recent activity is LMS
        // engagement (no sleep/screen-time logged) are still rescored nightly.
        const { rows } = await dbPool.query(`
            SELECT DISTINCT user_id FROM (
                SELECT user_id FROM public.sleep_sessions
                    WHERE session_date >= CURRENT_DATE - INTERVAL '30 days'
                    ${SIM_FILTER_CRON}
                UNION
                SELECT user_id FROM public.screen_time_sessions
                    WHERE session_date >= CURRENT_DATE - INTERVAL '30 days'
                    ${SIM_FILTER_CRON}
                UNION
                SELECT user_id FROM public.srl_responses
                    WHERE submitted_at >= NOW() - INTERVAL '30 days'
                UNION
                SELECT user_id FROM public.lms_sessions
                    WHERE session_date >= CURRENT_DATE - INTERVAL '30 days'
                    ${SIM_FILTER_CRON}
            ) active_users
            WHERE user_id NOT IN (
                SELECT user_id FROM public.student_profiles WHERE exclude_from_clustering = true
            )
        `);

        if (rows.length === 0) {
            logger.info('Cron: No active users found — skipping recomputation.');
            return;
        }

        logger.info(`Cron: Recomputing scores for ${rows.length} active user(s)...`);

        let successCount = 0;
        let errorCount = 0;

        for (const { user_id } of rows) {
            try {
                await computeAllScoresFn(user_id);
                successCount++;
            } catch (err) {
                logger.error(`Cron: Score recomputation failed for user ${user_id}: ${err.message}`);
                errorCount++;
            }
        }

        logger.info(`Cron: Nightly recomputation complete. ✓ ${successCount} succeeded, ✗ ${errorCount} failed.`);

        // SRL requires a single batch run so peer_clusters and all user_cluster_assignments
        // are written from the same model (one PGMoE fit, one atomic transaction).
        await batchScoreSRLCohort().catch(err =>
            logger.error(`Cron: SRL batch scoring failed: ${err.message}`)
        );
    } catch (err) {
        logger.error(`Cron: Nightly recomputation error: ${err.message}`);
    }
}

/**
 * Register all cron jobs.
 * Called once during server startup.
 */
export function startCronJobs() {
    // Run at midnight every day (server local time)
    cron.schedule('0 0 * * *', () => recomputeAllActiveUserScores());

    logger.info('Cron: Nightly score recomputation scheduled at 00:00.');
}
