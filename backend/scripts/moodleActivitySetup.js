/**
 * moodleActivitySetup.js — Automate student activity in Moodle for test2–test20
 *
 * For each remaining test student:
 *   1. Fetches a student token via login/token.php (uses password Test@1234)
 *   2. Attempts the quiz in LMSTEST
 *   3. Submits the assignment in LMSTEST
 *   4. Posts a discussion in the forum in LMSTEST
 *
 * Activity participation is randomised across students so the PGMoE clustering
 * sees a realistic spread of participation_score values (not all identical).
 *
 * Prerequisites (all done by moodleSetup.js + your manual test1 step):
 *   - Users test1–test20 exist and are enrolled in LMSTEST
 *   - LMSTEST contains at least one Quiz, one Assignment, one Forum activity
 *   - Moodle Mobile App web service is ENABLED:
 *       Site Admin → Plugins → Web services → Manage protocols → Enable REST
 *       Site Admin → Server → Mobile → Enable mobile web services
 *
 * Usage:
 *   node backend/scripts/moodleActivitySetup.js
 *   # or
 *   node --env-file=backend/.env backend/scripts/moodleActivitySetup.js
 */

import http  from 'http'
import https from 'https'

// =============================================================================
// CONFIG
// =============================================================================

const BASE_URL    = 'http://localhost:8888/moodle501'
const ADMIN_TOKEN = 'c4acddbfba05950afcae5c334c74bc8e'
const PASSWORD    = 'Test@1234'
const SERVICE     = 'moodle_mobile_app'   // built-in Moodle service; must be enabled

// test1 already done manually — start from test2
const STUDENTS = Array.from({ length: 19 }, (_, i) => ({
    username: `test${i + 2}`,
    email:    `test${i + 2}@example.com`,
}))

// Participation patterns (quiz / assign / forum).
// Spread across students so participation_score varies — improves PGMoE clustering.
const PARTICIPATION_PATTERNS = [
    ['quiz', 'assign', 'forum'],  // 0 — full
    ['quiz', 'assign', 'forum'],  // 1 — full
    ['quiz', 'assign', 'forum'],  // 2 — full
    ['quiz', 'assign', 'forum'],  // 3 — full
    ['quiz', 'assign'],           // 4 — no forum
    ['quiz', 'forum'],            // 5 — no assign
    ['assign', 'forum'],          // 6 — no quiz
    ['quiz', 'assign'],           // 7 — no forum
    ['quiz', 'forum'],            // 8 — no assign
    ['assign', 'forum'],          // 9 — no quiz
    ['quiz', 'assign', 'forum'],  // 10 — full
    ['quiz'],                     // 11 — quiz only
    ['assign'],                   // 12 — assign only
    ['forum'],                    // 13 — forum only
    ['quiz', 'assign', 'forum'],  // 14 — full
    ['quiz', 'assign'],           // 15 — no forum
    ['quiz', 'assign', 'forum'],  // 16 — full
    ['assign', 'forum'],          // 17 — no quiz
    ['quiz', 'assign', 'forum'],  // 18 — full
]

// =============================================================================
// HTTP HELPERS
// =============================================================================

function flattenParams(obj, prefix = '', out = {}) {
    if (Array.isArray(obj)) {
        obj.forEach((item, i) => flattenParams(item, prefix ? `${prefix}[${i}]` : `${i}`, out))
    } else if (obj !== null && typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
            flattenParams(value, prefix ? `${prefix}[${key}]` : key, out)
        }
    } else {
        out[prefix] = String(obj)
    }
    return out
}

