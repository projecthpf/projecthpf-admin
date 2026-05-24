-- ════════════════════════════════════════════════════════════════════
--  public.log_admin_audit — thin wrapper around admin_audit.log()
--
--  Supabase's PostgREST exposes RPC functions in the `public` schema.
--  We want admin_audit.log() to be callable from the application but
--  keep the audit_log TABLE itself buried in admin_audit. This wrapper
--  bridges the two — it's the only PostgREST-visible audit endpoint.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_admin_audit(
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
BEGIN
  RETURN admin_audit.log(
    p_action, p_target_table, p_target_id, p_before, p_after,
    p_result, p_error_msg, p_ip, p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_audit FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_audit TO authenticated;
