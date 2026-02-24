// Cluster Peer Service
// Gaussian Mixture Model (GMM) based clustering for peer comparison
// Replaces Z-score approach with behavioral clustering + percentile-based scoring
//
// Flow:
//   1. Gather all users' raw metrics per concept
//   2. Normalize features (min-max scaling)
//   3. Fit GMM with K=3 components via EM algorithm
//   4. Assign each user to their most-likely cluster
//   5. Compute per-cluster percentiles (P5, P50, P95) on composite score
//   6. Map user's score to 0-100 within their cluster's P5-P95 range

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';

// Re-use the metric queries from the existing service
import { computeStats } from './peerStatsService.js';

// =============================================================================
// GAUSSIAN MIXTURE MODEL (EM ALGORITHM)
// =============================================================================

/**
 * Compute the probability density of a point under a multivariate Gaussian
 * with diagonal covariance (independent dimensions).
 */
function gaussianPDF(x, mean, variance) {
    const d = x.length;
    let logP = -0.5 * d * Math.log(2 * Math.PI);
    for (let i = 0; i < d; i++) {
        const v = Math.max(variance[i], 1e-6); // floor to avoid division by zero
        logP -= 0.5 * Math.log(v);
        logP -= 0.5 * ((x[i] - mean[i]) ** 2) / v;
    }
    return Math.exp(logP);
}

/**
 * Initialize GMM parameters using K-Means++ seeding for centroids,
 * uniform weights, and identity-like variances.
 */
function initializeGMM(data, k) {
    const n = data.length;
    const d = data[0].length;

    // K-Means++ initialization for means
    const means = [];
    // Pick first centroid randomly
    means.push([...data[Math.floor(Math.random() * n)]]);

    for (let c = 1; c < k; c++) {
        // Compute squared distances to nearest existing centroid
        const dists = data.map(point => {
            let minDist = Infinity;
            for (const m of means) {
                let dist = 0;
                for (let i = 0; i < d; i++) dist += (point[i] - m[i]) ** 2;
                minDist = Math.min(minDist, dist);
            }
            return minDist;
        });
        const totalDist = dists.reduce((s, v) => s + v, 0);
        // Weighted random selection
        let r = Math.random() * totalDist;
        let idx = 0;
        for (let i = 0; i < n; i++) {
            r -= dists[i];
            if (r <= 0) { idx = i; break; }
        }
        means.push([...data[idx]]);
    }

    // Initialize variances as global variance per dimension
    const globalVariance = new Array(d).fill(0);
    const globalMean = new Array(d).fill(0);
    for (const point of data) {
        for (let i = 0; i < d; i++) globalMean[i] += point[i] / n;
    }
    for (const point of data) {
        for (let i = 0; i < d; i++) globalVariance[i] += (point[i] - globalMean[i]) ** 2 / n;
    }

    const variances = [];
    for (let c = 0; c < k; c++) {
        variances.push(globalVariance.map(v => Math.max(v, 1e-6)));
    }

    // Uniform mixing weights
    const weights = new Array(k).fill(1 / k);

    return { means, variances, weights };
}

/**
 * Fit a Gaussian Mixture Model using the EM algorithm.
 *
 * @param {number[][]} data - Array of feature vectors (N x D)
 * @param {number} k - Number of components
 * @param {number} maxIter - Maximum EM iterations
 * @param {number} tol - Log-likelihood convergence tolerance
 * @returns {{ means, variances, weights, assignments, responsibilities }}
 */
