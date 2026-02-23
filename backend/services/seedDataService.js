// Seed Data Service
// Generates simulated data for pre-created test accounts on backend startup.
// Only runs for seed accounts that have a simulated_profile but no SRL data yet.

import pool from '../config/database.js';
import logger from '../utils/logger.js';
import { generateStudentData } from './simulationOrchestratorService.js';

/**
 * Find seed accounts that need data generation and run the orchestrator for each.
 * A seed account is one with a simulated_profile set but no srl_responses yet.
 */
export async function seedTestAccountData() {
    try {
        // Find accounts with a profile but no SRL responses (i.e. no simulation data yet)
        const { rows: accountsNeedingData } = await pool.query(`
            SELECT u.id, u.email, sp.simulated_profile
            FROM public.users u
            JOIN public.student_profiles sp ON sp.user_id = u.id
            WHERE sp.simulated_profile IS NOT NULL
              AND u.email LIKE 'test%@example.com'
              AND NOT EXISTS (
                  SELECT 1 FROM public.srl_responses sr WHERE sr.user_id = u.id
              )
            ORDER BY u.email
        `);

        if (accountsNeedingData.length === 0) {
            logger.info('Seed data: All test accounts already have simulated data.');
            return;
        }

        logger.info(`Seed data: ${accountsNeedingData.length} test account(s) need data generation.`);

        for (const account of accountsNeedingData) {
            try {
                logger.info(`Seed data: Generating data for ${account.email} (profile: ${account.simulated_profile})...`);
                await generateStudentData(pool, account.id);
                logger.info(`Seed data: ✓ ${account.email} complete.`);
            } catch (err) {
                logger.error(`Seed data: ✗ Failed for ${account.email}: ${err.message}`);
            }
        }

        logger.info('Seed data: All test account data generation finished.');
    } catch (err) {
        logger.error(`Seed data service error: ${err.message}`);
    }
}
