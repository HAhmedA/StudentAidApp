// Auth controller
import bcrypt from 'bcrypt'
import crypto, { createHmac } from 'crypto'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { generateStudentData } from '../services/simulationOrchestratorService.js'
import { asyncRoute, AppError } from '../utils/errors.js'

// Produce the signed session cookie value that express-session expects.
// Uses the same algorithm as the 'cookie-signature' package (HMAC-SHA256, base64url).
function signSessionId(id, secret) {
    const sig = createHmac('sha256', secret).update(id).digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return 's:' + id + '.' + sig
}

// Set the connect.sid cookie explicitly — express-session's res.end() hook
// does not fire reliably in production behind nginx, so we set it manually
// after session.save() guarantees the row is in PostgreSQL.
function setSessionCookie(res, sessionId, maxAge = 24 * 60 * 60 * 1000) {
    const value = signSessionId(sessionId, process.env.SESSION_SECRET)
    const secure = process.env.COOKIE_SECURE === 'true'
    res.cookie('connect.sid', value, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge,
        path: '/',
    })
}

export const login = asyncRoute(async (req, res) => {
        const { email, password } = req.body
        const { rows } = await pool.query('SELECT id, email, name, password_hash, role FROM public.users WHERE email = $1', [email])
        const row = rows[0]
        if (!row) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
        const ok = await bcrypt.compare(password, row.password_hash)
        if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
        const user = { id: row.id, email: row.email, name: row.name, role: row.role }
        req.session.user = user
        // Explicitly save session before responding — prevents race condition where
        // the browser fires parallel requests before the session row is in PostgreSQL.
        await new Promise((resolve, reject) =>
            req.session.save(err => (err ? reject(err) : resolve()))
        )
        setSessionCookie(res, req.sessionID)
        logger.info(`User logged in: ${email}`)
        res.json(user)
})

export const logout = (req, res) => {
    const email = req.session.user?.email || 'unknown'
    req.session.destroy((err) => {
        if (err) {
            logger.error(`Logout error: ${err.message}`)
            return res.status(500).json({ error: 'logout_error' })
        }
        res.clearCookie('connect.sid')
        logger.info(`User logged out: ${email}`)
        res.json({})
    })
}

export const getMe = (req, res) => {
    res.json(req.session.user || null)
}

export const register = asyncRoute(async (req, res) => {
        const { email, name, password } = req.body
        const existing = await pool.query('SELECT id FROM public.users WHERE email = $1', [email])
        if (existing.rowCount) throw new AppError('EMAIL_IN_USE', 'Email already registered', 409)
        const passwordHash = await bcrypt.hash(password, 10)
        const insert = await pool.query(
            'INSERT INTO public.users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
            [email, name, passwordHash]
        )
        const user = insert.rows[0]
        req.session.user = user
        await new Promise((resolve, reject) =>
            req.session.save(err => (err ? reject(err) : resolve()))
        )
        setSessionCookie(res, req.sessionID)
        logger.info(`User registered: ${email}`)

        // Generate simulated data via Orchestrator (dev/test only).
        // Skipped when SIMULATION_MODE=false so production users start with a clean slate.
        if (process.env.SIMULATION_MODE !== 'false') {
            try {
                await generateStudentData(pool, user.id)
                logger.info(`Simulation data generated for user ${user.id}`)
            } catch (simErr) {
                // Log but don't fail registration if simulation fails
                logger.error(`Failed to generate simulation data for user ${user.id}: ${simErr.message}`)
            }
        }

        res.status(201).json(user)
})

const MOODLE_SESSION_MAX_AGE = 45 * 24 * 60 * 60 * 1000 // 45 days

export const moodleAutoLogin = asyncRoute(async (req, res) => {
    const { USERID, key } = req.query

    if (!USERID || !key) throw new AppError('MISSING_PARAMS', 'USERID and key are required', 400)
    const moodleId = parseInt(USERID, 10)
    if (isNaN(moodleId) || moodleId <= 0) throw new AppError('INVALID_PARAM', 'USERID must be a positive integer', 400)

    const expectedKey = process.env.MOODLE_AUTO_LOGIN_KEY
    if (!expectedKey) throw new AppError('NOT_CONFIGURED', 'Moodle auto-login is not configured', 503)

    const keyBuf = Buffer.from(key)
    const expectedBuf = Buffer.from(expectedKey)
    if (keyBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(keyBuf, expectedBuf)) {
        throw new AppError('FORBIDDEN', 'Invalid key', 403)
    }

    let user
    let isNewUser = false
    const { rows } = await pool.query(
        'SELECT id, email, name, role FROM public.users WHERE moodle_id = $1', [moodleId]
    )

    if (rows.length > 0) {
        user = rows[0]
    } else {
        const randomPassword = crypto.randomBytes(32).toString('hex')
        const passwordHash = await bcrypt.hash(randomPassword, 10)
        // ON CONFLICT handles the case where the email already exists but moodle_id
        // is wrong/null (e.g., after a DB rebuild). Updates moodle_id to re-link.
        const insert = await pool.query(
            `INSERT INTO public.users (email, name, password_hash, role, moodle_id)
             VALUES ($1, $2, $3, 'student', $4)
             ON CONFLICT (email) DO UPDATE SET moodle_id = EXCLUDED.moodle_id
             RETURNING id, email, name, role`,
            [`moodle_${moodleId}@auto.local`, `Student ${moodleId}`, passwordHash, moodleId]
        )
        user = insert.rows[0]
        isNewUser = true
        logger.info(`Moodle auto-provisioned user ${user.id} for moodle_id=${moodleId}`)

        if (process.env.SIMULATION_MODE !== 'false') {
            try {
                await generateStudentData(pool, user.id)
                logger.info(`Simulation data generated for Moodle user ${user.id}`)
            } catch (simErr) {
                logger.error(`Failed to generate simulation data for Moodle user ${user.id}: ${simErr.message}`)
            }
        }
    }

    req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role }
    req.session.cookie.maxAge = MOODLE_SESSION_MAX_AGE
    await new Promise((resolve, reject) =>
        req.session.save(err => (err ? reject(err) : resolve()))
    )
    setSessionCookie(res, req.sessionID, MOODLE_SESSION_MAX_AGE)

    const basePath = process.env.APP_BASE_PATH || '/'
    res.redirect(basePath)
})
