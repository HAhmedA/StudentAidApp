// PGMoE Algorithm — pure, stateless functions
// Parsimonious Gaussian Mixture of Experts (PGMoE)
// No database or pool usage; safe to import anywhere.

import logger from '../../utils/logger.js';

// =============================================================================
// PARSIMONIOUS GAUSSIAN MIXTURE OF EXPERTS (PGMoE)
// =============================================================================

/**
 * Center-normalize a feature matrix: zero mean, unit variance per dimension.
 * Returns { centered, means, stds } so we can un-normalize if needed.
 */
function centerNormalize(data) {
    const n = data.length;
    const d = data[0].length;
    const means = new Array(d).fill(0);
    const stds = new Array(d).fill(0);

    // Compute means
    for (const row of data) {
        for (let j = 0; j < d; j++) means[j] += row[j] / n;
    }
    // Compute standard deviations
    for (const row of data) {
        for (let j = 0; j < d; j++) stds[j] += (row[j] - means[j]) ** 2 / n;
    }
    for (let j = 0; j < d; j++) stds[j] = Math.sqrt(Math.max(stds[j], 1e-10));

    // Center and scale
    const centered = data.map(row =>
        row.map((v, j) => (v - means[j]) / stds[j])
    );

    return { centered, means, stds };
}

/**
 * Gaussian PDF (log-domain for numerical stability).
 * Supports both per-component diagonal variance and shared variance.
 */
function gaussianLogPDF(x, mean, variance) {
    const d = x.length;
    let logP = -0.5 * d * Math.log(2 * Math.PI);
    for (let i = 0; i < d; i++) {
        const v = Math.max(variance[i], 1e-6);
        logP -= 0.5 * Math.log(v);
        logP -= 0.5 * ((x[i] - mean[i]) ** 2) / v;
    }
    return logP;
}

function gaussianPDF(x, mean, variance) {
    return Math.exp(gaussianLogPDF(x, mean, variance));
}

/**
 * Softmax gating network: g_k(x) = softmax(W * x + b)
 * First class is reference (W[0]=0, b[0]=0) for identifiability.
 *
 * @param {number[]} x - Feature vector (D)
 * @param {number[][]} W - Weight matrix (K x D), W[0] is zeros
 * @param {number[]} b - Bias vector (K), b[0] is 0
 * @returns {number[]} - Gating probabilities (K), sums to 1
 */
function gatingProbs(x, W, b) {
    const k = W.length;
    const logits = new Array(k);
    let maxLogit = -Infinity;

    for (let c = 0; c < k; c++) {
        let z = b[c];
        for (let j = 0; j < x.length; j++) z += W[c][j] * x[j];
        logits[c] = z;
        if (z > maxLogit) maxLogit = z;
    }

    // Numerically stable softmax
    let sumExp = 0;
    const probs = new Array(k);
    for (let c = 0; c < k; c++) {
        probs[c] = Math.exp(logits[c] - maxLogit);
        sumExp += probs[c];
    }
    for (let c = 0; c < k; c++) probs[c] /= sumExp;

    return probs;
}

/**
 * Update gating parameters (W, b) via IRLS (one Newton-Raphson step per iteration).
 * Treats responsibilities as soft labels for multinomial logistic regression.
 * Component 0 is reference class (W[0]=0, b[0]=0).
 *
 * @param {number[][]} data - N x D feature matrix
 * @param {number[][]} responsibilities - N x K responsibilities
 * @param {number[][]} W - Current K x D weight matrix
 * @param {number[]} b - Current K bias vector
 * @param {number} learningRate - Step size (default 0.1 for stability)
 * @param {number} nSteps - Number of gradient steps per M-step
 */
function updateGating(data, responsibilities, W, b, learningRate = 0.1, nSteps = 3) {
    const n = data.length;
    const d = data[0].length;
    const k = W.length;

    for (let step = 0; step < nSteps; step++) {
        // Compute gradients for each non-reference component (c >= 1)
        for (let c = 1; c < k; c++) {
            const gradW = new Array(d).fill(0);
            let gradB = 0;

            for (let i = 0; i < n; i++) {
                const g = gatingProbs(data[i], W, b);
                const diff = responsibilities[i][c] - g[c];
                for (let j = 0; j < d; j++) {
                    gradW[j] += diff * data[i][j];
                }
                gradB += diff;
            }

            // Gradient ascent with L2 regularization (lambda = 0.01)
            const lambda = 0.01;
            for (let j = 0; j < d; j++) {
                W[c][j] += learningRate * (gradW[j] / n - lambda * W[c][j]);
            }
            b[c] += learningRate * (gradB / n);
        }
    }
}

