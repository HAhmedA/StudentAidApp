// Cluster Peer Service
// Parsimonious Gaussian Mixture of Experts (PGMoE) for peer comparison
// Uses feature-dependent gating + parsimonious covariance models

/**
 * @typedef {Object} ClusterResult
 * @property {string} clusterLabel
 * @property {number} clusterIndex
 * @property {number} percentileScore
 * @property {number} compositeScore
 * @property {number} dialMin
 * @property {number} dialCenter
 * @property {number} dialMax
 * @property {number} userCount
 * @property {Array<{domain: string, numericScore: number, category: string, categoryLabel: string}>} domains
 */

//
// Flow:
//   1. Gather all users' raw metrics per concept
//   2. Winsorize at P5/P95, scale to [0,1], then center-normalize (zero mean, unit var)
//   3. Fit PGMoE: test all (K, covType) combos, select best via BIC+AIC+entropy
//   4. Assign each user to their most-likely cluster
//   5. Compute per-cluster percentiles (P5, P50, P95) on composite score
//   6. Map user's score to 0-100 within their cluster's P5-P95 range

import logger from '../../utils/logger.js';
import { getAllUserMetrics } from './scoreQueryService.js';
import {
    centerNormalize,
    fitPGMoE,
    selectOptimalModel,
    generateClusterLabels
} from './pgmoeAlgorithm.js';
import { storeClusterResults, storeUserAssignment } from './clusterStorageService.js';

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
        pre_sleep: { metric: 'late_night', inverted: true }
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
 * @param {string} conceptId - 'lms', 'sleep', 'screen_time', 'srl'
 * @param {string} userId - Target user ID
 * @param {number} days - Look-back window (default 7)
 * @returns {Object} { clusterLabel, percentileScore, dialMin, dialCenter, dialMax, domains: [...] }
 */
// Minimum number of real users required before PGMoE clustering is meaningful.
// Below this threshold the system returns { coldStart: true } and the dashboard
// shows a "Building your profile" placeholder instead of the gauge.
const MIN_CLUSTER_USERS = 10;

async function computeClusterScores(dbPool, conceptId, userId, days = 7) {
    const allMetrics = await getAllUserMetrics(conceptId, days);

    if (!allMetrics[userId]) {
        logger.debug(`clusterPeerService: no ${conceptId} data for user ${userId}`);
        return null;
    }

    // SRL is special — variable dimensions
    if (conceptId === 'srl') {
        const userCount = Object.keys(allMetrics).length;
        if (userCount < MIN_CLUSTER_USERS) {
            logger.info(`clusterPeerService: cold start for SRL (${userCount}/${MIN_CLUSTER_USERS} users)`);
            return { coldStart: true };
        }
        return computeSRLClusterScores(allMetrics, userId);
    }

    const dims = DIMENSION_DEFS[conceptId];
    if (!dims) return null;

    const userIds = Object.keys(allMetrics);

    // Cold start: not enough real users to form meaningful clusters yet.
    if (userIds.length < MIN_CLUSTER_USERS) {
        logger.info(`clusterPeerService: cold start for ${conceptId} (${userIds.length}/${MIN_CLUSTER_USERS} users)`);
        return { coldStart: true };
    }
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

    // Center-normalize for PGMoE (after Winsorize+scale, before model fitting)
    const { centered } = centerNormalize(featureMatrix);

    // Select optimal (K, covType) via composite BIC+AIC+entropy criterion
    const { k, covType, model } = selectOptimalModel(centered, 2, 4);
    logger.info(`${conceptId}: K=${k}, cov=${covType} for ${userIds.length} users`);

    // Compute composite scores for each user
    const composites = userIds.map((uid, idx) => ({
        userId: uid,
        composite: computeCompositeScore(allMetrics[uid], allMetrics, dims).composite,
        cluster: model.assignments[idx]
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
    const userOrigCluster = model.assignments[userIdx];
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
    await storeClusterResults(conceptId, composites, clusterRemap, clusterMeans, k, model);
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

    // Center-normalize for PGMoE
    const { centered: centeredSRL } = centerNormalize(featureMatrix);

    const { k, covType, model } = selectOptimalModel(centeredSRL, 2, 4);
    logger.info(`srl: K=${k}, cov=${covType} for ${userIds.length} users`);

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
            cluster: model.assignments[idx]
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
    const userOrigCluster = model.assignments[userIdx];
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

    await storeClusterResults('srl', composites, clusterRemap, clusterMeans, k, model);
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
// EXPORTS
// =============================================================================

export {
    computeClusterScores,
    DIMENSION_DEFS,
    // Re-exports from sub-modules for backwards compatibility
    fitPGMoE,
    selectOptimalModel,
    generateClusterLabels,
    centerNormalize,
    percentile,
    mapToRange,
    computeCompositeScore
};
