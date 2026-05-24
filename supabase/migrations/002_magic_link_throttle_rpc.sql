-- ════════════════════════════════════════════════════════════════════
--  Atomic upsert for magic_link_throttle. Called by /api/auth/send-magic-link.
--  Avoids the classic read-modify-write race when two requests arrive at
--  the same hour bucket simultaneously.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.increment_magic_link_throttle(
  p_email       CITEXT,
  p_hour_bucket TIMESTAMPTZ,
  p_ip          INET
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO admin_auth.magic_link_throttle (email, hour_bucket, send_count, ip_addresses)
  VALUES (p_email, p_hour_bucket, 1, ARRAY[p_ip])
  ON CONFLICT (email, hour_bucket) DO UPDATE
    SET send_count   = admin_auth.magic_link_throttle.send_count + 1,
        ip_addresses = (
          SELECT ARRAY(SELECT DISTINCT UNNEST(admin_auth.magic_link_throttle.ip_addresses || ARRAY[p_ip]))
        );
END;
$$;

-- Only the service-role (server) calls this. Lock it down.
REVOKE ALL ON FUNCTION public.increment_magic_link_throttle FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_magic_link_throttle TO service_role;
