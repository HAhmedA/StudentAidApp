// SRL Annotation Service
// Computes statistics and generates annotation text for each SRL concept

// Concepts that are inverted (high score = bad outcome)
const INVERTED_CONCEPTS = ['anxiety'];

// Short display names for UI (concept_key -> short name)
const CONCEPT_SHORT_NAMES = {
    efficiency: 'Efficiency',
    importance: 'Perceived Importance',
    tracking: 'Progress Tracking',
    effort: 'Effort & Focus',
    help_seeking: 'Help Seeking',
    community: 'Peer Learning',
    timeliness: 'Timeliness',
    motivation: 'Motivation & Enjoyment',
    anxiety: 'Anxiety',
    reflection: 'Reflection'
};


/**
 * Calculate the average of an array of numbers
 */
function average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}


/**
 * Generate annotation text for UI display (short concept name)
 */
function generateAnnotationText(conceptKey, avg, count, latestScore = null) {
    if (count === 1) {
        return `Current score: ${avg.toFixed(1)}/5`;
    }
    if (latestScore !== null) {
        return `Latest: ${latestScore}/5, average: ${avg.toFixed(1)}/5 (${count} responses)`;
    }
    return `Average: ${avg.toFixed(1)}/5 (${count} responses)`;
}

/**
 * Generate annotation text for LLM/chatbot (full question title)
 */
function generateAnnotationTextLLM(conceptKey, fullTitle, avg, min, max, count, latestScore = null) {
    const displayTitle = CONCEPT_SHORT_NAMES[conceptKey] || fullTitle;
    const cleanTitle = displayTitle.replace(/:$/, '');

    if (count === 1) {
        return `- ${cleanTitle}: ${avg.toFixed(1)}/5 (single response)`;
    }

    if (latestScore !== null) {
        return `- ${cleanTitle}: latest ${latestScore}/5, avg ${avg.toFixed(1)}/5 (range ${min.toFixed(1)}–${max.toFixed(1)}, ${count} responses)`;
    }

    return `- ${cleanTitle}: avg ${avg.toFixed(1)}/5 (range ${min.toFixed(1)}–${max.toFixed(1)}, ${count} responses)`;
}

/**
 * Compute all annotations for a user
 * Called after each questionnaire submission
 */
async function computeAnnotations(pool, userId) {
    // Build concept info from static definitions
    const conceptInfo = {};
    for (const [key, title] of Object.entries(CONCEPT_SHORT_NAMES)) {
        conceptInfo[key] = {
            key,
            title,
            isInverted: INVERTED_CONCEPTS.includes(key)
        };
    }

    const timeWindow = '7d';
    const intervalDays = 7;
    const annotations = [];

    // Get all responses for this user in the time window
    const { rows: responses } = await pool.query(
        `SELECT concept_key, score, submitted_at
       FROM public.srl_responses
       WHERE user_id = $1 AND submitted_at >= NOW() - ($2 * INTERVAL '1 day')
       ORDER BY concept_key, submitted_at ASC`,
        [userId, intervalDays]
    );

    // Group by concept
    const byConceptKey = {};
    responses.forEach(r => {
        if (!byConceptKey[r.concept_key]) byConceptKey[r.concept_key] = [];
        byConceptKey[r.concept_key].push(parseFloat(r.score));
    });

    // Compute annotation for each concept
    for (const conceptKey of Object.keys(conceptInfo)) {
        const scores = byConceptKey[conceptKey] || [];
        const info = conceptInfo[conceptKey];
        const isInverted = info.isInverted;

        let avg = 0, min = 0, max = 0, count = 0;
        let latestScore = null;

        if (scores.length > 0) {
            avg = average(scores);
            min = Math.min(...scores);
            max = Math.max(...scores);
            count = scores.length;
            latestScore = scores[scores.length - 1];
        }

        const annotationText = generateAnnotationText(conceptKey, avg, count, latestScore);
        const annotationTextLLM = generateAnnotationTextLLM(
            conceptKey, info.title, avg, min, max, count, latestScore
        );

        annotations.push({
            userId,
            conceptKey,
            timeWindow,
            avgScore: avg,
            minScore: min,
            maxScore: max,
            responseCount: count,
            trend: null,
            isInverted,
            annotationText,
            annotationTextLLM,
            hasSufficientData: count > 0,
            distinctDayCount: null
        });
    }

    // Upsert all annotations
    for (const a of annotations) {
        await pool.query(
            `INSERT INTO public.srl_annotations
        (user_id, concept_key, time_window, avg_score, min_score, max_score,
         response_count, trend, is_inverted, has_sufficient_data, distinct_day_count,
         annotation_text, annotation_text_llm, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       ON CONFLICT (user_id, concept_key, time_window)
       DO UPDATE SET
         avg_score = EXCLUDED.avg_score,
         min_score = EXCLUDED.min_score,
         max_score = EXCLUDED.max_score,
         response_count = EXCLUDED.response_count,
         trend = EXCLUDED.trend,
         is_inverted = EXCLUDED.is_inverted,
         has_sufficient_data = EXCLUDED.has_sufficient_data,
         distinct_day_count = EXCLUDED.distinct_day_count,
         annotation_text = EXCLUDED.annotation_text,
         annotation_text_llm = EXCLUDED.annotation_text_llm,
         computed_at = NOW()`,
            [a.userId, a.conceptKey, a.timeWindow, a.avgScore, a.minScore, a.maxScore,
            a.responseCount, a.trend, a.isInverted, a.hasSufficientData, a.distinctDayCount,
            a.annotationText, a.annotationTextLLM]
        );
    }

    return annotations;
}

