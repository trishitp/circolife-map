CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS map_points (
  id            BIGSERIAL PRIMARY KEY,
  layer         TEXT NOT NULL CHECK (layer IN ('leads','accounts','meetings','assets')),
  source_id     TEXT NOT NULL,
  title         TEXT,
  owner_id      TEXT,
  owner_name    TEXT,
  territory     TEXT,
  status        TEXT,
  record_ts     TIMESTAMPTZ,
  address_raw   TEXT,
  pincode       TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  precision     TEXT NOT NULL DEFAULT 'none'
                CHECK (precision IN ('exact','approx','geocoded','pincode','inherited','none')),
  geom          GEOMETRY(Point, 4326),
  crm_url       TEXT,
  extra         JSONB DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (layer, source_id)
);
CREATE INDEX IF NOT EXISTS idx_points_geom ON map_points USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_points_layer ON map_points (layer);
CREATE INDEX IF NOT EXISTS idx_points_owner ON map_points (owner_name);
CREATE INDEX IF NOT EXISTS idx_points_territory ON map_points (territory);

CREATE TABLE IF NOT EXISTS geocode_cache (
  addr_hash   TEXT PRIMARY KEY,
  query       TEXT NOT NULL,
  provider    TEXT NOT NULL,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  confidence  TEXT,
  failed      BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pincode_centroids (
  pincode TEXT PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS unplottable_log (
  id BIGSERIAL PRIMARY KEY,
  layer TEXT, source_id TEXT, reason TEXT,
  logged_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (layer, source_id)
);