function fitGMM(data, k, maxIter = 50, tol = 1e-4) {
    const n = data.length;
    const d = data[0].length;

    // Edge case: fewer data points than clusters
    if (n <= k) {
        // Assign each point to its own cluster, pad remaining
        const assignments = data.map((_, i) => Math.min(i, k - 1));
        const responsibilities = data.map((_, i) => {
            const row = new Array(k).fill(0);
            row[Math.min(i, k - 1)] = 1;
            return row;
        });
        const means = [];
        const variances = [];
        const weights = [];
        for (let c = 0; c < k; c++) {
            const pts = data.filter((_, i) => assignments[i] === c);
            if (pts.length > 0) {
                means.push(pts[0].slice());
            } else {
                means.push(new Array(d).fill(0));
            }
            variances.push(new Array(d).fill(1));
            weights.push(pts.length / n);
        }
        return { means, variances, weights, assignments, responsibilities };
    }

    let { means, variances, weights } = initializeGMM(data, k);
    let prevLogLikelihood = -Infinity;
    let responsibilities = Array.from({ length: n }, () => new Array(k).fill(0));

    for (let iter = 0; iter < maxIter; iter++) {
        // ===== E-Step: compute responsibilities =====
        let logLikelihood = 0;

        for (let i = 0; i < n; i++) {
            let totalP = 0;
            for (let c = 0; c < k; c++) {
                responsibilities[i][c] = weights[c] * gaussianPDF(data[i], means[c], variances[c]);
                totalP += responsibilities[i][c];
            }
            // Normalize
            if (totalP > 0) {
                for (let c = 0; c < k; c++) responsibilities[i][c] /= totalP;
                logLikelihood += Math.log(totalP);
            } else {
                // Degenerate case: assign uniformly
                for (let c = 0; c < k; c++) responsibilities[i][c] = 1 / k;
            }
        }

        // Check convergence
        if (Math.abs(logLikelihood - prevLogLikelihood) < tol) {
            logger.debug(`GMM converged at iteration ${iter}, logL=${logLikelihood.toFixed(4)}`);
            break;
        }
        prevLogLikelihood = logLikelihood;

        // ===== M-Step: update parameters =====
        for (let c = 0; c < k; c++) {
            let Nc = 0;
            for (let i = 0; i < n; i++) Nc += responsibilities[i][c];

            if (Nc < 1e-10) continue; // Skip empty component

            // Update mean
            const newMean = new Array(d).fill(0);
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < d; j++) {
                    newMean[j] += responsibilities[i][c] * data[i][j];
                }
            }
            for (let j = 0; j < d; j++) newMean[j] /= Nc;

            // Update variance (diagonal)
            const newVar = new Array(d).fill(0);
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < d; j++) {
                    newVar[j] += responsibilities[i][c] * (data[i][j] - newMean[j]) ** 2;
                }
            }
            for (let j = 0; j < d; j++) newVar[j] = Math.max(newVar[j] / Nc, 1e-6);

            // Update weight
            means[c] = newMean;
            variances[c] = newVar;
            weights[c] = Nc / n;
        }
    }

    // Hard assignments via argmax of responsibilities
    const assignments = responsibilities.map(row => {
        let maxIdx = 0;
        for (let c = 1; c < k; c++) {
            if (row[c] > row[maxIdx]) maxIdx = c;
        }
        return maxIdx;
    });

    return { means, variances, weights, assignments, responsibilities };
}

/**
 * Select optimal number of clusters using BIC (Bayesian Information Criterion).
 * Tests K from kMin to kMax and returns the K with the lowest BIC.
 *
 * BIC = -2·logL + numParams·ln(n)
 * Lower BIC = better fit with fewer parameters (penalizes over-fitting).
 *
 * @param {number[][]} data - Feature matrix (N x D)
 * @param {number} kMin - Minimum K to test (default 2)
 * @param {number} kMax - Maximum K to test (default 6)
 * @returns {number} - Optimal K
 */
function selectOptimalK(data, kMin = 2, kMax = 6) {
    const n = data.length;
    const d = data[0].length;

    // Can't have more clusters than data points
    kMax = Math.min(kMax, n);
    kMin = Math.min(kMin, kMax);

    let bestK = kMin;
    let bestBIC = Infinity;

    for (let k = kMin; k <= kMax; k++) {
        const gmm = fitGMM(data, k);

        // Compute log-likelihood
        let logL = 0;
        for (let i = 0; i < n; i++) {
            let p = 0;
            for (let c = 0; c < k; c++) {
                p += gmm.weights[c] * gaussianPDF(data[i], gmm.means[c], gmm.variances[c]);
            }
            logL += Math.log(Math.max(p, 1e-300));
        }

        // Diagonal GMM params per component: d means + d variances + 1 weight = 2d + 1
        // Total params: k * (2d + 1) - 1 (weights sum to 1 → one is redundant)
        const numParams = k * (2 * d + 1) - 1;
        const bic = -2 * logL + numParams * Math.log(n);

        logger.debug(`BIC for K=${k}: ${bic.toFixed(2)} (logL=${logL.toFixed(2)}, params=${numParams})`);

        if (bic < bestBIC) {
            bestBIC = bic;
            bestK = k;
        }
    }

    logger.info(`Optimal K selected: ${bestK} (BIC=${bestBIC.toFixed(2)})`);
    return bestK;
}

