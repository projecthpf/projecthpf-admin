'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

/**
 * Magic-link callback page.
 *
 * Supabase's magic-link verification redirects HERE after the token is
 * validated. Depending on the flow type, the tokens arrive one of two ways:
 *
 *   PKCE flow:     ?code=xxx               (query param, server-readable)
 *   Implicit flow: #access_token=xxx&...   (URL fragment, client-only)
 *
 * Because admin.generateLink() (no client-side PKCE verifier) uses implicit
 * flow, we have to be a CLIENT page and read window.location.hash. If we
 * detect a code in the query string, we exchange it server-side; if we
 * detect tokens in the hash, we setSession() directly.
 *
 * After session is established, redirect to /admin (or whatever `next` says).
 * AdminAuthGuard there cross-checks the email against the allowlist.
 *
 * IMPORTANT: useSearchParams() requires a <Suspense> boundary above it
 * when this page is statically prerendered. Without the wrapper, `next
 * build` errors with "Error occurred prerendering page /auth/callback".
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackFallback />}>
      <CallbackInner />
    </Suspense>
  )
}

function CallbackFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #020108 0%, #0a1428 40%, #1a0a3a 100%)' }}>
      <div className="rounded-3xl p-10 max-w-md w-full mx-4 text-center"
        style={{ background: 'rgba(8,16,36,0.92)', border: '1px solid rgba(125,211,252,0.25)' }}>
        <Loader2 size={32} className="animate-spin mx-auto mb-4" style={{ color: '#7dd3fc' }} />
        <h2 className="text-lg font-bold text-white">Loading…</h2>
      </div>
    </div>
  )
}

function CallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'working' | 'error'>('working')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    (async () => {
      const next = searchParams.get('next') || '/admin'
      const code = searchParams.get('code')

      // ── Path A: PKCE flow — code in query string ───────────────────
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setStatus('error'); setErrorMsg(error.message); return
        }
        router.replace(next)
        return
      }

      // ── Path B: implicit flow — tokens in URL fragment ─────────────
      const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash
      const params = new URLSearchParams(hash)
      const accessToken  = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      const errorDesc    = params.get('error_description') || params.get('error')

      if (errorDesc) {
        setStatus('error'); setErrorMsg(decodeURIComponent(errorDesc)); return
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token:  accessToken,
          refresh_token: refreshToken,
        })
        if (error) {
          setStatus('error'); setErrorMsg(error.message); return
        }
        // Clean the hash off the URL before navigating onward.
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        router.replace(next)
        return
      }

      // Neither code nor tokens — someone hit /auth/callback directly.
      setStatus('error'); setErrorMsg('No verification token found in the link. Request a fresh sign-in link.')
    })()
  }, [router, searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #020108 0%, #0a1428 40%, #1a0a3a 100%)' }}>
      <div className="rounded-3xl p-10 max-w-md w-full mx-4 text-center"
        style={{ background: 'rgba(8,16,36,0.92)', border: '1px solid rgba(125,211,252,0.25)' }}>
        {status === 'working' ? (
          <>
            <Loader2 size={32} className="animate-spin mx-auto mb-4" style={{ color: '#7dd3fc' }} />
            <h2 className="text-lg font-bold text-white">Signing you in…</h2>
            <p className="text-sm mt-2" style={{ color: 'rgba(220,236,255,0.6)' }}>
              Verifying your sign-in link.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-white mb-3">Sign-in link failed</h2>
            <p className="text-sm mb-5" style={{ color: 'rgba(220,236,255,0.7)' }}>{errorMsg}</p>
            <a href="/admin/login"
              className="inline-block px-6 py-3 rounded-pill text-white font-bold text-sm"
              style={{ background: 'linear-gradient(135deg, #7dd3fc, #a78bfa)' }}>
              Request a new link
            </a>
          </>
        )}
      </div>
    </div>
  )
}
