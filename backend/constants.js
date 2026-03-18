// Chatbot Constants
// Centralized location for greeting messages and other magic strings

/**
 * Greeting message for users who have no data yet
 */
export const GREETING_NO_DATA =
    "Hello! I'm Max, your learning assistant. " +
    "I'm here to help you on your learning journey. " +
    "To get started with personalised recommendations, please:\n\n" +
    "• Complete the daily questionnaire (wellbeing & learning strategies)\n" +
    "• Log your daily sleep hours\n" +
    "• Track your daily screen time\n\n" +
    "Once you've shared this information, I'll be able to analyse your learning patterns, " +
    "sleep habits, and digital wellness to offer tailored advice. " +
    "Feel free to ask me any questions in the meantime!"

/**
 * Fallback greeting when LLM is unavailable or errors occur
 */
export const GREETING_FALLBACK =
    "Hello! I'm here to help you with your learning journey. How can I assist you today?"

/**
 * Session configuration
 */
export const SESSION_TIMEOUT_SECONDS = 1800 // 30 minutes

/**
 * Numeric boundaries for the three-tier score category system.
 * Used by the PGMoE clustering pipeline to classify per-domain scores (0–100).
 *   score >= VERY_GOOD  → 'very_good'
 *   score >= GOOD       → 'good'
 *   else                → 'requires_improvement'
 */
export const SCORE_THRESHOLDS = {
    VERY_GOOD: 66,
    GOOD: 33,
}