/**
 * Generate human-readable cluster labels for any K.
 * Labels are ordered from worst (index 0) to best (index K-1).
 *
 * @param {number} k - Number of clusters
 * @returns {string[]} - Array of k labels
 */
function generateClusterLabels(k) {
    if (k === 1) return ['Your peer group'];
    if (k === 2) return [
        'Students building stronger habits',
        'Students with strong habits'
    ];
    if (k === 3) return [
        'Students building stronger habits',
        'Students with balanced patterns',
        'Students with strong habits'
    ];
    // For k >= 4, interpolate labels
    const labels = [];
    for (let i = 0; i < k; i++) {
        const fraction = i / (k - 1); // 0 to 1
        if (fraction < 0.25) labels.push('Students building stronger habits');
        else if (fraction > 0.75) labels.push('Students with strong habits');
        else labels.push(`Students with balanced patterns (group ${i})`);
    }
    return labels;
}

// =============================================================================
// METRIC QUERIES (reused from peerStatsService)
// =============================================================================

// Import the metric queries — we'll re-export the same function
// to avoid code duplication
async function getAllUserMetrics(conceptId, days = 7) {
    // Dynamic import to avoid circular dependency
    const mod = await import('./peerStatsService.js');
    // peerStatsService has a private getAllUserMetrics — we replicate the queries here
    // since that function isn't exported. We call the concept-specific ones.
    switch (conceptId) {
        case 'lms': return getLMSMetrics(days);
        case 'sleep': return getSleepMetrics(days);
        case 'screen_time': return getScreenTimeMetrics(days);
        case 'social_media': return getSocialMediaMetrics(days);
        case 'srl': return getSRLMetrics();
        default:
            logger.warn(`clusterPeerService: unknown concept ${conceptId}`);
            return {};
    }
}

async function getLMSMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               SUM(total_active_minutes) as total_active_minutes,
               SUM(number_of_sessions) as number_of_sessions,
               COUNT(DISTINCT session_date) as days_active,
               SUM(reading_minutes) + SUM(watching_minutes) as passive_minutes,
               SUM(total_active_minutes) as total_minutes,
               CASE WHEN SUM(number_of_sessions) > 0
                    THEN SUM(total_active_minutes)::float / SUM(number_of_sessions)
                    ELSE 0 END as avg_session_duration
        FROM public.lms_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY user_id
    `);
    const metrics = {};
    for (const r of rows) {
        const totalMin = parseFloat(r.total_minutes) || 0;
        const passiveMin = parseFloat(r.passive_minutes) || 0;
        const activePercent = totalMin > 0 ? ((totalMin - passiveMin) / totalMin) * 100 : 0;
        metrics[r.user_id] = {
            total_active_minutes: parseFloat(r.total_active_minutes) || 0,
            number_of_sessions: parseFloat(r.number_of_sessions) || 0,
            days_active: parseFloat(r.days_active) || 0,
            active_percent: activePercent,
            avg_session_duration: parseFloat(r.avg_session_duration) || 0
        };
    }
    return metrics;
}

async function getSleepMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               AVG(total_sleep_minutes) as avg_sleep_minutes,
               AVG(awakenings_count) as avg_awakenings,
               AVG(awake_minutes) as avg_awake_minutes,
               STDDEV_POP(EXTRACT(HOUR FROM bedtime) + EXTRACT(MINUTE FROM bedtime) / 60.0) as bedtime_stddev
        FROM public.sleep_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY user_id
    `);
    const metrics = {};
    for (const r of rows) {
        metrics[r.user_id] = {
            sleep_minutes: parseFloat(r.avg_sleep_minutes) || 0,
            awakenings: parseFloat(r.avg_awakenings) || 0,
            awake_minutes: parseFloat(r.avg_awake_minutes) || 0,
            bedtime_stddev: parseFloat(r.bedtime_stddev) || 0
        };
    }
    return metrics;
}

