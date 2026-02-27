// simulateRealisticData.js
// Generates 40 days of realistic, varied raw data for 20 test students,
// then runs the full scoring + annotation pipeline end-to-end.
//
// Run from project root:
//   PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=password PGDATABASE=postgres \
//     node backend/scripts/simulateRealisticData.js

// =============================================================================
// SECTION 1: IMPORTS
// =============================================================================

import pool from '../config/database.js';
import { randomUUID } from 'crypto';
import { computeAllScores } from '../services/scoring/scoreComputationService.js';
import {
    computeJudgments as sleepJudgments,
    recomputeBaseline as sleepBaseline,
} from '../services/annotators/sleepAnnotationService.js';
import {
    computeJudgments as screenJudgments,
    recomputeBaseline as screenBaseline,
} from '../services/annotators/screenTimeAnnotationService.js';
import { computeJudgments as lmsJudgments } from '../services/annotators/lmsAnnotationService.js';
import { computeAnnotations, CONCEPT_SHORT_NAMES } from '../services/annotators/srlAnnotationService.js';

// =============================================================================
// SECTION 2: PERSONA TABLE  (20 students mapped to test1–test20)
// =============================================================================

const PERSONA_TABLE = [
    { email: 'test1@example.com',  name: 'Wei Chen',             profile: 'high_achiever', disability: null,       chronotype: 'early_bird', lmsPattern: 'consistent',      srlFreq: 'frequent', trend: 'stable' },
    { email: 'test2@example.com',  name: 'Arjun Patel',          profile: 'average',       disability: null,       chronotype: 'normal',     lmsPattern: 'deadline_driven', srlFreq: 'regular',  trend: 'improving' },
    { email: 'test3@example.com',  name: 'Amara Osei',           profile: 'low_achiever',  disability: 'dyslexia', chronotype: 'night_owl',  lmsPattern: 'minimal',         srlFreq: 'sparse',   trend: 'declining' },
    { email: 'test4@example.com',  name: 'Sofia Reyes',          profile: 'high_achiever', disability: null,       chronotype: 'early_bird', lmsPattern: 'consistent',      srlFreq: 'frequent', trend: 'improving' },
    { email: 'test5@example.com',  name: 'Hiroshi Tanaka',       profile: 'average',       disability: null,       chronotype: 'normal',     lmsPattern: 'binge_then_rest', srlFreq: 'regular',  trend: 'stable' },
    { email: 'test6@example.com',  name: 'Chidinma Eze',         profile: 'low_achiever',  disability: 'adhd',     chronotype: 'night_owl',  lmsPattern: 'minimal',         srlFreq: 'sparse',   trend: 'declining' },
    { email: 'test7@example.com',  name: 'Elias Bergström',      profile: 'high_achiever', disability: null,       chronotype: 'early_bird', lmsPattern: 'consistent',      srlFreq: 'frequent', trend: 'stable' },
    { email: 'test8@example.com',  name: 'Priya Krishnamurthy',  profile: 'average',       disability: null,       chronotype: 'normal',     lmsPattern: 'deadline_driven', srlFreq: 'regular',  trend: 'improving' },
    { email: 'test9@example.com',  name: 'Omar Al-Farsi',        profile: 'low_achiever',  disability: 'wmd',      chronotype: 'night_owl',  lmsPattern: 'minimal',         srlFreq: 'frequent', trend: 'stable' },
    { email: 'test10@example.com', name: 'Anika Müller',         profile: 'high_achiever', disability: null,       chronotype: 'early_bird', lmsPattern: 'consistent',      srlFreq: 'frequent', trend: 'improving' },
    { email: 'test11@example.com', name: 'Camille Dupont',       profile: 'average',       disability: null,       chronotype: 'normal',     lmsPattern: 'deadline_driven', srlFreq: 'regular',  trend: 'stable' },
    { email: 'test12@example.com', name: 'Tariq Mensah',         profile: 'low_achiever',  disability: 'dyslexia', chronotype: 'night_owl',  lmsPattern: 'binge_then_rest', srlFreq: 'sparse',   trend: 'declining' },
    { email: 'test13@example.com', name: 'Yuna Kim',             profile: 'high_achiever', disability: null,       chronotype: 'early_bird', lmsPattern: 'consistent',      srlFreq: 'frequent', trend: 'improving' },
    { email: 'test14@example.com', name: 'Marcus Johnson',       profile: 'average',       disability: null,       chronotype: 'normal',     lmsPattern: 'deadline_driven', srlFreq: 'regular',  trend: 'stable' },
    { email: 'test15@example.com', name: 'Fatima Al-Rashidi',    profile: 'low_achiever',  disability: 'adhd',     chronotype: 'night_owl',  lmsPattern: 'minimal',         srlFreq: 'sparse',   trend: 'declining' },
    { email: 'test16@example.com', name: 'Isabela Santos',       profile: 'high_achiever', disability: null,       chronotype: 'early_bird', lmsPattern: 'consistent',      srlFreq: 'frequent', trend: 'stable' },
    { email: 'test17@example.com', name: 'Nour Hassan',          profile: 'average',       disability: null,       chronotype: 'normal',     lmsPattern: 'binge_then_rest', srlFreq: 'regular',  trend: 'improving' },
    { email: 'test18@example.com', name: 'Sebastian Kowalski',   profile: 'low_achiever',  disability: 'wmd',      chronotype: 'night_owl',  lmsPattern: 'minimal',         srlFreq: 'frequent', trend: 'declining' },
    { email: 'test19@example.com', name: 'Aaliya Sharma',        profile: 'high_achiever', disability: null,       chronotype: 'early_bird', lmsPattern: 'consistent',      srlFreq: 'frequent', trend: 'stable' },
    { email: 'test20@example.com', name: 'Lucas Andrade',        profile: 'average',       disability: null,       chronotype: 'normal',     lmsPattern: 'deadline_driven', srlFreq: 'regular',  trend: 'stable' },
];

