-- Shareable mobile links for day route plans (RM field view)
ALTER TABLE route_plans
  ADD COLUMN IF NOT EXISTS share_token text;

CREATE UNIQUE INDEX IF NOT EXISTS route_plans_share_token_uidx
  ON route_plans (share_token)
  WHERE share_token IS NOT NULL;
