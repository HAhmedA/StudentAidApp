// Project Data Export Service
// Builds an anonymized, randomized CSV dataset compiled from a random subset
// of students' SRL + wellbeing responses, padded with synthetic rows when
// needed, rescaled to a unified integer 1..5 scale.
//
// Design notes
// - `pool` is injected so tests can pass a mock without module-level mocking.
// - Real rows keep native DB scales internally (SRL 1..5 decimal, wellbeing
//   0..10 decimal); rescaling to an integer 1..5 happens once, at the final
//   render step, via `toUnifiedScale`.
// - Synthetic rows are generated on native scales too, so the rescale pipeline
//   is symmetrical and one-pass.

// ── Public constants ────────────────────────────────────────────────────────

export const WELLBEING_KEYS = [
    'cheerfulness', 'calmness', 'vitality', 'restedness', 'interest'
]

export const SRL_KEYS = [
    'efficiency', 'importance', 'tracking', 'effort', 'help_seeking',
    'community', 'timeliness', 'motivation', 'anxiety', 'reflection'
]

export const CSV_COLUMNS = [
    'row_id', 'date',
    ...WELLBEING_KEYS,
    ...SRL_KEYS,
]

export const MIN_ROWS = 70

// Profile patterns (mirrored from srlDataSimulator.js, trimmed to what we need)
export const PROFILES = ['high_achiever', 'average', 'low_achiever']

const SRL_RANGES = {
    high_achiever: { base: [4, 5], anxiety: [1, 2], weekendHit: -0.3 },
    average:       { base: [2, 4], anxiety: [2, 4], weekendHit: -0.5 },
    low_achiever:  { base: [1, 3], anxiety: [3, 5], weekendHit: -0.8 },
}

const WELLBEING_RANGES = {
    high_achiever: [6, 9],
    average:       [4, 7],
    low_achiever:  [2, 5],
}

// ── CSV helpers ─────────────────────────────────────────────────────────────

// Matches the escaper in routes/profile.js (duplicated to keep the service
// self-contained; intentionally small).
export function escapeCell(val) {
    if (val === null || val === undefined) return ''
    if (val instanceof Date) return val.toISOString()
    const str = String(val)
    return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str
}

// Linearly rescale `value` from [inMin, inMax] to an integer in [1, 5].
export function toUnifiedScale(value, inMin, inMax) {
    if (value === null || value === undefined) return null
    const n = Number(value)
    if (Number.isNaN(n)) return null
    const t = (n - inMin) / (inMax - inMin)
    const rescaled = 1 + t * 4
    return Math.max(1, Math.min(5, Math.round(rescaled)))
}

// ── Randomness helpers ──────────────────────────────────────────────────────

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function randFloat(min, max) {
    return Math.random() * (max - min) + min
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
}

// Fisher-Yates, returns a new array.
function shuffle(arr) {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

// ── Synthesis ───────────────────────────────────────────────────────────────

function clampDecimal(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value * 10) / 10))
}

function isWeekend(date) {
    const d = date.getDay()
    return d === 0 || d === 6
}

function conceptBiases() {
    const out = {}
    for (const k of SRL_KEYS) {
        out[k] = (Math.random() - 0.5) * 1.6   // -0.8..+0.8
    }
    return out
}

function randomDateInLastDays(days) {
    const today = new Date()
    const d = new Date(today)
    d.setDate(d.getDate() - randInt(0, days))
    return d
}

export function generateSyntheticRow() {
    const profile = pick(PROFILES)
    const srlRange = SRL_RANGES[profile]
    const wbRange = WELLBEING_RANGES[profile]
    const biases = conceptBiases()
    const date = randomDateInLastDays(120)
    const weekend = isWeekend(date)

    const row = {
        date: date.toISOString().slice(0, 10),
        source: 'synthetic',
    }

    // SRL: profile base / anxiety range, bias, weekend dip, noise, clamp.
    for (const key of SRL_KEYS) {
        const isAnxiety = key === 'anxiety'
        const [lo, hi] = isAnxiety ? srlRange.anxiety : srlRange.base
        const mid = (lo + hi) / 2
        const bias = isAnxiety ? -biases[key] : biases[key]
        const weekendEffect = weekend ? srlRange.weekendHit : 0
        const noise = randFloat(-0.5, 0.5)
        row[key] = clampDecimal(mid + bias * 0.8 + weekendEffect + noise, 1.0, 5.0)
    }

    // Wellbeing: profile midpoint + wide jitter, mild weekend dip, clamp.
    const [wbLo, wbHi] = wbRange
    const wbBase = (wbLo + wbHi) / 2
    for (const key of WELLBEING_KEYS) {
        const noise = randFloat(-1.5, 1.5)
        const weekendEffect = weekend ? -0.4 : 0
        row[key] = clampDecimal(wbBase + noise + weekendEffect, 0.0, 10.0)
    }

    return row
}

// ── Sampling ────────────────────────────────────────────────────────────────

