# Peer Comparison & Scoring System — Full Documentation

> **Last updated:** 2026-02-24  
> This document explains the complete pipeline from raw data → clustering → scoring → gauge visualization.

---

## Table of Contents

1. [Overview](#overview)
2. [Data Sources & Simulators](#data-sources--simulators)
3. [Annotation Services](#annotation-services)
4. [Clustering Engine (GMM)](#clustering-engine-gmm)
5. [Scoring Pipeline](#scoring-pipeline)
6. [Historical Score Seeding](#historical-score-seeding)
7. [API Layer](#api-layer)
8. [Frontend — Gauge Visualization](#frontend--gauge-visualization)
9. [Frontend — Detailed Breakdown](#frontend--detailed-breakdown)
10. [Admin Dashboard](#admin-dashboard)
11. [Database Schema](#database-schema)
12. [File Reference](#file-reference)

---

## Overview

The system compares each student against **peers with similar behavioral patterns** using Gaussian Mixture Model (GMM) clustering. Instead of a simple average or Z-score, students are grouped into **K behavioral clusters** per concept (K is automatically selected via BIC, typically 2–6), and their score is expressed as a percentile within their cluster.

The gauge visualization shows **two arrow needles**:
- **Today** (black arrow) — the student's current score
- **Yesterday** (gray arrow) — the student's score from the previous day

The dial ranges from **"Needs Improvement"** (left/red) to **"Good"** (right/green), mapped to the cluster's P5–P95 percentile range.

### High-Level Flow

```
Raw Data (simulators)
    ↓
Annotation Services (per-concept judgments)
    ↓
Cluster Peer Service (GMM clustering + percentile scoring)
    ↓
Score Computation Service (composite score + storage)
    ↓
Scores API (/api/scores)
    ↓
Frontend (ScoreGauge + Home page)
```

---

## Data Sources & Simulators

Each concept has a **simulator** that generates realistic data for test accounts. Simulators produce 7 days of historical data based on student profiles (`high_achiever`, `average`, `low_achiever`).

| Concept | Simulator File | Data Table | Key Metrics |
|---|---|---|---|
| Sleep | `sleepDataSimulator.js` | `sleep_sessions` | total_sleep_minutes, awakenings_count, bedtime |
| Screen Time | `screenTimeDataSimulator.js` | `screen_time_sessions` | total_screen_minutes, longest_session, late_night_minutes |
| Social Media | `socialMediaDataSimulator.js` | `social_media_sessions` | total_social_minutes, number_of_checks, avg_session_length |
| LMS | `lmsDataSimulator.js` | `lms_sessions` | total_active_minutes, days_active, active_percent, avg_session_duration |
| SRL | `srlDataSimulator.js` | `srl_responses` | 14 Likert-scale concept scores (1–5) |

**Orchestrator:** `simulationOrchestratorService.js` coordinates all simulators, assigns profiles via round-robin, and triggers score computation after data generation.

---

## Annotation Services

Each concept has an **annotation service** that:
1. Fetches raw session data from the database
2. Applies rule-based judgments (e.g., "LMS activity was low")
3. Calls the clustering engine for peer comparison
4. Returns per-domain scores with cluster metadata

| Concept | Annotation Service | Domains |
|---|---|---|
| Sleep | `sleepAnnotationService.js` | duration, continuity, timing |
| Screen Time | `screenTimeAnnotationService.js` | volume, distribution, late_night |
| Social Media | `socialMediaAnnotationService.js` | volume, frequency, session_style |
| LMS | `lmsAnnotationService.js` | volume, consistency, action_mix, session_quality |
| SRL | `srlAnnotationService.js` | 14 concept keys (goal_setting, planning, etc.) |

Each annotation service's `getRawScoresForScoring()` function calls:
```javascript
const { computeClusterScores } = await import('../scoring/clusterPeerService.js');
const clusterResult = await computeClusterScores(pool, 'sleep', userId);
```

And returns domain scores enriched with:
- `clusterLabel` — human-readable cluster name
- `dialMin` / `dialCenter` / `dialMax` — P5, P50, P95 percentiles

---

## Clustering Engine (GMM)

**File:** `backend/services/scoring/clusterPeerService.js`

### Algorithm

The system uses a **Gaussian Mixture Model** fitted via the **Expectation-Maximization (EM) algorithm**. The number of clusters **K is automatically selected** using BIC (Bayesian Information Criterion), testing K=2 through K=6.

#### Step-by-step:

1. **Gather metrics** — Query all users' raw metrics for the concept (last 7 days)
2. **Build feature matrix** — Winsorize each dimension at P5/P95, then scale to [0, 1]. This prevents outliers from compressing the majority of data into a narrow band. Inverted metrics (where less = better, e.g., screen time) are flipped so higher always = better
3. **Select optimal K** — Fit GMM for each K from 2 to 6, compute BIC for each, select the K with the lowest BIC (best fit with fewest parameters)
4. **Initialize GMM** — K-Means++ seeding for centroids, uniform weights, global variance
5. **Run EM** — Up to 50 iterations with log-likelihood convergence check (tolerance 1e-4)
   - **E-step:** Compute responsibilities (probability each point belongs to each cluster)
   - **M-step:** Update means, variances, and mixing weights
6. **Hard assignment** — Each user is assigned to their most-likely cluster via argmax
7. **Order clusters** — Sort by mean composite score (low → high) to assign labels
8. **Compute percentiles** — Within each cluster, compute P5, P50, P95 of composite scores
9. **Map user score** — User's composite score is mapped to 0–100 within their cluster's P5–P95 range

### Normalization: Winsorized P5/P95

Instead of naive min-max scaling (where a single outlier compresses everyone else), each dimension is:

1. **Sorted** across all users
2. **Clipped** to the [P5, P95] range — extreme values are capped
3. **Scaled** to [0, 1] using P5 as the new min and P95 as the new max

```javascript
const clipped = Math.max(p5, Math.min(p95, raw));
const normalized = (clipped - p5) / (p95 - p5);  // 0 to 1
```

### Optimal K Selection (BIC)

The **Bayesian Information Criterion** balances model fit against complexity:

```
BIC = -2 · logL + numParams · ln(n)
```

- **logL** — log-likelihood of the data under the fitted GMM
- **numParams** — number of free parameters: `k × (2d + 1) - 1` for K components, D dimensions
- **n** — number of data points (users)

Lower BIC = better. The system tests K=2 through K=6 and picks the minimum.

#### Example with 20 test users:

| Concept | Optimal K | BIC |
|---|---|---|
| Sleep | 6 | -42.26 |
| Screen Time | 6 | -125.10 |
| Social Media | 5 | -105.13 |
| LMS | 6 | -203.79 |
| SRL | 5 | -728.90 |

### Dimension Definitions

```javascript
const DIMENSION_DEFS = {
    lms: {
        volume:          { metric: 'total_active_minutes', inverted: false },
        consistency:     { metric: 'days_active',          inverted: false },
        action_mix:      { metric: 'active_percent',       inverted: false },
        session_quality: { metric: 'avg_session_duration', inverted: false }
    },
    sleep: {
        duration:   { metric: 'sleep_minutes',   inverted: false },
        continuity: { metric: 'awakenings',      inverted: true  },
        timing:     { metric: 'bedtime_stddev',  inverted: true  }
    },
    screen_time: {
        volume:       { metric: 'screen_minutes',   inverted: true },
        distribution: { metric: 'longest_session',  inverted: true },
        late_night:   { metric: 'late_night',        inverted: true }
    },
    social_media: {
        volume:        { metric: 'social_minutes',      inverted: true },
        frequency:     { metric: 'number_of_checks',    inverted: true },
        session_style: { metric: 'avg_session_length',  inverted: true }
    }
};
```

> **Inverted = true** means lower raw values are better (e.g., fewer awakenings, less screen time). The normalization flips these so that higher scores always = better in the composite.

### Dynamic Cluster Labels

Labels are generated dynamically via `generateClusterLabels(k)` based on the selected K:

| K | Labels (ordered worst → best) |
|---|---|
| 2 | "Students building stronger habits" → "Students with strong habits" |
| 3 | "Students building stronger habits" → "Students with balanced patterns" → "Students with strong habits" |
| 4+ | Interpolated labels with group numbers for middle tiers |

### SRL Special Handling

SRL uses variable-dimension clustering where each SRL concept key becomes a feature dimension. Scores are normalized from the 1–5 Likert scale to [0, 1]. Inverted concepts (e.g., anxiety) are flipped. K is selected via BIC just like other concepts.

---

## Scoring Pipeline

**File:** `backend/services/scoring/scoreComputationService.js`

### `computeAllScores(userId)`

1. For each concept (sleep, lms, screen_time, social_media, srl):
   - Calls the annotation service's `getRawScoresForScoring()`
   - Receives per-domain scores + cluster metadata
   - Computes a weighted composite score (0–100)
   - Computes `avg_7d` — the rolling average of daily scores from the past 7 days (excluding today), queried from `concept_score_history`
   - Determines `trend` by comparing today's score to `avg_7d`: **improving** (≥ +10 points), **declining** (≤ -10 points), or **stable** (within ±10)
2. Stores the score in `concept_scores` (current) and `concept_score_history` (daily snapshot)
3. Returns an object mapping concept IDs → `{ score, trend, breakdown }`

> **Note:** The `trend` field (improving/declining/stable) is a **long-term** indicator comparing today vs. the 7-day average with a ±10 threshold. This is separate from the **breakdown badges** (Improving/Unchanged/Declining), which compare today vs. yesterday only with a ±2 threshold.

### Score Storage

| Table | Purpose | Key Fields |
|---|---|---|
| `concept_scores` | Current score (upserted per user+concept) | score, trend, aspect_breakdown, avg_7d |
| `concept_score_history` | Daily snapshot for trend calculation | score, score_date |
| `peer_clusters` | Cluster definitions per concept | centroid, p5, p50, p95, user_count |
| `user_cluster_assignments` | User → cluster mapping | cluster_index, cluster_label, percentile_position |

---

## Historical Score Seeding

**File:** `backend/services/simulationOrchestratorService.js` → `seedScoreHistory()`

After `computeAllScores()` runs for simulated users, `seedScoreHistory()` backfills the past **6 days** in `concept_score_history` with realistic daily variations:

```javascript
// ±8 point random variation from base score
const variation = (Math.random() - 0.5) * 16;
const dayScore = Math.max(0, Math.min(100, baseScore + variation));
```

This ensures the **Yesterday needle** always has data to display for simulated test accounts.

---

## API Layer

### `GET /api/scores` — Student Scores

**File:** `backend/routes/scores.js`

Returns all concept scores for the authenticated user, enriched with:

```json
{
  "scores": [
    {
      "conceptId": "sleep",
      "conceptName": "Sleep Quality",
      "score": 72.5,
      "trend": "improving",
      "avg7d": 68.3,
      "breakdown": { "duration": {...}, "continuity": {...}, "timing": {...} },
      "yesterdayScore": 65.2,
      "clusterLabel": "Students with balanced patterns",
      "dialMin": 35.5,
      "dialCenter": 55.0,
      "dialMax": 85.2,
      "computedAt": "2026-02-23T18:00:00Z"
    }
  ]
}
```

**Yesterday score:** Fetched from `concept_score_history` for `CURRENT_DATE - 1`.

**Cluster info:** Joined from `user_cluster_assignments` + `peer_clusters` to get P5/P50/P95.

---

## Frontend — Gauge Visualization

**File:** `src/components/ScoreGauge.tsx`

### SVG Gauge Structure

The gauge is a 180° arc rendered as an SVG:

```
         Gradient Arc (P5 → P95)
        /                        \
   Needs                          Good
   Improvement
        \     ↑Today  ↑Yesterday  /
         ● ──────────────────── ●
              Center dot
```

### Key Visual Elements

| Element | Description |
|---|---|
| **Gradient arc** | 20 segments transitioning red (#ef4444) → yellow (#eab308) → green (#22c55e → #15803d) |
| **Today needle** | Black arrow (shaft + arrowhead), rotated to score position on the arc |
| **Yesterday needle** | Gray arrow, same shape. If no data: faded (25% opacity) at dial center |
| **Edge labels** | "Needs Improvement" (left) and "Good" (right) |
| **Legend** | Arrow icons for Today and Yesterday |
| **Center dot** | White circle with dark inner dot |

### Score-to-Angle Mapping

```typescript
const fraction = (score - dialMin) / (dialMax - dialMin); // 0 to 1
const clampedFraction = Math.max(0, Math.min(1, fraction));
const angle = START_ANGLE + clampedFraction * (END_ANGLE - START_ANGLE);
// START_ANGLE = -180° (left), END_ANGLE = 0° (right)
```

### Props

| Prop | Type | Description |
|---|---|---|
| `score` | number | Today's composite score (0–100) |
| `yesterdayScore` | number \| null | Yesterday's score, or null if unavailable |
| `dialMin` | number | P5 percentile (left edge of arc) |
| `dialCenter` | number | P50 percentile (median) |
| `dialMax` | number | P95 percentile (right edge of arc) |
| `clusterLabel` | string \| null | Cluster name (currently not displayed on gauge) |
| `label` | string | Concept name displayed as title |
| `trend` | string | 'improving' / 'declining' / 'stable' |

---

## Frontend — Detailed Breakdown

**File:** `src/pages/Home.tsx`

When a user clicks a gauge, the detailed breakdown expands with:

### Badge (Self-Comparison)

Compares today's concept score to yesterday's:

| Condition | Badge | Color |
|---|---|---|
| `today - yesterday > 2` | **Improving** | Green (#15803d) |
| `today - yesterday < -2` | **Declining** | Red (#dc2626) |
| Within ±2 points | **Unchanged** | Gray (#6b7280) |
| No yesterday data | **New** | Gray (#6b7280) |

### Label (Dial Position)

Describes where the Today arrow sits on the dial relative to peers:

| Position (0–1 within P5–P95) | Text |
|---|---|
| ≥ 0.85 | "Near the top of your peer group" |
| ≥ 0.60 | "Above the median of your peer group" |
| ≥ 0.40 | "Around the median of your peer group" |
| ≥ 0.15 | "Below the median of your peer group" |
| < 0.15 | "In the lower range of your peer group" |

### Domain Info Tooltips

Each domain name has an ℹ icon. Hovering reveals what the metric measures and whether more or less is better. Examples:

- **Volume** (Screen Time): "Total daily screen time. Less is better."
- **Continuity** (Sleep): "Number of awakenings per night. Fewer is better."
- **Action Mix** (LMS): "Ratio of active vs passive learning. Higher active % is better."

---

## Admin Dashboard

**File:** `src/pages/Home.tsx` (admin section)

Admin users see a **student selector dropdown** that loads from `/api/admin/students`. When a student is selected:

1. **Scores** are fetched from `/api/admin/students/:id/scores`
2. **Annotations** are fetched from `/api/admin/students/:id/annotations`
3. The full student dashboard renders with gauges, breakdowns, and mood cards — identical to the student's own view

---

## Database Schema

### Peer Clusters

```sql
-- File: postgres/initdb/011_peer_clusters.sql

CREATE TABLE public.peer_clusters (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    concept_id      varchar(30) NOT NULL,
    cluster_index   integer NOT NULL,           -- 0 to K-1 (ordered worst→best, K is dynamic)
    cluster_label   varchar(100) NOT NULL,
    centroid        jsonb NOT NULL DEFAULT '{}',
    p5              numeric(7,2) NOT NULL,      -- 5th percentile composite
    p50             numeric(7,2) NOT NULL,      -- 50th percentile (median)
    p95             numeric(7,2) NOT NULL,      -- 95th percentile composite
    user_count      integer NOT NULL DEFAULT 0,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT unique_cluster UNIQUE (concept_id, cluster_index)
);

CREATE TABLE public.user_cluster_assignments (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             uuid NOT NULL REFERENCES public.users(id),
    concept_id          varchar(30) NOT NULL,
    cluster_index       integer NOT NULL,
    cluster_label       varchar(100),
    percentile_position numeric(5,2),
    assigned_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT unique_user_cluster UNIQUE (user_id, concept_id)
);
```

### Score History

```sql
-- File: postgres/initdb/010_concept_scores.sql

CREATE TABLE public.concept_score_history (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     uuid NOT NULL REFERENCES public.users(id),
    concept_id  varchar(30) NOT NULL,
    score       numeric(5,2) NOT NULL,
    score_date  date NOT NULL,
    computed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT unique_concept_score_history UNIQUE (user_id, concept_id, score_date)
);
```

---

## File Reference

### Backend

| File | Purpose |
|---|---|
| `services/scoring/clusterPeerService.js` | GMM clustering engine, BIC model selection, Winsorized normalization, dynamic cluster labels |
| `services/scoring/scoreComputationService.js` | Orchestrates per-concept score computation |
| `services/scoring/conceptScoreService.js` | Score storage, 7-day average, history tracking |
| `services/simulationOrchestratorService.js` | Coordinates simulators + seeds historical scores |
| `services/annotators/sleep|lms|screenTime|socialMedia|srlAnnotationService.js` | Per-concept annotation + cluster integration |
| `routes/scores.js` | API endpoint serving scores + cluster data |
| `postgres/initdb/010_concept_scores.sql` | Score tables schema |
| `postgres/initdb/011_peer_clusters.sql` | Cluster tables schema |

### Frontend

| File | Purpose |
|---|---|
| `src/components/ScoreGauge.tsx` | SVG gauge with gradient arc + two arrow needles |
| `src/components/ScoreGauge.css` | Gauge component styles |
| `src/pages/Home.tsx` | Dashboard rendering, breakdown logic, admin student viewer |
| `src/pages/HomeDetails.css` | Breakdown list styles + domain tooltip styles |
