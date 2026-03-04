# LLM Config Admin Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the admin change the LLM provider, URL, model names, API key, and tuning params from the admin dashboard without restarting the server.

**Architecture:** A new `llm_config` DB table (INSERT-not-UPDATE, same as `system_prompts`) stores config. A new `llmConfigService.js` reads DB first and falls back to env vars. `apiConnectorService.js` calls `getLlmConfig()` on each request instead of reading a static `process.env` object. Three new admin endpoints (GET/PUT/test) plus a new `AdminLlmConfigPanel` React component.

**Tech Stack:** Node.js ESM, Express, PostgreSQL (pg pool), `asyncRoute`/`Errors` utils, React + TypeScript, Redux Toolkit, axios.

---

### Task 1: DB Migration — `llm_config` table

**Files:**
- Create: `backend/migrations/1650000000018_llm_config.sql`

**Step 1: Create the migration file**

```sql
-- backend/migrations/1650000000018_llm_config.sql
CREATE TABLE IF NOT EXISTS public.llm_config (
    id          SERIAL PRIMARY KEY,
    provider    VARCHAR(50)   NOT NULL DEFAULT 'lmstudio',
    base_url    VARCHAR(500)  NOT NULL DEFAULT 'http://host.docker.internal:1234',
    main_model  VARCHAR(100)  NOT NULL DEFAULT 'hermes-3-llama-3.2-3b',
    judge_model VARCHAR(100)  NOT NULL DEFAULT 'qwen2.5-3b-instruct',
    max_tokens  INT           NOT NULL DEFAULT 2000,
    temperature DECIMAL(3,2)  NOT NULL DEFAULT 0.70,
    timeout_ms  INT           NOT NULL DEFAULT 30000,
    api_key     VARCHAR(500)  NOT NULL DEFAULT '',
    updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_config_updated_at
    ON public.llm_config (updated_at DESC);
```

**Step 2: Run the migration**

```bash
cd backend && npm run migrate
```

Expected: `Migrated up: 1650000000018_llm_config`

**Step 3: Commit**

```bash
git add backend/migrations/1650000000018_llm_config.sql
git commit -m "feat: add llm_config migration"
```

---

### Task 2: `llmConfigService.js` — DB-first config with env fallback

**Files:**
- Create: `backend/services/llmConfigService.js`
- Create: `backend/tests/llmConfigService.test.js`

**Step 1: Write the failing tests**

```js
// backend/tests/llmConfigService.test.js
import { jest } from '@jest/globals'

const mockQuery = jest.fn()

jest.unstable_mockModule('../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../utils/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

const { getLlmConfig } = await import('../services/llmConfigService.js')

describe('getLlmConfig', () => {
    beforeEach(() => jest.clearAllMocks())

    it('returns DB row when one exists', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                provider: 'openai',
                base_url: 'https://api.openai.com/v1',
                main_model: 'gpt-4o-mini',
                judge_model: 'gpt-4o-mini',
                max_tokens: 1000,
                temperature: 0.5,
                timeout_ms: 15000,
                api_key: 'sk-test'
            }]
        })

        const cfg = await getLlmConfig()
        expect(cfg.provider).toBe('openai')
        expect(cfg.baseUrl).toBe('https://api.openai.com/v1')
        expect(cfg.mainModel).toBe('gpt-4o-mini')
        expect(cfg.apiKey).toBe('sk-test')
    })

    it('falls back to env vars when DB is empty', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] })
        process.env.LLM_PROVIDER = 'lmstudio'
        process.env.LLM_BASE_URL = 'http://localhost:1234'
        process.env.LLM_MAIN_MODEL = 'my-model'
        process.env.LLM_JUDGE_MODEL = 'judge-model'
        process.env.LLM_MAX_TOKENS = '2000'
        process.env.LLM_TEMPERATURE = '0.7'
        process.env.LLM_TIMEOUT_MS = '30000'
        process.env.LLM_API_KEY = ''

        const cfg = await getLlmConfig()
        expect(cfg.provider).toBe('lmstudio')
        expect(cfg.baseUrl).toBe('http://localhost:1234')
        expect(cfg.mainModel).toBe('my-model')
    })

    it('falls back to env vars when DB query throws', async () => {
        mockQuery.mockRejectedValueOnce(new Error('DB down'))
        process.env.LLM_PROVIDER = 'lmstudio'
        process.env.LLM_BASE_URL = 'http://localhost:1234'
        process.env.LLM_MAIN_MODEL = 'fallback-model'
        process.env.LLM_JUDGE_MODEL = 'judge'
        process.env.LLM_MAX_TOKENS = '2000'
        process.env.LLM_TEMPERATURE = '0.7'
        process.env.LLM_TIMEOUT_MS = '30000'
        process.env.LLM_API_KEY = ''

        const cfg = await getLlmConfig()
        expect(cfg.mainModel).toBe('fallback-model')
    })
})
```

