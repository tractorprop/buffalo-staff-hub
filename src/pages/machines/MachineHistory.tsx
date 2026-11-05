import { useMemo, useState } from 'react'
import type { AuditEntry, ContainerCheckin, Model } from '../../lib/types'
import { supabase } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { selectAll } from '../../lib/selectAll'
import { labelFor } from '../../lib/modelLabel'
import { fmtDate } from '../../components/ui'
import { HistorySection, countList, countTotal, useAuditLog, type HistoryEvent } from '../../components/HistorySection'

type Row = {
  model_id?: string
  size?: string | null
  status?: string
  container_ref?: string | null
  eta?: string | null
  notes?: string | null
  stock_reference?: string | null
  serial_number?: string | null
  location?: string | null
}

type Kind = 'container' | 'arrival' | 'sold' | 'returned' | 'added' | 'removed' | 'changed'

const kinds: [Kind | 'short', string][] = [
  ['container', '🚢 Containers added'],
  ['arrival', '✅ Arrivals'],
  ['short', '⚠️ Short arrivals'],
  ['sold', '📤 Sold / left'],
  ['returned', '↩️ Returns'],
  ['added', '➕ Added to stock'],
  ['removed', '🗑️ Removed'],
  ['changed', '✏️ Changes'],
]

interface Group {
  kind: Kind
  at: string
  lastAt: string
  by: string | null
  ref: string // container or stock-entry reference
  items: Map<string, number>
  extra: Map<string, number> // arrivals: extras found at check-in
  missing: Map<string, number> // arrivals: removed as missing
  short?: string // arrivals: everything that didn't arrive, from the check-in
  note: string
  ids: number[]
}

// What one activity-log row means, in plain terms.
function classify(e: AuditEntry): { kind: Kind; row: Row; ref: string; part?: 'extra' | 'missing'; note?: string } | null {
  const o = (e.old_data ?? {}) as Row
  const n = (e.new_data ?? {}) as Row
  if (e.action === 'INSERT') {
    if (n.status === 'en_route') return { kind: 'container', row: n, ref: n.container_ref ?? '', note: n.eta ? `ETA ${fmtDate(n.eta)}` : '' }
    if (n.notes?.startsWith('Extra')) return { kind: 'arrival', row: n, ref: n.container_ref ?? '', part: 'extra' }
    if (n.notes === 'Return') return { kind: 'returned', row: n, ref: n.stock_reference ?? '' }
    return { kind: 'added', row: n, ref: n.container_ref ?? '' }
  }
  if (e.action === 'DELETE') {
    if (o.status === 'en_route') return { kind: 'arrival', row: o, ref: o.container_ref ?? '', part: 'missing' }
    return { kind: 'removed', row: o, ref: '' }
  }
  if (o.status === 'en_route' && n.status === 'in_stock') return { kind: 'arrival', row: n, ref: n.container_ref ?? o.container_ref ?? '' }
  if (o.status === 'in_stock' && n.status === 'sold') return { kind: 'sold', row: n, ref: n.stock_reference ?? '' }
  if (o.status === 'sold' && n.status === 'in_stock') return { kind: 'returned', row: n, ref: n.stock_reference ?? '' }
  const changes: string[] = []
  if (o.status !== n.status) changes.push(`status ${o.status ?? '–'} → ${n.status ?? '–'}`)
  if (o.eta !== n.eta) changes.push(`ETA ${o.eta ? fmtDate(o.eta) : '–'} → ${n.eta ? fmtDate(n.eta) : '–'}`)
  if (o.container_ref !== n.container_ref) changes.push(`container ${o.container_ref ?? '–'} → ${n.container_ref ?? '–'}`)
  if (o.serial_number !== n.serial_number) changes.push(`serial ${n.serial_number ?? '–'}`)
  if (o.location !== n.location) changes.push(`location ${n.location ?? '–'}`)
  if (o.size !== n.size) changes.push(`size ${o.size ?? '–'} → ${n.size ?? '–'}`)
  if (o.notes !== n.notes) changes.push('notes')
  if (!changes.length) return null // nothing a person would care about
  return { kind: 'changed', row: n, ref: n.container_ref ?? '', note: changes.join(', ') }
}

// Rows of the same kind, by the same person, for the same container/reference, within a few minutes form one entry.
function group(log: AuditEntry[], label: (r: Row) => string) {
  const out: Group[] = []
  for (const e of log) {
    const c = classify(e)
    if (!c) continue
    const t = new Date(e.changed_at).getTime()
    // A missing item removed during a check-in belongs with that arrival; otherwise it's a container edit.
    const matchKind = (g: Group) => g.kind === c.kind || (c.part === 'missing' && g.kind === 'arrival')
    let g = out.find(
      (x) => matchKind(x) && x.by === e.changed_by && x.ref === c.ref && x.note === (c.note ?? x.note) && t - new Date(x.lastAt).getTime() < 5 * 60e3,
    )
    if (!g) {
      g = { kind: c.kind, at: e.changed_at, lastAt: e.changed_at, by: e.changed_by, ref: c.ref, items: new Map(), extra: new Map(), missing: new Map(), note: c.note ?? '', ids: [] }
      out.push(g)
    }
    g.lastAt = e.changed_at
    g.ids.push(e.id)
    const m = c.part ? g[c.part] : g.items
    const l = label(c.row)
    m.set(l, (m.get(l) ?? 0) + 1)
  }
  // Missing items on their own (no arrival) were taken off a container that's still on the way.
  for (const g of out) if (g.kind === 'arrival' && g.items.size === 0 && g.extra.size === 0) g.kind = 'removed'
  return out
}

