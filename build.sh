#!/bin/bash
# ════════════════════════════════════════════════════════════════════
#  Build + push the Project HPF Admin Docker image.
#
#  Usage:   ./build.sh v5
#  Default: latest
#
#  PUBLIC env vars (those bundled into the client JS) are baked in at
#  build time. They MUST be passed in here — the script will not run
#  with placeholder values, to prevent accidental pushes with wrong
#  Supabase URLs etc.
#
#  Required env (export these in your shell, OR put them in .env.local
#  and source it before running):
#    NEXT_PUBLIC_SUPABASE_URL
#    NEXT_PUBLIC_SUPABASE_ANON_KEY
#    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
#    NEXT_PUBLIC_APP_URL                  (e.g. https://admin.projecthpf.org)
#
#  Server-only env (Supabase service role, Stripe secret, Resend, etc.)
#  is NEVER baked in. It's injected at runtime by the deploy platform.
# ════════════════════════════════════════════════════════════════════

set -euo pipefail

TAG=${1:-latest}
IMAGE=projecthpf/projecthpf-admin

# Auto-source .env.local if it exists so people don't need to export manually.
if [ -f .env.local ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^NEXT_PUBLIC_' .env.local | grep -v '^#' | xargs -d '\n')
fi

# Refuse to build with missing or placeholder env values.
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY NEXT_PUBLIC_APP_URL; do
  val="${!v:-}"
  if [ -z "$val" ] || [[ "$val" == *"YOUR_"* ]] || [[ "$val" == *"..."* ]]; then
    echo "ERROR: $v is missing or still a placeholder. Set it in .env.local or export it first." >&2
    exit 1
  fi
done

echo "→ Building ${IMAGE}:${TAG}"

docker build \
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}" \
  --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
  --build-arg "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}" \
  --build-arg "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  .

echo "→ Pushing ${IMAGE}:${TAG}"
docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:latest"

echo "✓ Done — pushed ${IMAGE}:${TAG}"
