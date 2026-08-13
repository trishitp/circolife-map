-- Meter billable / estimated third-party API calls (Google Maps, Ola, etc.)
CREATE TABLE IF NOT EXISTS api_usage (
  id           BIGSERIAL PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sku          TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'google',
  units        INT NOT NULL DEFAULT 1,
  ok           BOOLEAN NOT NULL DEFAULT TRUE,
  meta         JSONB
);

CREATE INDEX IF NOT EXISTS idx_api_usage_at ON api_usage (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_sku_at ON api_usage (sku, occurred_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
