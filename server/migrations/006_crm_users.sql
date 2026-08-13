-- CRM Users (Zoho Users module) for active/inactive + role filters
CREATE TABLE IF NOT EXISTS crm_users (
  user_id      TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  email        TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  role_name    TEXT,
  profile_name TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_users_name_lower
  ON crm_users (lower(trim(full_name)));
CREATE INDEX IF NOT EXISTS idx_crm_users_status ON crm_users (status);
CREATE INDEX IF NOT EXISTS idx_crm_users_role ON crm_users (role_name);

CREATE INDEX IF NOT EXISTS idx_points_extra_source
  ON map_points ((extra->>'source'));
