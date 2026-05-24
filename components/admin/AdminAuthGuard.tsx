'use client'
import { useEffect, useState, createContext, useContext } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

/**
 * AdminAuthGuard — wraps every /admin/* page (set up in app/admin/layout.tsx).
 *
 * Flow on each render:
 *   1. If on /admin/login, render children (no guard).
 *   2. Otherwise check Supabase session.
 *      - No session → redirect to /admin/login
 *   3. Hit /api/auth/whoami which:
 *        a. Re-checks the admin_auth.admin_users allowlist server-side
 *        b. Returns the role (admin | crm | bookkeeper | readonly)
 *        c. Updates last_sign_in_at / last_sign_in_ip + supabase_user_id
 *      - Not authorized → sign out + redirect to /admin/login
 *   4. Check the role can view the current path. If not → /admin.
 *
 * Defense in depth: every mutating API route ALSO calls requireAdminRole()
 * server-side. The client guard is for UX (don't render the page); the
 * server check is the actual security boundary.
 */

type UserRole = 'admin' | 'crm' | 'bookkeeper' | 'readonly' | null

interface AuthCtx {
  role: UserRole
  email: string | null
}

const AuthContext = createContext<AuthCtx>({ role: null, email: null })
export const useAuth = () => useContext(AuthContext)

/**
 * Page-level access map. The server enforces the same rules in API routes —
 * this is just UX so we don't render a page the user can't actually use.
 *
 * Add new modules to this map as they're built. Anything not matched is
 * admin-only by default (safer default than allow-by-default).
 */
const PAGE_ACCESS: Record<Exclude<UserRole, null>, (path: string) => boolean> = {
  admin:      (_p) => true,
  bookkeeper: (p) => /^\/admin(\/(invoices|bookkeeping|reports|documents|email|calendar|todo)(\/|$))?$/.test(p) || p === '/admin',
  crm:        (p) => /^\/admin(\/(crm|email|social|calendar|todo)(\/|$))?$/.test(p) || p === '/admin',
  readonly:   (p) => p === '/admin',
}

function canAccess(role: UserRole, path: string): boolean {
  if (!role) return false
  const fn = PAGE_ACCESS[role]
  return fn ? fn(path) : false
}

export default function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [role, setRole] = useState<UserRole>(null)
  const [email, setEmail] = useState<string | null>(null)

  const isLoginPage = pathname === '/admin/login'

  useEffect(() => {
    if (isLoginPage) { setChecking(false); setAuthed(true); return }

    let cancelled = false

    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return

      if (!session) {
        router.replace('/admin/login')
        setChecking(false)
        return
      }

      // Server-side allowlist re-check + role fetch + last-sign-in bookkeeping
      // happen in /api/auth/whoami. We don't trust the client for any of this.
      const r = await fetch('/api/auth/whoami', { credentials: 'include' })
      if (cancelled) return

      if (!r.ok) {
        // Signed in to Supabase but NOT on the admin allowlist (or deactivated).
        // Sign out fully so the next visit doesn't try the same thing.
        await supabase.auth.signOut()
        router.replace('/admin/login')
        setChecking(false)
        return
      }

      const me = await r.json() as { email: string; role: UserRole }
      if (cancelled) return

      setEmail(me.email)
      setRole(me.role)

      if (!canAccess(me.role, pathname)) {
        // Allowed admin but wrong role for THIS page — drop them at the dashboard.
        router.replace('/admin')
      }

      setAuthed(true)
      setChecking(false)
    })()

    // If the auth session goes away in another tab, redirect immediately.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session && !isLoginPage) router.replace('/admin/login')
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  }, [router, isLoginPage, pathname])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a1428' }}>
        <Loader2 className="animate-spin" size={28} color="#7dd3fc" />
      </div>
    )
  }
  if (!authed) return null

  return (
    <AuthContext.Provider value={{ role, email }}>
      {children}
    </AuthContext.Provider>
  )
}
