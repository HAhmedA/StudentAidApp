export default {
    testEnvironment: 'node',
    transform: {},           // ESM — no transform needed
    testMatch: ['**/tests/**/*.test.js'],
    setupFilesAfterEnv: ['./tests/setup.js'],
    // Prevent Jest from transforming node_modules (ESM compatible)
    transformIgnorePatterns: ['/node_modules/'],
    // Collect coverage from source files
    collectCoverageFrom: [
        'services/scoring/**/*.js',
        'utils/**/*.js',
        'config/**/*.js',
        'routes/**/*.js',
        '!**/node_modules/**'
    ],
    coverageThreshold: {
        global: {
            lines: 70
        }
    }
}
