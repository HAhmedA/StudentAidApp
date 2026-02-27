/**
 * backfillYesterdayScores.js — Backfill yesterday scores for all students
 *
 * Inserts a realistic "yesterday" entry into concept_score_history for every
 * student × concept pair found in concept_scores.
 * Safe to re-run — uses ON CONFLICT DO NOTHING.
 *
 * Usage (from project root):
 *   node --env-file=backend/.env backend/scripts/backfillYesterdayScores.js
 *
 * Or with explicit env vars (e.g. when connecting to Docker Postgres from host):
 *   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=password PGDATABASE=postgres \
 *   node backend/scripts/backfillYesterdayScores.js
 */

import pool from '../config/database.js'

// Generate a random integer in [min, max] (inclusive)
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

// Clamp a value to [0, 100]
function clamp100(v) {
    return Math.max(0, Math.min(100, v))
}

async function run() {
    console.log('Backfilling yesterday scores for all students...')

    // Query all student × concept score rows
    const { rows } = await pool.query(
        `SELECT cs.user_id, cs.concept_id, cs.score, cs.aspect_breakdown
         FROM public.concept_scores cs
         JOIN public.users u ON u.id = cs.user_id
         WHERE u.role = 'student'`
    )

    console.log(`Found ${rows.length} student × concept score rows`)

    let inserted = 0
    let skipped = 0

    for (const row of rows) {
        const currentScore = parseFloat(row.score)

        // Random delta: magnitude 5–15, random sign
        const magnitude = randInt(5, 15)
        const sign = Math.random() < 0.5 ? -1 : 1
        const delta = sign * magnitude
        const yesterdayScore = clamp100(currentScore + delta)

        // Derive yesterday breakdown by scaling each aspect score proportionally.
        // If current_score is 0 we can't scale, so preserve the breakdown as-is.
        let yesterdayBreakdown = {}
        const breakdown = row.aspect_breakdown
        if (breakdown && typeof breakdown === 'object' && currentScore > 0) {
            const factor = yesterdayScore / currentScore
            for (const [key, aspect] of Object.entries(breakdown)) {
                yesterdayBreakdown[key] = {
                    ...aspect,
                    score: clamp100((aspect.score || 0) * factor),
                    // Recalculate contribution proportionally as well
                    ...(aspect.contribution != null
                        ? { contribution: clamp100((aspect.contribution || 0) * factor) }
                        : {})
                }
            }
        } else {
            yesterdayBreakdown = breakdown || {}
        }

        const result = await pool.query(
            `INSERT INTO public.concept_score_history
             (user_id, concept_id, score, aspect_breakdown, score_date, computed_at)
             VALUES ($1, $2, $3, $4, CURRENT_DATE - 1, NOW())
             ON CONFLICT (user_id, concept_id, score_date) DO NOTHING`,
            [row.user_id, row.concept_id, yesterdayScore, JSON.stringify(yesterdayBreakdown)]
        )

        if (result.rowCount > 0) {
            inserted++
            console.log(`  ✓ user=${row.user_id.slice(0, 8)}… concept=${row.concept_id} today=${currentScore} → yesterday=${yesterdayScore}`)
        } else {
            skipped++
            console.log(`  - user=${row.user_id.slice(0, 8)}… concept=${row.concept_id} already has yesterday entry — skipped`)
        }
    }

    console.log(`\nDone: ${inserted} row(s) inserted, ${skipped} row(s) skipped (already existed)`)
    await pool.end()
}

run().catch(err => {
    console.error('Fatal error:', err)
    pool.end()
    process.exit(1)
})