const icon: Record<Kind, string> = { container: '🚢', arrival: '✅', sold: '📤', returned: '↩️', added: '➕', removed: '🗑️', changed: '✏️' }

function toEvent(g: Group): HistoryEvent {
  const n = countTotal(g.items)
  const ref = g.ref ? ` · ${g.ref}` : ''
  const title = {
    container: `Container ${g.ref || '(no reference)'} added: ${n} item${n === 1 ? '' : 's'} on the way`,
    arrival: `Container ${g.ref || '(no reference)'} arrived: ${n + countTotal(g.extra)} into stock`,
    sold: `${n} left the warehouse${ref}`,
    returned: `${n} returned to stock${ref}`,
    added: `${n} added straight into stock${g.ref ? ` · ${g.ref}` : ''}`,
    removed: g.missing.size
      ? `${countTotal(g.missing)} removed from container ${g.ref || '(no reference)'}`
      : `${n} deleted`,
    changed: `${n} item${n === 1 ? '' : 's'} edited${g.ref ? ` · container ${g.ref}` : ''}`,
  }[g.kind]
  const list = g.kind === 'removed' && g.missing.size ? g.missing : g.items
  return {
    key: `${g.kind}${g.at}${g.ref}${g.by}`,
    at: g.at,
    by: g.by,
    icon: icon[g.kind],
    kind: g.kind,
    title,
    detail: (
      <>
        {list.size > 0 && <div>{countList(list)}</div>}
        {g.note && <div className="text-xs text-slate-500 dark:text-slate-400">{g.note}</div>}
        {g.kind === 'arrival' && g.extra.size > 0 && <div className="text-sky-700 dark:text-sky-300">➕ Extras found: {countList(g.extra)}</div>}
        {g.kind === 'arrival' && (g.short || g.missing.size > 0) && (
          <div className="mt-1 inline-block rounded-md bg-red-50 px-2 py-0.5 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
            ⚠️ Missing: {g.short ?? countList(g.missing)}
          </div>
        )}
      </>
    ),
    search: `${title} ${countList(g.items)}${g.extra.size ? ` Extras found: ${countList(g.extra)}` : ''}${
      g.short || g.missing.size ? ` Missing: ${g.short ?? countList(g.missing)}` : ''
    } ${g.note}`,
    tags: g.kind === 'arrival' && (g.short || g.missing.size) ? ['short'] : undefined,
    ids: g.ids,
  }
}

// Everything that has happened to stock: containers, arrivals, sales, returns, removals and edits.
export function MachineHistory({ models }: { models: Model[] }) {
  const [days, setDays] = useState(90)
  const { data, error, reload, loading } = useAuditLog('machines', days)
  // Approved check-ins, for what didn't arrive in each container.
  const { data: checkins } = useLive<ContainerCheckin[]>(
    ['container_checkins'],
    () =>
      selectAll<ContainerCheckin>(() =>
        supabase!
          .from('container_checkins')
          .select('*')
          .eq('status', 'approved')
          .gte('decided_at', new Date(Date.now() - (days + 1) * 864e5).toISOString())
          .order('decided_at')
          .order('id'),
      ),
    [days],
  )
  const events = useMemo(() => {
    const label = (r: Row) => labelFor(r.model_id ?? '', models, r.size)
    const groups = group(data ?? [], label)
    for (const g of groups) {
      if (g.kind !== 'arrival') continue
      // The check-in approved for this container at the same time as these items arrived.
      const ci = (checkins ?? []).find(
        (c) => c.container_ref === g.ref && c.decided_at && Math.abs(new Date(c.decided_at).getTime() - new Date(g.at).getTime()) < 15 * 60e3,
      )
      if (ci?.short?.length)
        g.short = ci.short
          .map((x) => `${x.qty}× ${labelFor(x.model_id, models, x.size)} (${x.kept ? 'still expected' : 'removed'})`)
          .join(', ')
    }
    return groups.map(toEvent)
  }, [data, models, checkins])

  return (
    <HistorySection
      title="📜 Machines history"
      description="Everything that has happened to stock: containers added, arrivals, items sold or returned, removals and changes."
      events={events}
      kinds={kinds}
      days={days}
      fileName="machines-history"
      loading={loading}
      onDays={(n) => setDays((d) => Math.max(d, n))}
      onLoadOlder={() => setDays((d) => d + 365)}
      error={error}
      onDeleted={reload}
    />
  )
}