**Step 2: Run to confirm failure**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest tests/llmConfigService.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../services/llmConfigService.js'`

**Step 3: Implement the service**

```js
// backend/services/llmConfigService.js
import pool from '../config/database.js'
import logger from '../utils/logger.js'

function envFallback() {
    return {
        provider:    process.env.LLM_PROVIDER    || 'lmstudio',
        baseUrl:     process.env.LLM_BASE_URL     || 'http://host.docker.internal:1234',
        mainModel:   process.env.LLM_MAIN_MODEL   || 'hermes-3-llama-3.2-3b',
        judgeModel:  process.env.LLM_JUDGE_MODEL  || 'qwen2.5-3b-instruct',
        maxTokens:   parseInt(process.env.LLM_MAX_TOKENS  || '2000', 10),
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
        timeoutMs:   parseInt(process.env.LLM_TIMEOUT_MS  || '30000', 10),
        apiKey:      process.env.LLM_API_KEY       || ''
    }
}

/**
 * Returns the active LLM config.
 * Reads from DB (latest row) first; falls back to env vars if no DB record.
 */
export async function getLlmConfig() {
    try {
        const { rows } = await pool.query(
            `SELECT provider, base_url, main_model, judge_model,
                    max_tokens, temperature, timeout_ms, api_key
             FROM public.llm_config
             ORDER BY updated_at DESC LIMIT 1`
        )

        if (rows.length === 0) return envFallback()

        const row = rows[0]
        return {
            provider:    row.provider,
            baseUrl:     row.base_url,
            mainModel:   row.main_model,
            judgeModel:  row.judge_model,
            maxTokens:   row.max_tokens,
            temperature: parseFloat(row.temperature),
            timeoutMs:   row.timeout_ms,
            apiKey:      row.api_key
        }
    } catch (err) {
        logger.warn('getLlmConfig: DB error, falling back to env vars:', err.message)
        return envFallback()
    }
}
```