/**
 * Compute covariance under different parsimonious constraints.
 *
 * @param {number[][]} data - N x D
 * @param {number[][]} responsibilities - N x K
 * @param {number[][]} means - K x D means
 * @param {number} k - Number of components
 * @param {string} covType - 'EII' | 'VII' | 'EEI' | 'VVI'
 * @returns {number[][][]} - K arrays, each D-length (diagonal variances)
 */
function computeParsimonousCovariance(data, responsibilities, means, k, covType) {
    const n = data.length;
    const d = means[0].length;
    const FLOOR = 1e-6;

    if (covType === 'EII') {
        // Equal spherical: single σ² shared across all clusters & dimensions
        let totalVar = 0;
        let totalWeight = 0;
        for (let c = 0; c < k; c++) {
            for (let i = 0; i < n; i++) {
                const r = responsibilities[i][c];
                for (let j = 0; j < d; j++) {
                    totalVar += r * (data[i][j] - means[c][j]) ** 2;
                }
                totalWeight += r;
            }
        }
        const sigma2 = Math.max(totalVar / (totalWeight * d), FLOOR);
        return Array.from({ length: k }, () => new Array(d).fill(sigma2));
    }

    if (covType === 'VII') {
        // Varying spherical: σ_k² per cluster, shared across dimensions
        const variances = [];
        for (let c = 0; c < k; c++) {
            let clusterVar = 0;
            let Nc = 0;
            for (let i = 0; i < n; i++) {
                const r = responsibilities[i][c];
                for (let j = 0; j < d; j++) {
                    clusterVar += r * (data[i][j] - means[c][j]) ** 2;
                }
                Nc += r;
            }
            const sigma2 = Math.max(clusterVar / (Math.max(Nc, FLOOR) * d), FLOOR);
            variances.push(new Array(d).fill(sigma2));
        }
        return variances;
    }

    if (covType === 'EEI') {
        // Equal diagonal: diag(Σ) shared across clusters
        const sharedVar = new Array(d).fill(0);
        let totalWeight = 0;
        for (let c = 0; c < k; c++) {
            for (let i = 0; i < n; i++) {
                const r = responsibilities[i][c];
                for (let j = 0; j < d; j++) {
                    sharedVar[j] += r * (data[i][j] - means[c][j]) ** 2;
                }
                totalWeight += r;
            }
        }
        for (let j = 0; j < d; j++) sharedVar[j] = Math.max(sharedVar[j] / totalWeight, FLOOR);
        return Array.from({ length: k }, () => [...sharedVar]);
    }

    // VVI: varying diagonal (default, most flexible)
    const variances = [];
    for (let c = 0; c < k; c++) {
        const v = new Array(d).fill(0);
        let Nc = 0;
        for (let i = 0; i < n; i++) {
            const r = responsibilities[i][c];
            for (let j = 0; j < d; j++) {
                v[j] += r * (data[i][j] - means[c][j]) ** 2;
            }
            Nc += r;
        }
        for (let j = 0; j < d; j++) v[j] = Math.max(v[j] / Math.max(Nc, FLOOR), FLOOR);
        variances.push(v);
    }
    return variances;
}

/**
 * Count free parameters for a given (K, D, covType) configuration.
 * Includes gating params: (K-1) * (D+1) for softmax regression.
 */
function countParams(k, d, covType) {
    // Gating: (K-1) weight vectors of size D, plus (K-1) biases
    const gatingParams = (k - 1) * (d + 1);
    // Means: K * D
    const meanParams = k * d;
    // Covariance depends on type
    let covParams;
    switch (covType) {
        case 'EII': covParams = 1; break;          // One shared σ²
        case 'VII': covParams = k; break;           // σ_k² per cluster
        case 'EEI': covParams = d; break;           // Shared diagonal
        case 'VVI': covParams = k * d; break;       // Per-cluster diagonal
        default: covParams = k * d;
    }
    return gatingParams + meanParams + covParams;
}

/**
 * K-Means++ initialization for centroids.
 */
function kMeansPPInit(data, k) {
    const n = data.length;
    const d = data[0].length;
    const means = [];

    means.push([...data[Math.floor(Math.random() * n)]]);

    for (let c = 1; c < k; c++) {
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
        let r = Math.random() * totalDist;
        let idx = 0;
        for (let i = 0; i < n; i++) {
            r -= dists[i];
            if (r <= 0) { idx = i; break; }
        }
        means.push([...data[idx]]);
    }

    return means;
}