// =============================================================================
// SECTION 3: CONFIGURATION CONSTANTS
// =============================================================================

const DAYS = 40;

// bedtimeBase: hour the person typically goes to sleep (25.0 = 1 AM normalized)
const CHRONOTYPE_DEFS = {
    early_bird: { bedtimeBase: 22.0, wakeBase:  6.0, variance: 0.5 },
    normal:     { bedtimeBase: 23.5, wakeBase:  7.5, variance: 0.75 },
    night_owl:  { bedtimeBase: 25.0, wakeBase:  9.0, variance: 1.0 },
};

const PROFILE_SLEEP_DEFS = {
    high_achiever: { sleepBase: 450, sleepVar: 30,  awakeningsBase: 1, awakeVar: 1 },
    average:       { sleepBase: 400, sleepVar: 60,  awakeningsBase: 3, awakeVar: 2 },
    low_achiever:  { sleepBase: 330, sleepVar: 60,  awakeningsBase: 5, awakeVar: 3 },
};

const PROFILE_SCREEN_DEFS = {
    high_achiever: { base: 180, var: 40,  lateNight: 10,  longestBase: 35 },
    average:       { base: 300, var: 60,  lateNight: 30,  longestBase: 55 },
    low_achiever:  { base: 450, var: 80,  lateNight: 60,  longestBase: 100 },
};

const PROFILE_LMS_DEFS = {
    high_achiever: { activeMin: 60, var: 20, sessions: 3, quizProb: 0.8, assignProb: 0.4, forumProb: 0.5, longestSession: 40 },
    average:       { activeMin: 35, var: 15, sessions: 2, quizProb: 0.4, assignProb: 0.2, forumProb: 0.2, longestSession: 25 },
    low_achiever:  { activeMin: 15, var: 10, sessions: 1, quizProb: 0.2, assignProb: 0.0, forumProb: 0.0, longestSession: 15 },
};

const PROFILE_SRL_DEFS = {
    high_achiever: { baseRange: [3.8, 5.0], anxietyRange: [1.0, 2.5] },
    average:       { baseRange: [2.5, 4.0], anxietyRange: [2.0, 4.0] },
    low_achiever:  { baseRange: [1.0, 3.0], anxietyRange: [3.0, 5.0] },
};

// Daily probability of SRL submission per pattern
const SRL_FREQ_PROBS = {
    frequent: 0.40,
    regular:  0.15,
    sparse:   0.07,
};

// =============================================================================
// SECTION 4: UTILITY FUNCTIONS
// =============================================================================

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/** Box-Muller gaussian sample */
function gaussian(mean, stddev) {
    const u = Math.max(1e-10, 1 - Math.random());
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + z * stddev;
}

/**
 * Format a Date as local 'YYYY-MM-DD' string (avoids UTC offset issues).
 */
function toDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Create a timestamp from a date + decimal hour.
 * Hours are normalized to [0,24). If h > 12 (evening), bedtime is the prior calendar
 * day (person slept before midnight and woke on sessionDate). If h <= 12 (early morning),
 * bedtime is on sessionDate itself (past-midnight sleep).
 */
function createBedtimeTimestamp(sessionDate, decimalHour) {
    let h = ((decimalHour % 24) + 24) % 24;
    const result = new Date(sessionDate);
    result.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    if (h > 12) {
        result.setDate(result.getDate() - 1);
    }
    return result;
}

function isWeekend(date) {
    const dow = date.getDay();
    return dow === 0 || dow === 6;
}

/** dayIndex 0=oldest (39 days ago), dayIndex 39=today */
function isExamWeek(dayIndex) {
    return dayIndex < 5 || dayIndex >= 35;
}

/** Longitudinal trend multiplier: higher = better performance */
function trendMult(dayIndex, trend) {
    if (trend === 'improving') return 0.85 + (dayIndex / 39) * 0.30;
    if (trend === 'declining') return 1.15 - (dayIndex / 39) * 0.30;
    return 1.0;
}

/**
 * Returns whether the student logs LMS activity on this day.
 * Exam weeks always return true (override).
 */
