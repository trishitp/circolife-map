-- Zoho OAuth logins do not store a local password.
ALTER TABLE app_accounts ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE app_accounts
  ADD COLUMN IF NOT EXISTS login_provider TEXT NOT NULL DEFAULT 'password';

ALTER TABLE app_accounts
  ADD COLUMN IF NOT EXISTS zoho_zuid TEXT;