/**
 * Fit a Parsimonious Gaussian Mixture of Experts using EM.
 *
 * @param {number[][]} data - N x D feature matrix (should be center-normalized)
 * @param {number} k - Number of components
 * @param {string} covType - 'EII' | 'VII' | 'EEI' | 'VVI'
 * @param {number} maxIter - Maximum EM iterations
 * @param {number} tol - Log-likelihood convergence tolerance
 * @returns {{ means, variances, W, b, assignments, responsibilities, logLikelihood, covType }}
 */
function fitPGMoE(data, k, covType = 'VVI', maxIter = 50, tol = 1e-4) {
    const n = data.length;
    const d = data[0].length;

    // Edge case: fewer data points than clusters
    if (n <= k) {
        const assignments = data.map((_, i) => Math.min(i, k - 1));
        const responsibilities = data.map((_, i) => {
            const row = new Array(k).fill(0);
            row[Math.min(i, k - 1)] = 1;
            return row;
        });
        const means = [];
        for (let c = 0; c < k; c++) {
            const pts = data.filter((_, i) => assignments[i] === c);
            means.push(pts.length > 0 ? pts[0].slice() : new Array(d).fill(0));
        }
        const variances = Array.from({ length: k }, () => new Array(d).fill(1));
        const W = Array.from({ length: k }, () => new Array(d).fill(0));
        const b = new Array(k).fill(0);
        return { means, variances, W, b, assignments, responsibilities, logLikelihood: -Infinity, covType };
    }

    // Initialize means via K-Means++
    let means = kMeansPPInit(data, k);

    // Initialize gating: zero weights (uniform gating to start)
    let W = Array.from({ length: k }, () => new Array(d).fill(0));
    let b = new Array(k).fill(0);

    // Initialize responsibilities uniformly, then compute initial covariance
    let responsibilities = Array.from({ length: n }, () => new Array(k).fill(1 / k));

    // Initial hard assignment to nearest mean for better covariance init
    for (let i = 0; i < n; i++) {
        let bestC = 0;
        let bestDist = Infinity;
        for (let c = 0; c < k; c++) {
            let dist = 0;
            for (let j = 0; j < d; j++) dist += (data[i][j] - means[c][j]) ** 2;
            if (dist < bestDist) { bestDist = dist; bestC = c; }
        }
        responsibilities[i] = new Array(k).fill(0);
        responsibilities[i][bestC] = 1;
    }

    let variances = computeParsimonousCovariance(data, responsibilities, means, k, covType);

    // Reset to soft responsibilities
    responsibilities = Array.from({ length: n }, () => new Array(k).fill(1 / k));

    let prevLogL = -Infinity;
    let logLikelihood = -Infinity;

    for (let iter = 0; iter < maxIter; iter++) {
        // ===== E-Step: compute responsibilities =====
        logLikelihood = 0;

        for (let i = 0; i < n; i++) {
            const gate = gatingProbs(data[i], W, b);
            let totalP = 0;
            for (let c = 0; c < k; c++) {
                const gp = gaussianPDF(data[i], means[c], variances[c]);
                responsibilities[i][c] = gate[c] * gp;
                totalP += responsibilities[i][c];
            }
            if (totalP > 0) {
                for (let c = 0; c < k; c++) responsibilities[i][c] /= totalP;
                logLikelihood += Math.log(totalP);
            } else {
                for (let c = 0; c < k; c++) responsibilities[i][c] = 1 / k;
            }
        }

        // Check convergence
        if (Math.abs(logLikelihood - prevLogL) < tol) {
            logger.debug(`PGMoE(${covType},K=${k}) converged at iter ${iter}, logL=${logLikelihood.toFixed(4)}`);
            break;
        }
        prevLogL = logLikelihood;

        // ===== M-Step =====

        // 1. Update gating network (W, b) via gradient ascent
        updateGating(data, responsibilities, W, b);

        // 2. Update means
        for (let c = 0; c < k; c++) {
            let Nc = 0;
            for (let i = 0; i < n; i++) Nc += responsibilities[i][c];
            if (Nc < 1e-10) continue;

            const newMean = new Array(d).fill(0);
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < d; j++) {
                    newMean[j] += responsibilities[i][c] * data[i][j];
                }
            }
            for (let j = 0; j < d; j++) newMean[j] /= Nc;
            means[c] = newMean;
        }

        // 3. Update covariance with parsimony constraints
        variances = computeParsimonousCovariance(data, responsibilities, means, k, covType);
    }

    // Hard assignments via argmax
    const assignments = responsibilities.map(row => {
        let maxIdx = 0;
        for (let c = 1; c < k; c++) {
            if (row[c] > row[maxIdx]) maxIdx = c;
        }
        return maxIdx;
    });

    return { means, variances, W, b, assignments, responsibilities, logLikelihood, covType };
}

/**
 * Compute classification entropy of responsibilities.
 * Returns normalized value in [0, 1] where 1 = perfectly crisp, 0 = max ambiguity.
 */
