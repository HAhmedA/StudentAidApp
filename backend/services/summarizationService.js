// Summarization Service
// Generates rolling 10-day summaries of past conversations (long-term memory)
// Uses LLM to create smart 2-bullet summaries per day

import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { chatCompletion } from './apiConnectorService.js'

// Configuration
const SUMMARY_WINDOW_DAYS = 10
const BULLETS_PER_DAY = 2

/**
 * Get messages for a specific date for a user
 * 
 * @param {string} userId - User ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<Array>} - Messages from that date
 */
async function getMessagesForDate(userId, date) {
    const { rows } = await pool.query(
        `SELECT role, content, created_at 
         FROM public.chat_messages 
         WHERE user_id = $1 
           AND DATE(created_at) = $2
         ORDER BY created_at ASC`,
        [userId, date]
    )
    return rows
}

/**
 * Generate a summary for a single day's messages using LLM
 * 
 * @param {Array} messages - Messages from the day
 * @param {string} date - Date string for context
 * @returns {Promise<string>} - 2-bullet summary
 */
async function generateDaySummary(messages, date) {
    if (!messages || messages.length === 0) {
        return null
    }

    // Format messages for the LLM
    const conversation = messages.map(m =>
        `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content}`
    ).join('\n')

    const prompt = `Summarize the following conversation from ${date} in exactly ${BULLETS_PER_DAY} bullet points. 
Focus on the main topics discussed and any key insights or recommendations given.
Keep each bullet point concise (under 20 words).

CONVERSATION:
${conversation}

SUMMARY (exactly ${BULLETS_PER_DAY} bullet points):
-`

    try {
        const response = await chatCompletion([
            { role: 'user', content: prompt }
        ], {
            maxTokens: 150,
            temperature: 0.3 // Low temperature for consistent summaries
        })

        // Ensure response starts with bullet point
        const summary = response.startsWith('-') ? response : `- ${response}`
        return summary.trim()
    } catch (error) {
        logger.error(`Failed to generate summary for ${date}:`, error.message)
        // Return a simple fallback summary
        const msgCount = messages.length
        return `- Had ${msgCount} message${msgCount !== 1 ? 's' : ''} in conversation on ${date}`
    }
}

/**
 * Get or create a summary for a specific date
 * Uses caching - only generates if not already in database
 * 
 * @param {string} userId - User ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<string|null>} - Summary text or null if no messages
 */
async function getDailySummary(userId, date) {
    // Check cache first
    const { rows: cached } = await pool.query(
        `SELECT summary_text FROM public.chat_summaries 
         WHERE user_id = $1 AND summary_date = $2`,
        [userId, date]
    )

    if (cached.length > 0) {
        return cached[0].summary_text
    }

    // Get messages for this date
    const messages = await getMessagesForDate(userId, date)

    if (messages.length === 0) {
        return null
    }

    // Generate summary
    const summaryText = await generateDaySummary(messages, date)

    if (summaryText) {
        // Cache the summary
        await pool.query(
            `INSERT INTO public.chat_summaries (user_id, summary_date, summary_text, message_count)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, summary_date) 
             DO UPDATE SET summary_text = EXCLUDED.summary_text, 
                           message_count = EXCLUDED.message_count,
                           updated_at = NOW()`,
            [userId, date, summaryText, messages.length]
        )
    }

    return summaryText
}

/**
 * Get all summaries for the last 10 days for a user
 * This is the main function used by the Prompt Assembler
 * 
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Formatted summary text for LLM context
 */
async function getSummariesForChatbot(userId) {
    const summaries = []
    const today = new Date()

    // Check if user has any messages in the last 10 days
    const { rows: recentCheck } = await pool.query(
        `SELECT COUNT(*) as count FROM public.chat_messages
         WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2`,
        [userId, SUMMARY_WINDOW_DAYS]
    )

    if (parseInt(recentCheck[0].count) === 0) {
        return 'No chats in the last 10 days.'
    }

    // Optimization #6: Fetch all day summaries in parallel (batched to limit concurrency)
    // Batches of 3 prevent overwhelming the LLM API on cache misses
    const BATCH_SIZE = 3
    const dates = []
    for (let i = 1; i <= SUMMARY_WINDOW_DAYS; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        dates.push(date.toISOString().split('T')[0])
    }

    for (let b = 0; b < dates.length; b += BATCH_SIZE) {
        const batch = dates.slice(b, b + BATCH_SIZE)
        const results = await Promise.all(
            batch.map(dateStr => getDailySummary(userId, dateStr))
        )
        for (let j = 0; j < results.length; j++) {
            if (results[j]) {
                summaries.push(`[${batch[j]}]\n${results[j]}`)
            }
        }
    }

    if (summaries.length === 0) {
        return 'No chats in the last 10 days.'
    }

    return summaries.join('\n\n')
}

/**
 * Invalidate (delete) summary for a specific date
 * Called when new messages are added to a day that already has a summary
 * 
 * @param {string} userId - User ID
 * @param {string} date - Date in YYYY-MM-DD format
 */
async function invalidateSummary(userId, date) {
    await pool.query(
        `DELETE FROM public.chat_summaries 
         WHERE user_id = $1 AND summary_date = $2`,
        [userId, date]
    )
    logger.info(`Invalidated summary for user ${userId} on ${date}`)
}

/**
 * Check if user has any chat history
 * 
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
async function hasHistory(userId) {
    const { rows } = await pool.query(
        `SELECT EXISTS(SELECT 1 FROM public.chat_messages WHERE user_id = $1) as has_history`,
        [userId]
    )
    return rows[0].has_history
}

export {
    getSummariesForChatbot,
    getDailySummary,
    generateDaySummary,
    invalidateSummary,
    hasHistory,
    SUMMARY_WINDOW_DAYS
}