// Raw SQL that pivots SRL into one row per submission and joins wellbeing.
// `HAVING COUNT(sr.concept_key) = 10` ensures complete SRL; the wb NOT NULL
// guard ensures complete wellbeing. Includes both real and simulated rows
// (the output is fully anonymized).
const FETCH_SQL = `
    SELECT qr.id AS questionnaire_id,
           qr.user_id,
           qr.created_at::date AS submitted_date,
           wb.cheerfulness, wb.calmness, wb.vitality, wb.restedness, wb.interest,
           MAX(CASE WHEN sr.concept_key = 'efficiency'   THEN sr.score END) AS efficiency,
           MAX(CASE WHEN sr.concept_key = 'importance'   THEN sr.score END) AS importance,
           MAX(CASE WHEN sr.concept_key = 'tracking'     THEN sr.score END) AS tracking,
           MAX(CASE WHEN sr.concept_key = 'effort'       THEN sr.score END) AS effort,
           MAX(CASE WHEN sr.concept_key = 'help_seeking' THEN sr.score END) AS help_seeking,
           MAX(CASE WHEN sr.concept_key = 'community'    THEN sr.score END) AS community,
           MAX(CASE WHEN sr.concept_key = 'timeliness'   THEN sr.score END) AS timeliness,
           MAX(CASE WHEN sr.concept_key = 'motivation'   THEN sr.score END) AS motivation,
           MAX(CASE WHEN sr.concept_key = 'anxiety'      THEN sr.score END) AS anxiety,
           MAX(CASE WHEN sr.concept_key = 'reflection'   THEN sr.score END) AS reflection
      FROM public.questionnaire_results qr
      LEFT JOIN public.wellbeing_responses wb ON wb.questionnaire_id = qr.id
      LEFT JOIN public.srl_responses      sr ON sr.questionnaire_id = qr.id
     WHERE qr.created_at IS NOT NULL
     GROUP BY qr.id, qr.user_id, qr.created_at,
              wb.cheerfulness, wb.calmness, wb.vitality, wb.restedness, wb.interest
    HAVING wb.cheerfulness IS NOT NULL
       AND COUNT(sr.concept_key) = 10
`

function groupByUser(rows) {
    const groups = new Map()
    for (const r of rows) {
        if (!groups.has(r.user_id)) groups.set(r.user_id, [])
        groups.get(r.user_id).push(r)
    }
    return groups
}

function sampleRealRows(allRows) {
    if (allRows.length === 0) return []
    const groups = groupByUser(allRows)
    const users = [...groups.keys()]
    if (users.length === 0) return []

    // Pick 50-90% of students.
    const minPick = Math.ceil(users.length * 0.5)
    const maxPick = Math.ceil(users.length * 0.9)
    const targetCount = randInt(minPick, Math.max(minPick, maxPick))
    const picked = shuffle(users).slice(0, targetCount)

    const sampled = []
    for (const uid of picked) {
        const subs = groups.get(uid)
        const frac = randFloat(0.4, 0.7)
        const n = Math.max(1, Math.round(frac * subs.length))
        const chosen = shuffle(subs).slice(0, n)
        for (const s of chosen) sampled.push(s)
    }
    return sampled
}

// ── Render ──────────────────────────────────────────────────────────────────

function normalizeRealRow(row) {
    // Drop user_id, keep source='real', rename submitted_date to date (string).
    const out = {
        date: row.submitted_date instanceof Date
            ? row.submitted_date.toISOString().slice(0, 10)
            : String(row.submitted_date),
        source: 'real',
    }
    for (const k of WELLBEING_KEYS) out[k] = row[k]
    for (const k of SRL_KEYS) out[k] = row[k]
    return out
}

function renderCsv(rows) {
    const lines = [CSV_COLUMNS.join(',')]
    rows.forEach((r, i) => {
        const rescaled = {
            row_id: i + 1,
            date: r.date,
        }
        for (const k of WELLBEING_KEYS) {
            rescaled[k] = toUnifiedScale(r[k], 0, 10)
        }
        for (const k of SRL_KEYS) {
            rescaled[k] = toUnifiedScale(r[k], 1, 5)
        }
        lines.push(CSV_COLUMNS.map(c => escapeCell(rescaled[c])).join(','))
    })
    return lines.join('\n')
}

// ── Public entry point ──────────────────────────────────────────────────────

export async function buildProjectDataCsv(pool) {
    const { rows } = await pool.query(FETCH_SQL)
    const sampled = sampleRealRows(rows).map(normalizeRealRow)

    let combined = sampled
    if (combined.length < MIN_ROWS) {
        const needed = MIN_ROWS - combined.length
        const synthetic = []
        for (let i = 0; i < needed; i++) synthetic.push(generateSyntheticRow())
        combined = combined.concat(synthetic)
    }

    // Shuffle first so same-date rows appear in a random relative order per
    // download, then stable-sort by date ascending (V8 sort is stable).
    const sorted = shuffle(combined).sort((a, b) => a.date.localeCompare(b.date))
    return renderCsv(sorted)
}