**Step 4: Run tests — confirm pass**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest tests/llmConfigService.test.js --no-coverage
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add backend/services/llmConfigService.js backend/tests/llmConfigService.test.js
git commit -m "feat: add llmConfigService with DB-first config and env fallback"
```

---

### Task 3: Update `apiConnectorService.js` — dynamic config

**Files:**
- Modify: `backend/services/apiConnectorService.js`

**Step 1: Replace the static `config` block and update functions**

Remove the entire static `const config = { ... }` block at the top (lines 8–17).

Add import at top (after the `logger` import):

```js
import { getLlmConfig } from './llmConfigService.js'
```

Replace the body of `chatCompletion` — change the three const lines at the top plus the endpoint/headers/logger lines to use a dynamic config:

```js
async function chatCompletion(messages, options = {}) {
    const config = await getLlmConfig()                         // ← dynamic
    const model = options.model || config.mainModel
    const maxTokens = options.maxTokens || config.maxTokens
    const temperature = options.temperature ?? config.temperature

    const endpoint = `${config.baseUrl}/v1/chat/completions`
    // ... rest of function body unchanged ...
```

Replace the body of `checkAvailability`:

```js
async function checkAvailability() {
    const config = await getLlmConfig()                         // ← dynamic
    try {
        // ... rest of function body unchanged, config is now local ...
```

Update the export at the bottom — replace `config as llmConfig` with `getLlmConfig`:

```js
export {
    chatCompletion,
    chatCompletionWithRetry,
    checkAvailability,
    estimateTokens,
    getLlmConfig         // ← replaces: config as llmConfig
}
```

**Step 2: Run the full test suite — confirm nothing broke**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```

Expected: all tests pass (some may now mock `llmConfigService.js` — see next step if any fail)

**Step 3: Commit**

```bash
git add backend/services/apiConnectorService.js
git commit -m "feat: apiConnectorService reads LLM config dynamically from DB"
```

---

### Task 4: Fix `alignmentService.js` — adapt to async `getLlmConfig`

`alignmentService.js` currently imports the static `llmConfig` object and reads `llmConfig.judgeModel` synchronously. We change it to call `getLlmConfig()`.

**Files:**
- Modify: `backend/services/alignmentService.js`

**Step 1: Update the import**

Find (line 10):
```js
import { chatCompletion, llmConfig } from './apiConnectorService.js'
```

Replace with:
```js
import { chatCompletion, getLlmConfig } from './apiConnectorService.js'
```

**Step 2: Update the usage**

Find (line ~150 inside an async function):
```js
model: llmConfig.judgeModel,
```

Replace with (two lines — add the await above the usage):
```js
const { judgeModel } = await getLlmConfig()
// ...
model: judgeModel,
```

**Step 3: Run full test suite**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```

Expected: all tests pass

**Step 4: Commit**

```bash
git add backend/services/alignmentService.js
git commit -m "fix: alignmentService uses async getLlmConfig instead of static llmConfig"
```

---

### Task 5: Admin routes — GET / PUT / POST test

**Files:**
- Modify: `backend/routes/admin.js`
- Create: `backend/tests/adminLlmConfig.test.js`

**Step 1: Write the failing tests**

```js
// backend/tests/adminLlmConfig.test.js
import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import session from 'express-session'

const mockQuery = jest.fn()
const mockGetLlmConfig = jest.fn()
const mockFetch = jest.fn()

jest.unstable_mockModule('../config/database.js', () => ({
    default: { query: mockQuery }
}))
jest.unstable_mockModule('../utils/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))
jest.unstable_mockModule('../services/llmConfigService.js', () => ({
    getLlmConfig: mockGetLlmConfig
}))
// Mock all the imports admin.js needs
jest.unstable_mockModule('../services/alignmentService.js', () => ({
    DEFAULT_ALIGNMENT_PROMPT: 'default alignment'
}))
jest.unstable_mockModule('../services/annotators/srlAnnotationService.js', () => ({
    getAnnotations: jest.fn()
}))
jest.unstable_mockModule('../config/concepts.js', () => ({
    CONCEPT_NAMES: {}, CONCEPT_IDS: {}
}))
jest.unstable_mockModule('../services/scoring/scoreQueryService.js', () => ({
    getConceptPoolSizes: jest.fn(), getUserConceptDataSet: jest.fn()
}))

global.fetch = mockFetch

const adminRoutes = (await import('../routes/admin.js')).default

function makeApp(role = 'admin') {
    const app = express()
    app.use(express.json())
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }))
    app.use((req, _res, next) => { req.session.user = { id: 'admin-1', role }; next() })
    app.use('/admin', adminRoutes)
    return app
}

describe('GET /admin/llm-config', () => {
    it('returns masked config when DB row exists', async () => {
        mockGetLlmConfig.mockResolvedValueOnce({
            provider: 'openai', baseUrl: 'https://api.openai.com/v1',
            mainModel: 'gpt-4o', judgeModel: 'gpt-4o',
            maxTokens: 2000, temperature: 0.7, timeoutMs: 30000,
            apiKey: 'sk-real-key'
        })
        mockQuery.mockResolvedValueOnce({ rows: [{ updated_at: '2026-03-04T00:00:00Z' }] })

        const res = await request(makeApp()).get('/admin/llm-config')
        expect(res.status).toBe(200)
        expect(res.body.provider).toBe('openai')
        expect(res.body.apiKey).toBe('●●●●●●')
    })

    it('returns 403 for non-admin', async () => {
        const res = await request(makeApp('student')).get('/admin/llm-config')
        expect(res.status).toBe(403)
    })
})

describe('PUT /admin/llm-config', () => {
    it('saves new config and returns masked result', async () => {
        mockGetLlmConfig.mockResolvedValueOnce({ apiKey: 'existing-key' })
        mockQuery.mockResolvedValueOnce({
            rows: [{
                provider: 'openai', base_url: 'https://api.openai.com/v1',
                main_model: 'gpt-4o', judge_model: 'gpt-4o',
                max_tokens: 2000, temperature: 0.7, timeout_ms: 30000,
                api_key: 'existing-key', updated_at: '2026-03-04T00:00:00Z'
            }]
        })

        const res = await request(makeApp()).put('/admin/llm-config').send({
            provider: 'openai', baseUrl: 'https://api.openai.com/v1',
            mainModel: 'gpt-4o', judgeModel: 'gpt-4o',
            maxTokens: 2000, temperature: 0.7, timeoutMs: 30000,
            apiKey: '●●●●●●'    // masked → backend preserves existing
        })
        expect(res.status).toBe(200)
        expect(res.body.apiKey).toBe('●●●●●●')
    })

    it('rejects invalid temperature', async () => {
        const res = await request(makeApp()).put('/admin/llm-config').send({
            provider: 'openai', baseUrl: 'https://api.openai.com/v1',
            mainModel: 'gpt-4o', judgeModel: 'gpt-4o',
            maxTokens: 2000, temperature: 5.0, timeoutMs: 30000, apiKey: ''
        })
        expect(res.status).toBe(400)
    })
})

describe('POST /admin/llm-config/test', () => {
    it('returns success when LLM responds with model list', async () => {
        mockGetLlmConfig.mockResolvedValueOnce({ apiKey: 'existing' })
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })
        })

        const res = await request(makeApp()).post('/admin/llm-config/test').send({
            provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '●●●●●●'
        })
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.models).toContain('gpt-4o')
    })

    it('returns failure when fetch throws', async () => {
        mockGetLlmConfig.mockResolvedValueOnce({ apiKey: 'existing' })
        mockFetch.mockRejectedValueOnce(new Error('connection refused'))

        const res = await request(makeApp()).post('/admin/llm-config/test').send({
            provider: 'lmstudio', baseUrl: 'http://localhost:1234', apiKey: ''
        })
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(false)
        expect(res.body.error).toMatch(/connection refused/)
    })
})
```

**Step 2: Run to confirm failure**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest tests/adminLlmConfig.test.js --no-coverage
```

