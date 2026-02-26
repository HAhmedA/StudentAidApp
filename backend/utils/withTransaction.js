// Database transaction helper.
// Acquires a client from the pool, runs fn(client) inside BEGIN/COMMIT,
// and automatically rolls back on error before re-throwing.

/**
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function withTransaction(pool, fn) {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await fn(client)
        await client.query('COMMIT')
        return result
    } catch (err) {
        await client.query('ROLLBACK')
        throw err
    } finally {
        client.release()
    }
}
