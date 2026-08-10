-- Draft day plans for Smart Route Planning (Routes tab)
CREATE TABLE IF NOT EXISTS route_plans (
  owner_name   text NOT NULL,
  plan_date    date NOT NULL, -- IST calendar date
  origin_lat   float8,
  origin_lng   float8,
  origin_label text,
  stops        jsonb NOT NULL DEFAULT '[]'::jsonb,
  polyline     text,
  totals       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_name, plan_date)
);

CREATE INDEX IF NOT EXISTS route_plans_updated_idx ON route_plans (updated_at DESC);
