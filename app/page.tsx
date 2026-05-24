import { redirect } from 'next/navigation'

/**
 * The root URL of admin.projecthpf.org has no public-facing content.
 * Anyone landing here is bounced into the admin app — they'll hit
 * /admin/login if they're not authenticated, or /admin if they are.
 */
export default function RootPage() {
  redirect('/admin')
}
