'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, FileText, BookOpen, Calendar, LogOut, Menu, X, BarChart3, UserCog, Sparkles, ShieldCheck, Heart, Share2, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/admin/AdminAuthGuard'

/**
 * Sidebar nav. Each item is gated to one or more roles — the role is read
 * from `admin_users.role` at session init. To restrict a module from a
 * given role, omit that role from the `roles` array.
 *
 * Adding a new module:
 *   1. Drop a page under `app/admin/<slug>/page.tsx`
 *   2. Add an entry below with a sensible icon
 *   3. List which roles can see it
 */
const nav = [
  { href: '/admin',             label: 'Dashboard',         icon: LayoutDashboard, exact: true, roles: ['admin', 'bookkeeper', 'crm'] },
  { href: '/admin/crm',         label: 'CRM & Donors',      icon: Heart,           roles: ['admin', 'crm'] },
  { href: '/admin/email',       label: 'Email Inbox',       icon: Mail,            roles: ['admin', 'crm', 'bookkeeper'] },
  { href: '/admin/social',      label: 'Social Media',      icon: Share2,          roles: ['admin', 'crm'] },
  { href: '/admin/invoices',    label: 'Invoices & Receipts', icon: FileText,      roles: ['admin', 'bookkeeper'] },
  { href: '/admin/bookkeeping', label: 'Bookkeeping',       icon: BookOpen,        roles: ['admin', 'bookkeeper'] },
  { href: '/admin/reports',     label: 'Reports',           icon: BarChart3,       roles: ['admin', 'bookkeeper'] },
  { href: '/admin/documents',   label: 'Documents',         icon: ShieldCheck,     roles: ['admin', 'bookkeeper'] },
  { href: '/admin/calendar',    label: 'Calendar',          icon: Calendar,        roles: ['admin', 'crm', 'bookkeeper'] },
  { href: '/admin/todo',        label: 'Tasks',             icon: Sparkles,        roles: ['admin', 'crm', 'bookkeeper'] },
  { href: '/admin/users',       label: 'Admin Users',       icon: UserCog,         roles: ['admin'] },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { role } = useAuth()

  async function logout() {
    await supabase.auth.signOut()
    router.push('/admin/login')
  }

  // Hide items the current role can't access. If role hasn't loaded yet, show everything
  // and let the server-side guard 403 — better than flicker.
  const visibleNav = nav.filter(n => !role || n.roles.includes(role))

  return (
    <div className="flex flex-col h-full" style={{ background: 'linear-gradient(180deg, #0a1428 0%, #1a0a3a 100%)' }}>
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #7dd3fc, #a78bfa)' }}>
          <Image src="/logo.png" alt="Project HPF" width={28} height={28} className="object-contain" />
        </div>
        <div>
          <div className="text-white font-bold text-sm">Project HPF</div>
          <div className="text-xs" style={{ color: 'rgba(125,211,252,0.65)' }}>Foundation Admin</div>
        </div>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {visibleNav.map(({ href, label, icon: Icon, exact, matches }: any) => {
          const active = exact
            ? pathname === href
            : matches
              ? matches.some((m: string) => pathname.startsWith(m))
              : pathname.startsWith(href)
          return (
            <Link key={href} href={href} onClick={onNavigate}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm font-medium ${active ? 'text-white' : 'hover:text-white hover:bg-white/10'}`}
              style={{ background: active ? 'rgba(125,211,252,0.18)' : 'transparent', color: active ? 'white' : 'rgba(220,236,255,0.65)' }}>
              <Icon size={17} className="flex-shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="px-2 py-4 border-t border-white/10">
        <button onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all hover:bg-white/10"
          style={{ color: 'rgba(220,236,255,0.65)' }}>
          <LogOut size={17} />
          Sign Out
        </button>
      </div>
    </div>
  )
}

export default function AdminSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <>
      <aside className="hidden md:flex flex-col w-60 flex-shrink-0">
        <SidebarContent />
      </aside>
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 shadow-md" style={{ background: '#0a1428' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #7dd3fc, #a78bfa)' }}>
            <Image src="/logo.png" alt="" width={22} height={22} className="object-contain" />
          </div>
          <span className="text-white font-bold text-sm">Project HPF Admin</span>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="text-white p-1">
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex" style={{ top: '53px' }}>
          <div className="w-64 flex flex-col shadow-xl"><SidebarContent onNavigate={() => setMobileOpen(false)} /></div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  )
}
