// Authentication routes
import { Router } from 'express'
import bcrypt from 'bcrypt'
import { body } from 'express-validator'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { validate } from '../middleware/validation.js'

import { register, login, logout, getMe } from '../controllers/authController.js'
import { authLimiter } from '../middleware/rateLimit.js'

const router = Router()

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new student account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, name, password]
 *             properties:
 *               email:    { type: string, format: email }
 *               name:     { type: string, minLength: 1, maxLength: 255 }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:    { type: string }
 *                 email: { type: string }
 *                 name:  { type: string }
 *                 role:  { type: string }
 *       400: { description: Validation error }
 *       409: { description: Email already in use }
 *       500: { description: Server error }
 */
// Register new user (with stricter rate limiting)
router.post('/register', authLimiter, validate([
    body('email').isEmail().normalizeEmail(),
    body('name').isString().isLength({ min: 1, max: 255 }).trim(),
    body('password').isString().isLength({ min: 8, max: 200 })
]), register)

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Log in a user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 email:
 *                   type: string
 *                 name:
 *                   type: string
 *                 role:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', authLimiter, validate([
    body('email').isEmail().normalizeEmail(),
    body('password').isString().notEmpty()
]), login)

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Log out the current user and destroy the session
 *     tags: [Auth]
 *     responses:
 *       200: { description: Logged out successfully }
 *       500: { description: Server error }
 */
router.post('/logout', logout)

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get the currently authenticated user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Current user info (null if not logged in)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               nullable: true
 *               properties:
 *                 id:    { type: string }
 *                 email: { type: string }
 *                 name:  { type: string }
 *                 role:  { type: string }
 */
router.get('/me', getMe)

// Legacy endpoints (backwards compatible)
router.post('/legacy-login', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'not_found' })
    }
    // If email/password present, use real login
    if (req.body?.email && req.body?.password) {
        return login(req, res)
    }
    // Fallback demo role-based login
    const role = req.body?.role === 'admin' ? 'admin' : 'student'
    const user = { id: 'demo-user', role }
    req.session.user = user
    logger.info(`Demo login as: ${role}`)
    res.json(user)
})

export default router