function isActiveLMSDay(pattern, dayIndex, date) {
    if (isWeekend(date) && Math.random() > 0.3) return false;
    switch (pattern) {
        case 'consistent':      return Math.random() < 0.65;
        case 'deadline_driven': return [3, 4, 5].includes(dayIndex % 7) ? Math.random() < 0.85 : Math.random() < 0.15;
        case 'binge_then_rest': return Math.floor(dayIndex / 5) % 2 === 0;
        case 'minimal':         return Math.random() < 0.22;
        default:                return Math.random() < 0.50;
    }
}

/**
 * Split total minutes into n session chunks (Dirichlet-like partition).
 */
function splitMinutes(total, n) {
    if (n <= 1 || total <= 0) return [Math.max(total, 1)];
    const parts = [];
    let remaining = total;
    for (let i = 0; i < n - 1; i++) {
        const share = clamp(Math.round(rand(0.1, 0.5) * remaining), 1, remaining - (n - 1 - i));
        parts.push(share);
        remaining -= share;
    }
    parts.push(Math.max(remaining, 1));
    return parts;
}

// =============================================================================
// SECTION 5: PER-CONCEPT DATA GENERATORS
// =============================================================================

function genSleepRow(persona, date, dayIndex, prevSleepMin) {
    const chrono = CHRONOTYPE_DEFS[persona.chronotype];
    const sd = PROFILE_SLEEP_DEFS[persona.profile];

    let bedtimeBase = chrono.bedtimeBase;
    let awakeningsBase = sd.awakeningsBase;
    let sleepMinBase = sd.sleepBase;
    let sleepVarMult = 1.0;

    // Weekend: later bedtime
    if (isWeekend(date)) bedtimeBase += 1.5;

    // Exam week: later bedtime, less sleep, more awakenings
    if (isExamWeek(dayIndex)) {
        bedtimeBase += 1.5;
        sleepMinBase -= 60;
        awakeningsBase += 2;
    }

    // ADHD: amplified variance and awakenings
    if (persona.disability === 'adhd') {
        sleepVarMult = 1.4;
        awakeningsBase = Math.ceil(awakeningsBase * 1.3);
    }

    // Bad sleep carry-over: compound disruption
    if (prevSleepMin > 0 && prevSleepMin < sd.sleepBase * 0.85) {
        sleepMinBase -= 20;
    }

    // Longitudinal trend: improving → more sleep over time
    sleepMinBase = sleepMinBase * trendMult(dayIndex, persona.trend);

    const sleepMin = clamp(Math.round(gaussian(sleepMinBase, sd.sleepVar * sleepVarMult)), 180, 600);
    const awakeVar = sd.awakeVar * (persona.disability === 'adhd' ? 2 : 1);
    const awakenings = clamp(Math.round(gaussian(awakeningsBase, awakeVar)), 0, 15);
    const awakeMin = clamp(Math.round(gaussian(awakenings * 5, 5)), 0, 60);
    const timeInBed = clamp(sleepMin + awakeMin + randInt(5, 25), sleepMin + awakeMin, 720);

    // Bedtime timestamp; wake = bedtime + total bed time
    const bedtimeHour = gaussian(bedtimeBase, chrono.variance);
    const bedtime = createBedtimeTimestamp(date, bedtimeHour);
    const wakeTime = new Date(bedtime.getTime() + (sleepMin + awakeMin) * 60 * 1000);

    return {
        session_date: toDateStr(date),
        bedtime,
        wake_time: wakeTime,
        total_sleep_minutes: sleepMin,
        time_in_bed_minutes: timeInBed,
        awakenings_count: awakenings,
        awake_minutes: awakeMin,
        is_simulated: true,
        _sleepMin: sleepMin,  // passed to next day for carry-over
    };
}

function genScreenRow(persona, date, dayIndex, prevSleepMin) {
    const sd = PROFILE_SCREEN_DEFS[persona.profile];
    const sleepDef = PROFILE_SLEEP_DEFS[persona.profile];

    let base = sd.base;
    let varMult = 1.0;

    // Weekend: higher screen time
    if (isWeekend(date)) base += rand(60, 90);

    // Bad sleep carry-over: procrastination / phone use spike
    if (prevSleepMin > 0 && prevSleepMin < sleepDef.sleepBase * 0.85) base += 30;

    // ADHD: high variance
    if (persona.disability === 'adhd') varMult = 1.5;

    // Exam week: distraction spike
    if (isExamWeek(dayIndex)) base += 60;

    // INVERTED trend: improving → lower screen over time (2.0 - mult brings it down)
    base = base * (2.0 - trendMult(dayIndex, persona.trend));

    const total = clamp(Math.round(gaussian(base, sd.var * varMult)), 30, 720);
    const lateNight = clamp(
        Math.round(gaussian(total * (sd.lateNight / sd.base), sd.var * 0.2 * varMult)),
        0, Math.min(total, 180)
    );
    const longest = clamp(
        Math.round(gaussian(total * (sd.longestBase / sd.base), sd.var * 0.3 * varMult)),
        5, Math.min(total, 300)
    );

    return {
        session_date: toDateStr(date),
        total_screen_minutes: total,
        late_night_screen_minutes: lateNight,
        longest_continuous_session: longest,
        is_simulated: true,
    };
}

