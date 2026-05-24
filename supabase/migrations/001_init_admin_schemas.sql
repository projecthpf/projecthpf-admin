-- ════════════════════════════════════════════════════════════════════
--  Project HPF Foundation Admin — initial schema
--
--  Runs INSIDE the existing Supabase project that hosts the members
--  portal. We use dedicated schemas so admin tables can never collide
--  with members.* tables and we can grant/revoke access per schema.
--
--  Schemas:
--    admin_auth       — allowlist of admins, magic-link issuance log
--    admin_crm        — donors, prospects, communications (Phase 2)
--    admin_billing    — invoices, receipts, ledger (carried over)
--    admin_audit      — append-only action log for every admin mutation
--
--  Security model:
--    • Row Level Security ON for every table
--    • Service role (server) is the only writer for sensitive tables
--    • Reads are gated by admin_auth.is_admin(auth.uid())
--    • Audit log is INSERT-only — no UPDATE / DELETE permission, ever
--
--  Scale model:
--    • UUID primary keys (no sharding bottleneck)
--    • Cursor-friendly indexes (created_at DESC, id ASC) for pagination
--    • Audit log is the first table we'll partition by month when it
--      grows past ~50M rows — schema reserved for that future split
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email matching

-- ────────────────────────────────────────────────────────────────────
-- SCHEMAS
-- ────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS admin_auth;
CREATE SCHEMA IF NOT EXISTS admin_crm;
CREATE SCHEMA IF NOT EXISTS admin_billing;
CREATE SCHEMA IF NOT EXISTS admin_audit;

-- Lock these schemas down — the `anon` role (used by unauthenticated
-- Supabase requests) cannot see them at all. Even an SQL injection in
-- public schema can't traverse here without explicit grants.
REVOKE ALL ON SCHEMA admin_auth, admin_crm, admin_billing, admin_audit FROM PUBLIC;
REVOKE ALL ON SCHEMA admin_auth, admin_crm, admin_billing, admin_audit FROM anon;

