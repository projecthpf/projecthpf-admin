'use client'
import { useState } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { Loader2, Mail, CheckCircle2 } from 'lucide-react'

/**
 * Magic-link only admin login.
 *
 * Security model:
 *   1. User enters their email
 *   2. We call `signInWithOtp` — Supabase emails a single-use sign-in link
 *   3. The recipient clicks → Supabase verifies → cookies set → redirected to /admin
 *   4. AdminAuthGuard server-side cross-checks the email against admin_users.email
 *      (a Postgres allowlist). Anyone outside the allowlist is signed straight out
 *      even if they somehow get a magic link.
 *
 * Why magic link only:
 *   - Nothing to phish (no password to capture)
 *   - Nothing to brute force
 *   - Lost-device recovery is "I have email access"
 *   - We can rotate the allowlist instantly without password resets
 *
 * Rate limiting is enforced in the Supabase project settings (default 1 OTP / 60s).
 * We additionally throttle on the server in /api/auth/send-magic-link for the
 * paranoid case where Supabase rate limits get raised.
 */
export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Send through our own API route so we can enforce the allowlist BEFORE
    // even asking Supabase to deliver mail. Saves email quota + denies
    // attackers any signal about which addresses are valid admins.
    const r = await fetch('/api/auth/send-magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    })

    setLoading(false)

    if (!r.ok) {
      // Generic message — never reveal whether the email is or isn't an admin.
      // Attackers shouldn't be able to enumerate the allowlist via the form.
      setError('If that email is an authorized admin, a sign-in link is on its way.')
      setSent(true)
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #020108 0%, #0a1428 40%, #1a0a3a 100%)' }}>
      <div className="rounded-4xl shadow-2xl p-10 w-full max-w-md mx-4"
        style={{ background: 'rgba(8,16,36,0.92)', border: '1px solid rgba(125,211,252,0.25)', boxShadow: '0 25px 70px rgba(0,0,0,0.5), 0 0 60px rgba(125,211,252,0.12)' }}>
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 mb-4 relative rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #7dd3fc, #a78bfa)' }}>
            <Image src="/logo.png" alt="Project HPF" width={48} height={48} className="object-contain" />
          </div>
          <h1 className="text-2xl font-extrabold text-white">Foundation Admin</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(125,211,252,0.7)' }}>Project Healing Prosperity &amp; Freedom</p>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(52,211,153,0.15)' }}>
              <CheckCircle2 size={28} color="#34d399" />
            </div>
            <h2 className="text-lg font-bold text-white">Check your inbox</h2>
            <p className="text-sm" style={{ color: 'rgba(220,236,255,0.7)' }}>
              If <span className="text-white font-semibold">{email}</span> is on the admin allowlist, a one-time sign-in link is on its way. The link expires in 15 minutes.
            </p>
            <button onClick={() => { setSent(false); setEmail('') }}
              className="text-sm font-semibold hover:underline" style={{ color: '#7dd3fc' }}>
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSend} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'rgba(220,236,255,0.8)' }}>Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
                placeholder="info@projecthpf.org"
                className="w-full px-5 py-3.5 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                style={{ background: 'rgba(10,20,40,0.6)', border: '1px solid rgba(125,211,252,0.30)' }} />
            </div>
            {error && (
              <div className="px-5 py-3 rounded-2xl text-sm"
                style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#fca5a5' }}>{error}</div>
            )}
            <button type="submit" disabled={loading || !email}
              className="w-full text-white font-bold py-4 rounded-pill transition-all flex items-center justify-center gap-2 shadow-glow-cyan hover:shadow-glow-violet disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7dd3fc, #a78bfa)' }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
              {loading ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}

        <p className="text-center text-xs mt-6" style={{ color: 'rgba(220,236,255,0.4)' }}>
          Admin-only area. Access is restricted to authorized foundation staff. All sessions are logged.
        </p>
      </div>
    </div>
  )
}