/**
 * Returns an LMS session row or null if student is inactive this day.
 */
function genLMSRow(persona, date, dayIndex) {
    const examWeek = isExamWeek(dayIndex);
    const active = examWeek || isActiveLMSDay(persona.lmsPattern, dayIndex, date);
    if (!active) return null;

    const ld = PROFILE_LMS_DEFS[persona.profile];
    let activeMin = ld.activeMin;
    let longestSession = ld.longestSession;

    // Exam week: higher LMS engagement
    if (examWeek) activeMin = Math.round(activeMin * 1.5);

    // Dyslexia: longer sessions (more time per activity)
    if (persona.disability === 'dyslexia') longestSession = Math.round(longestSession * 1.5);

    // Longitudinal trend
    activeMin = Math.round(activeMin * trendMult(dayIndex, persona.trend));
    activeMin = clamp(Math.round(gaussian(activeMin, ld.var)), 5, 240);

    const numSessions = clamp(Math.round(gaussian(ld.sessions, 0.8)), 1, 8);
    const sessionDurations = splitMinutes(activeMin, numSessions);
    const actualLongest = Math.max(...sessionDurations, longestSession);

    // Quiz events: Bernoulli sum
    let quizProb = ld.quizProb;
    if (examWeek) quizProb = Math.min(1.0, quizProb * 2);
    let exercise_practice_events = 0;
    for (let i = 0; i < 5; i++) {
        if (Math.random() < quizProb) exercise_practice_events++;
    }
    exercise_practice_events = clamp(exercise_practice_events, 0, 5);

    // Assignment events
    const isDeadlineDay = persona.lmsPattern === 'deadline_driven' && [4, 5].includes(dayIndex % 7);
    const assignment_work_events = (Math.random() < ld.assignProb || isDeadlineDay) ? 1 : 0;

    // Forum events (evening bias already baked in via probabilistic generation)
    const forum_posts = Math.random() < ld.forumProb ? randInt(0, 2) : 0;
    const forum_views = forum_posts > 0 ? forum_posts + randInt(0, 2) : 0;
    const total_events = exercise_practice_events + assignment_work_events + forum_posts;

    return {
        session_date: toDateStr(date),
        total_active_minutes: activeMin,
        total_events: total_events,
        number_of_sessions: numSessions,
        session_durations: JSON.stringify(sessionDurations),
        longest_session_minutes: actualLongest,
        days_active_in_period: 1,
        reading_minutes: 0,
        watching_minutes: 0,
        exercise_practice_events,
        assignment_work_events,
        forum_views,
        forum_posts,
        is_simulated: true,
    };
}

/**
 * Generates a single SRL questionnaire response or returns null (skip this day).
 */
function maybeSRLRow(persona, date, dayIndex) {
    const freq = SRL_FREQ_PROBS[persona.srlFreq] || 0.15;
    const wmdBoost = persona.disability === 'wmd' ? 1.5 : 1.0;

    // Exam week: no SRL submissions (panic mode)
    if (isExamWeek(dayIndex)) return null;

    if (Math.random() > freq * wmdBoost) return null;

    const srlDef = PROFILE_SRL_DEFS[persona.profile];
    const [bMin, bMax] = srlDef.baseRange;
    const [aMin, aMax] = srlDef.anxietyRange;
    const mult = trendMult(dayIndex, persona.trend);

    const answers = {};
    for (const key of Object.keys(CONCEPT_SHORT_NAMES)) {
        if (key === 'anxiety') {
            const anxietyShift = persona.disability === 'wmd' ? 0.5 : 0;
            let score = gaussian((aMin + aMax) / 2 + anxietyShift, (aMax - aMin) / 4);
            if (persona.disability === 'adhd') score += gaussian(0, 0.5);
            // Improving trend → anxiety falls over time (inverted metric)
            score = score / mult;
            answers[key] = clamp(Math.round(score), 1, 5);
        } else {
            const midpoint = (bMin + bMax) / 2;
            let score = gaussian(midpoint * mult, (bMax - bMin) / 4);
            if (persona.disability === 'adhd') score += gaussian(0, 0.5);
            answers[key] = clamp(Math.round(score), 1, 5);
        }
    }

    // Realistic submission time: 8 AM – 10 PM
    const submittedAt = new Date(date);
    submittedAt.setHours(randInt(8, 22), randInt(0, 59), 0, 0);

    return { answers, submittedAt };
}

// =============================================================================
// SECTION 6: MAIN — 8 PHASES
// =============================================================================

