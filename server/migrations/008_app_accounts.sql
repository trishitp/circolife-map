-- Per-user logins. Admin tab + /api/admin are limited to is_admin accounts.
CREATE TABLE IF NOT EXISTS app_accounts (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  is_admin       BOOLEAN NOT NULL DEFAULT FALSE,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_accounts_email_lower
  ON app_accounts (lower(email));
