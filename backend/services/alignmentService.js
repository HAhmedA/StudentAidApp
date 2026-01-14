// Alignment Service
// Validates LLM responses using LLM-as-a-Judge pattern
// Owns all alignment/judge logic and prompts

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { chatCompletion, llmConfig } from './apiConnectorService.js'

// Configuration
const MAX_ALIGNMENT_RETRIES = 2

// Message when alignment check fails (LLM available but response didn't pass)
const ALIGNMENT_FAILED_MESSAGE = "Unfortunately I cannot assist with this query. Please try rephrasing your request."

// Message when service is unavailable (LLM down, timeout, etc.)
const SERVICE_UNAVAILABLE_MESSAGE = "I'm having trouble responding right now. Please try again later."

// Load default alignment prompt from file
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ALIGNMENT_PROMPT_PATH = path.join(__dirname, '../prompts/alignment_prompt.txt')

let DEFAULT_ALIGNMENT_PROMPT = 'Evaluate if the response is appropriate and follows instructions.'
try {
    DEFAULT_ALIGNMENT_PROMPT = fs.readFileSync(ALIGNMENT_PROMPT_PATH, 'utf-8').trim()
    logger.info('Loaded alignment prompt from file')
} catch (err) {
    logger.warn('Could not load alignment_prompt.txt, using basic default')
}

/**
 * Get the alignment prompt from database (with caching)
 * Falls back to the prompt loaded from alignment_prompt.txt
 * 
 * @returns {Promise<string>} - The alignment prompt template
 */
let cachedAlignmentPrompt = null
let cacheTime = 0
const CACHE_TTL_MS = 60000 // Cache for 1 minute

async function getAlignmentPrompt() {
    const now = Date.now()

    // Return cached if still valid
    if (cachedAlignmentPrompt && (now - cacheTime) < CACHE_TTL_MS) {
        return cachedAlignmentPrompt
    }

    try {
        const { rows } = await pool.query(
            `SELECT prompt FROM public.system_prompts 
             WHERE prompt_type = 'alignment' 
             ORDER BY updated_at DESC LIMIT 1`
        )

        cachedAlignmentPrompt = rows.length > 0 ? rows[0].prompt : DEFAULT_ALIGNMENT_PROMPT
        cacheTime = now
        return cachedAlignmentPrompt
    } catch (error) {
        logger.error('Failed to fetch alignment prompt from DB:', error.message)
        return cachedAlignmentPrompt || DEFAULT_ALIGNMENT_PROMPT
    }
}

// Export the default prompt so admin routes can use it
export { DEFAULT_ALIGNMENT_PROMPT }

/**
 * Build the judge prompt for alignment evaluation
 * 
 * @param {string} alignmentTemplate - The alignment prompt template from DB
 * @param {string} userQuery - The user's original question
 * @param {string} response - The LLM's response to evaluate
 * @param {string} systemInstructions - The admin's system prompt
 * @returns {string} - The formatted judge prompt
 */
function buildJudgePrompt(alignmentTemplate, userQuery, response, systemInstructions) {
    return `${alignmentTemplate}

INSTRUCTIONS GIVEN TO THE ASSISTANT:
${systemInstructions}

USER'S QUESTION:
${userQuery}

ASSISTANT'S RESPONSE:
${response}`
}

/**
 * Check if a response aligns with the system instructions
 * Uses LLM-as-a-Judge pattern with the configured judge model
 * 
 * @param {string} userQuery - The user's original question
 * @param {string} response - The LLM's response to evaluate
 * @param {string} systemInstructions - The admin's system prompt
 * @returns {Promise<{passed: boolean, reason: string}>}
 */
async function checkAlignment(userQuery, response, systemInstructions) {
    logger.info('Checking alignment for response')

    try {
        // Get alignment prompt from database
        const alignmentTemplate = await getAlignmentPrompt()

        const judgePrompt = buildJudgePrompt(alignmentTemplate, userQuery, response, systemInstructions)
        const messages = [{ role: 'user', content: judgePrompt }]

        const judgeResponse = await chatCompletion(messages, {
            model: llmConfig.judgeModel,
            maxTokens: 200,
            temperature: 0.1 // Low temperature for consistent judgments
        })

        // Parse JSON from response
        const jsonMatch = judgeResponse.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0])
            const passed = Boolean(result.passed)
            const reason = result.reason || 'No reason provided'
            logger.info(`Alignment check: ${passed ? 'PASSED' : 'FAILED'} - ${reason}`)
            return { passed, reason }
        }

        // If we can't parse JSON, assume failure
        logger.warn('Could not parse judge response as JSON:', judgeResponse)
        return { passed: false, reason: 'Judge response was not valid JSON' }
    } catch (error) {
        logger.error('Alignment check failed:', error.message)
        // On error, we're cautious and mark as failed
        return { passed: false, reason: `Alignment check error: ${error.message}` }
    }
}

/**
 * Get a response with alignment checking and retry logic
 * This wraps the LLM chat and ensures responses pass alignment
 * 
 * @param {Function} generateResponse - Function that generates a response (returns Promise<string>)
 * @param {string} userQuery - The user's original question
 * @param {string} systemInstructions - The admin's system prompt
 * @returns {Promise<{content: string, passed: boolean, retries: number}>}
 */
async function getAlignedResponse(generateResponse, userQuery, systemInstructions) {
    let retries = 0
    let lastResponse = ''
    let lastReason = ''

    while (retries <= MAX_ALIGNMENT_RETRIES) {
        try {
            // Generate response
            const response = await generateResponse()
            lastResponse = response

            // Check alignment
            const alignmentResult = await checkAlignment(userQuery, response, systemInstructions)

            if (alignmentResult.passed) {
                return {
                    content: response,
                    passed: true,
                    retries
                }
            }

            lastReason = alignmentResult.reason
            logger.warn(`Alignment failed (attempt ${retries + 1}/${MAX_ALIGNMENT_RETRIES + 1}): ${lastReason}`)
            retries++

        } catch (error) {
            logger.error(`Response generation failed (attempt ${retries + 1}):`, error.message)
            retries++
        }
    }

    // All retries exhausted - return alignment failed message
    logger.error(`All alignment retries exhausted. Last reason: ${lastReason}`)
    return {
        content: ALIGNMENT_FAILED_MESSAGE,
        passed: false,
        retries: retries,
        failureType: 'alignment'
    }
}

/**
 * Quick validation for obviously problematic content
 * This is a fast pre-check before full LLM alignment
 * 
 * @param {string} response - Response to check
 * @returns {{passed: boolean, reason: string}}
 */
function quickValidation(response) {
    if (!response || response.trim().length === 0) {
        return { passed: false, reason: 'Empty response' }
    }

    // Check for accidentally exposed internal markers
    const internalMarkers = [
        'SYSTEM PROMPT',
        'ADMIN INSTRUCTIONS',
        'ANNOTATED QUESTIONNAIRE',
        'ALIGNMENT CHECK',
        '```json',  // Raw JSON output
        'user_id:',
        'session_id:'
    ]

    for (const marker of internalMarkers) {
        if (response.includes(marker)) {
            return { passed: false, reason: `Response contains internal marker: ${marker}` }
        }
    }

    return { passed: true, reason: 'Quick validation passed' }
}

export {
    checkAlignment,
    getAlignedResponse,
    quickValidation,
    MAX_ALIGNMENT_RETRIES,
    ALIGNMENT_FAILED_MESSAGE,
    SERVICE_UNAVAILABLE_MESSAGE
}
