// Centralized error handling utilities.
// All routes should use asyncRoute() and Errors.* instead of raw try/catch.

import logger from './logger.js'

export class AppError extends Error {
    constructor(code, message, status = 500, details = null) {
        super(message)
        this.name = 'AppError'
        this.code = code
        this.status = status
        this.details = details
    }
}

export const Errors = {
    UNAUTHORIZED:    ()  => new AppError('UNAUTHORIZED', 'Not authenticated', 401),
    FORBIDDEN:       ()  => new AppError('FORBIDDEN', 'Access denied', 403),
    NOT_FOUND:       (r) => new AppError('NOT_FOUND', `${r} not found`, 404),
    VALIDATION:      (d) => new AppError('VALIDATION_ERROR', 'Invalid input', 400, d),
    DB_ERROR:        (m) => new AppError('DB_ERROR', 'Database error', 500, m),
    UNKNOWN_CONCEPT: (id) => new AppError('UNKNOWN_CONCEPT', `Unknown concept: ${id}`, 400),
}

/**
 * Async route wrapper — eliminates try/catch boilerplate in every route handler.
 * Catches any thrown error, converts it to a consistent JSON response shape.
 *
 * @param {Function} fn - Async route handler (req, res, next) => Promise<void>
 * @returns {Function} - Express middleware
 */
export const asyncRoute = (fn) => async (req, res, next) => {
    try {
        await fn(req, res, next)
    } catch (err) {
        const e = err instanceof AppError ? err : Errors.DB_ERROR(err.message)
        logger.error(`${e.code}: ${e.message}`)
        res.status(e.status).json({
            error: e.code,
            message: e.message,
            ...(process.env.NODE_ENV !== 'production' && e.details && { details: e.details })
        })
    }
}