async function main() {
    console.log('=== Realistic 40-Day Data Simulation ===\n');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // -----------------------------------------------------------------------
    // Phase 0: Query surveyId + student UUIDs
    // -----------------------------------------------------------------------
    console.log('Phase 0: Querying survey ID and student UUIDs...');

    const surveyRes = await pool.query(
        `SELECT id FROM public.surveys WHERE name ILIKE '%Self-Regulated%' LIMIT 1`
    );
    let surveyId;
    if (surveyRes.rows.length === 0) {
        const fallback = await pool.query('SELECT id FROM public.surveys LIMIT 1');
        if (fallback.rows.length === 0) throw new Error('No surveys found in DB');
        surveyId = fallback.rows[0].id;
        console.log('  Warning: SRL survey not found by name — using first available survey');
    } else {
        surveyId = surveyRes.rows[0].id;
    }
    console.log(`  Survey ID: ${surveyId}`);

    const emails = PERSONA_TABLE.map(p => p.email);
    const userRes = await pool.query(
        `SELECT id, email FROM public.users WHERE email = ANY($1)`,
        [emails]
    );
    const emailToId = {};
    userRes.rows.forEach(r => { emailToId[r.email] = r.id; });
    console.log(`  Found ${userRes.rows.length} / ${emails.length} students\n`);

    // -----------------------------------------------------------------------
    // Phase 1: Update student names
    // -----------------------------------------------------------------------
    console.log('Phase 1: Updating student names...');
    for (const persona of PERSONA_TABLE) {
        const userId = emailToId[persona.email];
        if (!userId) { console.log(`  Warning: ${persona.email} not found, skipping`); continue; }
        await pool.query('UPDATE public.users SET name = $1 WHERE id = $2', [persona.name, userId]);
    }
    console.log('  ✓ Names updated\n');

    // -----------------------------------------------------------------------
    // Phases 2–5: Per-student raw data + baselines + annotations
    // -----------------------------------------------------------------------
    const processedStudents = [];

    for (const persona of PERSONA_TABLE) {
        const userId = emailToId[persona.email];
        if (!userId) continue;

        console.log(`Processing ${persona.name} (${persona.email})...`);

        // Phase 2: Delete old derived + raw data
        await deleteStudentData(userId);
        console.log('  ✓ Phase 2: Cleared old data');

        // Phase 3: Generate 40 days of raw data
        const { sleepIds, screenIds, srlCount, lmsCount } = await generateRawData(
            persona, userId, surveyId, today
        );
        console.log(`  ✓ Phase 3: ${sleepIds.length} sleep, ${screenIds.length} screen, ${lmsCount} LMS, ${srlCount} SRL days`);

        // Phase 4: Recompute baselines
        await sleepBaseline(pool, userId, DAYS);
        await screenBaseline(pool, userId, DAYS);
        await recomputeLMSBaseline(userId);
        console.log('  ✓ Phase 4: Baselines recomputed');

        // Phase 5: Annotation services
        const last7SleepIds = sleepIds.slice(-7);
        for (const sid of last7SleepIds) {
            await sleepJudgments(pool, sid);
        }
        const last7ScreenIds = screenIds.slice(-7);
        for (const sid of last7ScreenIds) {
            await screenJudgments(pool, sid);
        }
        try {
            await lmsJudgments(pool, userId, 7);
        } catch (err) {
            // lmsAnnotationService has a known `totalMin` reference bug — non-critical
            console.log(`  Warning: LMS judgments skipped (${err.message})`);
        }
        const mockSurveyStructure = buildSurveyStructure();
        await computeAnnotations(pool, userId, mockSurveyStructure);
        console.log('  ✓ Phase 5: Annotations computed\n');

        processedStudents.push({ persona, userId, sleepIds, screenIds });
    }

    // -----------------------------------------------------------------------
    // Phase 6: computeAllScores for ALL students (PGMoE needs full user pool)
    // -----------------------------------------------------------------------
    console.log('Phase 6: Computing scores for all students...');
    for (const { persona, userId } of processedStudents) {
        try {
            const result = await computeAllScores(userId);
            const scored = Object.values(result).filter(r => r && !r.coldStart).length;
            console.log(`  ✓ ${persona.name}: ${scored}/4 concepts scored`);
        } catch (err) {
            console.log(`  Warning: Score computation failed for ${persona.name}: ${err.message}`);
        }
    }
    console.log('');

    // -----------------------------------------------------------------------
    // Phase 7: Backfill concept_score_history (40 days per student)
    // -----------------------------------------------------------------------
    console.log('Phase 7: Backfilling concept_score_history...');
    for (const { persona, userId } of processedStudents) {
        await backfillScoreHistory(persona, userId, today);
        console.log(`  ✓ ${persona.name}: history backfilled`);
    }

    // -----------------------------------------------------------------------
    // Phase 8: Close pool
    // -----------------------------------------------------------------------
    console.log('\n=== Simulation Complete ===');
    console.log(`Processed ${processedStudents.length} students with ${DAYS} days of data each.`);
    await pool.end();
}

// =============================================================================
// HELPERS
// =============================================================================

