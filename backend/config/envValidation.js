// Environment Validation
// Validates required environment variables and fails startup in production if missing

import logger from '../utils/logger.js'

// Required environment variables for production
const REQUIRED_PRODUCTION_ENV = {
    SESSION_SECRET: 'Session secret for cookie signing',
    PGHOST: 'PostgreSQL host',
    PGUSER: 'PostgreSQL username',
    PGPASSWORD: 'PostgreSQL password',
    PGDATABASE: 'PostgreSQL database name'
}

// Optional but recommended
const RECOMMENDED_ENV = {
    CORS_ORIGINS: 'Allowed CORS origins (comma-separated)',
    LLM_BASE_URL: 'LLM API base URL',
    LLM_MAIN_MODEL: 'Main LLM model name',
    SIMULATION_MODE: 'Set to "false" to disable simulators and exclude test data from clustering (default: "true")',
    MOODLE_BASE_URL: 'Base URL of Moodle instance for LMS sync (e.g. http://localhost:8888/moodle501)',
    MOODLE_TOKEN:    'Moodle web service token for REST API access',
    MOODLE_AUTO_LOGIN_KEY: 'Shared secret for Moodle auto-login URL authentication'
}

/**
 * Validate environment variables
 * In production: throws error if required vars are missing
 * In development: logs warnings for missing vars
 *
 * @param {string} nodeEnv - Value of process.env.NODE_ENV
 * @returns {boolean} isProduction — true when nodeEnv === 'production'
 * @throws {Error} In production if required variables are missing
 */
function validateEnvironment(nodeEnv) {
    const VALID_ENVS = ['production', 'development', 'test']
    if (!VALID_ENVS.includes(nodeEnv)) {
        logger.warn(`NODE_ENV "${nodeEnv ?? '(unset)'}" is not recognised — defaulting to "development"`)
        nodeEnv = 'development'
    }
    const isProduction = nodeEnv === 'production'
    const missing = []
    const warnings = []

    // Check required production variables
    for (const [key, description] of Object.entries(REQUIRED_PRODUCTION_ENV)) {
        if (!process.env[key]) {
            if (isProduction) {
                missing.push(`${key}: ${description}`)
            } else {
                warnings.push(`${key}: ${description} (using default)`)
            }
        }
    }

    // Check for weak secrets in production
    if (isProduction) {
        if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-secret') {
            missing.push('SESSION_SECRET: Must be a cryptographically random string in production')
        }
        if (!process.env.PGPASSWORD || process.env.PGPASSWORD === 'password') {
            missing.push('PGPASSWORD: Must be set to a strong password in production')
        }
    }

    // Check recommended variables
    for (const [key, description] of Object.entries(RECOMMENDED_ENV)) {
        if (!process.env[key]) {
            warnings.push(`${key}: ${description} (optional)`)
        }
    }

    // Log warnings
    if (warnings.length > 0) {
        logger.warn('Environment warnings:')
        warnings.forEach(w => logger.warn(`  - ${w}`))
    }

    // In production, fail if required vars are missing
    if (isProduction && missing.length > 0) {
        const errorMessage = `Missing required environment variables for production:\n${missing.map(m => `  - ${m}`).join('\n')}`
        logger.error(errorMessage)
        throw new Error(errorMessage)
    }

    logger.info('Environment validation passed')
    return isProduction
}

export { validateEnvironment, REQUIRED_PRODUCTION_ENV, RECOMMENDED_ENV }
