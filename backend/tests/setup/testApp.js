// Test Application Setup
// Creates an Express app configured for testing with session mocking

import express from 'express'
import session from 'express-session'
import chatRouter from '../../routes/chat.js'
import { testPool } from './testDb.js'

/**
 * Create a test Express app with the actual chat routes
 * @param {Object} options - Configuration options
 * @param {string|null} options.userId - User ID to inject into session (null = unauthenticated)
 * @param {Object} options.userDetails - Additional user details for session
 * @returns {Express} - Configured Express app
 */
function createTestApp(options = {}) {
    const { userId = null, userDetails = {} } = options

    const app = express()
    app.use(express.json())

    // Simple session middleware for testing
    app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: true
    }))

    // Inject mock session user if userId provided
    app.use((req, res, next) => {
        if (userId) {
            req.session.user = {
                id: userId,
                email: userDetails.email || 'testuser@test.com',
                role: userDetails.role || 'student',
                ...userDetails
            }
        }
        next()
    })

    // Mount actual chat routes
    app.use('/api/chat', chatRouter)

    return app
}

/**
 * Mock the LLM/external API services
 * Call this before tests that would hit external services
 */
function mockExternalServices() {
    // Return mock functions that tests can configure
    const mocks = {
        chatCompletion: jest.fn().mockResolvedValue('Mock LLM response'),
        checkAvailability: jest.fn().mockResolvedValue({ available: true })
    }

    // Note: Actual mocking happens via jest.mock() in test files
    // This function provides default mock implementations
    return mocks
}

export {
    createTestApp,
    mockExternalServices
}
