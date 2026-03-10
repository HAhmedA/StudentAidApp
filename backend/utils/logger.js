// Centralized logging utility using Winston
import winston from 'winston'
import path from 'path'
import { fileURLToPath } from 'url'

const { combine, timestamp, printf, colorize, errors, json } = winston.format

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Log directory path (used only when LOG_TO_FILE=true)
const LOG_DIR = path.join(__dirname, '..', 'logs')

const isProduction = process.env.NODE_ENV === 'production'
const logToFile    = process.env.LOG_TO_FILE === 'true'

// Custom format for console output in development
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`
})

// Custom format for file output (includes extra metadata)
const fileFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${stack || message}`
    if (Object.keys(metadata).length > 0) {
        log += ` | ${JSON.stringify(metadata)}`
    }
    return log
})

// Console transport: colorized in dev, JSON in production for log aggregators
const consoleTransport = new winston.transports.Console({
    format: isProduction
        ? combine(timestamp(), errors({ stack: true }), json())
        : combine(colorize(), consoleFormat)
})

// Build transport list — file transports only when LOG_TO_FILE=true
const transports = [consoleTransport]

if (logToFile) {
    transports.push(
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'app.log'),
            format: fileFormat,
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 5,
            tailable: true
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5 * 1024 * 1024,
            maxFiles: 3
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'chat.log'),
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB for chat logs
            maxFiles: 3
        })
    )
}

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true })
    ),
    transports,
    // Don't exit on handled exceptions
    exitOnError: false
})

// Stream for Morgan HTTP logging (if needed later)
logger.stream = {
    write: (message) => logger.info(message.trim())
}

// Helper to log chat-specific events with extra context
logger.chat = (message, metadata = {}) => {
    logger.info(message, { category: 'chat', ...metadata })
}

// Helper to log prompt assembly details
logger.prompt = (message, metadata = {}) => {
    logger.info(message, { category: 'prompt', ...metadata })
}

export default logger
