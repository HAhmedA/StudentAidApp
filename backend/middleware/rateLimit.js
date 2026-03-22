// Rate limiting middleware
import rateLimit from 'express-rate-limit'

// General API rate limiter — raised for usability testing (shared IPs in lab/classroom)
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: { error: 'too_many_requests', message: 'Too many requests, please try again later.' },
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false, // Disable deprecated headers
    skip: (req) => req.session?.user?.role === 'admin', // admins bypass the general limiter
})

// Stricter limiter for auth endpoints (login, register)
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 auth attempts per windowMs
    message: { error: 'too_many_requests', message: 'Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
})
