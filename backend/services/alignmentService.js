// Alignment Service
// Validates LLM responses using LLM-as-a-Judge pattern
// Owns all alignment/judge logic and prompts

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../config/database.js'
import logger from '../utils/logger.js'
import { chatCompletion, getLlmConfig } from './apiConnectorService.js'

// Configuration
const MAX_ALIGNMENT_RETRIES = 1

// Contextual alignment failure messages based on failure category
const ALIGNMENT_MESSAGES = {
    default: "I wasn't able to generate a suitable response to that. Please try rephrasing your question.",
    safety: "I can't help with that particular request. Is there something else about your learning I can assist with?",
    scope: "That topic is outside my expertise. I'm here to help with your learning habits, study strategies, and wellbeing data.",
    unclear: "I'm having trouble understanding your request. Could you provide more details or rephrase?"
}

// Message when alignment check fails (LLM available but response didn't pass)
const ALIGNMENT_FAILED_MESSAGE = ALIGNMENT_MESSAGES.default

// Message when service is unavailable (LLM down, timeout, etc.)
const SERVICE_UNAVAILABLE_MESSAGE = "The service is down at the moment, please try again later."

/**
 * Categorize alignment failure based on judge's reason
 * @param {string} reason - The failure reason from the judge
 * @returns {string} - Category key for ALIGNMENT_MESSAGES
 */
function categorizeFailure(reason) {
    if (!reason) return 'default'
    const r = reason.toLowerCase()
    if (r.includes('safety') || r.includes('harmful') || r.includes('inappropriate')) return 'safety'
    if (
        r.includes('scope') || r.includes('instruction') || r.includes('outside') ||
        r.includes('off-topic') || r.includes('off topic') || r.includes('unrelated') ||
        r.includes('not related') || r.includes('irrelevant') || r.includes('topic') ||
        r.includes('cooking') || r.includes('recipe') || r.includes('entirely')
    ) return 'scope'
    if (r.includes('unclear') || r.includes('ambiguous') || r.includes('understand')) return 'unclear'
    return 'default'
}

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

        // Build the evaluation content with clear structure
        const evaluationContent = `=== INSTRUCTIONS GIVEN TO ASSISTANT ===
${systemInstructions}

=== USER'S QUESTION ===
${userQuery}

=== ASSISTANT'S RESPONSE TO EVALUATE ===
${response}

=== YOUR VERDICT ===
Output ONLY valid JSON: {"passed": true, "reason": "..."} or {"passed": false, "reason": "..."}`

        // Simple system/user message format (no prefill - causes issues with some servers)
        const messages = [
            { role: 'system', content: alignmentTemplate },
            { role: 'user', content: evaluationContent }
        ]

        const { judgeModel } = await getLlmConfig()
        const judgeResponse = await chatCompletion(messages, {
            model: judgeModel,
            maxTokens: 150,
            temperature: 0.0
        })

        // Handle empty response from judge (model compatibility issue)
        if (!judgeResponse || judgeResponse.trim().length === 0) {
            logger.warn('Judge returned empty response - failing open to allow response through')
            return { passed: true, reason: 'Judge unavailable (empty response) - allowing response' }
        }

        // Parse JSON from response (look for JSON object anywhere in the response)
        const jsonMatch = judgeResponse.match(/\{[\s\S]*?\}/)
        if (jsonMatch) {
            try {
                const result = JSON.parse(jsonMatch[0])
                const passed = Boolean(result.passed)
                const reason = result.reason || 'No reason provided'
                logger.info(`Alignment check: ${passed ? 'PASSED' : 'FAILED'} - ${reason}`)
                return { passed, reason }
            } catch (parseError) {
                logger.warn('JSON parse error:', parseError.message, 'Response:', judgeResponse.substring(0, 200))
            }
        }

        // If we can't parse JSON, fail open to avoid blocking good responses
        logger.warn('Could not parse judge response as JSON, failing open:', judgeResponse.substring(0, 200))
        return { passed: true, reason: 'Judge returned non-JSON response - allowing response' }
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

    // All retries exhausted - return contextual alignment failed message
    const failureCategory = categorizeFailure(lastReason)
    logger.error(`All alignment retries exhausted. Category: ${failureCategory}, Reason: ${lastReason}`)
    return {
        content: ALIGNMENT_MESSAGES[failureCategory],
        passed: false,
        retries: retries,
        failureType: 'alignment',
        failureCategory
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
