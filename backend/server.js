// Minimal Express backend used by the React client.
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import helmet from 'helmet'
import swaggerUi from 'swagger-ui-express'

import pool from './config/database.js'
import logger from './utils/logger.js'
import routes from './routes/index.js'
import { ensureFixedSurvey } from './routes/surveys.js'
import { initializeSystemPrompt } from './services/promptAssemblerService.js'
import { seedTestAccountData } from './services/seedDataService.js'
import { specs } from './config/swagger.js'
import { apiLimiter } from './middleware/rateLimit.js'
import { validateEnvironment } from './config/envValidation.js'
import { startCronJobs } from './services/cronService.js'

const app = express()

// Validate environment variables (fails in production if critical vars missing)
// Returns isProduction so we don't re-derive it from the potentially-invalid raw value
const isProduction = validateEnvironment(process.env.NODE_ENV)

// Optional Sentry error tracking — activated only when SENTRY_DSN is set.
// Zero impact when not configured.
if (process.env.SENTRY_DSN) {
    try {
        const Sentry = (await import('@sentry/node')).default
        Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' })
        app.use(Sentry.Handlers.requestHandler())
        logger.info('Sentry error tracking initialised')
        // Sentry error handler is added below, before the global error handler
        app._sentryErrorHandler = Sentry.Handlers.errorHandler()
    } catch (err) {
        logger.warn(`Sentry init failed (is @sentry/node installed?): ${err.message}`)
    }
}

// Security headers
// On plain HTTP deployments (COOKIE_SECURE=false), disable directives that
// cause browsers to reject HTTP cookies: upgrade-insecure-requests (CSP) and
// Strict-Transport-Security (HSTS). Both make Chrome treat the site as HTTPS
// only, which silently drops SameSite=Lax cookies over HTTP.
const isHttpDeploy = process.env.COOKIE_SECURE === 'false'
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            connectSrc: [
                "'self'",
                process.env.MOODLE_BASE_URL,
                process.env.LLM_BASE_URL,
            ].filter(Boolean),
            frameAncestors: ["'none'"],
            // null disables the directive entirely (helmet v8 API)
            upgradeInsecureRequests: isHttpDeploy ? null : [],
        }
    },
    // Disable HSTS on plain HTTP — sending it over HTTP has no effect and
    // some browsers may cache it and later refuse to load the site over HTTP.
    hsts: !isHttpDeploy,
}))

// Let Express trust reverse proxy headers; important for cookies behind Docker
app.set('trust proxy', 1)
const PORT = process.env.PORT || 8080

// Allow cross-origin requests from the frontend
// Configurable via CORS_ORIGINS environment variable (comma-separated)
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3000']

const corsOptions = {
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Filename']
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// Parse CSV upload bodies before JSON — must come first so text/csv requests
// are claimed with the 10mb limit before express.json sees them.
app.use(express.raw({ type: 'text/csv', limit: '10mb' }))

// Parse JSON request bodies
app.use(express.json({ limit: '50kb' }))

// Postgres-backed session store
const PgSession = connectPgSimple(session)

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET ?? (process.env.NODE_ENV !== 'production' ? 'dev-secret' : undefined),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === 'true' : isProduction,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}))

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`)
  next()
})

// Health check — used by Docker and load balancers
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// Prevent intermediate proxies (e.g. ESM external nginx) from caching API responses.
// All API endpoints serve user-specific data and must never be served from cache.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.set('Pragma', 'no-cache')
  next()
})

// Mount all routes under /api with rate limiting
app.use('/api', apiLimiter, routes)

// Swagger API Documentation (dev only)
if (!isProduction) {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs))
}

// Sentry error handler (no-op when Sentry is not configured)
if (app._sentryErrorHandler) {
    app.use(app._sentryErrorHandler)
}

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    error: 'server_error',
    message: isProduction ? 'An internal server error occurred' : err.message
  });
});

// Start server
const server = app.listen(PORT, async () => {
  logger.info(`Backend listening on http://0.0.0.0:${PORT}`)

  // Initialize system prompt (seeds from file if database is empty)
  try {
    await initializeSystemPrompt()
  } catch (e) {
    logger.error('Failed to initialize system prompt:', e.message)
  }

  // Ensure the fixed Self-Regulated Learning Questionnaire exists
  try {
    await ensureFixedSurvey()
  } catch (e) {
    logger.error('Failed to initialize fixed survey:', e.message)
  }

  // Generate simulated data for seed test accounts (skipped when SIMULATION_MODE=false)
  // Awaited so that the score recomputation pass finishes before the first client request
  try {
    await seedTestAccountData()
  } catch (e) {
    logger.error('Failed to seed test account data:', e.message)
  }

  // Start nightly background jobs
  startCronJobs()
})

// Graceful shutdown — drain active requests and close DB pool on SIGTERM/SIGINT
// Docker sends SIGTERM during container stop; without this handler the process
// exits immediately, dropping in-flight requests and abandoning DB connections.
function gracefulShutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`)
  server.close(() => {
    pool.end().then(() => {
      logger.info('Database pool closed')
      process.exit(0)
    })
  })
  // Force exit if draining takes too long
  setTimeout(() => process.exit(1), 10000)
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