async function getScreenTimeMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               AVG(total_screen_minutes) as avg_screen_minutes,
               AVG(longest_continuous_session) as avg_longest_session,
               AVG(late_night_screen_minutes) as avg_late_night
        FROM public.screen_time_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY user_id
    `);
    const metrics = {};
    for (const r of rows) {
        metrics[r.user_id] = {
            screen_minutes: parseFloat(r.avg_screen_minutes) || 0,
            longest_session: parseFloat(r.avg_longest_session) || 0,
            late_night: parseFloat(r.avg_late_night) || 0
        };
    }
    return metrics;
}

async function getSocialMediaMetrics(days) {
    const { rows } = await pool.query(`
        SELECT user_id,
               AVG(total_social_minutes) as avg_social_minutes,
               AVG(number_of_social_sessions) as avg_checks,
               AVG(average_session_length) as avg_session_length
        FROM public.social_media_sessions
        WHERE session_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY user_id
    `);
    const metrics = {};
    for (const r of rows) {
        metrics[r.user_id] = {
            social_minutes: parseFloat(r.avg_social_minutes) || 0,
            number_of_checks: parseFloat(r.avg_checks) || 0,
            avg_session_length: parseFloat(r.avg_session_length) || 0
        };
    }
    return metrics;
}

async function getSRLMetrics() {
    const { rows } = await pool.query(`
        SELECT user_id, concept_key, avg_score, is_inverted
        FROM public.srl_annotations
        WHERE time_window = '7d' AND response_count > 0
        ORDER BY user_id, concept_key
    `);
    const metrics = {};
    for (const r of rows) {
        if (!metrics[r.user_id]) metrics[r.user_id] = {};
        metrics[r.user_id][r.concept_key] = {
            score: parseFloat(r.avg_score) || 0,
            isInverted: r.is_inverted
        };
    }
    return metrics;
}

// =============================================================================
// DIMENSION DEFINITIONS (which metrics to use, and which are inverted)
// =============================================================================

const DIMENSION_DEFS = {
    lms: {
        volume: { metric: 'total_active_minutes', inverted: false },
        consistency: { metric: 'days_active', inverted: false },
        action_mix: { metric: 'active_percent', inverted: false },
        session_quality: { metric: 'avg_session_duration', inverted: false }
    },
    sleep: {
        duration: { metric: 'sleep_minutes', inverted: false },
        continuity: { metric: 'awakenings', inverted: true },
        timing: { metric: 'bedtime_stddev', inverted: true }
    },
    screen_time: {
        volume: { metric: 'screen_minutes', inverted: true },
        distribution: { metric: 'longest_session', inverted: true },
        late_night: { metric: 'late_night', inverted: true }
    },
    social_media: {
        volume: { metric: 'social_minutes', inverted: true },
        frequency: { metric: 'number_of_checks', inverted: true },
        session_style: { metric: 'avg_session_length', inverted: true }
    }
};

// Cluster labels are now generated dynamically via generateClusterLabels(k)
// This supports K=2 through K=6 automatically.

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Compute percentile of a sorted array at a given percentile (0-100)
 */
function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    if (sortedArr.length === 1) return sortedArr[0];
    const idx = (p / 100) * (sortedArr.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sortedArr[lower];
    return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (idx - lower);
}

/**
 * Map a value to 0-100 within a [min, max] range
 */
function mapToRange(value, min, max) {
    if (max === min) return 50;
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/**
 * Compute a composite score for a user from their metrics.
 * For non-inverted metrics: higher = better.
 * For inverted metrics: lower = better (we negate after normalization).
 * Returns a single 0-100 number.
 */
function computeCompositeScore(userMetrics, allMetrics, dims) {
    const domainScores = [];

    for (const [domain, def] of Object.entries(dims)) {
        const allValues = Object.values(allMetrics).map(m => m[def.metric]).filter(v => v != null).sort((a, b) => a - b);
        if (allValues.length === 0) continue;

        // Winsorize at P5/P95, then scale to 0-100
        const p5Val = percentile(allValues, 5);
        const p95Val = percentile(allValues, 95);
        const raw = userMetrics[def.metric];
        const clipped = Math.max(p5Val, Math.min(p95Val, raw));
        let normalized = p95Val > p5Val ? ((clipped - p5Val) / (p95Val - p5Val)) * 100 : 50;

        // For inverted metrics, flip so higher = better
        if (def.inverted) normalized = 100 - normalized;

        domainScores.push({ domain, score: normalized });
    }

    if (domainScores.length === 0) return { composite: 50, domainScores: [] };

    const composite = domainScores.reduce((s, d) => s + d.score, 0) / domainScores.length;
    return { composite, domainScores };
}

// =============================================================================
// MAIN PUBLIC API
// =============================================================================

/**
 * Compute cluster-based peer comparison scores for a user.
 *
 * @param {Object} dbPool - Database pool (unused, we use imported pool)
 * @param {string} conceptId - 'lms', 'sleep', 'screen_time', 'social_media', 'srl'
 * @param {string} userId - Target user ID
 * @param {number} days - Look-back window (default 7)
 * @returns {Object} { clusterLabel, percentileScore, dialMin, dialCenter, dialMax, domains: [...] }
 */
async function computeClusterScores(dbPool, conceptId, userId, days = 7) {
    const allMetrics = await getAllUserMetrics(conceptId, days);

    if (!allMetrics[userId]) {
        logger.debug(`clusterPeerService: no ${conceptId} data for user ${userId}`);
        return null;
    }

    // SRL is special — variable dimensions
    if (conceptId === 'srl') {
        return computeSRLClusterScores(allMetrics, userId);
    }

    const dims = DIMENSION_DEFS[conceptId];
    if (!dims) return null;

    const userIds = Object.keys(allMetrics);
    const dimKeys = Object.keys(dims);

    // Build feature matrix for clustering (N users x D dimensions)
    // Winsorize at P5/P95, then scale to [0, 1]
    // This prevents outliers from compressing the majority of data into a narrow band
    const ranges = {};
    for (const dk of dimKeys) {
        const metric = dims[dk].metric;
        const allVals = userIds.map(uid => allMetrics[uid][metric]).filter(v => v != null).sort((a, b) => a - b);
        const p5Val = percentile(allVals, 5);
        const p95Val = percentile(allVals, 95);
        ranges[dk] = { p5: p5Val, p95: p95Val };
    }

    const featureMatrix = userIds.map(uid => {
        return dimKeys.map(dk => {
            const metric = dims[dk].metric;
            const raw = allMetrics[uid][metric] || 0;
            const { p5, p95 } = ranges[dk];
            // Winsorize: clip to [P5, P95]
            const clipped = Math.max(p5, Math.min(p95, raw));
            // Scale to [0, 1]
            let normalized = p95 > p5 ? (clipped - p5) / (p95 - p5) : 0.5;
            // For inverted metrics, flip so higher = better in feature space
            if (dims[dk].inverted) normalized = 1 - normalized;
            return normalized;
        });
    });

    // Select optimal K via BIC (tests K=2 to K=6), then fit final GMM
    const k = selectOptimalK(featureMatrix, 2, 6);
    const gmm = fitGMM(featureMatrix, k);
    logger.info(`${conceptId}: using K=${k} clusters for ${userIds.length} users`);

    // Compute composite scores for each user
    const composites = userIds.map((uid, idx) => ({
        userId: uid,
        composite: computeCompositeScore(allMetrics[uid], allMetrics, dims).composite,
        cluster: gmm.assignments[idx]
    }));

    // Order clusters by mean composite score (low→high)
    const clusterMeans = [];
    for (let c = 0; c < k; c++) {
        const members = composites.filter(u => u.cluster === c);
        const mean = members.length > 0
            ? members.reduce((s, u) => s + u.composite, 0) / members.length
            : 0;
        clusterMeans.push({ cluster: c, mean, count: members.length });
    }
    clusterMeans.sort((a, b) => a.mean - b.mean);

    // Build re-mapping: original cluster index → ordered index (0=worst, 2=best)
    const clusterRemap = {};
    clusterMeans.forEach((cm, orderedIdx) => {
        clusterRemap[cm.cluster] = orderedIdx;
    });

    // Find the user's cluster and percentile position
    const userIdx = userIds.indexOf(userId);
    const userOrigCluster = gmm.assignments[userIdx];
    const userOrderedCluster = clusterRemap[userOrigCluster];
    const userComposite = composites[userIdx].composite;

    // Get all composites in the user's cluster
    const clusterComposites = composites
        .filter(u => u.cluster === userOrigCluster)
        .map(u => u.composite)
        .sort((a, b) => a - b);

    const p5 = percentile(clusterComposites, 5);
    const p50 = percentile(clusterComposites, 50);
    const p95 = percentile(clusterComposites, 95);
    const userPercentile = mapToRange(userComposite, p5, p95);

    const labels = generateClusterLabels(k);
    const clusterLabel = labels[Math.min(userOrderedCluster, labels.length - 1)];

    // Store cluster definitions and assignment in DB
    await storeClusterResults(conceptId, composites, clusterRemap, clusterMeans, k, gmm);
    await storeUserAssignment(userId, conceptId, userOrderedCluster, clusterLabel, userPercentile);

    // Also compute per-domain results for the breakdown
    const { domainScores } = computeCompositeScore(allMetrics[userId], allMetrics, dims);
    const domainResults = domainScores.map(ds => {
        const category = ds.score >= 66 ? 'very_good' : ds.score >= 33 ? 'good' : 'requires_improvement';
        const categoryLabel = ds.score >= 66 ? 'Very Good' : ds.score >= 33 ? 'Good' : 'Could Improve';
        return {
            domain: ds.domain,
            numericScore: Math.round(ds.score * 100) / 100,
            category,
            categoryLabel
        };
    });

    return {
        clusterLabel,
        clusterIndex: userOrderedCluster,
        percentileScore: Math.round(userPercentile * 100) / 100,
        compositeScore: Math.round(userComposite * 100) / 100,
        dialMin: Math.round(p5 * 100) / 100,
        dialCenter: Math.round(p50 * 100) / 100,
        dialMax: Math.round(p95 * 100) / 100,
        userCount: clusterComposites.length,
        domains: domainResults
    };
}

/**
 * SRL-specific clustering (variable number of concept dimensions)
 */
async function computeSRLClusterScores(allMetrics, userId) {
    const userDims = allMetrics[userId];
    if (!userDims) return null;

    // Get all concept keys that appear across any user
    const allConceptKeys = new Set();
    for (const dims of Object.values(allMetrics)) {
        for (const key of Object.keys(dims)) allConceptKeys.add(key);
    }
    const conceptKeys = [...allConceptKeys].sort();

    if (conceptKeys.length === 0) return null;

    const userIds = Object.keys(allMetrics);

    // Build feature matrix: each user gets a vector of their scores for each concept
    const featureMatrix = userIds.map(uid => {
        return conceptKeys.map(ck => {
            const data = allMetrics[uid]?.[ck];
            if (!data) return 0.5; // default if concept not present
            let score = data.score / 5; // Normalize from 1-5 to 0-1 scale
            if (data.isInverted) score = 1 - score;
            return score;
        });
    });

    const k = selectOptimalK(featureMatrix, 2, 6);
    const gmm = fitGMM(featureMatrix, k);
    logger.info(`srl: using K=${k} clusters for ${userIds.length} users`);

    // Compute composite scores
    const composites = userIds.map((uid, idx) => {
        const scores = conceptKeys.map(ck => {
            const data = allMetrics[uid]?.[ck];
            if (!data) return 50;
            let s = (data.score / 5) * 100;
            if (data.isInverted) s = 100 - s;
            return s;
        });
        return {
            userId: uid,
            composite: scores.reduce((a, b) => a + b, 0) / scores.length,
            cluster: gmm.assignments[idx]
        };
    });

    // Order clusters
    const clusterMeans = [];
    for (let c = 0; c < k; c++) {
        const members = composites.filter(u => u.cluster === c);
        const mean = members.length > 0
            ? members.reduce((s, u) => s + u.composite, 0) / members.length
            : 0;
        clusterMeans.push({ cluster: c, mean, count: members.length });
    }
    clusterMeans.sort((a, b) => a.mean - b.mean);

    const clusterRemap = {};
    clusterMeans.forEach((cm, orderedIdx) => { clusterRemap[cm.cluster] = orderedIdx; });

    const userIdx = userIds.indexOf(userId);
    const userOrigCluster = gmm.assignments[userIdx];
    const userOrderedCluster = clusterRemap[userOrigCluster];
    const userComposite = composites[userIdx].composite;

    const clusterComposites = composites
        .filter(u => u.cluster === userOrigCluster)
        .map(u => u.composite)
        .sort((a, b) => a - b);

    const p5 = percentile(clusterComposites, 5);
    const p50 = percentile(clusterComposites, 50);
    const p95 = percentile(clusterComposites, 95);
    const userPercentile = mapToRange(userComposite, p5, p95);

    const srlLabels = generateClusterLabels(k);
    const clusterLabel = srlLabels[Math.min(userOrderedCluster, srlLabels.length - 1)];

    await storeClusterResults('srl', composites, clusterRemap, clusterMeans, k, gmm);
    await storeUserAssignment(userId, 'srl', userOrderedCluster, clusterLabel, userPercentile);

    // Per-domain results for SRL
    const domainResults = conceptKeys.map(ck => {
        const data = userDims[ck];
        if (!data) return { domain: ck, numericScore: 50, category: 'good', categoryLabel: 'Good' };
        let score = (data.score / 5) * 100;
        if (data.isInverted) score = 100 - score;
        const category = score >= 66 ? 'very_good' : score >= 33 ? 'good' : 'requires_improvement';
        const categoryLabel = score >= 66 ? 'Very Good' : score >= 33 ? 'Good' : 'Could Improve';
        return {
            domain: ck,
            numericScore: Math.round(score * 100) / 100,
            category,
            categoryLabel
        };
    });

    return {
        clusterLabel,
        clusterIndex: userOrderedCluster,
        percentileScore: Math.round(userPercentile * 100) / 100,
        compositeScore: Math.round(userComposite * 100) / 100,
        dialMin: Math.round(p5 * 100) / 100,
        dialCenter: Math.round(p50 * 100) / 100,
        dialMax: Math.round(p95 * 100) / 100,
        userCount: clusterComposites.length,
        domains: domainResults
    };
}

// =============================================================================
// DB STORAGE
// =============================================================================

async function storeClusterResults(conceptId, composites, clusterRemap, clusterMeans, k, gmm) {
    try {
        // Clean up stale clusters from previous runs with higher K
        await pool.query(
            `DELETE FROM public.peer_clusters WHERE concept_id = $1 AND cluster_index >= $2`,
            [conceptId, k]
        );

        const labels = generateClusterLabels(k);
        for (let origC = 0; origC < k; origC++) {
            const orderedIdx = clusterRemap[origC];
            const members = composites.filter(u => u.cluster === origC);
            const scores = members.map(u => u.composite).sort((a, b) => a - b);

            const p5Val = percentile(scores, 5);
            const p50Val = percentile(scores, 50);
            const p95Val = percentile(scores, 95);
            const label = labels[Math.min(orderedIdx, labels.length - 1)];

            await pool.query(
                `INSERT INTO public.peer_clusters
                 (concept_id, cluster_index, cluster_label, centroid, p5, p50, p95, user_count, computed_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 ON CONFLICT (concept_id, cluster_index) DO UPDATE SET
                   cluster_label = EXCLUDED.cluster_label,
                   centroid = EXCLUDED.centroid,
                   p5 = EXCLUDED.p5,
                   p50 = EXCLUDED.p50,
                   p95 = EXCLUDED.p95,
                   user_count = EXCLUDED.user_count,
                   computed_at = NOW()`,
                [conceptId, orderedIdx, label, JSON.stringify(gmm.means[origC] || []),
                    p5Val, p50Val, p95Val, members.length]
            );
        }
    } catch (err) {
        logger.error(`Error storing cluster results for ${conceptId}: ${err.message}`);
    }
}

async function storeUserAssignment(userId, conceptId, clusterIndex, clusterLabel, percentilePosition) {
    try {
        await pool.query(
            `INSERT INTO public.user_cluster_assignments
             (user_id, concept_id, cluster_index, cluster_label, percentile_position, assigned_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (user_id, concept_id) DO UPDATE SET
               cluster_index = EXCLUDED.cluster_index,
               cluster_label = EXCLUDED.cluster_label,
               percentile_position = EXCLUDED.percentile_position,
               assigned_at = NOW()`,
            [userId, conceptId, clusterIndex, clusterLabel, percentilePosition]
        );
    } catch (err) {
        logger.error(`Error storing user cluster assignment: ${err.message}`);
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    computeClusterScores,
    fitGMM,
    selectOptimalK,
    generateClusterLabels,
    percentile,
    mapToRange,
    computeCompositeScore,
    DIMENSION_DEFS
};
