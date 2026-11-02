import { useMemo, useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { useAuth } from '../../auth/AuthProvider'
import { personName, useProfiles } from '../../lib/useProfiles'
import { labelFor } from '../../lib/modelLabel'
import type { AfterSalesQuery, AfterSalesStatus, Model } from '../../lib/types'
import { Button, Confirm, ErrorText, Loading, Toast, fmtDate, fmtDateTime, inputClass } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'

interface Data {
  queries: AfterSalesQuery[]
  models: Model[]
}

async function loadAll() {
  const [queries, models] = await Promise.all([
    supabase!.from('aftersales').select('*').order('created_at', { ascending: false }).limit(1000),
    supabase!.from('models').select('*').order('model_number'),
  ])
  const error = queries.error ?? models.error
  return { data: error ? null : { queries: queries.data as AfterSalesQuery[], models: models.data as Model[] }, error }
}

export const statusInfo: Record<AfterSalesStatus, { label: string; icon: string; pill: string; button: string }> = {
  waiting: {
    label: 'Waiting for response',
    icon: '🔴',
    pill: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    button: 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  },
  diagnosing: {
    label: 'Diagnosing',
    icon: '🟠',
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    button: 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  resolved: {
    label: 'Resolved',
    icon: '🟢',
    pill: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
    button: 'border-green-600 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  },
}

const STALE_DAYS = 14
const daysSince = (at: string) => Math.floor((Date.now() - new Date(at).getTime()) / 864e5)
// Open queries with no update for two weeks: staff are asked whether it's been resolved.
export const isStale = (q: Pick<AfterSalesQuery, 'status' | 'updated_at'>) => q.status !== 'resolved' && daysSince(q.updated_at) >= STALE_DAYS

type Tab = 'open' | 'mine' | 'resolved' | 'all'

export function AfterSalesPage() {
  const { profile, isManager } = useAuth()
  const profiles = useProfiles()
  const { data, error, loading } = useLive<Data>(['aftersales', 'models'], loadAll)
  const [tab, setTab] = useState<Tab>('open')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [toast, setToast] = useState('')

  const queries = useMemo(() => data?.queries ?? [], [data])
  const mine = queries.filter((q) => q.assignee_id === profile?.id && q.status !== 'resolved')
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase()
    return queries
      .filter((q) => tab === 'all' || (tab === 'resolved' ? q.status === 'resolved' : q.status !== 'resolved'))
      .filter((q) => tab !== 'mine' || q.assignee_id === profile?.id)
      .filter((q) => !s || `${q.invoice_ref} ${q.issue} ${labelFor(q.model_id ?? '', data?.models ?? [])}`.toLowerCase().includes(s))
      .sort((a, b) => Number(isStale(b)) - Number(isStale(a)) || Number(b.urgent) - Number(a.urgent) || b.created_at.localeCompare(a.created_at))
  }, [queries, tab, search, profile, data])

  // Every change goes through here, with a line added to the query's updates.
  async function change(q: AfterSalesQuery, fields: Partial<AfterSalesQuery>, note: string) {
    const updates = [...q.updates, { at: new Date().toISOString(), by: profile?.id ?? null, text: note }]
    const { error } = await supabase!
      .from('aftersales')
      .update({ ...fields, updates })
      .eq('id', q.id)
    if (error) setToast(friendlyError(error))
  }

  if (loading) return <Loading />
  if (error || !data)
    return (
      <ErrorText>
        {/aftersales/.test(error) ? 'After-sales is not switched on yet. The founder needs to run database/15-after-sales.sql in Supabase.' : error}
      </ErrorText>
    )

  const staleMine = mine.filter(isStale).length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">🛠️ After-sales</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Customers message the after-sales WhatsApp number. Log each query here and flag it to the right person. The chat itself stays in WhatsApp.
        </p>
      </div>

      {mine.length > 0 && (
        <button
          onClick={() => setTab('mine')}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 border-brand-500 bg-brand-50 px-4 py-3 text-left text-sm dark:bg-slate-800"
        >
          <span>🚩</span>
          <strong>
            {mine.length} quer{mine.length === 1 ? 'y' : 'ies'} flagged to you
          </strong>
          {mine.some((q) => q.urgent) && <span>· {mine.filter((q) => q.urgent).length} urgent</span>}
          {staleMine > 0 && <span className="font-semibold text-red-700 dark:text-red-300">· {staleMine} with no update for 2+ weeks</span>}
        </button>
      )}

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <NewQuery models={data.models} onSaved={(msg) => setToast(msg)} />

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['open', `Open (${queries.filter((q) => q.status !== 'resolved').length})`],
                ['mine', `Flagged to me (${mine.length})`],
                ['resolved', 'Resolved'],
                ['all', `All (${queries.length})`],
              ] as [Tab, string][]
            )
              .filter(([t]) => isManager || t === 'open' || t === 'mine') // resolved queries are history: managers only
              .map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                    tab === t ? 'border-ink bg-ink text-white dark:border-brand-500 dark:bg-brand-500 dark:text-ink' : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            <input
              className={`${inputClass} sm:ml-auto sm:w-56`}
              placeholder="Search invoice number or issue…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {search ? 'No queries match your search.' : tab === 'resolved' ? 'No resolved queries yet.' : 'Nothing open. 👍'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {shown.map((q) => (
                <QueryRow
                  key={q.id}
                  q={q}
                  models={data.models}
                  isMine={q.assignee_id === profile?.id}
                  open={openId === q.id}
                  onToggle={() => setOpenId(openId === q.id ? null : q.id)}
                  change={change}
                  canDelete={isManager}
                  onDeleted={() => setToast(`Query for ${q.invoice_ref} deleted.`)}
                  profiles={profiles}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
      {isManager && <IssuesByMachine queries={queries} models={data.models} onPick={(label) => (setTab('all'), setSearch(label))} />}
      {toast && <Toast onClose={() => setToast('')}>{toast}</Toast>}
    </div>
  )
}

