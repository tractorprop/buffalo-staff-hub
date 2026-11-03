import { useMemo, useState, type ReactNode } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { selectAll } from '../lib/selectAll'
import { useAuth } from '../auth/AuthProvider'
import { useLive } from '../lib/useLive'
import { personName, useProfiles } from '../lib/useProfiles'
import type { AuditEntry } from '../lib/types'
import { Button, Confirm, ErrorText, Modal, fmtDateTime, inputClass } from './ui'

export interface HistoryEvent {
  key: string
  at: string
  by: string | null
  icon: string
  title: ReactNode
  detail?: ReactNode
  search: string // text the search box matches against
  kind?: string // for the filter chips
  ids?: number[] // activity-log rows behind it (founder can delete them)
}

// Activity-log rows for one table, from the last `days` days, kept up to date.
export function useAuditLog(table: string, days: number) {
  return useLive<AuditEntry[]>(
    [table, 'audit_log'],
    () =>
      selectAll<AuditEntry>(() =>
        supabase!
          .from('audit_log')
          .select('*')
          .eq('table_name', table)
          .gte('changed_at', new Date(Date.now() - days * 864e5).toISOString())
          .order('changed_at')
          .order('id'),
      ),
    [table, days],
  )
}

// A history section at the bottom of a page: the latest few entries, and a window with
// the full history (search, person and type filters, older entries).
export function HistorySection({
  title,
  description,
  events,
  kinds,
  days,
  onLoadOlder,
  error,
  onDeleted,
}: {
  title: string
  description: string
  events: HistoryEvent[]
  kinds?: [string, string][] // [kind, label] filter chips
  days: number
  onLoadOlder: () => void
  error?: string
  onDeleted?: () => void
}) {
  const profiles = useProfiles()
  const { isFounder } = useAuth()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [person, setPerson] = useState('')
  const [kind, setKind] = useState('')
  const [remove, setRemove] = useState<HistoryEvent | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [limit, setLimit] = useState(50)

  const sorted = useMemo(() => [...events].sort((a, b) => b.at.localeCompare(a.at)), [events])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sorted
      .filter((e) => (!person || e.by === person) && (!kind || e.kind === kind))
      .filter((e) => !q || `${e.search} ${personName(profiles, e.by)}`.toLowerCase().includes(q))
  }, [sorted, search, person, kind, profiles])

  const list = (items: HistoryEvent[]) => (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
      {items.map((e) => (
        <li key={e.key} className="flex gap-3 px-4 py-2.5">
          <span className="shrink-0 text-base leading-5">{e.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">{e.title}</span>
              <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                {personName(profiles, e.by)} · {fmtDateTime(e.at)}
              </span>
              {isFounder && e.ids?.length && onDeleted ? (
                <button className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => setRemove(e)}>
                  Delete
                </button>
              ) : null}
            </div>
            {e.detail && <div className="mt-0.5 text-slate-600 dark:text-slate-300">{e.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  )

  return (
    <section className="space-y-2 pt-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
      <ErrorText>{error || deleteError}</ErrorText>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nothing in the last {days} days.</p>
      ) : (
        list(sorted.slice(0, PREVIEW))
      )}
      <Button size="sm" onClick={() => setOpen(true)}>
        Open all history{sorted.length ? ` (${sorted.length})` : ''} →
      </Button>

      {open && (
        <Modal title={title} onClose={() => setOpen(false)} wide="xl">
          <div className="space-y-2">
            {kinds && (
              <div className="flex flex-wrap gap-1.5">
                {[['', 'All'] as [string, string], ...kinds].map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      kind === k ? 'border-ink bg-ink text-white dark:border-brand-500 dark:bg-brand-500 dark:text-ink' : 'border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <select className={`${inputClass} sm:w-56`} value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">Everyone</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
              <input className={inputClass} placeholder="Search…" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {shown.length === 0 ? (
              <p className="py-4 text-sm text-slate-500 dark:text-slate-400">
                Nothing in the last {days} days{search || person || kind ? ' matching these filters' : ''}.
              </p>
            ) : (
              list(shown.slice(0, limit))
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              {shown.length > limit ? (
                <Button size="sm" onClick={() => setLimit((n) => n + 100)}>
                  Show more ({shown.length - limit} more)
                </Button>
              ) : (
                <>
                  Showing the last {days} days.
                  <Button size="sm" onClick={onLoadOlder}>
                    Load older
                  </Button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
      {remove && (
        <Confirm
          title="Delete this history entry?"
          message="It is removed from the history only. Nothing else changes."
          onConfirm={async () => {
            const { error } = await supabase!.from('audit_log').delete().in('id', remove.ids!)
            setDeleteError(error ? friendlyError(error) : '')
            setRemove(null)
            onDeleted?.()
          }}
          onCancel={() => setRemove(null)}
        />
      )}
    </section>
  )
}

const PREVIEW = 5 // history entries shown on the page; the rest open in a window

// "3× B600 Digger, 1× Thumb B600" from a label → count map.
export const countList = (m: Map<string, number>) =>
  [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([l, n]) => `${n}× ${l}`)
    .join(', ')
export const countTotal = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