/** POST to Moodle REST web service. token defaults to ADMIN_TOKEN. */
function moodlePost(wsfunction, params = {}, token = ADMIN_TOKEN) {
    return new Promise((resolve, reject) => {
        const parsedUrl  = new URL(`${BASE_URL}/webservice/rest/server.php`)
        const transport  = parsedUrl.protocol === 'https:' ? https : http
        const flat       = flattenParams(params)
        const bodyParts  = new URLSearchParams({
            wstoken:            token,
            moodlewsrestformat: 'json',
            wsfunction,
            ...flat,
        })
        const bodyStr = bodyParts.toString()

        const options = {
            hostname: parsedUrl.hostname,
            port:     parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path:     parsedUrl.pathname,
            method:   'POST',
            headers:  {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(bodyStr),
            },
        }

        const req = transport.request(options, (res) => {
            let body = ''
            res.setEncoding('utf8')
            res.on('data', chunk => { body += chunk })
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`HTTP ${res.statusCode}`))
                }
                if (!body || body.trim() === 'null') return resolve(null)
                let json
                try { json = JSON.parse(body) } catch {
                    return reject(new Error(`Non-JSON: ${body.slice(0, 200)}`))
                }
                if (json?.exception) {
                    return reject(new Error(`${wsfunction}: ${json.message || json.exception}`))
                }
                resolve(json)
            })
        })
        req.on('error', err => reject(new Error(`Network: ${err.message}`)))
        req.write(bodyStr)
        req.end()
    })
}

/**
 * Obtain a Moodle token for a student account via login/token.php.
 * Requires Moodle Mobile web services to be enabled.
 */
function getStudentToken(username) {
    return new Promise((resolve, reject) => {
        const parsedUrl  = new URL(`${BASE_URL}/login/token.php`)
        const transport  = parsedUrl.protocol === 'https:' ? https : http
        const bodyStr    = new URLSearchParams({ username, password: PASSWORD, service: SERVICE }).toString()

        const options = {
            hostname: parsedUrl.hostname,
            port:     parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path:     parsedUrl.pathname,
            method:   'POST',
            headers:  {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(bodyStr),
            },
        }

        const req = transport.request(options, (res) => {
            let body = ''
            res.setEncoding('utf8')
            res.on('data', chunk => { body += chunk })
            res.on('end', () => {
                let json
                try { json = JSON.parse(body) } catch {
                    return reject(new Error(`Non-JSON token response: ${body.slice(0, 200)}`))
                }
                if (json?.error) return reject(new Error(`Token error for ${username}: ${json.error}`))
                if (!json?.token) return reject(new Error(`No token returned for ${username}`))
                resolve(json.token)
            })
        })
        req.on('error', err => reject(new Error(`Network: ${err.message}`)))
        req.write(bodyStr)
        req.end()
    })
}

// =============================================================================
// ACTIVITY DISCOVERY (admin token)
// =============================================================================

async function discoverActivities() {
    console.log('Discovering activities in LMSTEST course...')

    // Find LMSTEST course
    const found = await moodlePost('core_course_get_courses_by_field', {
        field: 'shortname',
        value: 'LMSTEST',
    })
    const courses = found?.courses ?? []
    if (courses.length === 0) {
        throw new Error('LMSTEST course not found. Run moodleSetup.js first.')
    }
    const courseId = courses[0].id
    console.log(`  ✓ Found LMSTEST: id=${courseId}`)

    // Fetch course contents to get module instance IDs
    const sections = await moodlePost('core_course_get_contents', { courseid: courseId })

    let quizId   = null
    let assignId = null
    let forumId  = null

    for (const section of (sections ?? [])) {
        for (const mod of (section.modules ?? [])) {
            if (mod.modname === 'quiz'   && !quizId)   quizId   = mod.instance
            if (mod.modname === 'assign' && !assignId) assignId = mod.instance
            if (mod.modname === 'forum'  && !forumId)  forumId  = mod.instance
        }
    }

    const missing = []
    if (!quizId)   missing.push('Quiz')
    if (!assignId) missing.push('Assignment')
    if (!forumId)  missing.push('Forum')

    if (missing.length > 0) {
        throw new Error(
            `Missing activities in LMSTEST: ${missing.join(', ')}.\n` +
            `  Please add them in the Moodle UI first (same step you did for test1).`
        )
    }

    console.log(`  ✓ Quiz id=${quizId}  Assignment id=${assignId}  Forum id=${forumId}`)
    return { courseId, quizId, assignId, forumId }
}

// =============================================================================
// STUDENT ACTIONS (student token)
// =============================================================================

