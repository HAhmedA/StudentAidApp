// Chat Routes Integration Tests
// Tests actual routes with real database, mocking only external LLM services

import request from 'supertest'
import express from 'express'
import session from 'express-session'
import {
    cleanupTestData,
    getOrCreateTestUser,
    closeTestDb,
    testPool
} from './setup/testDb.js'

// For ESM, we need to use unstable_mockModule before importing the modules
// Since Jest ESM mocking is complex, we'll use a simpler approach:
// Create a test app that imports the actual routes but with service layer mocking via dependency injection

/**
 * Create a test Express app with actual chat routes
 * Uses session middleware to inject mock users
 */
function createTestApp(userId = null) {
    const app = express()
    app.use(express.json())

    app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: true
    }))

    // Inject mock session user
    app.use((req, res, next) => {
        if (userId) {
            req.session.user = {
                id: userId,
                email: 'testuser@test.com',
                role: 'student'
            }
        }
        next()
    })

    return app
}

describe('Chat Routes Integration Tests', () => {
    let testUserId
    let chatRouter

    beforeAll(async () => {
        // Get or create test user
        testUserId = await getOrCreateTestUser('chat-test@test.com')

        // Dynamically import the router after test setup
        const chatModule = await import('../routes/chat.js')
        chatRouter = chatModule.default
    })

    beforeEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        await cleanupTestData()
        await closeTestDb()
    })

    describe('Authentication Tests', () => {
        test('GET /api/chat/initial returns 401 when not authenticated', async () => {
            const app = createTestApp(null)
            app.use('/api/chat', chatRouter)

            const response = await request(app)
                .get('/api/chat/initial')

            expect(response.status).toBe(401)
            expect(response.body.error).toBe('not_authenticated')
        })

        test('POST /api/chat/message returns 401 when not authenticated', async () => {
            const app = createTestApp(null)
            app.use('/api/chat', chatRouter)

            const response = await request(app)
                .post('/api/chat/message')
                .send({ message: 'Hello' })

            expect(response.status).toBe(401)
            expect(response.body.error).toBe('not_authenticated')
        })

        test('POST /api/chat/reset returns 401 when not authenticated', async () => {
            const app = createTestApp(null)
            app.use('/api/chat', chatRouter)

            const response = await request(app)
                .post('/api/chat/reset')

            expect(response.status).toBe(401)
            expect(response.body.error).toBe('not_authenticated')
        })

        test('GET /api/chat/session returns 401 when not authenticated', async () => {
            const app = createTestApp(null)
            app.use('/api/chat', chatRouter)

            const response = await request(app)
                .get('/api/chat/session')

            expect(response.status).toBe(401)
            expect(response.body.error).toBe('not_authenticated')
        })

        test('GET /api/chat/history returns 401 when not authenticated', async () => {
            const app = createTestApp(null)
            app.use('/api/chat', chatRouter)

            const response = await request(app)
                .get('/api/chat/history?sessionId=test')

            expect(response.status).toBe(401)
            expect(response.body.error).toBe('not_authenticated')
        })
    })

    describe('Input Validation Tests', () => {
        test('POST /api/chat/message returns 400 for empty message', async () => {
            const app = createTestApp(testUserId)
            app.use('/api/chat', chatRouter)

            const response = await request(app)
                .post('/api/chat/message')
                .send({ message: '' })

            expect(response.status).toBe(400)
            expect(response.body.error).toBe('message is required')
        })

        test('POST /api/chat/message returns 400 for missing message', async () => {
            const app = createTestApp(testUserId)
            app.use('/api/chat', chatRouter)

            const response = await request(app)
                .post('/api/chat/message')
                .send({})

            expect(response.status).toBe(400)
            expect(response.body.error).toBe('message is required')
        })

        test('POST /api/chat/message returns 400 for whitespace-only message', async () => {
            const app = createTestApp(testUserId)
            app.use('/api/chat', chatRouter)

            const response = await request(app)
                .post('/api/chat/message')
                .send({ message: '   ' })

            expect(response.status).toBe(400)
            expect(response.body.error).toBe('message is required')
        })

        test('POST /api/chat/message returns 400 for message exceeding max length', async () => {
            const app = createTestApp(testUserId)
            app.use('/api/chat', chatRouter)

            const longMessage = 'a'.repeat(5001)
            const response = await request(app)
                .post('/api/chat/message')
                .send({ message: longMessage })

            expect(response.status).toBe(400)
            expect(response.body.error).toContain('too long')
        })

        test('GET /api/chat/history returns 400 without sessionId', async () => {
            const app = createTestApp(testUserId)
            app.use('/api/chat', chatRouter)

            const response = await request(app)
                .get('/api/chat/history')

            expect(response.status).toBe(400)
            expect(response.body.error).toBe('sessionId is required')
        })
    })

    // NOTE: Session management and message sending tests require full integration
    // with the LLM service layer. These are better suited as E2E tests or require
    // Jest ESM module mocking which is currently experimental.
    // The authentication and input validation tests above verify that:
    // 1. Routes properly enforce authentication
    // 2. Input validation works correctly
    // 3. The actual router is being tested (not mock implementations)
})
