# Project HPF Foundation Admin

Internal admin portal for **Project Healing Prosperity & Freedom** — CRM, donor
management, accounting, social media, and back-office operations, all behind a
magic-link login restricted to a small allowlist of staff.

This repo started as a fork of `lpbc-admin` (a construction-business admin
portal) and has been stripped down + rebuilt for nonprofit foundation use. The
shared lineage is invoicing, bookkeeping, email inbox, and document storage —
all production-tested code.

---

## Architecture

```
admin.projecthpf.org (Next.js 14 + Tailwind)
        │
        │ Supabase JS client  ◀── magic-link auth + RLS
        ▼
Supabase Postgres (shared with members.projecthpf.org)
        │
        ├─ admin_auth.*      allowlist, magic-link throttle
        ├─ admin_crm.*       donors, prospects, communications
        ├─ admin_billing.*   invoices, receipts, ledger, bank statements
        ├─ admin_audit.*     append-only action log
        │
        └─ members_app.*     existing members portal tables (read-only joins)
```

## Security model

This is a **financial / personal-data system** with a small, trusted user base.
Defense in depth at every layer:

| Layer | What enforces access |
|---|---|
| Edge   | HSTS, CSP, X-Frame-Options DENY, Permissions-Policy in `middleware.ts` |
| Auth   | Magic link only — no passwords. Allowlist checked server-side before send |
| Client | `AdminAuthGuard` calls `/api/auth/whoami` on every page render |
| API    | Every mutating route calls `requireAdminRole()` from `lib/admin-guard.ts` |
| DB     | Row Level Security on every table; `is_admin()` Postgres function gate |
| Audit  | `admin_audit.log()` SECURITY DEFINER function records every mutation |

**If any one layer fails, the others still hold.** A bug in the client guard
can't expose data because the API guard re-checks. A bug in the API guard
can't expose data because RLS re-checks. A bug in RLS can't bypass logging
because the audit function verifies caller identity itself.

### Adding a new admin

1. Insert their email into `admin_auth.admin_users` (SQL or the Admin Users page).
2. They go to `/admin/login`, enter their email, click the magic link.
3. On first sign-in their `supabase_user_id` is automatically linked.

### Removing an admin

`UPDATE admin_auth.admin_users SET is_active=FALSE, deactivated_at=NOW() WHERE email='...'`

Soft delete — never hard-delete. Audit log references admin_id forever; deleting
the row would orphan history. The user is signed out at their next page load.

## Scale model

Built to scale far past the initial 2 admins → millions of donors / member
records / audit events:

- **UUID primary keys** everywhere — no sharding bottlenecks
- **Cursor pagination** (`WHERE id > last_seen`) on every list query
- **Composite indexes** matched to actual query patterns
- **Audit log partition-ready** — composite PK `(id, created_at)` so we can
  `ALTER TABLE ... PARTITION BY RANGE (created_at)` as a metadata-only op once
  rows pass ~50M
- **Soft delete** (`deactivated_at` / `deleted_at`) — no orphaned FKs, full
  history retained, recoverable
- **Server-side rate limits** on auth endpoints + plans for Redis-backed
  general throttling when traffic warrants
- **No `SELECT *`** in production code — every query names its columns

## Local development

```bash
npm install
cp .env.local.example .env.local       # fill in Supabase URL + keys
npx supabase db push                   # applies migrations to your Supabase project
npm run dev                            # http://localhost:3000/admin
```

You must be on the admin allowlist (`admin_auth.admin_users`) to sign in locally
just as in production — magic-link still flows through real Supabase.

## Deployment

Production runs on Flux at `admin.projecthpf.org`. Dockerfile + build script
match the members portal pattern.

```bash
./build.sh                   # builds and pushes projecthpf/projecthpf-admin:vNNN
```

## Module layout

```
app/admin/
  page.tsx           Dashboard
  login/             Magic-link sign-in
  crm/               Donor / member / prospect management
  email/             Inbox via Resend / Gmail API
  social/            Multi-platform post scheduling (planned)
  invoices/          Invoice + donation receipt management
  bookkeeping/       Ledger, reconciliation, bank statements
  reports/           Saved reports + ad-hoc queries
  documents/         Google Drive integration
  calendar/          Scheduled events
  todo/              Task list
  users/             Admin user management (admin role only)

components/admin/    Shared UI (sidebar, guard, modals)
lib/                 supabase client, admin-guard, utilities
app/api/             Server routes; ALL of them call requireAdminRole()
supabase/migrations/ Versioned SQL — never edit a migration that's been run
```

## What was removed from lpbc-admin

Construction-business modules archived under `supabase/migrations/_legacy_construction/`
for reference but not used:

- `worksites`, `permits`, `licensing`, `materials-lists`, `inventory`
- `schedule-requests`, `taxes` (W9/1099 — will rebuild as nonprofit 990 module later)
- `vendor-documents`, `suppliers`

What was kept and rebranded: CRM (now donors), invoicing (now receipts), email,
bookkeeping, documents, calendar, todo, reports, accounts, bank-statements,
Plaid, Stripe, OCR receipt capture, Google Drive.