Expected: FAIL — routes don't exist yet

**Step 3: Add the three routes to `admin.js`**

Add this import near the top of `admin.js` (after existing imports):

```js
import { getLlmConfig } from '../services/llmConfigService.js'
```

Add a validation helper and the three routes **before** the legacy aliases block at the bottom:

```js
// ── LLM Config endpoints ──────────────────────────────────────────

const MASK = '●●●●●●'

function validateLlmConfigBody(body) {
    const { provider, baseUrl, mainModel, judgeModel, maxTokens, temperature, timeoutMs } = body
    if (!provider || typeof provider !== 'string') return 'provider is required'
    if (!baseUrl || typeof baseUrl !== 'string') return 'baseUrl is required'
    if (!mainModel || typeof mainModel !== 'string') return 'mainModel is required'
    if (!judgeModel || typeof judgeModel !== 'string') return 'judgeModel is required'
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32000) return 'maxTokens must be integer 1–32000'
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) return 'temperature must be 0.0–2.0'
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) return 'timeoutMs must be integer 1000–120000'
    return null
}

// Get current LLM config (api_key masked)
router.get('/llm-config', asyncRoute(async (req, res) => {
    const cfg = await getLlmConfig()
    const { rows } = await pool.query(
        'SELECT updated_at FROM public.llm_config ORDER BY updated_at DESC LIMIT 1'
    )
    res.json({
        provider:    cfg.provider,
        baseUrl:     cfg.baseUrl,
        mainModel:   cfg.mainModel,
        judgeModel:  cfg.judgeModel,
        maxTokens:   cfg.maxTokens,
        temperature: cfg.temperature,
        timeoutMs:   cfg.timeoutMs,
        apiKey:      cfg.apiKey ? MASK : '',
        updatedAt:   rows[0]?.updated_at ?? null
    })
}))

// Update LLM config
router.put('/llm-config', asyncRoute(async (req, res) => {
    const { provider, baseUrl, mainModel, judgeModel, maxTokens, temperature, timeoutMs, apiKey } = req.body
    const userId = req.session.user?.id

    const validationError = validateLlmConfigBody(req.body)
    if (validationError) throw Errors.VALIDATION(validationError)

    // If apiKey is the mask placeholder, preserve the existing key
    let resolvedApiKey = apiKey
    if (apiKey === MASK) {
        const current = await getLlmConfig()
        resolvedApiKey = current.apiKey
    }

    const { rows } = await pool.query(
        `INSERT INTO public.llm_config
            (provider, base_url, main_model, judge_model, max_tokens, temperature, timeout_ms, api_key, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING provider, base_url, main_model, judge_model, max_tokens, temperature, timeout_ms, api_key, updated_at`,
        [provider, baseUrl, mainModel, judgeModel, maxTokens, temperature, timeoutMs, resolvedApiKey, userId]
    )

    const row = rows[0]
    logger.info(`LLM config updated by admin ${userId}: provider=${provider}`)
    res.json({
        provider:    row.provider,
        baseUrl:     row.base_url,
        mainModel:   row.main_model,
        judgeModel:  row.judge_model,
        maxTokens:   row.max_tokens,
        temperature: parseFloat(row.temperature),
        timeoutMs:   row.timeout_ms,
        apiKey:      row.api_key ? MASK : '',
        updatedAt:   row.updated_at
    })
}))

// Test LLM config (does NOT save — pings /v1/models with the given config)
router.post('/llm-config/test', asyncRoute(async (req, res) => {
    const { baseUrl, apiKey: submittedKey, provider } = req.body

    if (!baseUrl) throw Errors.VALIDATION('baseUrl is required')

    // Resolve masked key to real key
    let apiKey = submittedKey
    if (submittedKey === MASK) {
        const current = await getLlmConfig()
        apiKey = current.apiKey
    }

    const headers = { 'Content-Type': 'application/json' }
    if (apiKey && provider !== 'lmstudio') {
        headers['Authorization'] = `Bearer ${apiKey}`
    }

    const start = Date.now()
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const response = await fetch(`${baseUrl}/v1/models`, {
            method: 'GET', headers, signal: controller.signal
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
            return res.json({ success: false, models: [], latencyMs: Date.now() - start, error: `HTTP ${response.status}` })
        }

        const data = await response.json()
        const models = data.data?.map(m => m.id) || []
        res.json({ success: true, models, latencyMs: Date.now() - start })
    } catch (err) {
        res.json({ success: false, models: [], latencyMs: Date.now() - start, error: err.message })
    }
}))
```

**Step 4: Run tests — confirm pass**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest tests/adminLlmConfig.test.js --no-coverage
```

Expected: all tests PASS

**Step 5: Run full suite**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```

Expected: all tests PASS

**Step 6: Commit**

```bash
git add backend/routes/admin.js backend/tests/adminLlmConfig.test.js
git commit -m "feat: add admin GET/PUT/test endpoints for LLM config"
```

---

### Task 6: Frontend API module — `src/api/llmConfig.ts`

**Files:**
- Create: `src/api/llmConfig.ts`

**Step 1: Create the module**

```typescript
// src/api/llmConfig.ts
import { api } from './client'

export interface LlmConfig {
    provider: string
    baseUrl: string
    mainModel: string
    judgeModel: string
    maxTokens: number
    temperature: number
    timeoutMs: number
    apiKey: string          // "●●●●●●" if set, "" if not
    updatedAt: string | null
}

export interface LlmTestResult {
    success: boolean
    models: string[]
    latencyMs: number
    error?: string
}

export const fetchLlmConfig = () =>
    api.get<LlmConfig>('/admin/llm-config')

export const saveLlmConfig = (cfg: Partial<LlmConfig>) =>
    api.put<LlmConfig>('/admin/llm-config', cfg)

export const testLlmConfig = (cfg: Partial<LlmConfig>) =>
    api.post<LlmTestResult>('/admin/llm-config/test', cfg)
```

**Step 2: Type-check**

```bash
cd /path/to/project && npx tsc --noEmit
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/api/llmConfig.ts
git commit -m "feat: add llmConfig API module"
```

---

### Task 7: Extend Redux `src/redux/admin.ts`

**Files:**
- Modify: `src/redux/admin.ts`

**Step 1: Add types and initial state**

At the top of the file, add imports:

```typescript
import { fetchLlmConfig as apiFetchLlmConfig, saveLlmConfig as apiSaveLlmConfig, testLlmConfig as apiTestLlmConfig } from '../api/llmConfig'
import type { LlmConfig, LlmTestResult } from '../api/llmConfig'
```

Extend `AdminState`:

```typescript
interface AdminState {
    // ... existing fields ...
    llmConfig: LlmConfig | null
    llmConfigStatus: 'idle' | 'loading' | 'succeeded' | 'failed'
    llmTestResult: LlmTestResult | null
    llmTestStatus: 'idle' | 'loading' | 'succeeded' | 'failed'
}
```

Extend `initialState`:

```typescript
const initialState: AdminState = {
    // ... existing fields ...
    llmConfig: null,
    llmConfigStatus: 'idle',
    llmTestResult: null,
    llmTestStatus: 'idle'
}
```

**Step 2: Add async thunks** (after the existing thunks, before the slice):

```typescript
export const fetchLlmConfig = createAsyncThunk('admin/fetchLlmConfig', async () => {
    const data = await apiFetchLlmConfig()
    return data
})

export const updateLlmConfig = createAsyncThunk(
    'admin/updateLlmConfig',
    async (cfg: Partial<LlmConfig>) => {
        const data = await apiSaveLlmConfig(cfg)
        return data
    }
)

export const testLlmConfigThunk = createAsyncThunk(
    'admin/testLlmConfig',
    async (cfg: Partial<LlmConfig>) => {
        const data = await apiTestLlmConfig(cfg)
        return data
    }
)
```

**Step 3: Add extra reducers** (inside `extraReducers` builder, after existing cases):

```typescript
// Fetch LLM config
.addCase(fetchLlmConfig.pending, (state) => { state.llmConfigStatus = 'loading' })
.addCase(fetchLlmConfig.fulfilled, (state, action) => {
    state.llmConfigStatus = 'succeeded'
    state.llmConfig = action.payload
})
.addCase(fetchLlmConfig.rejected, (state) => { state.llmConfigStatus = 'failed' })

// Update LLM config
.addCase(updateLlmConfig.pending, (state) => { state.llmConfigStatus = 'loading' })
.addCase(updateLlmConfig.fulfilled, (state, action) => {
    state.llmConfigStatus = 'succeeded'
    state.llmConfig = action.payload
})
.addCase(updateLlmConfig.rejected, (state) => { state.llmConfigStatus = 'failed' })

// Test LLM config
.addCase(testLlmConfigThunk.pending, (state) => {
    state.llmTestStatus = 'loading'
    state.llmTestResult = null
})
.addCase(testLlmConfigThunk.fulfilled, (state, action) => {
    state.llmTestStatus = 'succeeded'
    state.llmTestResult = action.payload
})
.addCase(testLlmConfigThunk.rejected, (state) => { state.llmTestStatus = 'failed' })
```

**Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

**Step 5: Commit**

```bash
git add src/redux/admin.ts
git commit -m "feat: extend admin Redux slice with LLM config state and thunks"
```

---

### Task 8: `AdminLlmConfigPanel.tsx` component

**Files:**
- Create: `src/components/AdminLlmConfigPanel.tsx`

**Step 1: Create the component**

```tsx
// src/components/AdminLlmConfigPanel.tsx
import React, { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../redux/store'
import {
    fetchLlmConfig,
    updateLlmConfig,
    testLlmConfigThunk
} from '../redux/admin'
import type { LlmConfig } from '../api/llmConfig'

const MASK = '●●●●●●'
const PROVIDERS = ['lmstudio', 'openai', 'groq', 'other']

const AdminLlmConfigPanel: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>()
    const { llmConfig, llmConfigStatus, llmTestResult, llmTestStatus } = useSelector(
        (state: RootState) => state.admin
    )

    const [open, setOpen] = useState(false)
    const [form, setForm] = useState<Partial<LlmConfig>>({})
    const [showKey, setShowKey] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)

    useEffect(() => { dispatch(fetchLlmConfig()) }, [dispatch])

    useEffect(() => {
        if (llmConfig) setForm(llmConfig)
    }, [llmConfig])

    const set = (field: keyof LlmConfig, value: unknown) =>
        setForm(prev => ({ ...prev, [field]: value }))

    const handleTest = () => {
        setSaveMsg(null)
        dispatch(testLlmConfigThunk(form))
    }

    const handleSave = async () => {
        setSaveMsg(null)
        const result = await dispatch(updateLlmConfig(form))
        if (updateLlmConfig.fulfilled.match(result)) {
            setSaveMsg('Configuration saved.')
        } else {
            setSaveMsg('Save failed. Check the values and try again.')
        }
    }

    const panelStyle: React.CSSProperties = {
        background: '#1a1a2e', border: '1px solid #333', borderRadius: 8,
        marginBottom: 16, overflow: 'hidden'
    }
    const headerStyle: React.CSSProperties = {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
        background: '#16213e', color: '#e0e0e0'
    }
    const bodyStyle: React.CSSProperties = {
        padding: '16px', display: 'grid', gap: 12, color: '#ccc'
    }
    const inputStyle: React.CSSProperties = {
        background: '#0f0f23', border: '1px solid #444', borderRadius: 4,
        color: '#e0e0e0', padding: '6px 10px', width: '100%', boxSizing: 'border-box'
    }
    const labelStyle: React.CSSProperties = { fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }
    const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }
    const btnStyle = (color: string): React.CSSProperties => ({
        background: color, color: '#fff', border: 'none', borderRadius: 4,
        padding: '8px 16px', cursor: 'pointer', fontWeight: 600
    })

    return (
        <div style={panelStyle}>
            <div style={headerStyle} onClick={() => setOpen(o => !o)}>
                <span>{open ? '▼' : '▶'} LLM API Configuration</span>
                {llmConfig?.updatedAt && (
                    <span style={{ fontSize: 11, color: '#888' }}>
                        last updated: {new Date(llmConfig.updatedAt).toLocaleString()}
                    </span>
                )}
            </div>

            {open && (
                <div style={bodyStyle}>
                    {/* Provider */}
                    <div>
                        <label style={labelStyle}>Provider</label>
                        <select value={form.provider || ''} onChange={e => set('provider', e.target.value)}
                            style={{ ...inputStyle }}>
                            {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>

                    {/* Base URL */}
                    <div>
                        <label style={labelStyle}>Base URL</label>
                        <input style={inputStyle} value={form.baseUrl || ''}
                            onChange={e => set('baseUrl', e.target.value)} />
                    </div>

                    {/* Models */}
                    <div style={rowStyle}>
                        <div>
                            <label style={labelStyle}>Main Model</label>
                            <input style={inputStyle} value={form.mainModel || ''}
                                onChange={e => set('mainModel', e.target.value)} />
                        </div>
                        <div>
                            <label style={labelStyle}>Judge Model</label>
                            <input style={inputStyle} value={form.judgeModel || ''}
                                onChange={e => set('judgeModel', e.target.value)} />
                        </div>
                    </div>

                    {/* API Key */}
                    <div>
                        <label style={labelStyle}>API Key</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input style={{ ...inputStyle, flex: 1 }}
                                type={showKey ? 'text' : 'password'}
                                value={form.apiKey || ''}
                                onChange={e => set('apiKey', e.target.value)} />
                            <button style={{ ...btnStyle('#333'), padding: '6px 12px' }}
                                onClick={() => setShowKey(s => !s)}>
                                {showKey ? 'Hide' : 'Show'}
                            </button>
                        </div>
                    </div>

                    {/* Tuning params */}
                    <div style={rowStyle}>
                        <div>
                            <label style={labelStyle}>Max Tokens</label>
                            <input style={inputStyle} type="number"
                                value={form.maxTokens ?? ''}
                                onChange={e => set('maxTokens', parseInt(e.target.value, 10))} />
                        </div>
                        <div>
                            <label style={labelStyle}>Temperature</label>
                            <input style={inputStyle} type="number" step="0.1" min="0" max="2"
                                value={form.temperature ?? ''}
                                onChange={e => set('temperature', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label style={labelStyle}>Timeout (ms)</label>
                            <input style={inputStyle} type="number"
                                value={form.timeoutMs ?? ''}
                                onChange={e => set('timeoutMs', parseInt(e.target.value, 10))} />
                        </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button style={btnStyle('#2d5a8e')} onClick={handleTest}
                            disabled={llmTestStatus === 'loading'}>
                            {llmTestStatus === 'loading' ? 'Testing…' : 'Test Connection'}
                        </button>
                        <button style={btnStyle('#2e7d32')} onClick={handleSave}
                            disabled={llmConfigStatus === 'loading'}>
                            {llmConfigStatus === 'loading' ? 'Saving…' : 'Save Configuration'}
                        </button>

                        {llmTestResult && (
                            <span style={{ color: llmTestResult.success ? '#66bb6a' : '#ef5350', fontSize: 13 }}>
                                {llmTestResult.success
                                    ? `✓ Connected — ${llmTestResult.models.length} models (${llmTestResult.latencyMs}ms)`
                                    : `✗ Failed — ${llmTestResult.error}`}
                            </span>
                        )}
                        {saveMsg && (
                            <span style={{ color: saveMsg.includes('failed') ? '#ef5350' : '#66bb6a', fontSize: 13 }}>
                                {saveMsg}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default AdminLlmConfigPanel
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/components/AdminLlmConfigPanel.tsx
git commit -m "feat: add AdminLlmConfigPanel component"
```

---

### Task 9: Wire into `Home.tsx`

**Files:**
- Modify: `src/pages/Home.tsx`

**Step 1: Add the import** (near the other AdminX imports):

```typescript
import AdminLlmConfigPanel from '../components/AdminLlmConfigPanel'
```

**Step 2: Add the panel** in the admin section of the JSX, alongside the other admin panels:

```tsx
<AdminLlmConfigPanel />
```

Place it after `<AdminCsvLogPanel />` and before the Danger Zone section.

**Step 3: Type-check and visual check**

```bash
npx tsc --noEmit
npm start   # verify panel appears in admin dashboard, collapses/expands
```

**Step 4: Run full backend test suite one last time**

```bash
cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage
```

Expected: all tests PASS

**Step 5: Final commit**

```bash
git add src/pages/Home.tsx
git commit -m "feat: add AdminLlmConfigPanel to admin dashboard"
```

---

## Summary of all changed files

| File | Change |
|------|--------|
| `backend/migrations/1650000000018_llm_config.sql` | New — DB table |
| `backend/services/llmConfigService.js` | New — DB-first config |
| `backend/tests/llmConfigService.test.js` | New — 3 tests |
| `backend/services/apiConnectorService.js` | Modified — dynamic config |
| `backend/services/alignmentService.js` | Modified — async getLlmConfig |
| `backend/routes/admin.js` | Modified — 3 new endpoints |
| `backend/tests/adminLlmConfig.test.js` | New — 5 tests |
| `src/api/llmConfig.ts` | New — typed API module |
| `src/redux/admin.ts` | Modified — llmConfig state + thunks |
| `src/components/AdminLlmConfigPanel.tsx` | New — panel component |
| `src/pages/Home.tsx` | Modified — mount panel |
