// Prompt Assembler Service
// Combines all data sources into a single system prompt for LLM
// Since API calls are stateless, we include all context every time

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { getAnnotationsForChatbot } from './annotationService.js'
import { getSummariesForChatbot, hasHistory } from './summarizationService.js'
import { estimateTokens } from './apiConnectorService.js'

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Paths to prompt files
const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system_prompt.txt')
const ALIGNMENT_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'alignment_prompt.txt')

// Maximum token budget for context (leaving room for response)
const MAX_CONTEXT_TOKENS = 6000
const MAX_SESSION_MESSAGES = 20

/**
 * Seed a prompt from file if it doesn't exist in DB
 * 
 * @param {string} promptType - 'system' or 'alignment'
 * @param {string} filePath - Path to the prompt file
 */
async function seedPromptIfMissing(promptType, filePath) {
    // Check if this type of prompt exists
    const { rows } = await pool.query(
        `SELECT id FROM public.system_prompts WHERE prompt_type = $1 LIMIT 1`,
        [promptType]
    )

    if (rows.length === 0) {
        // Prompt doesn't exist - seed from file
        try {
            const filePrompt = fs.readFileSync(filePath, 'utf-8')
            await pool.query(
                `INSERT INTO public.system_prompts (prompt, prompt_type, updated_at) VALUES ($1, $2, NOW())`,
                [filePrompt, promptType]
            )
            logger.info(`${promptType} prompt seeded from file to database`)
        } catch (err) {
            logger.warn(`Could not seed ${promptType} prompt from file: ${err.message}`)
        }
    } else {
        logger.info(`${promptType} prompt already exists in database`)
    }
}

/**
 * Initialize prompts - seeds database from files if empty
 * Call this once at server startup
 */
async function initializeSystemPrompt() {
    try {
        await seedPromptIfMissing('system', SYSTEM_PROMPT_PATH)
        await seedPromptIfMissing('alignment', ALIGNMENT_PROMPT_PATH)
    } catch (err) {
        logger.error(`Failed to initialize prompts: ${err.message}`)
    }
}

/**
 * Get the current system prompt from database
 * 
 * @returns {Promise<string>} - System prompt text
 */
async function getSystemPrompt() {
    const { rows } = await pool.query(
        `SELECT prompt FROM public.system_prompts 
         ORDER BY updated_at DESC LIMIT 1`
    )
    return rows.length > 0 ? rows[0].prompt : 'Be helpful and ethical.'
}

/**
 * Get user context from their profile
 * 
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Formatted user context
 */
async function getUserContext(userId) {
    const { rows } = await pool.query(
        `SELECT u.name, sp.edu_level, sp.field_of_study, sp.major, sp.learning_formats, sp.disabilities
         FROM public.users u
         LEFT JOIN public.student_profiles sp ON u.id = sp.user_id
         WHERE u.id = $1`,
        [userId]
    )

    if (rows.length === 0) {
        return 'No profile information provided.'
    }

    const profile = rows[0]
    const parts = []

    if (profile.name) {
        parts.push(`- Student name: ${profile.name}`)
    }

    if (profile.edu_level) {
        parts.push(`- Education level: ${profile.edu_level}`)
    }
    if (profile.field_of_study) {
        parts.push(`- Field of study: ${profile.field_of_study}`)
    }
    if (profile.major) {
        parts.push(`- Major: ${profile.major}`)
    }
    if (profile.learning_formats && profile.learning_formats.length > 0) {
        const formats = Array.isArray(profile.learning_formats)
            ? profile.learning_formats
            : JSON.parse(profile.learning_formats)
        if (formats.length > 0) {
            parts.push(`- Learning preferences: ${formats.join(', ')}`)
        }
    }
    if (profile.disabilities && profile.disabilities.length > 0) {
        const disabilities = Array.isArray(profile.disabilities)
            ? profile.disabilities
            : JSON.parse(profile.disabilities)
        if (disabilities.length > 0) {
            parts.push(`- Accessibility considerations: ${disabilities.join(', ')}`)
        }
    }

    return parts.length > 0 ? parts.join('\n') : 'No specific preferences provided.'
}

/**
 * Get current session messages
 * 
 * @param {string} sessionId - Session ID
 * @param {number} limit - Maximum messages to include
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
async function getSessionMessages(sessionId, limit = MAX_SESSION_MESSAGES) {
    const { rows } = await pool.query(
        `SELECT role, content FROM public.chat_messages 
         WHERE session_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2`,
        [sessionId, limit]
    )
    // Reverse to get chronological order
    return rows.reverse()
}

/**
 * Assemble the complete prompt for the LLM
 * This is the main function that combines all data sources
 * 
 * @param {string} userId - User ID
 * @param {string} sessionId - Current session ID
 * @param {string} userMessage - Current user message (optional, for new messages)
 * @returns {Promise<Array<{role: string, content: string}>>} - Messages array for LLM
 */
