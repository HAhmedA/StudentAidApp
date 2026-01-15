// Test Database Setup
// Connects to test PostgreSQL database and provides utilities for test isolation

import pkg from 'pg'
const { Pool } = pkg

// Test database pool - uses environment variables or defaults for test container
const testPool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5433),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'password',
    database: process.env.PGDATABASE || 'postgres',
})

/**
 * Clean up test data between tests
 * Removes data from chat tables while preserving schema and users
 */
async function cleanupTestData() {
    await testPool.query('DELETE FROM public.chat_messages')
    await testPool.query('DELETE FROM public.chat_summaries')
    await testPool.query('DELETE FROM public.chat_sessions')
}

/**
 * Create a test user if not exists
 * @returns {Promise<string>} - User ID
 */
async function getOrCreateTestUser(email = 'testuser@test.com') {
    // Check if user exists
    const { rows: existing } = await testPool.query(
        'SELECT id FROM public.users WHERE email = $1',
        [email]
    )

    if (existing.length > 0) {
        return existing[0].id
    }

    // Create test user
    const { rows } = await testPool.query(
        `INSERT INTO public.users (email, name, password_hash, role) 
         VALUES ($1, 'Test User', 'test-hash', 'student') 
         RETURNING id`,
        [email]
    )
    return rows[0].id
}

/**
 * Close the test database pool
 */
async function closeTestDb() {
    await testPool.end()
}

/**
 * Get the test pool for direct queries if needed
 */
function getTestPool() {
    return testPool
}

export {
    testPool,
    cleanupTestData,
    getOrCreateTestUser,
    closeTestDb,
    getTestPool
}