function computeNormalizedEntropy(responsibilities, n, k) {
    if (k <= 1 || n === 0) return 1;
    let entropy = 0;
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < k; c++) {
            const r = Math.max(responsibilities[i][c], 1e-300);
            entropy -= r * Math.log(r);
        }
    }
    // Max possible entropy = n * log(k) (uniform assignments)
    const maxEntropy = n * Math.log(k);
    // Normalized: 1 = crisp, 0 = ambiguous
    return maxEntropy > 0 ? 1 - (entropy / maxEntropy) : 1;
}

/**
 * Select optimal (K, covType) using composite criterion:
 * rank-based combination of BIC (40%), AIC (30%), and normalized entropy (30%).
 *
 * @param {number[][]} data - Center-normalized feature matrix (N x D)
 * @param {number} kMin - Minimum K to test (default 2)
 * @param {number} kMax - Maximum K to test (default 6)
 * @returns {{ k, covType, model }} - Best K, covariance type, and fitted model
 */
function selectOptimalModel(data, kMin = 2, kMax = 6) {
    const n = data.length;
    const d = data[0].length;
    const COV_TYPES = ['EII', 'VII', 'EEI', 'VVI'];

    kMax = Math.min(kMax, n);
    kMin = Math.min(kMin, kMax);

    const candidates = [];

    for (const covType of COV_TYPES) {
        for (let k = kMin; k <= kMax; k++) {
            const model = fitPGMoE(data, k, covType);
            const logL = model.logLikelihood;
            const p = countParams(k, d, covType);

            const bic = -2 * logL + p * Math.log(n);
            const aic = -2 * logL + 2 * p;
            const entropy = computeNormalizedEntropy(model.responsibilities, n, k);

            candidates.push({ k, covType, model, bic, aic, entropy, logL, p });
        }
    }

    if (candidates.length === 0) {
        // Fallback
        const model = fitPGMoE(data, kMin, 'VVI');
        return { k: kMin, covType: 'VVI', model };
    }

    // Rank each candidate on each criterion (lower rank = better)
    // BIC: lower is better → sort ascending
    const bicSorted = [...candidates].sort((a, b) => a.bic - b.bic);
    // AIC: lower is better → sort ascending
    const aicSorted = [...candidates].sort((a, b) => a.aic - b.aic);
    // Entropy: higher is better → sort descending
    const entSorted = [...candidates].sort((a, b) => b.entropy - a.entropy);

    const bicRank = new Map();
    const aicRank = new Map();
    const entRank = new Map();
    bicSorted.forEach((c, i) => bicRank.set(c, i));
    aicSorted.forEach((c, i) => aicRank.set(c, i));
    entSorted.forEach((c, i) => entRank.set(c, i));

    // Composite score: weighted sum of ranks
    let bestCandidate = candidates[0];
    let bestScore = Infinity;

    for (const c of candidates) {
        const score = 0.4 * bicRank.get(c) + 0.3 * aicRank.get(c) + 0.3 * entRank.get(c);

        logger.debug(`  K=${c.k} ${c.covType}: BIC=${c.bic.toFixed(1)}, AIC=${c.aic.toFixed(1)}, ` +
            `entropy=${c.entropy.toFixed(3)}, composite=${score.toFixed(2)}`);

        if (score < bestScore) {
            bestScore = score;
            bestCandidate = c;
        }
    }

    logger.info(`Selected: K=${bestCandidate.k}, cov=${bestCandidate.covType}, ` +
        `BIC=${bestCandidate.bic.toFixed(1)}, AIC=${bestCandidate.aic.toFixed(1)}, ` +
        `entropy=${bestCandidate.entropy.toFixed(3)}, compositeRank=${bestScore.toFixed(2)}`);

    return {
        k: bestCandidate.k,
        covType: bestCandidate.covType,
        model: bestCandidate.model
    };
}

/**
 * Generate human-readable cluster labels for any K.
 * Labels are ordered from worst (index 0) to best (index K-1).
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
    const labels = [];
    for (let i = 0; i < k; i++) {
        const fraction = i / (k - 1);
        if (fraction < 0.25) labels.push('Students building stronger habits');
        else if (fraction > 0.75) labels.push('Students with strong habits');
        else labels.push(`Students with balanced patterns (group ${i})`);
    }
    return labels;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    centerNormalize,
    gaussianLogPDF,
    gaussianPDF,
    gatingProbs,
    updateGating,
    computeParsimonousCovariance,
    countParams,
    kMeansPPInit,
    fitPGMoE,
    computeNormalizedEntropy,
    selectOptimalModel,
    generateClusterLabels
};
