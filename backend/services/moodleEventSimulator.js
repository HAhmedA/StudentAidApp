// Moodle Event Simulator
// Generates mock REST-shaped activity data that passes through the SAME aggregateToDaily()
// pipeline as real Moodle data, ensuring identical code paths for simulated vs. real data.
//
// Three achievement profiles match the existing simulation system:
//   HIGH_ACHIEVER  — 6 active days/wk, ~5 quiz attempts, ~2 assignments, ~3 forum posts
//   AVERAGE        — 4 active days/wk, ~2 quiz attempts, ~1 assignment, ~1 forum post
//   LOW_ACHIEVER   — 2 active days/wk, ~0-1 quiz attempts, 0 assignments, 0 forum posts

import logger from '../utils/logger.js'
import { aggregateToDaily, upsertLmsDailyRows } from './moodleService.js'
import { withTransaction } from '../utils/withTransaction.js'
import { computeJudgments } from './annotators/lmsAnnotationService.js'
import { computeAllScores } from './scoring/index.js'

// =============================================================================
// PROFILE DEFINITIONS
// =============================================================================

const MOCK_PROFILES = {
    high_achiever: {
        activeDaysPerWeek:    6,
        quizAttemptsPerWeek:  5,
        assignmentsPerWeek:   2,
        forumPostsPerWeek:    3,
        quizDurationRange:    [20, 90],  // minutes
    },
    average: {
        activeDaysPerWeek:    4,
        quizAttemptsPerWeek:  2,
        assignmentsPerWeek:   1,
        forumPostsPerWeek:    1,
        quizDurationRange:    [10, 60],
    },
    low_achiever: {
        activeDaysPerWeek:    2,
        quizAttemptsPerWeek:  1,
        assignmentsPerWeek:   0,
        forumPostsPerWeek:    0,
        quizDurationRange:    [10, 30],
    },
}

const DEFAULT_PROFILE = 'average'

// =============================================================================
// MOCK DATA GENERATION
// =============================================================================

/**
 * Generate mock REST-shaped activity data matching the given profile.
 * Returns data in the exact shape that fetchQuizAttempts / fetchAssignmentSubmissions /
 * fetchForumPosts return, so aggregateToDaily() can process it identically.
 *
 * @param {string} profile  - 'high_achiever' | 'average' | 'low_achiever'
 * @param {number} days     - Number of past days to generate data for (default 7)
 * @returns {{ quizAttempts: Array, assignments: Array, forumPosts: Array }}
 */
function generateMockRestData(profile = DEFAULT_PROFILE, days = 7) {
    const cfg = MOCK_PROFILES[profile] || MOCK_PROFILES[DEFAULT_PROFILE]

    // Pick which day offsets are "active" (0 = today, days-1 = oldest)
    const allOffsets    = Array.from({ length: days }, (_, i) => i)
    const activeDayCount = clamp(randomAround(cfg.activeDaysPerWeek, 1), 0, days)
    shuffle(allOffsets)
    const activeOffsets = new Set(allOffsets.slice(0, activeDayCount))

    const today       = new Date()
    today.setHours(0, 0, 0, 0)

    const quizAttempts = []
    const assignments  = []
    const forumPosts   = []

    for (const offset of activeOffsets) {
        const dayDate = new Date(today)
        dayDate.setDate(dayDate.getDate() - offset)
        const dateStr = dayDate.toISOString().slice(0, 10)

        // Base Unix timestamp for this day (midday to avoid timezone edge cases)
        const baseTsSeconds = Math.floor(dayDate.getTime() / 1000) + 43200

        // Quiz attempts for this day
        const quizCount = clamp(randomAround(cfg.quizAttemptsPerWeek / activeDayCount, 0.8), 0, 5)
        for (let i = 0; i < quizCount; i++) {
            const [minDur, maxDur] = cfg.quizDurationRange
            const durationMin = minDur + Math.floor(Math.random() * (maxDur - minDur + 1))
            const timestart   = baseTsSeconds + i * 3600 + Math.floor(Math.random() * 1800)
            const timefinish  = timestart + durationMin * 60

            quizAttempts.push({
                date:             dateStr,
                timestart,
                timefinish,
                duration_minutes: durationMin,
                quizid:           1000 + Math.floor(Math.random() * 10),  // fake quiz ID
            })
        }

        // Assignment submissions for this day
        if (cfg.assignmentsPerWeek > 0) {
            const assignCount = Math.random() < (cfg.assignmentsPerWeek / activeDayCount) ? 1 : 0
            for (let i = 0; i < assignCount; i++) {
                assignments.push({
                    date:         dateStr,
                    assignmentid: 2000 + Math.floor(Math.random() * 5),  // fake assignment ID
                })
            }
        }

        // Forum posts for this day
        if (cfg.forumPostsPerWeek > 0) {
            const postCount = Math.random() < (cfg.forumPostsPerWeek / activeDayCount)
                ? Math.ceil(Math.random() * 2)
                : 0
            for (let i = 0; i < postCount; i++) {
                forumPosts.push({
                    date:         dateStr,
                    discussionid: 3000 + Math.floor(Math.random() * 10),  // fake discussion ID
                })
            }
        }
    }

    return { quizAttempts, assignments, forumPosts }
}

