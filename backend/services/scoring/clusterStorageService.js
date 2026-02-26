// Cluster Storage Service
// Handles persisting PGMoE cluster results and user assignments to the database.

import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import { withTransaction } from '../../utils/withTransaction.js';
import { generateClusterLabels } from './pgmoeAlgorithm.js';

// =============================================================================
// LOCAL HELPERS
// =============================================================================

/**
 * Compute percentile of a sorted array at a given percentile (0-100).
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

// =============================================================================
// DB STORAGE
// =============================================================================

async function storeClusterResults(conceptId, composites, clusterRemap, clusterMeans, k, model) {
    try {
        await withTransaction(pool, async (client) => {
            // Clean up stale clusters from previous runs with higher K
            await client.query(
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

                await client.query(
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
                    [conceptId, orderedIdx, label, JSON.stringify(model.means[origC] || []),
                        p5Val, p50Val, p95Val, members.length]
                );
            }
        });
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

export { storeClusterResults, storeUserAssignment };
