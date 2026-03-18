// Chatbot Preferences Service
// Manages per-user persona settings (response_length, tone, answer_style)
// and data-version tracking for stale-greeting detection.

import pool from '../config/database.js'
import logger from '../utils/logger.js'

const VALID_LENGTHS = ['short', 'medium', 'long']
const VALID_TONES = ['friendly', 'formal', 'motivational', 'neutral']
const VALID_STYLES = ['bullets', 'prose', 'mixed']

const DEFAULT_PREFS = {
    response_length: 'medium',
    tone: 'friendly',
    answer_style: 'mixed'
}

// =============================================================================
// READ
// =============================================================================

/**
 * Returns preferences for a user. Inserts defaults if no row exists yet.
 */
export async function getPreferences(userId) {
    const { rows } = await pool.query(
        `INSERT INTO public.chatbot_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET updated_at = chatbot_preferences.updated_at
         RETURNING response_length, tone, answer_style, data_last_updated_at`,
        [userId]
    )
    return rows[0]
}

// =============================================================================
// WRITE
// =============================================================================

/**
 * Validates and upserts persona settings. Throws on invalid enum values.
 */
export async function upsertPreferences(userId, prefs) {
    const { response_length, tone, answer_style } = prefs

    if (response_length !== undefined && !VALID_LENGTHS.includes(response_length)) {
        throw new Error(`Invalid response_length: ${response_length}`)
    }
    if (tone !== undefined && !VALID_TONES.includes(tone)) {
        throw new Error(`Invalid tone: ${tone}`)
    }
    if (answer_style !== undefined && !VALID_STYLES.includes(answer_style)) {
        throw new Error(`Invalid answer_style: ${answer_style}`)
    }

    // Pass null for absent fields so COALESCE preserves the existing DB value on UPDATE,
    // and falls back to the column default on INSERT (new row).
    const rl = response_length ?? null
    const t  = tone ?? null
    const as = answer_style ?? null

    const { rows } = await pool.query(
        `INSERT INTO public.chatbot_preferences (user_id, response_length, tone, answer_style)
         VALUES ($1,
                 COALESCE($2::varchar, 'medium'),
                 COALESCE($3::varchar, 'friendly'),
                 COALESCE($4::varchar, 'mixed'))
         ON CONFLICT (user_id) DO UPDATE
           SET response_length = COALESCE($2::varchar, chatbot_preferences.response_length),
               tone            = COALESCE($3::varchar, chatbot_preferences.tone),
               answer_style    = COALESCE($4::varchar, chatbot_preferences.answer_style),
               updated_at      = NOW()
         RETURNING response_length, tone, answer_style, data_last_updated_at`,
        [userId, rl, t, as]
    )
    return rows[0]
}

/**
 * Bumps data_last_updated_at to NOW(). Fire-and-forget safe.
 * Upserts so it works even when no preferences row exists yet.
 */
export async function updateDataVersion(userId) {
    try {
        await pool.query(
            `INSERT INTO public.chatbot_preferences (user_id, data_last_updated_at, updated_at)
             VALUES ($1, NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE
               SET data_last_updated_at = NOW(),
                   updated_at           = NOW()`,
            [userId]
        )
    } catch (err) {
        logger.warn('updateDataVersion failed for user %s: %s', userId, err.message)
    }
}

// =============================================================================
// STALENESS CHECK
// =============================================================================

/**
 * Returns true if data_last_updated_at > greeting_generated_at for the session.
 * Returns false when either timestamp is NULL (no data submitted yet, or no
 * cached greeting yet — in both cases the greeting is not stale in a harmful way).
 */
export async function isGreetingStale(sessionId) {
    const { rows } = await pool.query(
        `SELECT cs.greeting_generated_at, cp.data_last_updated_at, cp.updated_at AS prefs_updated_at
         FROM public.chat_sessions cs
         LEFT JOIN public.chatbot_preferences cp ON cp.user_id = cs.user_id
         WHERE cs.id = $1`,
        [sessionId]
    )

    if (rows.length === 0) return false

    const { greeting_generated_at, data_last_updated_at, prefs_updated_at } = rows[0]

    if (!greeting_generated_at) return false

    // Stale if data was updated OR persona preferences (tone/style/length) changed
    // after the greeting was generated
    if (data_last_updated_at && data_last_updated_at > greeting_generated_at) return true
    if (prefs_updated_at && prefs_updated_at > greeting_generated_at) return true

    return false
}
