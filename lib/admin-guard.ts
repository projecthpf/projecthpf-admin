import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'

export type AdminRole = 'admin' | 'crm' | 'bookkeeper' | 'readonly'

export interface AdminContext {
  adminId:        string
  email:          string
  role:           AdminRole
  supabaseUserId: string
  ip:             string | null
  userAgent:      string | null
}

/**
 * Use this in EVERY mutating API route — POST/PATCH/DELETE — and any
 * GET route that returns sensitive data.
 *
 *   export async function POST(req: NextRequest) {
 *     const ctx = await requireAdminRole(req, ['admin', 'crm'])
 *     if (ctx instanceof NextResponse) return ctx   // not allowed
 *
 *     // ... business logic, then ...
 *     await audit(ctx, 'crm.contact.create', { table: 'admin_crm.contacts', id: newId, after: payload })
 *   }
 *
 * It does THREE things in one round trip to Postgres:
 *   1. Validates the Supabase session
 *   2. Confirms the email is on the allowlist and active
 *   3. Confirms the role matches one of the `allowed` roles
 *
 * Returns either an AdminContext (allowed) or a NextResponse to return
 * immediately (denied). This signature keeps every route's intro short.
 */
export async function requireAdminRole(
  req: NextRequest,
  allowed: AdminRole[] = ['admin']
): Promise<AdminContext | NextResponse> {
  const supa = createRouteHandlerClient({ cookies })
  const { data: { session } } = await supa.auth.getSession()

  if (!session || !session.user.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const db = createServerClient()
  const { data: admin } = await db
    .schema('admin_auth')
    .from('admin_users')
    .select('id, email, role, is_active, deactivated_at')
    .eq('email', session.user.email.toLowerCase())
    .maybeSingle()

  if (!admin || !admin.is_active || admin.deactivated_at) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!allowed.includes(admin.role as AdminRole)) {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 })
  }

  return {
    adminId:        admin.id,
    email:          admin.email,
    role:           admin.role as AdminRole,
    supabaseUserId: session.user.id,
    ip:             req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || null,
    userAgent:      req.headers.get('user-agent'),
  }
}

/**
 * Write a row to admin_audit.audit_log. Call this from every mutating route
 * AFTER the change succeeds (or on caught error, with result='error').
 *
 * Uses the admin_audit.log() Postgres function which is SECURITY DEFINER
 * and verifies the caller is on the allowlist before inserting. Belt and
 * suspenders — if a route ever forgot to call requireAdminRole first, the
 * function will still refuse the write.
 */
export async function audit(
  ctx: AdminContext,
  action: string,
  opts: {
    table?:    string
    id?:       string
    before?:   any
    after?:    any
    result?:   'success' | 'denied' | 'error'
    errorMsg?: string
  } = {}
): Promise<void> {
  const supa = createRouteHandlerClient({ cookies })

  // We call the RPC AS THE USER (not service role) so the SECURITY DEFINER
  // function can verify auth.uid() matches the allowlist.
  await supa.rpc('log_admin_audit', {
    p_action:       action,
    p_target_table: opts.table || null,
    p_target_id:    opts.id || null,
    p_before:       opts.before || null,
    p_after:        opts.after || null,
    p_result:       opts.result || 'success',
    p_error_msg:    opts.errorMsg || null,
    p_ip:           ctx.ip,
    p_user_agent:   ctx.userAgent,
  })
}
