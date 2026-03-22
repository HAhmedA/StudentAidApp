// Database connection pool configuration
import pkg from 'pg'
const { Pool } = pkg

const pool = new Pool({
    host: process.env.PGHOST || 'postgres',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'postgres',
    connectionTimeoutMillis: 10000,
})

// Prevent idle client errors from crashing the process.
// Without this handler, an unexpected error on an idle client emits an
// unhandled 'error' event which terminates Node.js.
pool.on('error', (err) => {
    console.error('Unexpected idle client error:', err.message)
})

export default pool
