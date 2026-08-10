-- Location signals (per-source coords) + rebuilt address discrepancy rollup

CREATE TABLE IF NOT EXISTS location_signals (
  id            BIGSERIAL PRIMARY KEY,
  entity_layer  TEXT NOT NULL CHECK (entity_layer IN ('leads','accounts')),
  entity_id     TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('mmi','billing','shipping','checkin')),
  address_text  TEXT,
  pincode       TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  precision     TEXT NOT NULL DEFAULT 'none',
  -- Empty string for non-checkin; meeting id for check-in signals
  meeting_id    TEXT NOT NULL DEFAULT '',
  record_ts     TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_layer, entity_id, source, meeting_id)
);

CREATE INDEX IF NOT EXISTS idx_signals_entity
  ON location_signals (entity_layer, entity_id);
CREATE INDEX IF NOT EXISTS idx_signals_source
  ON location_signals (source);
CREATE INDEX IF NOT EXISTS idx_signals_meeting
  ON location_signals (meeting_id) WHERE meeting_id <> '';

CREATE TABLE IF NOT EXISTS address_discrepancies (
  entity_layer       TEXT NOT NULL CHECK (entity_layer IN ('leads','accounts')),
  entity_id          TEXT NOT NULL,
  title              TEXT,
  owner_name         TEXT,
  territory          TEXT,
  crm_url            TEXT,
  -- Snapshot text + coords per source (primary/latest for check-in)
  mmi_lat            DOUBLE PRECISION,
  mmi_lng            DOUBLE PRECISION,
  mmi_address        TEXT,
  mmi_pincode        TEXT,
  mmi_precision      TEXT,
  billing_lat        DOUBLE PRECISION,
  billing_lng        DOUBLE PRECISION,
  billing_address    TEXT,
  billing_pincode    TEXT,
  billing_precision  TEXT,
  shipping_lat       DOUBLE PRECISION,
  shipping_lng       DOUBLE PRECISION,
  shipping_address   TEXT,
  shipping_pincode   TEXT,
  shipping_precision TEXT,
  checkin_lat        DOUBLE PRECISION,
  checkin_lng        DOUBLE PRECISION,
  checkin_meeting_id TEXT,
  checkin_precision  TEXT,
  checkin_record_ts  TIMESTAMPTZ,
  -- Pairwise distances (km); NULL when either side missing
  mmi_billing_km       DOUBLE PRECISION,
  mmi_shipping_km      DOUBLE PRECISION,
  billing_shipping_km  DOUBLE PRECISION,
  mmi_checkin_km       DOUBLE PRECISION,
  billing_checkin_km   DOUBLE PRECISION,
  shipping_checkin_km  DOUBLE PRECISION,
  max_spread_km        DOUBLE PRECISION,
  worst_pair           TEXT,
  severity             TEXT NOT NULL DEFAULT 'ok'
                       CHECK (severity IN ('ok','watch','alert')),
  flags                JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_layer, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_disc_severity ON address_discrepancies (severity);
CREATE INDEX IF NOT EXISTS idx_disc_territory ON address_discrepancies (territory);
CREATE INDEX IF NOT EXISTS idx_disc_owner ON address_discrepancies (owner_name);
CREATE INDEX IF NOT EXISTS idx_disc_spread ON address_discrepancies (max_spread_km DESC NULLS LAST);
