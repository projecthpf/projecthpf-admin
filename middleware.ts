import { NextResponse, type NextRequest } from 'next/server'

/**
 * Security headers applied to every response. These are the baseline; specific
 * routes can extend (e.g., relaxing connect-src for an external API integration).
 *
 *   - HSTS:                  force HTTPS for 2 years, include subdomains, preload-ready
 *   - X-Frame-Options:       deny iframing entirely (no clickjacking surface)
 *   - X-Content-Type-Options: stop browsers guessing types
 *   - Referrer-Policy:       send only the origin on cross-origin requests
 *   - Permissions-Policy:    disable camera/mic/geolocation by default
 *   - Content-Security-Policy: strict default-src 'self' with explicit allowlist
 *
 * If you need to relax CSP for a specific integration, do it in that route's
 * own response headers, not by loosening this baseline.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options':           'DENY',
  'X-Content-Type-Options':    'nosniff',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Permissions-Policy':        'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'X-DNS-Prefetch-Control':    'off',
}

/**
 * Content Security Policy.
 *
 * Allowlist rationale:
 *   - 'self' for our own assets
 *   - Supabase: API and storage endpoints (replace with your project URL)
 *   - Stripe: payment iframes + assets
 *   - Google: OAuth + Drive + analytics (only what we actually use)
 *   - data: URIs for inline icons/SVGs
 *   - 'unsafe-inline' on style-src is needed for Tailwind's runtime classes;
 *     'unsafe-eval' on script-src would only be needed for some bundlers — we
 *     don't include it so any inline eval() will fail-fast in production.
 *
 * Update the * placeholders below with real URLs as integrations land.
 */
function buildCSP(): string {
  const supabaseDomain = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
    : '*.supabase.co'
  return [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' https://js.stripe.com https://www.googletagmanager.com`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://${supabaseDomain} https://*.googleusercontent.com https://*.gravatar.com`,
    `font-src 'self' data:`,
    `connect-src 'self' https://${supabaseDomain} wss://${supabaseDomain} https://api.stripe.com https://api.resend.com https://api.anthropic.com https://www.googleapis.com`,
    `frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://drive.google.com`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ')
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next()

  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v)
  }
  res.headers.set('Content-Security-Policy', buildCSP())

  return res
}

/**
 * Apply to everything except static assets and Next.js internals.
 * Add API routes here explicitly because middleware doesn't run on
 * static files but DOES run on /api/* by default — that's what we want.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf|otf)$).*)',
  ],
}
