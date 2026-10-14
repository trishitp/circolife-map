-- BDM / RM pincode territory assignments (uploaded from admin)

CREATE TABLE IF NOT EXISTS bdm_pincode_assignments (
  bdm_name   TEXT NOT NULL,
  pincode    TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bdm_name, pincode)
);

CREATE INDEX IF NOT EXISTS idx_bdm_pincode_assignments_bdm
  ON bdm_pincode_assignments (lower(trim(bdm_name)));

CREATE INDEX IF NOT EXISTS idx_bdm_pincode_assignments_pin
  ON bdm_pincode_assignments (pincode);
