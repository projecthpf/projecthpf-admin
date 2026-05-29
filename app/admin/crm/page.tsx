'use client'
/**
 * CRM & Donors — main browse view.
 *
 * Cosmic-themed list of admin_crm.contacts with type/tag filters,
 * search, cursor-pagination infinite scroll, and a slide-in detail
 * panel that lets you view + edit profile fields, see gifts, log
 * communications, and attach/detach tags.
 *
 * Wire-up:
 *   GET /api/crm/contacts?cursor=…&q=…&type=…&tag=…
 *   POST /api/crm/contacts  (create)
 *   GET /api/crm/contacts/:id  (detail + gifts + comms + tags)
 *   PATCH /api/crm/contacts/:id  (update)
 *   GET /api/crm/tags
 *   POST /api/crm/contacts/:id/tags  (attach)
 *   DELETE /api/crm/contacts/:id/tags?tag_id=…  (detach)
 *   POST /api/crm/gifts  (record a gift)
 *   POST /api/crm/communications  (log a comm)
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// ── Types (mirror the API route schemas) ──────────────────────────
type ContactType =
  | 'individual' | 'organization' | 'foundation' | 'corporate'
  | 'board' | 'volunteer' | 'prospect' | 'vendor'

interface Contact {
  id: string
  contact_type: ContactType
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  email?: string | null
  phone?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  lifetime_giving_cents?: number
  last_gift_at?: string | null
  gift_count?: number
  created_at: string
  updated_at: string
  // populated only on detail fetch
  address_line1?: string | null
  address_line2?: string | null
  postal_code?: string | null
  notes?: string | null
  source?: string | null
  email_opt_in?: boolean
  sms_opt_in?: boolean
  mail_opt_in?: boolean
  member_user_id?: number | null
}

interface Tag {
  id: string
  name: string
  slug: string
  color: string
  description?: string | null
}

interface Gift {
  id: string
  contact_id: string
  amount_cents: number
  currency: string
  gift_kind: string
  received_at: string
  source?: string | null
  campaign?: string | null
  designation?: string | null
  payment_method?: string | null
  receipt_number?: string | null
  voided_at?: string | null
  created_at: string
}

interface Communication {
  id: string
  kind: 'email' | 'call' | 'meeting' | 'sms' | 'letter' | 'note' | 'event' | 'other'
  direction?: 'inbound' | 'outbound' | null
  subject?: string | null
  body?: string | null
  occurred_at: string
  logged_by?: string | null
  created_at: string
}

interface DetailBundle {
  contact: Contact
  tags: Tag[]
  gifts: Gift[]
  comms: Communication[]
}

const CONTACT_TYPES: { value: ContactType; label: string; emoji: string }[] = [
  { value: 'individual',   label: 'Individual',  emoji: '👤' },
  { value: 'organization', label: 'Org',         emoji: '🏛' },
  { value: 'foundation',   label: 'Foundation',  emoji: '🌍' },
  { value: 'corporate',    label: 'Corporate',   emoji: '🏢' },
  { value: 'board',        label: 'Board',       emoji: '🪑' },
  { value: 'volunteer',    label: 'Volunteer',   emoji: '🤲' },
  { value: 'prospect',     label: 'Prospect',    emoji: '✨' },
  { value: 'vendor',       label: 'Vendor',      emoji: '🧾' },
]

function fmtMoney(cents: number | null | undefined) {
  if (!cents) return '$0'
  return '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function displayName(c: Pick<Contact, 'first_name' | 'last_name' | 'company_name' | 'contact_type'>): string {
  const personal = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  if (c.contact_type === 'individual' || c.contact_type === 'board' || c.contact_type === 'volunteer' || c.contact_type === 'prospect') {
    return personal || c.company_name || '(no name)'
  }
  return c.company_name || personal || '(no name)'
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0] || '').join('').toUpperCase() || '?'
}

// ──────────────────────────────────────────────────────────────────
//  Page
// ──────────────────────────────────────────────────────────────────
export default function CRMPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<ContactType | null>(null)
  const [filterTag, setFilterTag] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  const searchTimer = useRef<number | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const fetchPage = useCallback(async (cursor?: string | null, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true)
    try {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      if (search.trim()) params.set('q', search.trim())
      if (filterType) params.set('type', filterType)
      if (filterTag) params.set('tag', filterTag)
      const r = await fetch('/api/crm/contacts?' + params.toString(), { credentials: 'include' })
      const j = await r.json()
      if (j.contacts) {
        setContacts(prev => append ? [...prev, ...j.contacts] : j.contacts)
        setNextCursor(j.next_cursor || null)
      }
    } catch (err) {
      console.error('[crm fetch]', err)
    } finally {
      setLoading(false); setLoadingMore(false)
    }
  }, [search, filterType, filterTag])

  // Load tags once
  useEffect(() => {
    fetch('/api/crm/tags', { credentials: 'include' })
      .then(r => r.json())
      .then(j => setTags(j.tags || []))
      .catch(() => {})
  }, [])

  // Refetch on filter changes (debounced for search)
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => fetchPage(null, false), 220) as unknown as number
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current) }
  }, [search, filterType, filterTag, fetchPage])

  // Infinite scroll sentinel
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && nextCursor && !loadingMore && !loading) {
        fetchPage(nextCursor, true)
      }
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [nextCursor, loadingMore, loading, fetchPage])

  function clearFilters() {
    setSearch(''); setFilterType(null); setFilterTag(null)
  }

  return (
    <div className="min-h-screen text-ink" style={{ background: '#020108' }}>
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 border-b border-white/5 backdrop-blur-md" style={{ background: 'rgba(2,1,8,0.85)' }}>
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <h1 className="text-2xl font-bold text-ink">CRM & Donors</h1>
            <p className="text-xs text-ink-muted mt-1">Contacts, gifts, communications · {contacts.length} loaded</p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="px-5 py-2.5 rounded-pill font-semibold text-sm text-white whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #0489c7, #7c3aed)', boxShadow: '0 4px 14px rgba(125,211,252,0.25)' }}
          >
            + New Contact
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="max-w-7xl mx-auto px-6 py-5 space-y-3">
        <div className="flex gap-3 items-center">
          <input
            type="search"
            placeholder="Search by name, email, company, city…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 px-5 py-2.5 rounded-pill bg-surface-raised border border-white/10 text-ink placeholder:text-ink-subtle text-sm outline-none focus:border-brand-400"
          />
          {(search || filterType || filterTag) && (
            <button onClick={clearFilters} className="px-4 py-2 rounded-pill text-xs text-ink-muted border border-white/10 hover:bg-white/5">
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterChip active={filterType === null} onClick={() => setFilterType(null)} label="All types" />
          {CONTACT_TYPES.map(t => (
            <FilterChip
              key={t.value}
              active={filterType === t.value}
              onClick={() => setFilterType(filterType === t.value ? null : t.value)}
              label={<><span className="mr-1">{t.emoji}</span>{t.label}</>}
            />
          ))}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <FilterChip active={filterTag === null} onClick={() => setFilterTag(null)} label="All tags" />
            {tags.map(t => (
              <FilterChip
                key={t.id}
                active={filterTag === t.slug}
                onClick={() => setFilterTag(filterTag === t.slug ? null : t.slug)}
                label={t.name}
                accent={t.color}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── List ── */}
      <div className="max-w-7xl mx-auto px-6 pb-24">
        {loading ? (
          <div className="text-center py-24 text-ink-muted">Loading contacts…</div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-5xl mb-3 opacity-60">🌌</div>
            <div className="text-ink-muted text-sm">No contacts match these filters.</div>
            {(search || filterType || filterTag) && (
              <button onClick={clearFilters} className="mt-4 text-brand-400 text-sm underline">Clear filters</button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map(c => (
              <ContactRow
                key={c.id}
                contact={c}
                selected={selectedId === c.id}
                onClick={() => setSelectedId(c.id)}
              />
            ))}
            <div ref={sentinelRef} className="h-10 flex items-center justify-center text-xs text-ink-subtle">
              {loadingMore ? 'Loading more…' : nextCursor ? '↓ Scroll for more' : (contacts.length > 0 ? '· end ·' : '')}
            </div>
          </div>
        )}
      </div>

      {/* ── Detail panel (slide-in) ── */}
      {selectedId && (
        <DetailPanel
          contactId={selectedId}
          tags={tags}
          onClose={() => setSelectedId(null)}
          onUpdate={updated => {
            setContacts(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
          }}
          onDelete={id => {
            setContacts(prev => prev.filter(c => c.id !== id))
            setSelectedId(null)
          }}
        />
      )}

      {/* ── New contact modal ── */}
      {showNewModal && (
        <NewContactModal
          onClose={() => setShowNewModal(false)}
          onCreated={c => {
            setContacts(prev => [c, ...prev])
            setShowNewModal(false)
            setSelectedId(c.id)
          }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
//  Components
// ──────────────────────────────────────────────────────────────────
function FilterChip({
  active, onClick, label, accent
}: { active: boolean; onClick: () => void; label: React.ReactNode; accent?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-pill text-xs font-medium transition border ${
        active
          ? 'text-white border-transparent'
          : 'text-ink-muted border-white/10 hover:bg-white/5'
      }`}
      style={active ? {
        background: accent
          ? `linear-gradient(135deg, ${accent}cc, ${accent}80)`
          : 'linear-gradient(135deg, #0489c7, #7c3aed)',
        boxShadow: '0 0 14px rgba(125,211,252,0.25)'
      } : undefined}
    >
      {label}
    </button>
  )
}

function ContactRow({
  contact, selected, onClick
}: { contact: Contact; selected: boolean; onClick: () => void }) {
  const name = displayName(contact)
  const typeMeta = CONTACT_TYPES.find(t => t.value === contact.contact_type) ?? CONTACT_TYPES[0]
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-5 py-3.5 rounded-2xl transition flex items-center gap-4 ${
        selected ? 'bg-brand-night border border-brand-400/40' : 'bg-surface-raised border border-white/5 hover:border-white/15'
      }`}
    >
      <div
        className="w-11 h-11 rounded-pill flex items-center justify-center font-bold text-sm shrink-0"
        style={{
          background: 'linear-gradient(135deg, rgba(4,137,199,0.25), rgba(167,139,250,0.20))',
          color: '#7dd3fc',
          border: '1px solid rgba(125,211,252,0.2)'
        }}
      >
        {initials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <div className="font-semibold text-ink truncate">{name}</div>
          <span className="text-xs text-ink-subtle whitespace-nowrap">{typeMeta.emoji} {typeMeta.label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-muted mt-0.5 truncate">
          {contact.email && <span className="truncate">{contact.email}</span>}
          {contact.email && (contact.city || contact.state) && <span className="opacity-40">·</span>}
          {(contact.city || contact.state) && <span>📍 {[contact.city, contact.state].filter(Boolean).join(', ')}</span>}
        </div>
      </div>
      <div className="text-right shrink-0 hidden sm:block">
        <div className="text-sm font-bold" style={{ color: '#a78bfa' }}>{fmtMoney(contact.lifetime_giving_cents)}</div>
        <div className="text-[10px] text-ink-subtle">lifetime</div>
      </div>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────
//  Detail Panel (slide-in)
// ──────────────────────────────────────────────────────────────────
function DetailPanel({
  contactId, tags, onClose, onUpdate, onDelete
}: {
  contactId: string
  tags: Tag[]
  onClose: () => void
  onUpdate: (c: Contact) => void
  onDelete: (id: string) => void
}) {
  const [bundle, setBundle] = useState<DetailBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'profile' | 'gifts' | 'comms' | 'tags'>('profile')
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState<Partial<Contact>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/crm/contacts/${contactId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        if (j.contact) {
          setBundle({ contact: j.contact, tags: j.tags || [], gifts: j.gifts || [], comms: j.comms || [] })
          setForm(j.contact)
        }
      })
      .finally(() => setLoading(false))
  }, [contactId])

  async function saveProfile() {
    if (!bundle) return
    setSaving(true)
    try {
      const r = await fetch(`/api/crm/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form)
      })
      const j = await r.json()
      if (j.contact) {
        setBundle({ ...bundle, contact: j.contact })
        onUpdate(j.contact)
        setEdit(false)
      } else {
        alert(j.detail ? JSON.stringify(j.detail) : (j.error || 'Update failed'))
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Soft-delete this contact? Gifts will be preserved.')) return
    const r = await fetch(`/api/crm/contacts/${contactId}`, { method: 'DELETE', credentials: 'include' })
    const j = await r.json()
    if (j.ok) onDelete(contactId)
    else alert(j.error || 'Delete failed')
  }

  const name = bundle ? displayName(bundle.contact) : ''

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm" />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-xl z-40 overflow-y-auto border-l border-white/10"
        style={{ background: '#0a1428' }}>
        <div className="sticky top-0 z-10 px-6 py-4 border-b border-white/10 backdrop-blur-md flex items-center justify-between gap-4"
          style={{ background: 'rgba(10,20,40,0.92)' }}>
          <div className="min-w-0">
            <div className="font-bold text-lg text-ink truncate">{name || 'Loading…'}</div>
            {bundle && (
              <div className="text-xs text-ink-muted mt-0.5">
                {bundle.contact.email || '—'} · lifetime {fmtMoney(bundle.contact.lifetime_giving_cents)}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-pill text-ink-muted hover:bg-white/5">✕</button>
        </div>

        {loading || !bundle ? (
          <div className="p-12 text-center text-ink-muted">Loading…</div>
        ) : (
          <>
            <div className="px-6 pt-4 flex gap-1 border-b border-white/5">
              {(['profile', 'gifts', 'comms', 'tags'] as const).map(t => (
                <button key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-2xl transition ${
                    tab === t ? 'text-brand-400 border-b-2 border-brand-400 -mb-px' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {t === 'profile' ? 'Profile' : t === 'gifts' ? `Gifts (${bundle.gifts.length})` : t === 'comms' ? `Comms (${bundle.comms.length})` : `Tags (${bundle.tags.length})`}
                </button>
              ))}
            </div>

            <div className="p-6">
              {tab === 'profile' && (
                <ProfileTab
                  contact={bundle.contact}
                  edit={edit}
                  setEdit={setEdit}
                  form={form}
                  setForm={setForm}
                  saving={saving}
                  onSave={saveProfile}
                  onDelete={handleDelete}
                />
              )}
              {tab === 'gifts' && (
                <GiftsTab
                  contactId={contactId}
                  gifts={bundle.gifts}
                  onAdded={g => setBundle({ ...bundle, gifts: [g, ...bundle.gifts] })}
                />
              )}
              {tab === 'comms' && (
                <CommsTab
                  contactId={contactId}
                  comms={bundle.comms}
                  onAdded={c => setBundle({ ...bundle, comms: [c, ...bundle.comms] })}
                />
              )}
              {tab === 'tags' && (
                <TagsTab
                  contactId={contactId}
                  attached={bundle.tags}
                  allTags={tags}
                  onChange={updatedTags => setBundle({ ...bundle, tags: updatedTags })}
                />
              )}
            </div>
          </>
        )}
      </aside>
    </>
  )
}

function ProfileTab({
  contact, edit, setEdit, form, setForm, saving, onSave, onDelete
}: {
  contact: Contact
  edit: boolean
  setEdit: (b: boolean) => void
  form: Partial<Contact>
  setForm: (f: Partial<Contact>) => void
  saving: boolean
  onSave: () => void
  onDelete: () => void
}) {
  function field(label: string, key: keyof Contact, type: 'text' | 'email' | 'tel' = 'text') {
    const v = (form[key] as string) || ''
    return (
      <div>
        <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">{label}</label>
        {edit ? (
          <input
            type={type}
            value={v}
            onChange={e => setForm({ ...form, [key]: e.target.value })}
            className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none"
          />
        ) : (
          <div className="text-sm text-ink py-2">{(contact[key] as string) || <span className="text-ink-subtle">—</span>}</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {field('First Name', 'first_name')}
        {field('Last Name', 'last_name')}
      </div>
      {field('Company', 'company_name')}
      <div className="grid grid-cols-2 gap-4">
        {field('Email', 'email', 'email')}
        {field('Phone', 'phone', 'tel')}
      </div>
      {field('Address', 'address_line1')}
      <div className="grid grid-cols-3 gap-4">
        {field('City', 'city')}
        {field('State', 'state')}
        {field('ZIP', 'postal_code')}
      </div>
      <div>
        <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Contact Type</label>
        {edit ? (
          <select
            value={form.contact_type || 'individual'}
            onChange={e => setForm({ ...form, contact_type: e.target.value as ContactType })}
            className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none"
          >
            {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
          </select>
        ) : (
          <div className="text-sm text-ink py-2">
            {(() => {
              const t = CONTACT_TYPES.find(x => x.value === contact.contact_type)
              return t ? `${t.emoji} ${t.label}` : contact.contact_type
            })()}
          </div>
        )}
      </div>
      <div>
        <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Notes</label>
        {edit ? (
          <textarea
            rows={4}
            value={(form.notes as string) || ''}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none resize-y"
          />
        ) : (
          <div className="text-sm text-ink py-2 whitespace-pre-wrap">{contact.notes || <span className="text-ink-subtle">—</span>}</div>
        )}
      </div>

      <div className="pt-4 flex gap-2 border-t border-white/5">
        {edit ? (
          <>
            <button onClick={onSave} disabled={saving}
              className="px-5 py-2 rounded-pill text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #0489c7, #7c3aed)' }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={() => setEdit(false)} className="px-5 py-2 rounded-pill text-sm text-ink-muted border border-white/10">Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setEdit(true)} className="px-5 py-2 rounded-pill text-sm font-semibold text-ink border border-white/15 hover:bg-white/5">✎ Edit</button>
            <div className="flex-1" />
            <button onClick={onDelete} className="px-5 py-2 rounded-pill text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10">Delete</button>
          </>
        )}
      </div>
    </div>
  )
}

const GIFT_KINDS = ['one_time', 'recurring', 'pledge', 'in_kind', 'grant', 'sponsorship', 'membership']

function GiftsTab({
  contactId, gifts, onAdded
}: { contactId: string; gifts: Gift[]; onAdded: (g: Gift) => void }) {
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState('one_time')
  const [source, setSource] = useState('')
  const [campaign, setCampaign] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  async function submitGift() {
    const dollars = parseFloat(amount)
    if (!Number.isFinite(dollars) || dollars <= 0) { alert('Amount must be > $0'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/crm/gifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          contact_id: contactId,
          amount_cents: Math.round(dollars * 100),
          currency: 'USD',
          gift_kind: kind,
          received_at: new Date(date).toISOString(),
          source: source || null,
          campaign: campaign || null,
        })
      })
      const j = await r.json()
      if (j.gift) {
        onAdded(j.gift)
        setAdding(false); setAmount(''); setSource(''); setCampaign('')
      } else {
        alert(j.detail ? JSON.stringify(j.detail) : (j.error || 'Failed'))
      }
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="w-full py-2.5 rounded-2xl text-sm font-semibold text-brand-400 border border-brand-400/30 hover:bg-brand-400/5">
          + Record a gift
        </button>
      ) : (
        <div className="p-4 rounded-2xl border border-white/10 bg-surface-sunken space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">Amount ($)</label>
              <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="100.00"
                className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-ink outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Date received</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-ink outline-none focus:border-brand-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">Kind</label>
              <select value={kind} onChange={e => setKind(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-ink outline-none focus:border-brand-400">
                {GIFT_KINDS.map(k => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Source</label>
              <input value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. website, event"
                className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-ink outline-none focus:border-brand-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Campaign (optional)</label>
            <input value={campaign} onChange={e => setCampaign(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-ink outline-none focus:border-brand-400" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={submitGift} disabled={saving}
              className="px-5 py-2 rounded-pill text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #059669, #34d399)' }}>
              {saving ? 'Saving…' : 'Record gift'}
            </button>
            <button onClick={() => setAdding(false)} className="px-5 py-2 rounded-pill text-sm text-ink-muted border border-white/10">Cancel</button>
          </div>
        </div>
      )}

      {gifts.length === 0 ? (
        <div className="text-center py-12 text-sm text-ink-subtle">No gifts recorded yet.</div>
      ) : (
        <div className="space-y-2">
          {gifts.map(g => (
            <div key={g.id} className={`p-3 rounded-2xl border ${g.voided_at ? 'border-red-500/20 bg-red-500/5' : 'border-white/10 bg-surface-sunken'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-bold text-lg" style={{ color: g.voided_at ? '#fca5a5' : '#86efac' }}>
                  {fmtMoney(g.amount_cents)} {g.voided_at && <span className="text-xs ml-2">(voided)</span>}
                </div>
                <div className="text-xs text-ink-muted">{fmtDate(g.received_at)}</div>
              </div>
              <div className="text-xs text-ink-muted mt-1 flex gap-3 flex-wrap">
                <span>{g.gift_kind.replace('_', ' ')}</span>
                {g.source && <span>· {g.source}</span>}
                {g.campaign && <span>· {g.campaign}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const COMM_KINDS = ['email', 'call', 'meeting', 'sms', 'letter', 'note', 'event', 'other']

function CommsTab({
  contactId, comms, onAdded
}: { contactId: string; comms: Communication[]; onAdded: (c: Communication) => void }) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<Communication['kind']>('note')
  const [direction, setDirection] = useState<'inbound' | 'outbound' | ''>('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  async function submitComm() {
    if (!body.trim() && !subject.trim()) { alert('Add a subject or body'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/crm/communications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          contact_id: contactId,
          kind, subject: subject || null, body: body || null,
          direction: direction || undefined,
        })
      })
      const j = await r.json()
      if (j.communication) {
        onAdded(j.communication)
        setAdding(false); setSubject(''); setBody(''); setKind('note'); setDirection('')
      } else alert(j.detail ? JSON.stringify(j.detail) : (j.error || 'Failed'))
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="w-full py-2.5 rounded-2xl text-sm font-semibold text-brand-400 border border-brand-400/30 hover:bg-brand-400/5">
          + Log a communication
        </button>
      ) : (
        <div className="p-4 rounded-2xl border border-white/10 bg-surface-sunken space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">Kind</label>
              <select value={kind} onChange={e => setKind(e.target.value as Communication['kind'])}
                className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-ink outline-none focus:border-brand-400">
                {COMM_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Direction</label>
              <select value={direction} onChange={e => setDirection(e.target.value as 'inbound' | 'outbound' | '')}
                className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-ink outline-none focus:border-brand-400">
                <option value="">—</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </div>
          </div>
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject"
            className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-ink outline-none focus:border-brand-400" />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Notes / body" rows={4}
            className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-ink outline-none focus:border-brand-400 resize-y" />
          <div className="flex gap-2">
            <button onClick={submitComm} disabled={saving}
              className="px-5 py-2 rounded-pill text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #0489c7, #7c3aed)' }}>
              {saving ? 'Saving…' : 'Log it'}
            </button>
            <button onClick={() => setAdding(false)} className="px-5 py-2 rounded-pill text-sm text-ink-muted border border-white/10">Cancel</button>
          </div>
        </div>
      )}

      {comms.length === 0 ? (
        <div className="text-center py-12 text-sm text-ink-subtle">No communications logged.</div>
      ) : (
        <div className="space-y-2">
          {comms.map(c => (
            <div key={c.id} className="p-3 rounded-2xl border border-white/10 bg-surface-sunken">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-semibold text-ink">
                  <span className="text-xs uppercase tracking-wider text-brand-400 mr-2">{c.kind}{c.direction ? ` · ${c.direction}` : ''}</span>
                  {c.subject || '(no subject)'}
                </div>
                <div className="text-xs text-ink-muted whitespace-nowrap">{fmtDate(c.occurred_at)}</div>
              </div>
              {c.body && <div className="text-xs text-ink-muted mt-2 whitespace-pre-wrap">{c.body}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TagsTab({
  contactId, attached, allTags, onChange
}: { contactId: string; attached: Tag[]; allTags: Tag[]; onChange: (next: Tag[]) => void }) {
  const [working, setWorking] = useState<string | null>(null)
  const attachedIds = new Set(attached.map(t => t.id))

  async function toggle(tag: Tag) {
    setWorking(tag.id)
    try {
      if (attachedIds.has(tag.id)) {
        const r = await fetch(`/api/crm/contacts/${contactId}/tags?tag_id=${tag.id}`, {
          method: 'DELETE', credentials: 'include'
        })
        const j = await r.json()
        if (j.ok) onChange(attached.filter(t => t.id !== tag.id))
        else alert(j.error || 'Detach failed')
      } else {
        const r = await fetch(`/api/crm/contacts/${contactId}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tag_id: tag.id })
        })
        const j = await r.json()
        if (j.ok) onChange([...attached, tag])
        else alert(j.error || 'Attach failed')
      }
    } finally { setWorking(null) }
  }

  return (
    <div>
      <div className="text-xs text-ink-muted mb-3">Click tags to attach or detach.</div>
      <div className="flex flex-wrap gap-2">
        {allTags.map(t => {
          const isOn = attachedIds.has(t.id)
          return (
            <button key={t.id}
              disabled={working === t.id}
              onClick={() => toggle(t)}
              className={`px-3.5 py-1.5 rounded-pill text-xs font-medium border transition ${isOn ? 'text-white border-transparent' : 'text-ink-muted border-white/10 hover:bg-white/5'}`}
              style={isOn ? {
                background: `linear-gradient(135deg, ${t.color}cc, ${t.color}80)`,
                boxShadow: '0 0 12px rgba(125,211,252,0.2)'
              } : undefined}
            >
              {working === t.id ? '…' : (isOn ? '✓ ' : '+ ') + t.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
//  New Contact Modal
// ──────────────────────────────────────────────────────────────────
function NewContactModal({
  onClose, onCreated
}: { onClose: () => void; onCreated: (c: Contact) => void }) {
  const [form, setForm] = useState<Partial<Contact>>({
    contact_type: 'individual',
    country: 'US'
  })
  const [saving, setSaving] = useState(false)

  async function submit() {
    const hasName = !!(form.first_name?.trim() || form.last_name?.trim() || form.company_name?.trim())
    if (!hasName) { alert('Need at least a first name, last name, or company name.'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form)
      })
      const j = await r.json()
      if (j.contact) onCreated(j.contact)
      else alert(j.detail ? JSON.stringify(j.detail) : (j.error || 'Create failed'))
    } finally { setSaving(false) }
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 z-40 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-lg rounded-3xl border border-white/10 shadow-card-lg pointer-events-auto"
          style={{ background: '#0a1428' }}>
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="font-bold text-lg text-ink">New Contact</h2>
            <button onClick={onClose} className="p-2 rounded-pill text-ink-muted hover:bg-white/5">✕</button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Type</label>
              <select value={form.contact_type} onChange={e => setForm({ ...form, contact_type: e.target.value as ContactType })}
                className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none">
                {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.first_name || ''} onChange={e => setForm({ ...form, first_name: e.target.value })} placeholder="First name"
                className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none" />
              <input value={form.last_name || ''} onChange={e => setForm({ ...form, last_name: e.target.value })} placeholder="Last name"
                className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none" />
            </div>
            <input value={form.company_name || ''} onChange={e => setForm({ ...form, company_name: e.target.value })} placeholder="Company (if applicable)"
              className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none" />
            <div className="grid grid-cols-2 gap-3">
              <input type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email"
                className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none" />
              <input type="tel" value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone"
                className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.city || ''} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City"
                className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none" />
              <input value={form.state || ''} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="State"
                className="w-full px-4 py-2 rounded-xl bg-surface-sunken border border-white/10 text-sm text-ink focus:border-brand-400 outline-none" />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2">
            <button onClick={onClose} className="px-5 py-2 rounded-pill text-sm text-ink-muted border border-white/10">Cancel</button>
            <button onClick={submit} disabled={saving}
              className="px-5 py-2 rounded-pill text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #0489c7, #7c3aed)' }}>
              {saving ? 'Creating…' : 'Create contact'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
