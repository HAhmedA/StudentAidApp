// Input Guard Service
// Pre-LLM defense against prompt injection using weighted multi-signal scoring.
// Catches obvious attacks cheaply before they consume LLM tokens.
// Subtle attacks are handled downstream by the alignment judge.

import logger from '../utils/logger.js'

// Cyrillic/Greek lookalikes → Latin equivalents
const HOMOGLYPH_MAP = {
    '\u0410': 'A', '\u0412': 'B', '\u0421': 'C', '\u0415': 'E', '\u041D': 'H',
    '\u041A': 'K', '\u041C': 'M', '\u041E': 'O', '\u0420': 'P', '\u0422': 'T',
    '\u0425': 'X', '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p',
    '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0458': 'j',
    '\u0455': 's', '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0397': 'H',
    '\u0399': 'I', '\u039A': 'K', '\u039C': 'M', '\u039D': 'N', '\u039F': 'O',
    '\u03A1': 'P', '\u03A4': 'T', '\u03A7': 'X', '\u03B1': 'a', '\u03BF': 'o',
    '\u03C1': 'p', '\u03C4': 't',
}

const SIGNAL_CATEGORIES = [
    {
        name: 'role_injection',
        weight: 0.4,
        patterns: [
            /^system\s*:/im,
            /^assistant\s*:/im,
            /\[INST\]/i,
            /<\|im_start\|>/i,
            /<\|im_end\|>/i,
            /<<\s*SYS\s*>>/i,
        ]
    },
    {
        name: 'instruction_override',
        weight: 0.35,
        patterns: [
            /ignore\s+(all\s+)?(your\s+)?(previous|prior|above)?\s*(instructions|rules|prompts|guidelines|directives)/i,
            /disregard\s+(all\s+)?(your\s+)?(previous|prior|above)?\s*(instructions|rules|prompts|guidelines)/i,
            /you\s+are\s+now\s+a\b/i,
            /new\s+instructions?\s*:/i,
            /override\s+(your|all|the)\s+(instructions|rules|prompts)/i,
            /forget\s+(all\s+)?(your|previous|prior)\s+(instructions|rules|prompts)/i,
        ]
    },
    {
        name: 'prompt_extraction',
        weight: 0.3,
        patterns: [
            /repeat\s+(your\s+)?(system\s+prompt|initial\s+instructions|original\s+instructions)/i,
            /show\s+(me\s+)?(your\s+)?(system\s+prompt|instructions|hidden\s+prompt)/i,
            /what\s+(are|is)\s+your\s+(system\s+prompt|initial\s+instructions|hidden\s+instructions)/i,
            /output\s+(your\s+)?(system\s+prompt|instructions|prompt)\s*(verbatim|exactly)/i,
            /print\s+(your\s+)?(system\s+prompt|instructions)/i,
        ]
    },
    {
        name: 'delimiter_attack',
        weight: 0.35,
        patterns: [
            /<\/system>/i,
            /<instruction>/i,
            /<\/instruction>/i,
            /---\s*system/i,
            /###\s*system\s*prompt/i,
            /(<[a-z]+>.*?<\/[a-z]+>\s*){5,}/is,  // 5+ XML-like tags
        ]
    },
    {
        name: 'encoding_evasion',
        weight: 0.4,
        // Patterns are checked dynamically in scoreSignals for this category
        patterns: []
    },
]

const BLOCK_THRESHOLD = 0.65
const WARN_THRESHOLD = 0.35

// Zero-width characters to strip
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u2060\uFEFF]/g

/**
 * Normalize input text: strip zero-width chars, map homoglyphs, collapse whitespace
 * @param {string} text
 * @returns {{ normalized: string, zeroWidthCount: number }}
 */
function normalizeInput(text) {
    const zeroWidthMatches = text.match(ZERO_WIDTH_RE)
    const zeroWidthCount = zeroWidthMatches ? zeroWidthMatches.length : 0

    let normalized = text.replace(ZERO_WIDTH_RE, '')

    // Replace homoglyphs
    normalized = [...normalized].map(ch => HOMOGLYPH_MAP[ch] || ch).join('')

    // Collapse whitespace (but preserve newlines for ^ anchors)
    normalized = normalized.replace(/[^\S\n]+/g, ' ')

    return { normalized, zeroWidthCount }
}

/**
 * Check if a string looks like a base64-encoded injection
 * @param {string} text
 * @returns {boolean}
 */
function hasBase64Injection(text) {
    // Look for base64 strings longer than 50 chars
    const b64Match = text.match(/[A-Za-z0-9+/]{50,}={0,2}/g)
    if (!b64Match) return false

    for (const candidate of b64Match) {
        try {
            const decoded = Buffer.from(candidate, 'base64').toString('utf-8')
            // Check if decoded text contains injection patterns
            if (/ignore\s+(your\s+)?(previous\s+)?instructions/i.test(decoded) ||
                /system\s*prompt/i.test(decoded) ||
                /you\s+are\s+now/i.test(decoded)) {
                return true
            }
        } catch {
            // Not valid base64, skip
        }
    }
    return false
}

/**
 * Run all signal categories against normalized input and return aggregate score
 * @param {string} normalized - The normalized input text
 * @param {number} zeroWidthCount - Number of zero-width chars stripped
 * @returns {{ score: number, flags: string[] }}
 */
function scoreSignals(normalized, zeroWidthCount) {
    let score = 0
    const flags = []

    for (const category of SIGNAL_CATEGORIES) {
        if (category.name === 'encoding_evasion') {
            // Special handling: base64 + zero-width detection
            let matched = false
            if (zeroWidthCount >= 3) {
                matched = true
                flags.push('encoding_evasion:zero_width_chars')
            }
            if (hasBase64Injection(normalized)) {
                matched = true
                flags.push('encoding_evasion:base64_injection')
            }
            if (matched) {
                score += category.weight
            }
            continue
        }

        for (const pattern of category.patterns) {
            if (pattern.test(normalized)) {
                score += category.weight
                flags.push(category.name)
                break // One match per category is enough
            }
        }
    }

    return { score: Math.min(score, 1.0), flags }
}

/**
 * Check if a user message is safe to send to the LLM
 * @param {string} message - Raw user message
 * @returns {{ safe: boolean, score: number, flags: string[], action: string }}
 */
export function checkInputSafety(message) {
    if (!message || typeof message !== 'string') {
        return { safe: true, score: 0, flags: [], action: 'pass' }
    }

    const { normalized, zeroWidthCount } = normalizeInput(message)
    const { score, flags } = scoreSignals(normalized, zeroWidthCount)

    if (score >= BLOCK_THRESHOLD) {
        logger.warn('INPUT_GUARD_BLOCK', { score: score.toFixed(2), flags })
        return { safe: false, score, flags, action: 'block' }
    }

    if (score >= WARN_THRESHOLD) {
        logger.info('INPUT_GUARD_WARN', { score: score.toFixed(2), flags })
        return { safe: true, score, flags, action: 'warn' }
    }

    return { safe: true, score, flags, action: 'pass' }
}

// Export internals for testing
export { normalizeInput, scoreSignals, hasBase64Injection, BLOCK_THRESHOLD, WARN_THRESHOLD }
