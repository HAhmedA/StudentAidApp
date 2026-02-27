/**
 * moodleUpdateMeta.js — Backfill realistic names and activity timestamps in Moodle
 *
 * Phase 1: Update user profiles (firstname/lastname) — "Test Student 15" → "Fatima Al-Rashidi"
 * Phase 2: Backdate quiz/assign/forum timestamps to spread across the past ~40 days
 * Phase 3: Update mdl_logstore_standard_log so Moodle's Logs view also shows realistic dates
 *
 * Timestamps are deterministic (no randomness), driven by each persona's LMS pattern and
 * chronotype so the spread is realistic: consistent students acted 8–28 days ago, minimal
 * students 20–38 days ago, deadline_driven 5–14 days ago, binge_then_rest 12–22 days ago.
 *
 * Prerequisites: MAMP running with MySQL on port 8889 (database: moodle501)
 *
 * Usage:
 *   node backend/scripts/moodleUpdateMeta.js
 */

import { spawnSync } from 'child_process'

// =============================================================================
// CONFIG
// =============================================================================

const MYSQL_BIN  = '/Applications/MAMP/Library/bin/mysql80/bin/mysql'
const MYSQL_ARGS = [
    '-h', '127.0.0.1',
    '-P', '8889',
    '-uroot',
    '-proot',
    '--default-character-set=utf8mb4',
    '--batch',
    '--skip-column-names',
    'moodle501',
]

// =============================================================================
// PERSONA TABLE  (mirrors simulateRealisticData.js)
// =============================================================================

const PERSONAS = [
    { email: 'test1@example.com',  firstname: 'Wei',       lastname: 'Chen',          lmsPattern: 'consistent',      chronotype: 'early_bird' },
    { email: 'test2@example.com',  firstname: 'Arjun',     lastname: 'Patel',         lmsPattern: 'deadline_driven', chronotype: 'normal'     },
    { email: 'test3@example.com',  firstname: 'Amara',     lastname: 'Osei',          lmsPattern: 'minimal',         chronotype: 'night_owl'  },
    { email: 'test4@example.com',  firstname: 'Sofia',     lastname: 'Reyes',         lmsPattern: 'consistent',      chronotype: 'early_bird' },
    { email: 'test5@example.com',  firstname: 'Hiroshi',   lastname: 'Tanaka',        lmsPattern: 'binge_then_rest', chronotype: 'normal'     },
    { email: 'test6@example.com',  firstname: 'Chidinma',  lastname: 'Eze',           lmsPattern: 'minimal',         chronotype: 'night_owl'  },
    { email: 'test7@example.com',  firstname: 'Elias',     lastname: 'Bergström',     lmsPattern: 'consistent',      chronotype: 'early_bird' },
    { email: 'test8@example.com',  firstname: 'Priya',     lastname: 'Krishnamurthy', lmsPattern: 'deadline_driven', chronotype: 'normal'     },
    { email: 'test9@example.com',  firstname: 'Omar',      lastname: 'Al-Farsi',      lmsPattern: 'minimal',         chronotype: 'night_owl'  },
    { email: 'test10@example.com', firstname: 'Anika',     lastname: 'Müller',        lmsPattern: 'consistent',      chronotype: 'early_bird' },
    { email: 'test11@example.com', firstname: 'Camille',   lastname: 'Dupont',        lmsPattern: 'deadline_driven', chronotype: 'normal'     },
    { email: 'test12@example.com', firstname: 'Tariq',     lastname: 'Mensah',        lmsPattern: 'binge_then_rest', chronotype: 'night_owl'  },
    { email: 'test13@example.com', firstname: 'Yuna',      lastname: 'Kim',           lmsPattern: 'consistent',      chronotype: 'early_bird' },
    { email: 'test14@example.com', firstname: 'Marcus',    lastname: 'Johnson',       lmsPattern: 'deadline_driven', chronotype: 'normal'     },
    { email: 'test15@example.com', firstname: 'Fatima',    lastname: 'Al-Rashidi',    lmsPattern: 'minimal',         chronotype: 'night_owl'  },
    { email: 'test16@example.com', firstname: 'Isabela',   lastname: 'Santos',        lmsPattern: 'consistent',      chronotype: 'early_bird' },
    { email: 'test17@example.com', firstname: 'Nour',      lastname: 'Hassan',        lmsPattern: 'binge_then_rest', chronotype: 'normal'     },
    { email: 'test18@example.com', firstname: 'Sebastian', lastname: 'Kowalski',      lmsPattern: 'minimal',         chronotype: 'night_owl'  },
    { email: 'test19@example.com', firstname: 'Aaliya',    lastname: 'Sharma',        lmsPattern: 'consistent',      chronotype: 'early_bird' },
    { email: 'test20@example.com', firstname: 'Lucas',     lastname: 'Andrade',       lmsPattern: 'deadline_driven', chronotype: 'normal'     },
]

// =============================================================================
// MYSQL HELPERS
// =============================================================================

