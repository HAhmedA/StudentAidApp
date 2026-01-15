// Chatbot Constants
// Centralized location for greeting messages and other magic strings

/**
 * Greeting message for users who have a profile but no SRL questionnaire data
 */
export const GREETING_NO_DATA_WITH_PROFILE =
    "Hello! Welcome to your learning support assistant. " +
    "I see you've set up your profile - that's great! " +
    "To provide you with personalized learning recommendations, " +
    "please complete the Self-Regulated Learning (SRL) questionnaire. " +
    "Once you've submitted your responses, I'll be able to analyze your learning patterns " +
    "and offer tailored advice. How can I help you in the meantime?"

/**
 * Greeting message for users with no profile and no SRL data
 */
export const GREETING_NO_DATA_NO_PROFILE =
    "Hello! Welcome to your learning support assistant. " +
    "I'm here to help you on your learning journey. " +
    "To get started with personalized recommendations, please: \n" +
    "1. Complete your profile with your educational background and preferences\n" +
    "2. Fill out the Self-Regulated Learning (SRL) questionnaire\n\n" +
    "Once you've done that, I'll be able to analyze your learning patterns " +
    "and provide tailored advice. Feel free to ask me any questions in the meantime!"

/**
 * Fallback greeting when LLM is unavailable or errors occur
 */
export const GREETING_FALLBACK =
    "Hello! I'm here to help you with your learning journey. How can I assist you today?"

/**
 * Session configuration
 */
export const SESSION_TIMEOUT_SECONDS = 1800 // 30 minutes
