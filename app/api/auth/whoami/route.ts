import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'

// Force dynamic rendering — this route reads cookies, can't be prerendered
// statically. Without this, `next build` fails with "Dynamic server usage".
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/whoami
 *
 * The single source of truth for "is this session allowed?" Called by:
 *   - AdminAuthGuard on every /admin/* page render
 *   - requireAdminRole() in every mutating API route
 *
 * Steps:
 *   1. Pull the Supabase session from cookies (server-side).
 *   2. If no session → 401.
 *   3. Look up the session user's email in admin_auth.admin_users.
 *      - Not present, or is_active=FALSE, or deactivated_at IS NOT NULL → 403
 *   4. If found, update last_sign_in_at + last_sign_in_ip + supabase_user_id.
 *   5. Return { email, role }.
 *
 * Why this is its own endpoint:
 *   - Centralized place to add MFA / IP allowlist / device fingerprinting later
 *   - Client guard and API guards share the same logic
 *   - Easy to audit every "did this person get in?" question by tailing logs
 */
export async function GET(req: NextRequest) {
  // Get the session from cookies (Supabase auth-helpers reads sb-* cookies)
  const supa = createRouteHandlerClient({ cookies })
  const { data: { session } } = await supa.auth.getSession()

  if (!session || !session.user.email) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 })
  }

  const email = session.user.email.toLowerCase()
  const ip = (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    null
  )

  // Use the service-role client for the admin_auth schema lookup —
  // the authenticated role doesn't have direct SELECT on it, only via
  // the is_admin() helper (which doesn't return the role enum).
  const db = createServerClient()
  const { data: admin, error } = await db
    .schema('admin_auth')
    .from('admin_users')
    .select('id, email, role, is_active, deactivated_at, supabase_user_id')
    .eq('email', email)
    .maybeSingle()

  if (error || !admin || !admin.is_active || admin.deactivated_at) {
    return NextResponse.json({ error: 'not_allowed' }, { status: 403 })
  }

  // Bookkeeping update — link supabase_user_id on first sign-in,
  // refresh last_sign_in_at and IP every time. Fire-and-forget; if
  // it fails we still return 200 because the user IS allowed.
  db.schema('admin_auth').from('admin_users').update({
    supabase_user_id: session.user.id,
    last_sign_in_at:  new Date().toISOString(),
    last_sign_in_ip:  ip,
  }).eq('id', admin.id).then(() => {}, () => {})

  return NextResponse.json({
    email:  admin.email,
    role:   admin.role,
  })
}