/**
 * Extract and save individual SRL responses from questionnaire submission
 * 
 * @param {object} pool - Database connection pool
 * @param {string} questionnaireId - Questionnaire result ID
 * @param {string} userId - User ID
 * @param {object} answers - JSONB answers object
 * @param {Date} submittedAt - Submission timestamp
 */
async function saveResponses(pool, questionnaireId, userId, answers, submittedAt) {
    const conceptKeys = Object.keys(CONCEPT_SHORT_NAMES);

    for (const key of conceptKeys) {
        const score = answers[key];
        if (score !== undefined && score !== null) {
            const numScore = Number(score);
            if (!isNaN(numScore) && numScore >= 1 && numScore <= 5) {
                await pool.query(
                    `INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (questionnaire_id, concept_key) 
           DO UPDATE SET score = EXCLUDED.score, submitted_at = EXCLUDED.submitted_at`,
                    [userId, questionnaireId, key, numScore, submittedAt]
                );
            }
        }
    }
}

/**
 * Get annotations for a user (for chatbot/display)
 * 
 * @param {object} pool - Database connection pool
 * @param {string} userId - User ID
 * @param {string} timeWindow - '24h' or '7d' (optional, returns both if not specified)
 * @param {boolean} forLLM - If true, returns LLM-formatted text
 */
async function getAnnotations(pool, userId, timeWindow = null, forLLM = false) {
    let query = `SELECT * FROM public.srl_annotations WHERE user_id = $1`;
    const params = [userId];

    if (timeWindow) {
        query += ` AND time_window = $2`;
        params.push(timeWindow);
    }

    query += ` ORDER BY concept_key, time_window`;

    const { rows } = await pool.query(query, params);

    return rows.map(row => ({
        conceptKey: row.concept_key,
        timeWindow: row.time_window,
        avgScore: parseFloat(row.avg_score) || 0,
        minScore: row.min_score,
        maxScore: row.max_score,
        responseCount: row.response_count,
        isInverted: row.is_inverted,
        text: forLLM ? row.annotation_text_llm : row.annotation_text,
        computedAt: row.computed_at
    }));
}

/**
 * Get formatted SRL analysis for chatbot prompt.
 * Factually describes the student's self-reported learning patterns.
 */
async function getAnnotationsForChatbot(pool, userId) {
    const annotations = await getAnnotations(pool, userId, null, true);

    const validAnnotations = annotations.filter(a => a.responseCount > 0);

    if (validAnnotations.length === 0) {
        return 'No questionnaire data available for this student.';
    }

    let result = '## Student Self-Regulated Learning Status\n\n';
    validAnnotations.forEach(a => {
        result += `${a.text}\n`;
    });

    return result;
}

/**
 * Check if a user has any actual SRL data (responseCount > 0)
 * Used to determine whether to call LLM or return a hardcoded prompt
 * 
 * @param {object} pool - Database connection pool
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - True if user has SRL data
 */
