
import pool from '../config/database.js';
import { computeAnnotations } from '../services/annotators/srlAnnotationService.js';
import logger from '../utils/logger.js';
import { randomUUID } from 'crypto';

async function verify() {
    try {
        logger.info('Starting SRL Trend Verification...');

        // 1. Get student user
        const { rows } = await pool.query("SELECT id FROM public.users WHERE email = 'student@example.com'");
        if (rows.length === 0) throw new Error("Student user not found");
        const userId = rows[0].id;

        // 2. Clear existing SRL responses for clean test
        await pool.query('DELETE FROM public.srl_responses WHERE user_id = $1', [userId]);

        // 3. Insert Test Data
        // Scenario: Improving Trend (2, 2, 3) but Latest is a dip (1)
        // Trend = Improving (because 2->3 is upward slope/average increase vs start)
        // Comparison = Lower (1 < 2.33)
        // Expected: "You have been improving overall, despite a slight dip today"

        const keys = ['focus'];

        const now = new Date();
        const d1 = new Date(now); d1.setDate(d1.getDate() - 4);
        const d2 = new Date(now); d2.setDate(d2.getDate() - 3);
        const d3 = new Date(now); d3.setDate(d3.getDate() - 2);
        const d4 = new Date(now); // Today

        // Insert historical
        // Insert historical
        await insertResponse(pool, userId, 'focus', 1, d1);
        await insertResponse(pool, userId, 'focus', 2, d2);
        await insertResponse(pool, userId, 'focus', 5, d3);
        // Insert latest (DIP)
        await insertResponse(pool, userId, 'focus', 2, d4);

        // 4. Compute
        const annotations = await computeAnnotations(pool, userId);

        // 5. Check Output
        const focusAnn = annotations.find(a => a.conceptKey === 'focus');
        if (!focusAnn) throw new Error("Focus annotation not generated");

        console.log('\n--- LLM TEXT OUTPUT ---');
        console.log(focusAnn.annotationTextLLM);
        console.log('--- END OUTPUT ---\n');

        console.log('\n--- UI TEXT OUTPUT ---');
        console.log(focusAnn.annotationText);
        console.log('--- END OUTPUT ---\n');

        if (focusAnn.annotationTextLLM.includes('improving overall')) {
            logger.info('SUCCESS: Complex description found (Improving Overall).');
        } else {
            logger.error('FAIL: Complex description missing.');
        }

        if (focusAnn.annotationTextLLM.includes('slight dip today')) {
            logger.info('SUCCESS: "Slight dip" nuance found.');
        } else {
            logger.error('FAIL: "Slight dip" nuance missing.');
        }

        process.exit(0);

    } catch (err) {
        logger.error('Verification failed:', err);
        process.exit(1);
    }
}

async function insertResponse(pool, userId, key, score, date) {
    const qId = randomUUID(); // Unique ID for each submission

    // Insert Parent Questionnaire
    await pool.query(
        `INSERT INTO public.questionnaire_results (id, user_id, postid, answers, created_at)
         VALUES ($1, $2, $1, '{}', $3)
         ON CONFLICT (id) DO NOTHING`,
        [qId, userId, date]
    );

    // Insert Response
    await pool.query(
        `INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, qId, key, score, date]
    );
}

verify();
