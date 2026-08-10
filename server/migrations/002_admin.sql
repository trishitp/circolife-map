-- Admin ops, gaps review, territory fallback for geocode

ALTER TABLE map_points DROP CONSTRAINT IF EXISTS map_points_precision_check;
ALTER TABLE map_points ADD CONSTRAINT map_points_precision_check
  CHECK (precision IN ('exact','approx','geocoded','pincode','territory','inherited','none'));

ALTER TABLE unplottable_log
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS territory TEXT,
  ADD COLUMN IF NOT EXISTS crm_url TEXT,
  ADD COLUMN IF NOT EXISTS address_raw TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT;

CREATE TABLE IF NOT EXISTS sync_runs (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'full'
                CHECK (kind IN ('full','regeocode','manual')),
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','ok','error')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER,
  stats         JSONB DEFAULT '{}'::jsonb,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS territory_centroids (
  territory TEXT PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  n_points INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unplottable_layer ON unplottable_log (layer);
CREATE INDEX IF NOT EXISTS idx_unplottable_reviewed ON unplottable_log (reviewed_at);
CREATE INDEX IF NOT EXISTS idx_points_precision ON map_points (precision);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs (started_at DESC);