async function hasSRLData(pool, userId) {
    const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM public.srl_responses WHERE user_id = $1`,
        [userId]
    );
    return parseInt(rows[0].count) > 0;
}

// =============================================================================
// SCORING INTEGRATION
// =============================================================================

/**
 * Get cluster-based scores for scoring aggregation
 * Uses PGMoE clustering + percentile scoring instead of Z-scores
 */
async function getRawScoresForScoring(pool, userId) {
    const { computeClusterScores } = await import('../scoring/clusterPeerService.js');
    const clusterResult = await computeClusterScores(pool, 'srl', userId);

    if (!clusterResult) return [];
    if (clusterResult.coldStart) return [{ coldStart: true }];
    if (!clusterResult.domains) return [];

    // Fetch annotation labels
    const { rows } = await pool.query(
        `SELECT concept_key, annotation_text
         FROM public.srl_annotations
         WHERE user_id = $1 AND time_window = '7d' AND response_count > 0
         ORDER BY concept_key`,
        [userId]
    );
    const labelMap = {};
    rows.forEach(r => labelMap[r.concept_key] = r.annotation_text);

    return clusterResult.domains.map(r => ({
        ...r,
        label: labelMap[r.domain] || r.categoryLabel,
        clusterLabel: clusterResult.clusterLabel,
        dialMin: clusterResult.dialMin,
        dialCenter: clusterResult.dialCenter,
        dialMax: clusterResult.dialMax
    }));
}

// Keep old function for backwards compatibility, but mark deprecated
async function getSeveritiesForScoring(pool, userId) {
    console.warn('getSeveritiesForScoring is deprecated, use getRawScoresForScoring');
    const rawScores = await getRawScoresForScoring(pool, userId);
    return rawScores.map(r => ({
        domain: r.domain,
        severity: r.category === 'very_good' ? 'ok' : r.category === 'good' ? 'warning' : 'poor'
    }));
}

// ============================================================================
// WELLBEING (WHO-5) — stored only, sent to chatbot, NOT displayed on dashboard
// ============================================================================

const WELLBEING_KEYS = ['cheerfulness', 'calmness', 'vitality', 'restedness', 'interest'];

async function saveWellbeingResponses(pool, questionnaireId, userId, answers, submittedAt) {
    const values = WELLBEING_KEYS.map(k => {
        const val = answers[k];
        if (val === undefined || val === null) return null;
        const num = Number(val);
        if (isNaN(num) || num < 0 || num > 10) return null;
        return Math.round(num * 10) / 10; // 1 decimal place
    });
    if (values.every(v => v === null)) return;

    await pool.query(
        `INSERT INTO public.wellbeing_responses
            (user_id, questionnaire_id, cheerfulness, calmness, vitality, restedness, interest, submitted_at, is_simulated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)`,
        [userId, questionnaireId, ...values, submittedAt]
    );
}

async function getWellbeingForChatbot(pool, userId) {
    const { rows } = await pool.query(
        `SELECT cheerfulness, calmness, vitality, restedness, interest, submitted_at
         FROM public.wellbeing_responses
         WHERE user_id = $1
         ORDER BY submitted_at DESC
         LIMIT 7`,
        [userId]
    );

    if (rows.length === 0) return '';

    const latest = rows[0];
    const labels = {
        cheerfulness: 'Cheerful & in good spirits',
        calmness: 'Calm & relaxed',
        vitality: 'Active & vigorous',
        restedness: 'Woke up fresh & rested',
        interest: 'Daily life filled with interesting things'
    };

    let text = '## Student Wellbeing (WHO-5 Style)\n\n';
    text += '### Most Recent:\n';
    for (const [key, label] of Object.entries(labels)) {
        text += `- ${label}: ${latest[key]}/10\n`;
    }

    if (rows.length > 1) {
        const avgOf = (key) => {
            const vals = rows.map(r => r[key]).filter(v => v != null);
            return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 'N/A';
        };
        text += `\n### Past ${rows.length} days averages:\n`;
        for (const [key, label] of Object.entries(labels)) {
            text += `- ${label}: avg ${avgOf(key)}/10\n`;
        }
    }

    text += '\nNote: This data reflects the student\'s subjective daily wellbeing. Use it to gauge emotional state and tailor your tone — e.g., be more supportive if wellbeing scores are low.';
    return text;
}

export {
    computeAnnotations,
    saveResponses,
    saveWellbeingResponses,
    getAnnotations,
    getAnnotationsForChatbot,
    getWellbeingForChatbot,
    hasSRLData,
    getSeveritiesForScoring,
    getRawScoresForScoring,
    INVERTED_CONCEPTS,
    CONCEPT_SHORT_NAMES,
    WELLBEING_KEYS
};


