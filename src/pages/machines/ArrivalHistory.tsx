import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { personName, useProfiles } from '../../lib/useProfiles'
import type { AuditEntry, Model } from '../../lib/types'
import { Button, ErrorText, fmtDateTime, inputClass } from '../../components/ui'

type Row = { model_id?: string; size?: string | null; status?: string; container_ref?: string | null; notes?: string | null }

interface Arrival {
  at: string
  lastAt: string
  by: string | null
  ref: string
  arrived: Map<string, number>
  extra: Map<string, number>
  missing: Map<string, number>
}

async function load(days: number) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  return supabase!
    .from('audit_log')
    .select('*')
    .eq('table_name', 'machines')
    .gte('changed_at', since)
    .or('old_data->>status.eq.en_route,new_data->>notes.like.Extra*')
    .order('changed_at')
    .limit(10000)
}

// Approved container arrivals, built from the activity log: machines moved from
// En route to In stock, extras added at check-in, and items removed as missing.
// Rows for the same container by the same person within a few minutes form one arrival.
function group(log: AuditEntry[], label: (r: Row) => string) {
  const out: Arrival[] = []
  for (const e of log) {
    const o = (e.old_data ?? {}) as Row
    const n = (e.new_data ?? {}) as Row
    let kind: 'arrived' | 'extra' | 'missing' | null = null
    let row: Row = n
    if (e.action === 'UPDATE' && o.status === 'en_route' && n.status === 'in_stock') kind = 'arrived'
    else if (e.action === 'INSERT' && n.status === 'in_stock' && n.notes?.startsWith('Extra')) kind = 'extra'
    else if (e.action === 'DELETE' && o.status === 'en_route') {
      kind = 'missing'
      row = o
    }
    if (!kind) continue
    const ref = (kind === 'arrived' ? n.container_ref ?? o.container_ref : row.container_ref) ?? '(no container)'
    let a = out.find(
      (x) => x.ref === ref && x.by === e.changed_by && new Date(e.changed_at).getTime() - new Date(x.lastAt).getTime() < 5 * 60e3,
    )
    if (!a) {
      a = { at: e.changed_at, lastAt: e.changed_at, by: e.changed_by, ref, arrived: new Map(), extra: new Map(), missing: new Map() }
      out.push(a)
    }
    a.lastAt = e.changed_at
    const m = a[kind]
    const l = label(row)
    m.set(l, (m.get(l) ?? 0) + 1)
  }
  // An arrival that only removed missing items (nothing actually arrived) still shows, so the record is complete.
  return out.reverse()
}

const list = (m: Map<string, number>) =>
  [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([l, n]) => `${n}× ${l}`)
    .join(', ')
const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

export function ArrivalHistory({ models }: { models: Model[] }) {
  const profiles = useProfiles()
  const [days, setDays] = useState(90)
  const [search, setSearch] = useState('')
  const { data, error, loading } = useLive<AuditEntry[]>(['machines'], () => load(days), [days])

  const arrivals = useMemo(() => {
    const label = (r: Row) => `${models.find((m) => m.id === r.model_id)?.model_number ?? '?'}${r.size ? ` ${r.size}` : ''}`
    const q = search.trim().toLowerCase()
    return group(data ?? [], label).filter(
      (a) => !q || `${a.ref} ${personName(profiles, a.by)} ${list(a.arrived)} ${list(a.extra)}`.toLowerCase().includes(q),
    )
  }, [data, models, profiles, search])

  return (
    <section className="space-y-2 pt-4">
      <h2 className="text-lg font-semibold">📦 Container arrival history</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">Stock approved into the warehouse from containers: what arrived, who approved it and when.</p>
      <input className={inputClass} placeholder="Search container, model or person…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ErrorText>{error}</ErrorText>
      {loading ? null : arrivals.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No container arrivals approved in the last {days} days{search ? ' matching your search' : ''}.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {arrivals.map((a) => (
            <li key={`${a.ref}${a.at}`} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">🚢 {a.ref}</span>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
                  {total(a.arrived) + total(a.extra)} into stock
                </span>
                <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                  Approved by <strong className="text-slate-700 dark:text-slate-200">{personName(profiles, a.by)}</strong> · {fmtDateTime(a.at)}
                </span>
              </div>
              {a.arrived.size > 0 && <div className="mt-1">✅ {list(a.arrived)}</div>}
              {a.extra.size > 0 && <div className="mt-0.5 text-sky-700 dark:text-sky-300">➕ Extras: {list(a.extra)}</div>}
              {a.missing.size > 0 && <div className="mt-0.5 text-amber-700 dark:text-amber-400">⚠️ Removed as missing: {list(a.missing)}</div>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
        Showing the last {days} days.
        <Button size="sm" onClick={() => setDays((d) => d + 180)}>
          Load older
        </Button>
      </div>
    </section>
  )
}
