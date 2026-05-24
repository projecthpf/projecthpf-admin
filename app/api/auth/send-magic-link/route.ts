import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase'

/**
 * POST /api/auth/send-magic-link
 *
 * Issues a Supabase magic-link sign-in email, but ONLY if the requested
 * email is on the admin_auth.admin_users allowlist and is_active.
 *
 * Security model:
 *   1. Validate the email shape (Zod).
 *   2. Check our own throttle table — refuse if this email or IP has
 *      already received its hourly quota of links.
 *   3. Check the allowlist. If not present, return a generic 200
 *      response so an attacker can't enumerate valid admin emails.
 *   4. Ask Supabase to send the OTP magic link.
 *   5. Record the send in the throttle table.
 *
 * Why we don't return 401/404 for non-allowlisted emails:
 *   That would let an attacker query the form to discover which emails
 *   are admins. Instead we always 200 and the user sees the same
 *   "if you're authorized, a link is on its way" message.
 *
 * Rate limits (per email per hour):
 *   - 3 sends max
 *   - Tracked by hour bucket; resets on the hour
 *
 * Per-IP rate limit:
 *   - 10 distinct emails per hour (catches reconnaissance scans)
 */

const Body = z.object({
  email: z.string().email().max(254).transform(s => s.trim().toLowerCase()),
})

const HOURLY_PER_EMAIL = 3
const HOURLY_PER_IP    = 10

export async function POST(req: NextRequest) {
  const ip = (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    '0.0.0.0'
  )

  // Parse + validate body. Reject malformed requests with 400.
  let parsed
  try {
    const body = await req.json()
    parsed = Body.parse(body)
  } catch {
    // Bad shape — return 200 with no action so we don't leak validation details.
    return NextResponse.json({ ok: true })
  }
  const { email } = parsed

  const db = createServerClient()

  // ── Throttle check ────────────────────────────────────────────────
  const hourBucket = new Date()
  hourBucket.setMinutes(0, 0, 0)

  const { data: throttle } = await db
    .schema('admin_auth')
    .from('magic_link_throttle')
    .select('send_count, ip_addresses')
    .eq('email', email)
    .eq('hour_bucket', hourBucket.toISOString())
    .maybeSingle()

  if (throttle && throttle.send_count >= HOURLY_PER_EMAIL) {
    // Silent throttle — same 200 response, no email sent.
    return NextResponse.json({ ok: true })
  }

  // Per-IP scan check: count distinct emails this IP has requested this hour.
  const { data: ipScans } = await db
    .schema('admin_auth')
    .from('magic_link_throttle')
    .select('email')
    .contains('ip_addresses', [ip])
    .eq('hour_bucket', hourBucket.toISOString())

  if (ipScans && ipScans.length >= HOURLY_PER_IP) {
    // This IP is poking too many addresses. Drop silently.
    return NextResponse.json({ ok: true })
  }

  // ── Allowlist check ──────────────────────────────────────────────
  const { data: admin } = await db
    .schema('admin_auth')
    .from('admin_users')
    .select('id, email, is_active, deactivated_at')
    .eq('email', email)
    .maybeSingle()

  // Always record the throttle attempt — even for invalid emails — so
  // a scanner can't probe forever for free.
  await upsertThrottle(db, email, hourBucket, ip)

  if (!admin || !admin.is_active || admin.deactivated_at) {
    // Generic 200. No information leak about whether the email exists.
    return NextResponse.json({ ok: true })
  }

  // ── Issue the magic link via Supabase ────────────────────────────
  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      // After clicking the link the user lands here; AdminAuthGuard
      // re-checks the allowlist and redirects to /admin on success.
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || ''}/admin`,
      shouldCreateUser: true, // creates auth.users row if first sign-in
    },
  })

  if (error) {
    // Log server-side but still 200 to the client.
    console.error('[send-magic-link] supabase error', error)
  }

  return NextResponse.json({ ok: true })
}

async function upsertThrottle(db: ReturnType<typeof createServerClient>, email: string, hourBucket: Date, ip: string) {
  // Atomic increment via raw SQL — avoids a read-modify-write race.
  await db.rpc('increment_magic_link_throttle', {
    p_email: email,
    p_hour_bucket: hourBucket.toISOString(),
    p_ip: ip,
  })
}