async function deleteStudentData(userId) {
    const tables = [
        'DELETE FROM public.sleep_judgments WHERE user_id = $1',
        'DELETE FROM public.screen_time_judgments WHERE user_id = $1',
        'DELETE FROM public.lms_judgments WHERE user_id = $1',
        'DELETE FROM public.srl_annotations WHERE user_id = $1',
        'DELETE FROM public.concept_scores WHERE user_id = $1',
        'DELETE FROM public.concept_score_history WHERE user_id = $1',
        'DELETE FROM public.user_cluster_assignments WHERE user_id = $1',
        'DELETE FROM public.sleep_baselines WHERE user_id = $1',
        'DELETE FROM public.screen_time_baselines WHERE user_id = $1',
        'DELETE FROM public.lms_baselines WHERE user_id = $1',
        'DELETE FROM public.srl_responses WHERE user_id = $1',
        'DELETE FROM public.questionnaire_results WHERE user_id = $1',
        'DELETE FROM public.sleep_sessions WHERE user_id = $1',
        'DELETE FROM public.screen_time_sessions WHERE user_id = $1',
        'DELETE FROM public.lms_sessions WHERE user_id = $1',
    ];
    for (const q of tables) {
        await pool.query(q, [userId]);
    }
}

async function generateRawData(persona, userId, surveyId, today) {
    const sleepIds = [];
    const screenIds = [];

    let prevSleepMin = PROFILE_SLEEP_DEFS[persona.profile].sleepBase;

    // Buffers for sparse data (LMS + SRL inserted after floor check)
    const lmsRowBuffer = {};   // dayIndex → row
    const srlRowBuffer = {};   // dayIndex → { answers, submittedAt }

    for (let dayIndex = 0; dayIndex < DAYS; dayIndex++) {
        const date = new Date(today);
        date.setDate(date.getDate() - (DAYS - 1 - dayIndex));

        // --- Sleep (every day) ---
        const sleepRow = genSleepRow(persona, date, dayIndex, prevSleepMin);
        const sleepResult = await pool.query(
            `INSERT INTO public.sleep_sessions
               (user_id, session_date, bedtime, wake_time, total_sleep_minutes,
                time_in_bed_minutes, awakenings_count, awake_minutes, is_simulated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (user_id, session_date) DO UPDATE SET
               bedtime = EXCLUDED.bedtime, wake_time = EXCLUDED.wake_time,
               total_sleep_minutes = EXCLUDED.total_sleep_minutes,
               time_in_bed_minutes = EXCLUDED.time_in_bed_minutes,
               awakenings_count = EXCLUDED.awakenings_count,
               awake_minutes = EXCLUDED.awake_minutes,
               is_simulated = EXCLUDED.is_simulated
             RETURNING id`,
            [userId, sleepRow.session_date, sleepRow.bedtime, sleepRow.wake_time,
             sleepRow.total_sleep_minutes, sleepRow.time_in_bed_minutes,
             sleepRow.awakenings_count, sleepRow.awake_minutes, sleepRow.is_simulated]
        );
        sleepIds.push(sleepResult.rows[0].id);
        prevSleepMin = sleepRow._sleepMin;

        // --- Screen Time (every day) ---
        const screenRow = genScreenRow(persona, date, dayIndex, prevSleepMin);
        const screenResult = await pool.query(
            `INSERT INTO public.screen_time_sessions
               (user_id, session_date, total_screen_minutes, late_night_screen_minutes,
                longest_continuous_session, is_simulated)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, session_date) DO UPDATE SET
               total_screen_minutes = EXCLUDED.total_screen_minutes,
               late_night_screen_minutes = EXCLUDED.late_night_screen_minutes,
               longest_continuous_session = EXCLUDED.longest_continuous_session,
               is_simulated = EXCLUDED.is_simulated
             RETURNING id`,
            [userId, screenRow.session_date, screenRow.total_screen_minutes,
             screenRow.late_night_screen_minutes, screenRow.longest_continuous_session,
             screenRow.is_simulated]
        );
        screenIds.push(screenResult.rows[0].id);

        // --- LMS (sparse, buffered) ---
        const lmsRow = genLMSRow(persona, date, dayIndex);
        if (lmsRow) lmsRowBuffer[dayIndex] = lmsRow;

        // --- SRL (probabilistic, buffered) ---
        const srlData = maybeSRLRow(persona, date, dayIndex);
        if (srlData) srlRowBuffer[dayIndex] = srlData;
    }

    // LMS floor: ensure at least 3 active days
    const lmsDayIndices = Object.keys(lmsRowBuffer).map(Number);
    if (lmsDayIndices.length < 3) {
        const needed = 3 - lmsDayIndices.length;
        const ld = PROFILE_LMS_DEFS[persona.profile];
        const available = Array.from({ length: DAYS }, (_, i) => i)
            .filter(i => !lmsRowBuffer[i])
            .filter(i => {
                const d = new Date(today);
                d.setDate(d.getDate() - (DAYS - 1 - i));
                return !isWeekend(d);
            })
            .slice(0, needed);

        for (const di of available) {
            const d = new Date(today);
            d.setDate(d.getDate() - (DAYS - 1 - di));
            lmsRowBuffer[di] = {
                session_date: toDateStr(d),
                total_active_minutes: ld.activeMin,
                total_events: 1,
                number_of_sessions: 1,
                session_durations: JSON.stringify([ld.activeMin]),
                longest_session_minutes: ld.activeMin,
                days_active_in_period: 1,
                reading_minutes: 0, watching_minutes: 0,
                exercise_practice_events: 1,
                assignment_work_events: 0,
                forum_views: 0, forum_posts: 0,
                is_simulated: true,
            };
        }
    }

    // Insert all LMS rows
    let lmsCount = 0;
    for (const di of Object.keys(lmsRowBuffer)) {
        const r = lmsRowBuffer[di];
        await pool.query(
            `INSERT INTO public.lms_sessions
               (user_id, session_date, total_active_minutes, total_events, number_of_sessions,
                session_durations, longest_session_minutes, days_active_in_period,
                reading_minutes, watching_minutes, exercise_practice_events,
                assignment_work_events, forum_views, forum_posts, is_simulated)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (user_id, session_date) DO UPDATE SET
               total_active_minutes = EXCLUDED.total_active_minutes,
               total_events = EXCLUDED.total_events,
               number_of_sessions = EXCLUDED.number_of_sessions,
               session_durations = EXCLUDED.session_durations,
               longest_session_minutes = EXCLUDED.longest_session_minutes,
               exercise_practice_events = EXCLUDED.exercise_practice_events,
               assignment_work_events = EXCLUDED.assignment_work_events,
               forum_views = EXCLUDED.forum_views,
               forum_posts = EXCLUDED.forum_posts,
               is_simulated = EXCLUDED.is_simulated`,
            [userId, r.session_date, r.total_active_minutes, r.total_events, r.number_of_sessions,
             r.session_durations, r.longest_session_minutes, r.days_active_in_period,
             r.reading_minutes, r.watching_minutes, r.exercise_practice_events,
             r.assignment_work_events, r.forum_views, r.forum_posts, r.is_simulated]
        );
        lmsCount++;
    }

    // SRL floor: ensure at least 2 submissions
    const srlDayIndices = Object.keys(srlRowBuffer).map(Number);
    if (srlDayIndices.length < 2) {
        const srlDef = PROFILE_SRL_DEFS[persona.profile];
        const [bMin, bMax] = srlDef.baseRange;
        const [aMin, aMax] = srlDef.anxietyRange;
        const forceDays = [5, 20].filter(d => !srlRowBuffer[d]).slice(0, 2 - srlDayIndices.length);
        for (const di of forceDays) {
            const d = new Date(today);
            d.setDate(d.getDate() - (DAYS - 1 - di));
            const submittedAt = new Date(d);
            submittedAt.setHours(10, 0, 0, 0);
            const answers = {};
            for (const key of Object.keys(CONCEPT_SHORT_NAMES)) {
                answers[key] = key === 'anxiety'
                    ? clamp(Math.round((aMin + aMax) / 2), 1, 5)
                    : clamp(Math.round((bMin + bMax) / 2), 1, 5);
            }
            srlRowBuffer[di] = { answers, submittedAt };
        }
    }

    // Insert all SRL rows
    let srlCount = 0;
    for (const di of Object.keys(srlRowBuffer)) {
        const srl = srlRowBuffer[di];
        const qId = randomUUID();
        await pool.query(
            `INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
             VALUES ($1, $2, $3, $4, $5)`,
            [qId, surveyId, userId, srl.submittedAt, JSON.stringify(srl.answers)]
        );
        for (const [key, score] of Object.entries(srl.answers)) {
            await pool.query(
                `INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (questionnaire_id, concept_key) DO NOTHING`,
                [userId, qId, key, score, srl.submittedAt]
            );
        }
        srlCount++;
    }

    return { sleepIds, screenIds, srlCount, lmsCount };
}

