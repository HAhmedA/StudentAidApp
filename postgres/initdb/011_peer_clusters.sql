-- Peer Clusters Schema
-- Stores GMM cluster assignments and percentile boundaries per concept
-- Used for cluster-based peer comparison (replacing Z-score approach)

-- =============================================================================
-- PEER CLUSTERS (cluster definitions per concept)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.peer_clusters (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  concept_id varchar(30) NOT NULL,
  cluster_index integer NOT NULL,         -- 0, 1, 2
  cluster_label varchar(100) NOT NULL,    -- human-friendly label
  centroid jsonb NOT NULL DEFAULT '{}',   -- centroid coordinates
  p5 numeric(7,2) NOT NULL,              -- 5th percentile composite score
  p50 numeric(7,2) NOT NULL,             -- 50th percentile (median)
  p95 numeric(7,2) NOT NULL,             -- 95th percentile composite score
  user_count integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_cluster UNIQUE (concept_id, cluster_index)
);

CREATE INDEX IF NOT EXISTS idx_peer_clusters_concept ON public.peer_clusters (concept_id);

-- =============================================================================
-- USER CLUSTER ASSIGNMENTS (one assignment per user per concept)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_cluster_assignments (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_id varchar(30) NOT NULL,
  cluster_index integer NOT NULL,
  cluster_label varchar(100) NOT NULL,
  percentile_position numeric(5,2),       -- user's percentile within cluster (0-100)
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_cluster UNIQUE (user_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_user_cluster_user ON public.user_cluster_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_user_cluster_concept ON public.user_cluster_assignments (user_id, concept_id);