async function attemptQuiz(token, quizId, username) {
    // Start attempt
    const startRes = await moodlePost('mod_quiz_start_attempt', { quizid: quizId }, token)
    const attemptId = startRes?.attempt?.id
    if (!attemptId) throw new Error('start_attempt returned no attempt id')

    // Submit the attempt immediately (blank answers — counts as an attempt)
    await moodlePost('mod_quiz_process_attempt', {
        attemptid:     attemptId,
        data:          [],      // no answers (will be marked 0/wrong, but it's an attempt)
        finishattempt: 1,
        timeup:        0,
    }, token)

    console.log(`    [quiz]   attempt ${attemptId} submitted`)
}

async function submitAssignment(token, assignId, username) {
    const text = `Submission by ${username}. This is an automated test submission for LMS integration testing.`
    // Step 1: save content (creates/updates draft)
    await moodlePost('mod_assign_save_submission', {
        assignmentid: assignId,
        plugindata: {
            onlinetext_editor: {
                text,
                format:  1,    // HTML
                itemid:  0,
            },
        },
    }, token)
    // Step 2: finalize — changes status from 'draft' → 'submitted'
    // Without this the sync ignores the submission (filter: status in ['submitted','reopened'])
    await moodlePost('mod_assign_submit_for_grading', {
        assignmentid:              assignId,
        acceptsubmissionstatement: 1,
    }, token)
    console.log(`    [assign] submission finalized (submitted)`)
}

async function postForum(token, forumId, username) {
    const discussionNum = Math.floor(Math.random() * 1000)
    await moodlePost('mod_forum_add_discussion', {
        forumid: forumId,
        subject: `Test discussion by ${username} #${discussionNum}`,
        message: `Hello from ${username}! This is an automated forum post for LMS integration testing. Post #${discussionNum}.`,
    }, token)
    console.log(`    [forum]  discussion posted`)
}

// =============================================================================
// MAIN
// =============================================================================

// Students that failed every previous sync attempt because they had no quiz activity.
// Root causes:
//   1. mod_assign_submit_for_grading fails silently → assignment stays 'draft' → filtered out
//   2. mod_forum_get_discussion_posts missing from LocalTesting service → forum silently skipped
// Fix: add 'quiz' to every student — proven to sync reliably.
// Keep assign+forum for participation_score variety once those functions are added to LocalTesting.
const RETRY_STUDENTS = [
    { username: 'test8',  activities: ['quiz', 'assign', 'forum'] },
    { username: 'test11', activities: ['quiz', 'assign', 'forum'] },
    { username: 'test14', activities: ['quiz', 'assign'] },
    { username: 'test15', activities: ['quiz', 'assign', 'forum'] },
    { username: 'test19', activities: ['quiz', 'assign', 'forum'] },
]

async function main() {
    console.log('\nMoodle Activity Setup — Retry for failed students')
    console.log(`Students : ${RETRY_STUDENTS.map(s => s.username).join(', ')}`)
    console.log('─────────────────────────────────────────────────\n')

    // Discover quiz/assign/forum IDs once
    const { quizId, assignId, forumId } = await discoverActivities()
    console.log()

    let succeeded = 0
    let failed    = 0

    for (let i = 0; i < RETRY_STUDENTS.length; i++) {
        const { username, activities } = RETRY_STUDENTS[i]
        console.log(`[${i + 1}/${RETRY_STUDENTS.length}] ${username}  →  doing: ${activities.join(', ')}`)

        try {
            const token = await getStudentToken(username)

            for (const activity of activities) {
                try {
                    if (activity === 'quiz')   await attemptQuiz(token, quizId, username)
                    if (activity === 'assign') await submitAssignment(token, assignId, username)
                    if (activity === 'forum')  await postForum(token, forumId, username)
                } catch (actErr) {
                    console.warn(`    ✗ ${activity} failed: ${actErr.message}`)
                }
            }

            succeeded++
        } catch (err) {
            console.warn(`  ✗ Could not process ${username}: ${err.message}`)
            failed++
        }
    }


    console.log('\n─────────────────────────────────────────────────')
    console.log(`Done!  Succeeded: ${succeeded}  Failed: ${failed}`)
    console.log('\nNext step:')
    console.log('  → In the app admin panel, click "Sync All from Moodle"')
    console.log('  → Verify synced:21 with non-empty days:[...] for the active students\n')
}

main().catch(err => {
    console.error('\nFatal error:', err.message)
    process.exit(1)
})