async function recomputeLMSBaseline(userId) {
    await pool.query(
        `INSERT INTO public.lms_baselines
           (user_id, baseline_active_minutes, baseline_sessions, baseline_days_active,
            sessions_count, computed_at)
         SELECT
           user_id,
           AVG(total_active_minutes),
           AVG(number_of_sessions),
           COUNT(DISTINCT session_date)::numeric / 6.0,
           COUNT(*), NOW()
         FROM public.lms_sessions
         WHERE user_id = $1 AND session_date >= CURRENT_DATE - INTERVAL '40 days'
         GROUP BY user_id
         ON CONFLICT (user_id) DO UPDATE SET
           baseline_active_minutes = EXCLUDED.baseline_active_minutes,
           baseline_sessions       = EXCLUDED.baseline_sessions,
           baseline_days_active    = EXCLUDED.baseline_days_active,
           sessions_count          = EXCLUDED.sessions_count,
           computed_at             = NOW()`,
        [userId]
    );
}

function buildSurveyStructure() {
    return {
        pages: [{
            elements: Object.keys(CONCEPT_SHORT_NAMES).map(key => ({
                name: key,
                type: 'rating',
                title: CONCEPT_SHORT_NAMES[key],
            })),
        }],
    };
}

/**
 * Phase 7: Backfill concept_score_history using profile-based normalization formulas.
 * Pre-loads all raw data into Maps to avoid per-day DB queries.
 */
