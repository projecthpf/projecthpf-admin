# ── Stage 1: Install dependencies ─────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# ── Stage 2: Build the Next.js app ───────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build args become env vars at build time
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
# Build version tag — pass via --build-arg APP_VERSION=v002 (mirrors the
# members portal pattern). Becomes process.env.APP_VERSION at runtime
# so the UI can show which image is actually running.
ARG APP_VERSION=dev

ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-placeholder-anon-key}
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-pk_placeholder}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-https://admin.projecthpf.org}
ENV APP_VERSION=${APP_VERSION}

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Dummy server-side env vars so Next.js build doesn't crash on API routes
ENV SUPABASE_SERVICE_ROLE_KEY=build-placeholder
ENV STRIPE_SECRET_KEY=build-placeholder
ENV RESEND_API_KEY=build-placeholder
ENV PLAID_CLIENT_ID=build-placeholder
ENV PLAID_SECRET=build-placeholder
ENV GOOGLE_CLIENT_ID=build-placeholder
ENV GOOGLE_CLIENT_SECRET=build-placeholder
ENV GOOGLE_REFRESH_TOKEN=build-placeholder
ENV GOOGLE_CALENDAR_ID=build-placeholder
ENV ANTHROPIC_API_KEY=build-placeholder

RUN npm run build

# ── Stage 3: Production runner ───────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV APP_VERSION=${APP_VERSION}

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets
COPY --from=builder /app/public ./public

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