function NewQuery({ models, onSaved }: { models: Model[]; onSaved: (msg: string) => void }) {
  const { profile } = useAuth()
  const profiles = useProfiles()
  const [invoiceRef, setInvoiceRef] = useState('')
  const [modelId, setModelId] = useState('')
  const [issue, setIssue] = useState('')
  const [assignee, setAssignee] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = invoiceRef.trim() && issue.trim() && assignee

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!invoiceRef.trim()) return setError('Enter the invoice number.')
    if (!issue.trim()) return setError("Describe what's wrong.")
    if (!assignee) return setError('Choose who to flag it to.')
    setBusy(true)
    setError('')
    const { error } = await supabase!.from('aftersales').insert({
      invoice_ref: invoiceRef.trim(),
      model_id: modelId || null,
      issue: issue.trim(),
      assignee_id: assignee,
      urgent,
      created_by: profile?.id,
      updates: [{ at: new Date().toISOString(), by: profile?.id ?? null, text: `Logged and flagged to ${personName(profiles, assignee)}` }],
    })
    setBusy(false)
    if (error) return setError(friendlyError(error))
    onSaved(`Query for ${invoiceRef.trim()} logged and flagged to ${personName(profiles, assignee)}.`)
    setInvoiceRef('')
    setModelId('')
    setIssue('')
    setAssignee('')
    setUrgent(false)
  }

  return (
    <form onSubmit={save} className="space-y-3 self-start rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="font-semibold">+ Log a new query</h2>
      <label className="block">
        <span className="text-sm font-semibold">Invoice number *</span>
        <input
          className={`${inputClass} mt-1`}
          required
          maxLength={60}
          placeholder="e.g. BM-1001 or Shopify #1052"
          value={invoiceRef}
          onChange={(e) => setInvoiceRef(e.target.value)}
        />
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Also add this as a label on the WhatsApp chat, so anyone can find it.</span>
      </label>
      <div>
        <span className="text-sm font-semibold">Machine</span>
        <div className="mt-1">
          <ModelPicker models={models} value={modelId} onChange={setModelId} />
        </div>
      </div>
      <label className="block">
        <span className="text-sm font-semibold">What's the issue? *</span>
        <textarea className={`${inputClass} mt-1`} rows={3} required maxLength={1000} value={issue} onChange={(e) => setIssue(e.target.value)} />
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">No customer names or phone numbers.</span>
      </label>
      <label className="block">
        <span className="text-sm font-semibold">Flag to *</span>
        <select className={`${inputClass} mt-1`} required value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Choose a person…</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
      </label>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        New queries start as <span className={`rounded-full px-2 py-0.5 font-semibold ${statusInfo.waiting.pill}`}>🔴 Waiting for response</span>
      </p>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" className="w-full" disabled={busy || !ready}>
        {busy ? 'Saving…' : 'Save & flag'}
      </Button>
    </form>
  )
}