/**
 * Run SQL via stdin — handles Unicode (ü, ö, etc.) safely without shell escaping.
 * @param {string} sql
 * @returns {string} stdout trimmed
 */
function runMySQL(sql) {
    const result = spawnSync(MYSQL_BIN, MYSQL_ARGS, { input: sql, encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status !== 0) {
        throw new Error((result.stderr || `MySQL exited with code ${result.status}`).trim())
    }
    return result.stdout.trim()
}

/**
 * Run a SELECT and return rows as arrays of strings.
 * @param {string} sql
 * @returns {string[][]}
 */
function queryMySQL(sql) {
    const raw = runMySQL(sql)
    if (!raw) return []
    return raw.split('\n').map(row => row.split('\t'))
}

// =============================================================================
// TIMESTAMP GENERATION
// =============================================================================

const NOW_SECS = Math.floor(Date.now() / 1000)

/**
 * Generate a deterministic Unix timestamp for a student's activity.
 *
 * Spread strategy:
 *   consistent      → 8–28 days ago   (regular, spread evenly)
 *   deadline_driven → 5–14 days ago   (recent, near "deadlines")
 *   binge_then_rest → 12–22 days ago  (during last active binge)
 *   minimal         → 20–38 days ago  (infrequent, older activity)
 *
 * Time-of-day driven by chronotype:
 *   early_bird  → 9–11 AM  (+0 AM for quiz, +4h for assign, +2h for forum)
 *   normal      → 1–4 PM
 *   night_owl   → 7–9 PM
 *
 * @param {string} lmsPattern
 * @param {string} chronotype
 * @param {'quiz'|'assign'|'forum'} activityType
 * @param {number} personaIndex  0-indexed position in PERSONAS
 * @returns {number} Unix timestamp (seconds)
 */
function genTimestamp(lmsPattern, chronotype, activityType, personaIndex) {
    const i = personaIndex

    // Days ago — all within 6 days so every activity falls inside the 7-day sync window.
    // (moodleService.js line 428: sinceTimestamp = now - 7*86400 - 300)
    // Variety still gives each pattern a distinct "when this week" feel:
    //   consistent      → worked steadily; recent activity yesterday or 2 days ago
    //   deadline_driven → submitted right before the "deadline": 1–2 days ago
    //   binge_then_rest → active mid-week during a binge: 3–4 days ago
    //   minimal         → occasional; something slipped in 5–6 days ago
    const PATTERN_CONFIG = {
        consistent:      { base: 1, spread: 2 },   // 1–3 days ago
        deadline_driven: { base: 1, spread: 1 },   // 1–2 days ago
        binge_then_rest: { base: 3, spread: 1 },   // 3–4 days ago
        minimal:         { base: 5, spread: 1 },   // 5–6 days ago
    }
    const { base, spread } = PATTERN_CONFIG[lmsPattern] ?? { base: 15, spread: 10 }
    const daysAgo = base + (i % (spread + 1))

    // Hour of day
    const CHRONO_HOUR = { early_bird: 9, normal: 13, night_owl: 19 }
    let hour = (CHRONO_HOUR[chronotype] ?? 13) + (i % 3)  // +0,+1,+2h for variety
    if (activityType === 'assign') hour += 4  // assignments in the evening
    if (activityType === 'forum')  hour += 2  // forum posts in the afternoon
    hour = Math.min(hour, 23)                 // cap at 11 PM

    // Deterministic minutes — unique per (student, activityType) combination
    const minute = (i * 11 + activityType.length * 7) % 60

    return NOW_SECS - daysAgo * 86400 + hour * 3600 + minute * 60
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
    console.log('\nMoodle Meta Update Script')
    console.log('─────────────────────────────────────────────────')
    console.log(`Personas : ${PERSONAS.length} (test1–test20)`)
    console.log(`MySQL    : 127.0.0.1:8889 / moodle501\n`)

    // Sanity-check MySQL connection
    try {
        runMySQL('SELECT 1;')
        console.log('✓ MySQL connection OK\n')
    } catch (err) {
        console.error(`✗ Cannot reach MySQL: ${err.message}`)
        console.error('  Make sure MAMP is running with MySQL on port 8889.')
        process.exit(1)
    }

    // -------------------------------------------------------------------------
    // Phase 1: Update user names
    // -------------------------------------------------------------------------
    console.log('Phase 1: Updating user names...')
    let nameOk = 0, nameFail = 0

    for (const p of PERSONAS) {
        try {
            // Single-row UPDATE per student; stdin handles UTF-8 (ü, ö, etc.)
            runMySQL(
                `UPDATE mdl_user ` +
                `SET firstname = '${p.firstname}', lastname = '${p.lastname}' ` +
                `WHERE email = '${p.email}';`
            )
            console.log(`  ✓ ${p.email.padEnd(22)} → ${p.firstname} ${p.lastname}`)
            nameOk++
        } catch (err) {
            console.warn(`  ✗ ${p.email}: ${err.message}`)
            nameFail++
        }
    }
    console.log(`  → ${nameOk} updated, ${nameFail} failed\n`)

    // -------------------------------------------------------------------------
    // Phase 2 & 3: Backdate timestamps
    // -------------------------------------------------------------------------
    console.log('Phase 2: Fetching Moodle user IDs...')

    const emailList = PERSONAS.map(p => `'${p.email}'`).join(', ')
    const userRows = queryMySQL(`SELECT id, email FROM mdl_user WHERE email IN (${emailList});`)
    const emailToMoodleId = {}
    for (const [id, email] of userRows) {
        if (id && email) emailToMoodleId[email.trim()] = parseInt(id.trim())
    }
    console.log(`  Found ${Object.keys(emailToMoodleId).length} / ${PERSONAS.length} Moodle IDs\n`)

    console.log('Phase 3: Backdating activity timestamps...')
    console.log('  (quiz | assign | forum days-ago  —  based on LMS pattern + chronotype)\n')

    let tsOk = 0, tsFail = 0

    for (let i = 0; i < PERSONAS.length; i++) {
        const p         = PERSONAS[i]
        const moodleId  = emailToMoodleId[p.email]

        if (!moodleId) {
            console.warn(`  ✗ [test${i+1}] ${p.firstname} ${p.lastname}: no Moodle user found — skipping`)
            tsFail++
            continue
        }

        const quizTs    = genTimestamp(p.lmsPattern, p.chronotype, 'quiz',   i)
        const assignTs  = genTimestamp(p.lmsPattern, p.chronotype, 'assign', i)
        const forumTs   = genTimestamp(p.lmsPattern, p.chronotype, 'forum',  i)

        const qDays     = Math.round((NOW_SECS - quizTs)   / 86400)
        const aDays     = Math.round((NOW_SECS - assignTs)  / 86400)
        const fDays     = Math.round((NOW_SECS - forumTs)   / 86400)

        console.log(
            `  [test${String(i+1).padStart(2)}] ${(p.firstname + ' ' + p.lastname).padEnd(22)}` +
            `  quiz:${String(qDays).padStart(2)}d  assign:${String(aDays).padStart(2)}d  forum:${String(fDays).padStart(2)}d ago`
        )

        try {
            // --- Quiz attempts ---------------------------------------------------
            // timefinish = timestart + 10 min (blank submission, short duration)
            runMySQL(
                `UPDATE mdl_quiz_attempts ` +
                `SET timestart = ${quizTs}, timefinish = ${quizTs + 600}, timemodified = ${quizTs + 600} ` +
                `WHERE userid = ${moodleId};`
            )

            // --- Assignment submissions ------------------------------------------
            // timemodified is what moodleService.fetchAssignmentSubmissions uses as date
            runMySQL(
                `UPDATE mdl_assign_submission ` +
                `SET timecreated = ${assignTs}, timemodified = ${assignTs + 120} ` +
                `WHERE userid = ${moodleId};`
            )

            // --- Forum: discussions + posts ---------------------------------------
            // timestart=0 means "always visible"; timemodified drives recency display
            runMySQL(
                `UPDATE mdl_forum_discussions ` +
                `SET timestart = 0, timemodified = ${forumTs} ` +
                `WHERE userid = ${moodleId};`
            )
            // mdl_forum_posts.created is what moodleService.fetchForumPosts uses as date
            runMySQL(
                `UPDATE mdl_forum_posts ` +
                `SET created = ${forumTs}, modified = ${forumTs} ` +
                `WHERE userid = ${moodleId};`
            )

            // --- Standard log (Moodle's Logs view) --------------------------------
            // Update each component's log entries so the Reports > Logs screen also
            // shows realistic timestamps instead of all entries at the same moment.
            runMySQL(
                `UPDATE mdl_logstore_standard_log ` +
                `SET timecreated = ${quizTs} ` +
                `WHERE userid = ${moodleId} AND component = 'mod_quiz';`
            )
            runMySQL(
                `UPDATE mdl_logstore_standard_log ` +
                `SET timecreated = ${assignTs} ` +
                `WHERE userid = ${moodleId} AND component = 'mod_assign';`
            )
            runMySQL(
                `UPDATE mdl_logstore_standard_log ` +
                `SET timecreated = ${forumTs} ` +
                `WHERE userid = ${moodleId} AND component = 'mod_forum';`
            )

            tsOk++
        } catch (err) {
            console.warn(`    ✗ Timestamp update failed for ${p.email}: ${err.message}`)
            tsFail++
        }
    }

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('\n─────────────────────────────────────────────────')
    console.log(`Names updated      : ${nameOk} / ${PERSONAS.length}`)
    console.log(`Timestamps updated : ${tsOk} / ${PERSONAS.length}`)
    console.log('\nNext steps:')
    console.log('  1. Moodle → Administration → Reports → Logs')
    console.log('     Verify student names and timestamps are spread across multiple dates.')
    console.log('  2. App admin panel → "Sync All from Moodle"')
    console.log('     Updated activity dates will appear in the per-student LMS data.\n')
}

main().catch(err => {
    console.error('\nFatal error:', err.message)
    process.exit(1)
})