-- ────────────────────────────────────────────────────────────────────
-- admin_auth.admin_users — the allowlist
-- ────────────────────────────────────────────────────────────────────
-- Only emails present here can sign in to the admin portal. The
-- /api/auth/send-magic-link route checks this before asking Supabase to
-- deliver a sign-in link, and AdminAuthGuard re-checks after sign-in.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE admin_auth.admin_users (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email               CITEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'admin'
                        CHECK (role IN ('admin', 'crm', 'bookkeeper', 'readonly')),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  -- The Supabase auth.users row id — populated on first successful sign-in.
  -- Lets us join to auth.users for last_sign_in_at, MFA status, etc.
  supabase_user_id    UUID,
  invited_by          UUID REFERENCES admin_auth.admin_users(id),
  invited_at          TIMESTAMPTZ DEFAULT NOW(),
  last_sign_in_at     TIMESTAMPTZ,
  last_sign_in_ip     INET,
  -- Soft delete — never actually drop rows. Audit log references admin_id
  -- forever; deleting would orphan history.
  deactivated_at      TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_users_email_active
  ON admin_auth.admin_users(email)
  WHERE is_active = TRUE AND deactivated_at IS NULL;

CREATE INDEX idx_admin_users_supabase_id
  ON admin_auth.admin_users(supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

-- Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION admin_auth.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_users_touch BEFORE UPDATE ON admin_auth.admin_users
  FOR EACH ROW EXECUTE FUNCTION admin_auth.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- admin_auth.magic_link_throttle — server-side rate limiting
-- ────────────────────────────────────────────────────────────────────
-- One row per (email, hour-bucket). The send-magic-link route checks
-- count before issuing. Stops accidental floods even if a bot bypasses
-- Supabase's own per-email limits.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE admin_auth.magic_link_throttle (
  email             CITEXT NOT NULL,
  hour_bucket       TIMESTAMPTZ NOT NULL,  -- date_trunc('hour', now())
  send_count        INT NOT NULL DEFAULT 0,
  ip_addresses      INET[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (email, hour_bucket)
);

-- Auto-cleanup old throttle rows so the table doesn't grow unbounded.
-- Anything older than 24h is irrelevant — magic links expire in 15 min.
CREATE INDEX idx_magic_link_throttle_cleanup
  ON admin_auth.magic_link_throttle(hour_bucket);

-- ────────────────────────────────────────────────────────────────────
-- admin_auth.is_admin(uuid) — helper used by RLS policies
-- ────────────────────────────────────────────────────────────────────
-- Marked SECURITY DEFINER so it can read admin_users from RLS-restricted
-- contexts. Returns TRUE only if the supabase_user_id is in the
-- allowlist AND active AND not soft-deleted.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_auth.is_admin(uid UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM admin_auth.admin_users
    WHERE supabase_user_id = uid
      AND is_active = TRUE
      AND deactivated_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION admin_auth.current_admin_role() RETURNS TEXT
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM admin_auth.admin_users
  WHERE supabase_user_id = auth.uid()
    AND is_active = TRUE
    AND deactivated_at IS NULL
  LIMIT 1;
$$;

-- ────────────────────────────────────────────────────────────────────
-- admin_audit.audit_log — every mutation, append-only, forever
-- ────────────────────────────────────────────────────────────────────
-- INSERT-only by design. There is no UPDATE or DELETE grant on this
-- table for any role. If anyone ever needs to "fix" an audit row, they
-- create a corrective record — the original stands.
--
-- Partition-ready: we'll convert to PARTITION BY RANGE (created_at)
-- once row count exceeds ~50M. The CHECK constraint scaffolding is
-- already here so the future ALTER is a metadata-only operation.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE admin_audit.audit_log (
  id              UUID NOT NULL DEFAULT uuid_generate_v4(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_admin_id  UUID REFERENCES admin_auth.admin_users(id),
  actor_email     CITEXT,  -- denormalized in case admin_users row changes later
  actor_ip        INET,
  actor_user_agent TEXT,
  -- Free-form action name like 'crm.contact.create', 'invoice.send', 'admin.user.invite'
  action          TEXT NOT NULL,
  -- The target object — schema-qualified table + id
  target_table    TEXT,
  target_id       UUID,
  -- Full before/after snapshots for diff'ing. JSONB so we can index/query later.
  before_state    JSONB,
  after_state     JSONB,
  -- Result code: 'success' | 'denied' | 'error'
  result          TEXT NOT NULL DEFAULT 'success'
                    CHECK (result IN ('success', 'denied', 'error')),
  error_message   TEXT,
  PRIMARY KEY (id, created_at)  -- composite so partitioning works later
);

CREATE INDEX idx_audit_log_created
  ON admin_audit.audit_log(created_at DESC);
CREATE INDEX idx_audit_log_actor
  ON admin_audit.audit_log(actor_admin_id, created_at DESC);
CREATE INDEX idx_audit_log_target
  ON admin_audit.audit_log(target_table, target_id, created_at DESC)
  WHERE target_id IS NOT NULL;
CREATE INDEX idx_audit_log_action
  ON admin_audit.audit_log(action, created_at DESC);

-- ────────────────────────────────────────────────────────────────────
-- Row Level Security — locked-down by default
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE admin_auth.admin_users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_auth.magic_link_throttle  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit.audit_log           ENABLE ROW LEVEL SECURITY;

-- admin_users: admins see all; only admins (not crm/bookkeeper) can write
CREATE POLICY p_admin_users_read ON admin_auth.admin_users
  FOR SELECT USING ( admin_auth.is_admin(auth.uid()) );
CREATE POLICY p_admin_users_write ON admin_auth.admin_users
  FOR ALL USING ( admin_auth.current_admin_role() = 'admin' )
           WITH CHECK ( admin_auth.current_admin_role() = 'admin' );

-- magic_link_throttle: server-only (service role bypasses RLS)
-- No policies for authenticated users — they can't see throttle data.

-- audit_log: any admin can READ; nobody (including admins) can write or delete
-- via row-level grants. Writes happen via the SECURITY DEFINER function below.
CREATE POLICY p_audit_log_read ON admin_audit.audit_log
  FOR SELECT USING ( admin_auth.is_admin(auth.uid()) );

REVOKE INSERT, UPDATE, DELETE ON admin_audit.audit_log FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- admin_audit.log() — the ONLY way to write to audit_log
-- ────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER lets it INSERT even though authenticated has no grant.
-- API routes call this; client code cannot call it directly because the
-- `authenticated` role can EXECUTE but the function checks is_admin().
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_audit.log(
  p_action        TEXT,
  p_target_table  TEXT DEFAULT NULL,
  p_target_id     UUID DEFAULT NULL,
  p_before        JSONB DEFAULT NULL,
  p_after         JSONB DEFAULT NULL,
  p_result        TEXT DEFAULT 'success',
  p_error_msg     TEXT DEFAULT NULL,
  p_ip            INET DEFAULT NULL,
  p_user_agent    TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin   admin_auth.admin_users%ROWTYPE;
  v_log_id  UUID;
BEGIN
  SELECT * INTO v_admin
  FROM admin_auth.admin_users
  WHERE supabase_user_id = auth.uid()
    AND is_active = TRUE
    AND deactivated_at IS NULL;

  IF v_admin.id IS NULL THEN
    RAISE EXCEPTION 'audit.log: caller is not an active admin';
  END IF;

  INSERT INTO admin_audit.audit_log
    (actor_admin_id, actor_email, actor_ip, actor_user_agent,
     action, target_table, target_id, before_state, after_state,
     result, error_message)
  VALUES
    (v_admin.id, v_admin.email, p_ip, p_user_agent,
     p_action, p_target_table, p_target_id, p_before, p_after,
     p_result, p_error_msg)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION admin_audit.log FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_audit.log TO authenticated;
GRANT EXECUTE ON FUNCTION admin_auth.is_admin TO authenticated, anon;
GRANT EXECUTE ON FUNCTION admin_auth.current_admin_role TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- Seed the initial admins
-- ────────────────────────────────────────────────────────────────────
-- These two emails can sign in immediately. supabase_user_id is NULL
-- until their first successful magic-link sign-in, at which point the
-- backend updates it.
-- ────────────────────────────────────────────────────────────────────
INSERT INTO admin_auth.admin_users (email, display_name, role, notes)
VALUES
  ('info@projecthpf.org',   'Project HPF Org Admin', 'admin', 'Default org admin account, seeded by 001_init.'),
  ('projecthpf421@gmail.com','Lacey Price',          'admin', 'Founder, seeded by 001_init.')
ON CONFLICT (email) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────
-- Grants for the application schemas
-- ────────────────────────────────────────────────────────────────────
-- The `authenticated` role (regular signed-in users) gets USAGE on the
-- schemas so RLS policies can do anything. RLS is the actual gatekeeper.
-- ────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA admin_auth, admin_crm, admin_billing, admin_audit TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA admin_auth, admin_audit TO authenticated;