function QueryRow({
  q,
  models,
  isMine,
  open,
  onToggle,
  change,
  canDelete,
  onDeleted,
  profiles,
}: {
  q: AfterSalesQuery
  models: Model[]
  isMine: boolean
  open: boolean
  onToggle: () => void
  change: (q: AfterSalesQuery, fields: Partial<AfterSalesQuery>, note: string) => Promise<void>
  canDelete: boolean
  onDeleted: () => void
  profiles: ReturnType<typeof useProfiles>
}) {
  const [note, setNote] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const s = statusInfo[q.status]
  const stale = isStale(q)
  const setStatus = (status: AfterSalesStatus) =>
    change(q, { status, resolved_at: status === 'resolved' ? new Date().toISOString() : null }, `Status changed to ${statusInfo[status].label}`)

  return (
    <li className={`py-2 ${isMine && q.status !== 'resolved' ? '-mx-2 rounded-lg bg-brand-50/60 px-2 dark:bg-slate-800/60' : ''}`}>
      <button onClick={onToggle} className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 text-left">
        <span className="w-28 shrink-0 font-mono text-sm font-bold">{q.invoice_ref}</span>
        <span className="min-w-0 flex-1 text-sm">
          {q.urgent && <span className="mr-1">❗</span>}
          {q.model_id && <strong className="mr-1">{labelFor(q.model_id, models)}</strong>}
          {q.issue}
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Flagged to {isMine ? <strong>you</strong> : personName(profiles, q.assignee_id)} · updated {fmtDate(q.updated_at)}
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.pill}`}>
          {s.icon} {s.label}
        </span>
      </button>

      {stale && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <span>
            ⏰ No update for <strong>{daysSince(q.updated_at)} days</strong>. Has this been resolved?
          </span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" className="border-green-600 text-green-700" onClick={() => setStatus('resolved')}>
              Yes, resolved
            </Button>
            <Button size="sm" onClick={() => change(q, {}, 'Checked: still open')}>
              No, still open
            </Button>
          </span>
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Status</div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(statusInfo) as AfterSalesStatus[]).map((st) => (
                <button
                  key={st}
                  onClick={() => st !== q.status && setStatus(st)}
                  className={`rounded-lg border px-2 py-2 text-sm font-semibold ${
                    q.status === st ? statusInfo[st].button : 'border-slate-300 text-slate-500 dark:border-slate-700'
                  }`}
                >
                  {statusInfo[st].icon} {statusInfo[st].label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 whitespace-nowrap">
              Flagged to
              <select
                className={`${inputClass} w-auto`}
                value={q.assignee_id ?? ''}
                onChange={(e) => change(q, { assignee_id: e.target.value || null }, `Flagged to ${personName(profiles, e.target.value)}`)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={q.urgent}
                onChange={(e) => change(q, { urgent: e.target.checked }, e.target.checked ? 'Marked urgent' : 'No longer urgent')}
              />
              Urgent
            </label>
            <span className="text-xs text-slate-500">
              Logged by {personName(profiles, q.created_by)} · {fmtDate(q.created_at)}
            </span>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Updates</div>
            <ul className="space-y-1 text-sm">
              {[...q.updates].reverse().map((u, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-xs text-slate-500">{fmtDateTime(u.at)}</span>
                  <span>
                    <strong>{personName(profiles, u.by)}:</strong> {u.text}
                  </span>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!note.trim()) return
                await change(q, {}, note.trim())
                setNote('')
              }}
            >
              <input
                className={inputClass}
                maxLength={500}
                placeholder="Add an update, e.g. part ordered…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button type="submit" disabled={!note.trim()}>
                Add
              </Button>
            </form>
          </div>

          {canDelete && (
            <div className="text-right">
              <button className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => setConfirmDelete(true)}>
                Delete query
              </button>
            </div>
          )}
          {confirmDelete && (
            <Confirm
              title={`Delete the query for ${q.invoice_ref}?`}
              message="This removes the query and its updates for good."
              onConfirm={async () => {
                const { error } = await supabase!.from('aftersales').delete().eq('id', q.id)
                setConfirmDelete(false)
                if (!error) onDeleted()
              }}
              onCancel={() => setConfirmDelete(false)}
            />
          )}
        </div>
      )}
    </li>
  )
}

// Which machines cause the most after-sales queries (all time, resolved ones included).
function IssuesByMachine({ queries, models, onPick }: { queries: AfterSalesQuery[]; models: Model[]; onPick: (label: string) => void }) {
  const rows = useMemo(() => {
    const m = new Map<string, { total: number; open: number; urgent: number; last: string }>()
    for (const q of queries) {
      const k = q.model_id ?? ''
      const r = m.get(k) ?? { total: 0, open: 0, urgent: 0, last: q.created_at }
      r.total++
      if (q.status !== 'resolved') r.open++
      if (q.urgent) r.urgent++
      if (q.created_at > r.last) r.last = q.created_at
      m.set(k, r)
    }
    return [...m.entries()].map(([id, r]) => ({ id, label: id ? labelFor(id, models) : 'No machine given', ...r })).sort((a, b) => b.total - a.total)
  }, [queries, models])
  if (!rows.length) return null
  const max = rows[0].total
  return (
    <section className="space-y-2 pt-2">
      <h2 className="text-lg font-semibold">📊 Issues by machine</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Every after-sales query ever logged, including resolved ones. Click a machine to see its queries.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Machine</th>
              <th className="px-3 py-2">Queries</th>
              <th className="px-3 py-2 text-right">Still open</th>
              <th className="px-3 py-2 text-right">Urgent</th>
              <th className="px-3 py-2 text-right">Latest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <button className="font-semibold hover:underline" onClick={() => onPick(r.id ? r.label : '')}>
                    {r.label}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(6, (r.total / max) * 160)}px` }} />
                    <span className="font-semibold">{r.total}</span>
                  </div>
                </td>
                <td className={`px-3 py-2 text-right ${r.open ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{r.open}</td>
                <td className="px-3 py-2 text-right">{r.urgent}</td>
                <td className="px-3 py-2 text-right text-slate-500">{fmtDate(r.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