// =============================================================================
// STANDALONE SIMULATE FUNCTION
// =============================================================================

/**
 * Simulate LMS activity for a user using generateMockRestData → aggregateToDaily,
 * the same pipeline as real Moodle sync. Writes is_simulated=true rows.
 *
 * Can be called standalone or from simulationOrchestratorService.
 *
 * @param {import('pg').Pool} pool
 * @param {string} userId
 */
async function simulateUserData(pool, userId) {
    // Read profile assigned by orchestrator (or fall back to default)
    const profile = await getProfile(pool, userId) || DEFAULT_PROFILE
    logger.info(`moodleEventSimulator: using profile '${profile}' for user ${userId}`)

    // Generate mock REST-shaped data
    const { quizAttempts, assignments, forumPosts } = generateMockRestData(profile, 7)

    // Aggregate via the same function used for real data
    const dailyRows = aggregateToDaily({ quizAttempts, assignments, forumPosts })

    if (dailyRows.length === 0) {
        logger.info(`moodleEventSimulator: no activity generated for user ${userId}`)
        return
    }

    // Upsert lms_sessions (is_simulated=true) and baseline
    await withTransaction(pool, async (client) => {
        await upsertLmsDailyRows(client, userId, dailyRows, true)

        // Baseline: profile-driven weekly estimate
        const cfg = MOCK_PROFILES[profile] || MOCK_PROFILES[DEFAULT_PROFILE]
        const baselineMinutes  = cfg.quizAttemptsPerWeek * 45 + cfg.assignmentsPerWeek * 10
        const baselineSessions = cfg.quizAttemptsPerWeek + cfg.assignmentsPerWeek
        await client.query(
            `INSERT INTO public.lms_baselines
                 (user_id, baseline_active_minutes, baseline_sessions, baseline_days_active)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId, baselineMinutes, baselineSessions, cfg.activeDaysPerWeek]
        )
    })

    // Compute judgments and scores
    await computeJudgments(pool, userId, 7)
    computeAllScores(userId).catch(err =>
        logger.error(`moodleEventSimulator computeAllScores error for ${userId}: ${err.message}`)
    )

    logger.info(`moodleEventSimulator: ${dailyRows.length} days simulated for user ${userId}`)
}

// =============================================================================
// UTILITIES
// =============================================================================

async function getProfile(pool, userId) {
    const { rows } = await pool.query(
        `SELECT simulated_profile FROM public.student_profiles WHERE user_id = $1`,
        [userId]
    )
    return rows.length > 0 ? rows[0].simulated_profile : null
}

function randomAround(base, variance) {
    return Math.max(0, Math.round(base + (Math.random() - 0.5) * 2 * variance))
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]]
    }
}

export { generateMockRestData, simulateUserData }