async function assemblePrompt(userId, sessionId, userMessage = null) {
    logger.info(`Assembling prompt for user ${userId}, session ${sessionId}`)

    // Gather all data sources in parallel
    const [systemPrompt, userContext, annotations, summaries] = await Promise.all([
        getSystemPrompt(),
        getUserContext(userId),
        getAnnotationsForChatbot(pool, userId),
        getSummariesForChatbot(userId)
    ])

    // Get current session messages
    const sessionMessages = await getSessionMessages(sessionId)

    // Check if this is a first-time or returning user
    const userHasHistory = await hasHistory(userId)
    const userType = userHasHistory
        ? 'This is a returning student.'
        : 'This is a new student.'

    // Build the assembled system content
    // Note: All behavioral instructions are in the system prompt file
    const assembledSystem = `${systemPrompt}

---

USER CONTEXT & PREFERENCES:
${userContext}

ANNOTATED QUESTIONNAIRE INSIGHTS:
${annotations}

PREVIOUS CHATS (SUMMARIZED):
${summaries}

CURRENT SESSION:
${userType}
`

    // Check token budget
    let contextTokens = estimateTokens(assembledSystem)

    // Build messages array
    const messages = [
        { role: 'system', content: assembledSystem }
    ]

    // Add session messages, potentially truncating older ones if needed
    let messagesToAdd = [...sessionMessages]

    while (messagesToAdd.length > 0 && contextTokens < MAX_CONTEXT_TOKENS) {
        const msg = messagesToAdd.shift()
        const msgTokens = estimateTokens(msg.content)

        if (contextTokens + msgTokens > MAX_CONTEXT_TOKENS) {
            // Truncate - keep the most recent messages
            logger.warn(`Truncating session messages, token budget exceeded`)
            break
        }

        messages.push(msg)
        contextTokens += msgTokens
    }

    // Add the current user message if provided
    if (userMessage) {
        messages.push({ role: 'user', content: userMessage })
    }

    logger.info(`Assembled prompt: ${messages.length} messages, ~${contextTokens} tokens`)
    return messages
}

/**
 * Assemble initial greeting prompt
 * Used when starting a new session to generate the opening message
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
async function assembleInitialGreetingPrompt(userId) {
    const [systemPrompt, userContext, annotations, summaries] = await Promise.all([
        getSystemPrompt(),
        getUserContext(userId),
        getAnnotationsForChatbot(pool, userId),
        getSummariesForChatbot(userId)
    ])

    const userHasHistory = await hasHistory(userId)
    const userType = userHasHistory ? 'returning student' : 'new student'

    // Log what data we have for debugging
    logger.info(`Initial greeting data - userContext: ${userContext.substring(0, 100)}...`)
    logger.info(`Initial greeting data - annotations length: ${annotations.length} chars`)

    // Note: Greeting behavior is defined in system_prompt.txt under GREETING BEHAVIOR
    const assembledSystem = `${systemPrompt}

---

USER CONTEXT & PREFERENCES:
${userContext}

ANNOTATED QUESTIONNAIRE INSIGHTS:
${annotations}

PREVIOUS CHATS (SUMMARIZED):
${summaries}

CURRENT SESSION:
This is a ${userType}. Generate a personalized greeting following the GREETING BEHAVIOR instructions.
`

    return [
        { role: 'system', content: assembledSystem },
        { role: 'user', content: 'Hello, I just opened the chat. Please greet me based on my data.' }
    ]
}

/**
 * Extract just the system instructions part for alignment checking
 * 
 * @returns {Promise<string>}
 */
async function getSystemInstructionsForAlignment() {
    return await getSystemPrompt()
}

/**
 * Check if a user has actual student profile data set up
 * This checks for edu_level, field_of_study, major - not just the username
 * 
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - True if user has profile data beyond just name
 */
async function hasStudentProfile(userId) {
    const { rows } = await pool.query(
        `SELECT edu_level, field_of_study, major, learning_formats, disabilities
         FROM public.student_profiles
         WHERE user_id = $1`,
        [userId]
    )

    if (rows.length === 0) {
        return false
    }

    const profile = rows[0]
    // Check if any meaningful profile field is filled in
    return !!(profile.edu_level || profile.field_of_study || profile.major ||
        (profile.learning_formats && profile.learning_formats.length > 0) ||
        (profile.disabilities && profile.disabilities.length > 0))
}

export {
    assemblePrompt,
    assembleInitialGreetingPrompt,
    getSystemPrompt,
    getUserContext,
    getSessionMessages,
    getSystemInstructionsForAlignment,
    hasStudentProfile,
    initializeSystemPrompt
}
