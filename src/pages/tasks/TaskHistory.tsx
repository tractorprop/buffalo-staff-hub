import { useMemo, useState } from 'react'
import type { Task } from '../../lib/types'
import { personName, useProfiles } from '../../lib/useProfiles'
import { fmtDate, today } from '../../components/ui'
import { HistorySection, useAuditLog, type HistoryEvent } from '../../components/HistorySection'

// Managers and the founder only: who was given which task, and who completed it when.
export function TaskHistory({ tasks }: { tasks: Task[] }) {
  const profiles = useProfiles()
  const [days, setDays] = useState(180)
  const { data, error, reload, loading } = useAuditLog('tasks', days)
  const now = today()

  const events = useMemo(() => {
    const log = data ?? []
    const who = (id: string | null | undefined) => (id ? personName(profiles, id) : 'nobody')
    const out: HistoryEvent[] = log.flatMap((e): HistoryEvent[] => {
      const o = e.old_data as Partial<Task> | null
      const n = e.new_data as Partial<Task> | null
      const t = (n ?? o)!
      const base = { key: String(e.id), at: e.changed_at, by: e.changed_by, ids: [e.id] }
      const due = t.due_date ? ` · due ${fmtDate(t.due_date)}` : ''
      let ev: Pick<HistoryEvent, 'icon' | 'kind' | 'title'> | null = null
      if (e.action === 'INSERT') ev = { icon: '📝', kind: 'assigned', title: `“${t.title}” given to ${who(t.assignee_id)}${due}` }
      else if (e.action === 'DELETE') ev = { icon: '🗑️', kind: 'deleted', title: `“${t.title}” deleted` }
      else if (!o?.done && n?.done) {
        const late = t.due_date && e.changed_at.slice(0, 10) > t.due_date
        ev = { icon: '✅', kind: 'completed', title: `“${t.title}” completed${late ? ' (late)' : ''}` }
      } else if (o?.done && !n?.done) ev = { icon: '↩️', kind: 'reopened', title: `“${t.title}” reopened` }
      else if (o?.assignee_id !== n?.assignee_id) ev = { icon: '👤', kind: 'assigned', title: `“${t.title}” moved from ${who(o?.assignee_id)} to ${who(n?.assignee_id)}` }
      else ev = { icon: '✏️', kind: 'edited', title: `“${t.title}” edited${due}` }
      return [{ ...base, ...ev, search: `${ev.title} ${t.priority ?? ''}` }]
    })
    // Tasks created before history was switched on still show when they were given out.
    const logged = new Set(log.filter((e) => e.action === 'INSERT').map((e) => e.record_id))
    const since = new Date(Date.now() - days * 864e5).toISOString()
    for (const t of tasks)
      if (!logged.has(t.id) && t.created_at >= since) {
        const title = `“${t.title}” given to ${who(t.assignee_id)}${t.done ? ' · completed' : t.due_date && t.due_date < now ? ' · overdue' : ''}`
        out.push({ key: `t${t.id}`, at: t.created_at, by: null, icon: '📝', kind: 'assigned', title, search: title })
      }
    return out
  }, [data, tasks, profiles, days, now])

  // Per-person totals from the current task list.
  const people = useMemo(() => {
    const m = new Map<string, { open: number; overdue: number; done: number }>()
    for (const t of tasks) {
      const k = t.assignee_id ?? ''
      const p = m.get(k) ?? { open: 0, overdue: 0, done: 0 }
      if (t.done) p.done++
      else {
        p.open++
        if (t.due_date && t.due_date < now) p.overdue++
      }
      m.set(k, p)
    }
    return [...m.entries()].sort((a, b) => personName(profiles, a[0] || null).localeCompare(personName(profiles, b[0] || null)))
  }, [tasks, profiles, now])

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2 text-right">Open</th>
              <th className="px-3 py-2 text-right">Overdue</th>
              <th className="px-3 py-2 text-right">Completed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {people.map(([id, p]) => (
              <tr key={id}>
                <td className="px-3 py-2 font-medium">{id ? personName(profiles, id) : 'Not assigned'}</td>
                <td className="px-3 py-2 text-right">{p.open}</td>
                <td className={`px-3 py-2 text-right ${p.overdue ? 'font-bold text-red-600 dark:text-red-400' : ''}`}>{p.overdue}</td>
                <td className="px-3 py-2 text-right text-green-700 dark:text-green-400">{p.done}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HistorySection
        title="📜 Task history (managers only)"
        description="Which tasks were given to whom, and who completed them and when. Staff can't see this."
        events={events}
        kinds={[
          ['assigned', '📝 Given out'],
          ['completed', '✅ Completed'],
          ['reopened', '↩️ Reopened'],
          ['deleted', '🗑️ Deleted'],
          ['edited', '✏️ Edited'],
        ]}
        days={days}
      fileName="task-history"
      loading={loading}
      onDays={(n) => setDays((d) => Math.max(d, n))}
        onLoadOlder={() => setDays((d) => d + 365)}
        error={error}
        onDeleted={reload}
      />
    </div>
  )
}