async function backfillScoreHistory(persona, userId, today) {
    // Pre-load raw data
    const { rows: sleepRows } = await pool.query(
        `SELECT session_date::text, total_sleep_minutes FROM public.sleep_sessions
         WHERE user_id = $1 ORDER BY session_date ASC`,
        [userId]
    );
    const { rows: screenRows } = await pool.query(
        `SELECT session_date::text, total_screen_minutes FROM public.screen_time_sessions
         WHERE user_id = $1 ORDER BY session_date ASC`,
        [userId]
    );
    const { rows: lmsRows } = await pool.query(
        `SELECT session_date::text, total_active_minutes, exercise_practice_events,
                assignment_work_events, forum_posts
         FROM public.lms_sessions WHERE user_id = $1 ORDER BY session_date ASC`,
        [userId]
    );
    const { rows: srlRows } = await pool.query(
        `SELECT concept_key, score, DATE(submitted_at)::text AS response_date
         FROM public.srl_responses WHERE user_id = $1 ORDER BY submitted_at ASC`,
        [userId]
    );

    // Build lookup Maps keyed by 'YYYY-MM-DD' strings
    const sleepMap = Object.fromEntries(sleepRows.map(r => [r.session_date, Number(r.total_sleep_minutes)]));
    const screenMap = Object.fromEntries(screenRows.map(r => [r.session_date, Number(r.total_screen_minutes)]));
    const lmsMap = Object.fromEntries(lmsRows.map(r => [r.session_date, r]));

    // SRL: group scores by date and concept
    const srlByDate = {};
    for (const r of srlRows) {
        const k = r.response_date;
        if (!srlByDate[k]) srlByDate[k] = {};
        if (!srlByDate[k][r.concept_key]) srlByDate[k][r.concept_key] = [];
        srlByDate[k][r.concept_key].push(Number(r.score));
    }

    let prevLmsScore = 50;

    for (let dayIndex = 0; dayIndex < DAYS; dayIndex++) {
        const date = new Date(today);
        date.setDate(date.getDate() - (DAYS - 1 - dayIndex));
        const dateStr = toDateStr(date);

        // Sleep score: normalize minutes to 0-100 (270=worst, 540=best)
        const sleepMin = sleepMap[dateStr];
        const sleepScore = sleepMin != null
            ? clamp(Math.round((sleepMin - 270) / (540 - 270) * 100), 0, 100)
            : 50;

        // Screen score (inverted): normalize minutes to 0-100 (60=best, 600=worst)
        const screenMin = screenMap[dateStr];
        const screenScore = screenMin != null
            ? clamp(Math.round(100 - (screenMin - 60) / (600 - 60) * 100), 0, 100)
            : 50;

        // LMS score: participation breadth + activity volume; decay on inactive days
        const lmsRow = lmsMap[dateStr];
        let lmsScore;
        if (!lmsRow) {
            lmsScore = clamp(Math.round(prevLmsScore * 0.9), 0, 100);
        } else {
            const quizC  = Math.min(Number(lmsRow.exercise_practice_events) || 0, 3) / 3.0 * 34;
            const assignC = Math.min(Number(lmsRow.assignment_work_events) || 0, 2) / 2.0 * 33;
            const forumC  = Math.min(Number(lmsRow.forum_posts) || 0, 2) / 2.0 * 33;
            const participation = quizC + assignC + forumC;
            const activeMin = Number(lmsRow.total_active_minutes) || 0;
            lmsScore = clamp(Math.round(participation + (activeMin / 90) * 40), 0, 100);
        }
        prevLmsScore = lmsScore;

        // SRL score: average of last 7 days' responses, anxiety inverted
        let srlScore = 50;
        const window7Dates = [];
        for (let wi = Math.max(0, dayIndex - 6); wi <= dayIndex; wi++) {
            const d2 = new Date(today);
            d2.setDate(d2.getDate() - (DAYS - 1 - wi));
            window7Dates.push(toDateStr(d2));
        }
        const conceptScores = {};
        for (const dStr of window7Dates) {
            if (!srlByDate[dStr]) continue;
            for (const [key, scores] of Object.entries(srlByDate[dStr])) {
                if (!conceptScores[key]) conceptScores[key] = [];
                conceptScores[key].push(...scores);
            }
        }
        const conceptNorm = Object.entries(conceptScores).map(([key, scores]) => {
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            return key === 'anxiety' ? (5 - avg) / 4 * 100 : (avg - 1) / 4 * 100;
        });
        if (conceptNorm.length > 0) {
            srlScore = clamp(
                Math.round(conceptNorm.reduce((a, b) => a + b, 0) / conceptNorm.length),
                0, 100
            );
        }

        // Insert 4 history rows for this date
        const conceptScoresMap = { sleep: sleepScore, screen_time: screenScore, lms: lmsScore, srl: srlScore };
        for (const [conceptId, score] of Object.entries(conceptScoresMap)) {
            await pool.query(
                `INSERT INTO public.concept_score_history (user_id, concept_id, score, score_date, computed_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (user_id, concept_id, score_date) DO UPDATE SET
                   score = EXCLUDED.score, computed_at = NOW()`,
                [userId, conceptId, score, dateStr]
            );
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    pool.end().catch(() => {});
    process.exit(1);
});
