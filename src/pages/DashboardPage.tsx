import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLive } from '../lib/useLive'
import { useAuth } from '../auth/AuthProvider'
import { personName, useProfiles } from '../lib/useProfiles'
import { calendarItems, groupContainers, loadCalendar, type CalendarData } from '../lib/calendarData'
import { addDays, overlaps } from '../lib/dates'
import type { Machine, Model } from '../lib/types'
import { ErrorText, Loading, fmtDate, today } from '../components/ui'
import { Legend, MonthCalendar } from '../components/MonthCalendar'
import { ContainerTimeline } from '../components/ContainerTimeline'

interface Data {
  models: Model[]
  machines: Pick<Machine, 'model_id' | 'size' | 'status' | 'sold_date' | 'eta' | 'container_ref'>[]
  waiting: { model_id: string }[]
  openTasks: { assignee_id: string | null; due_date: string | null }[]
  calendar: CalendarData
}

async function loadAll() {
  const [models, machines, waiting, tasks, calendar] = await Promise.all([
    supabase!.from('models').select('*').order('model_number'),
    supabase!.from('machines').select('model_id, size, status, sold_date, eta, container_ref'),
    supabase!.from('waitlist').select('model_id').eq('contacted', false),
    supabase!.from('tasks').select('assignee_id, due_date').eq('done', false),
    loadCalendar(),
  ])
  const error = models.error ?? machines.error ?? waiting.error ?? tasks.error ?? calendar.error
  if (error) return { data: null, error }
  return {
    data: {
      models: models.data as Model[],
      machines: machines.data as Data['machines'],
      waiting: waiting.data as Data['waiting'],
      openTasks: tasks.data as Data['openTasks'],
      calendar: calendar.data!,
    },
    error: null,
  }
}

function Card({ title, action, children, tone = 'default' }: { title: string; action?: ReactNode; children: ReactNode; tone?: 'default' | 'alert' | 'warn' }) {
  const tones = {
    default: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
    alert: 'border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30',
    warn: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
  }
  return (
    <section className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action && <div className="ml-auto text-sm">{action}</div>}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, to, tone }: { label: string; value: number; to: string; tone: string }) {
  return (
    <Link to={to} className="rounded-xl border border-slate-200 bg-white p-3 hover:border-brand-500 dark:border-slate-800 dark:bg-slate-900">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </Link>
  )
}

const linkClass = 'font-medium text-sky-700 underline dark:text-sky-300'

export function DashboardPage() {
  const { profile } = useAuth()
  const profiles = useProfiles()
  const { data, error, loading } = useLive<Data>(['models', 'machines', 'waitlist', 'tasks', 'holidays', 'events'], loadAll)
  const now = today()

  const d = useMemo(() => {
    if (!data) return null
    const month = now.slice(0, 7)
    const weekEnd = addDays(now, 6)
    const inStockBy = new Map<string, number>()
    const enRouteBy = new Map<string, number>()
    for (const m of data.machines) {
      if (m.status === 'in_stock') inStockBy.set(m.model_id, (inStockBy.get(m.model_id) ?? 0) + 1)
      if (m.status === 'en_route') enRouteBy.set(m.model_id, (enRouteBy.get(m.model_id) ?? 0) + 1)
    }
    const waitingBy = new Map<string, number>()
    for (const w of data.waiting) waitingBy.set(w.model_id, (waitingBy.get(w.model_id) ?? 0) + 1)

    const containers = groupContainers(
      data.machines.filter((m) => m.status === 'en_route'),
      data.models,
    )
    const leave = data.calendar.holidays.filter((h) => h.status === 'approved')

    return {
      inStock: data.machines.filter((m) => m.status === 'in_stock').length,
      enRoute: data.machines.filter((m) => m.status === 'en_route').length,
      soldThisMonth: data.machines.filter((m) => m.status === 'sold' && m.sold_date?.startsWith(month)).length,
      myTasks: data.openTasks.filter((t) => t.assignee_id === profile?.id).length,
      myOverdue: data.openTasks.filter((t) => t.assignee_id === profile?.id && t.due_date && t.due_date < now).length,
      toCall: data.models
        .filter((m) => (inStockBy.get(m.id) ?? 0) > 0 && (waitingBy.get(m.id) ?? 0) > 0)
        .map((m) => ({ model: m, inStock: inStockBy.get(m.id)!, waiting: waitingBy.get(m.id)! })),
      levelsSet: data.models.some((m) => m.reorder_level != null),
      levelsMissing: data.models.length > 0 && data.models.every((m) => m.reorder_level === undefined),
      lowStock: data.models
        .filter((m) => m.reorder_level != null && (inStockBy.get(m.id) ?? 0) <= m.reorder_level)
        .map((m) => ({ model: m, inStock: inStockBy.get(m.id) ?? 0, enRoute: enRouteBy.get(m.id) ?? 0 }))
        .sort((a, b) => a.inStock - b.inStock),
      containers,
      arriving: containers.filter((c) => c.eta && c.eta <= addDays(now, 28)),
      noEta: containers.filter((c) => !c.eta).length,
      offToday: leave.filter((h) => overlaps(h.start_date, h.end_date, now, now)),
      offThisWeek: leave.filter((h) => overlaps(h.start_date, h.end_date, addDays(now, 1), weekEnd)),
      items: calendarItems(data.calendar, profiles),
    }
  }, [data, now, profile, profiles])

  if (loading) return <Loading />
  if (error || !d) return <ErrorText>{error}</ErrorText>

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">
          {greeting}
          {profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="In stock" value={d.inStock} to="/machines?status=in_stock" tone="text-green-700 dark:text-green-400" />
        <Stat label="🚢 En route" value={d.enRoute} to="/machines?status=en_route" tone="text-amber-600 dark:text-amber-400" />
        <Stat label="Sold this month" value={d.soldThisMonth} to="/machines?status=sold" tone="text-slate-700 dark:text-slate-300" />
        <Stat label={d.myOverdue ? `My tasks (${d.myOverdue} overdue)` : 'My tasks'} value={d.myTasks} to="/tasks" tone={d.myOverdue ? 'text-red-600' : ''} />
        <Stat label="Off today" value={d.offToday.length} to="/calendar" tone="text-sky-700 dark:text-sky-400" />
      </div>

      {d.toCall.length > 0 && (
        <Card title="📞 Customers to call: back in stock" tone="alert">
          <ul className="space-y-2">
            {d.toCall.map((c) => (
              <li key={c.model.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2 text-sm dark:bg-slate-900">
                <span className="font-semibold">{c.model.model_number}</span>
                <span className="text-green-700 dark:text-green-400">{c.inStock} in stock</span>
                <span>
                  {c.waiting} customer{c.waiting === 1 ? '' : 's'} waiting
                </span>
                <Link to={`/waitlist?model=${c.model.id}`} className={`ml-auto ${linkClass}`}>
                  Open waiting list →
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="⚠️ Low stock: needs ordering" tone={d.lowStock.length ? 'warn' : 'default'} action={<Link to="/machines" className={linkClass}>Machines</Link>}>
          {d.levelsMissing ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Low stock levels are not switched on yet. A manager needs to run <code>database/03-calendar-and-low-stock.sql</code> in Supabase.
            </p>
          ) : !d.levelsSet ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No low stock levels set yet. Managers: on the Machines page, open a model and click <strong>Edit model</strong> to set its low stock level.
            </p>
          ) : d.lowStock.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">All models are above their low stock level. 👍</p>
          ) : (
            <ul className="divide-y divide-red-100 text-sm dark:divide-red-900/50">
              {d.lowStock.map((l) => (
                <li key={l.model.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                  <Link to={`/machines?model=${l.model.id}`} className="font-semibold hover:underline">
                    {l.model.model_number}
                  </Link>
                  {l.model.name && <span className="text-slate-500">{l.model.name}</span>}
                  <span className="ml-auto">
                    <strong className={l.inStock === 0 ? 'text-red-600 dark:text-red-400' : ''}>{l.inStock}</strong> in stock
                    <span className="text-slate-500"> (low at {l.model.reorder_level})</span>
                    {l.enRoute > 0 && <span className="text-amber-700 dark:text-amber-400"> · {l.enRoute} on the way</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="🚢 Containers arriving in the next 4 weeks" action={<Link to="/machines?status=en_route" className={linkClass}>All en route</Link>}>
          {d.arriving.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No containers due in the next 4 weeks.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {d.arriving.map((c) => (
                <li key={c.ref} className="py-1.5">
                  <div className="flex flex-wrap gap-x-3">
                    <span className="font-semibold">📦 {c.ref}</span>
                    <span className={c.eta! < now ? 'font-semibold text-red-600' : 'text-slate-600 dark:text-slate-300'}>
                      {c.eta! < now ? `Overdue (ETA ${fmtDate(c.eta)})` : `ETA ${fmtDate(c.eta)}`}
                    </span>
                    <span className="ml-auto text-slate-500">{c.total} machines</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{c.contents.map(([l, n]) => `${n}× ${l}`).join(', ')}</div>
                </li>
              ))}
            </ul>
          )}
          {d.noEta > 0 && <p className="mt-2 text-xs text-slate-500">+ {d.noEta} container{d.noEta === 1 ? '' : 's'} with no ETA set.</p>}
        </Card>
      </div>

      <ContainerTimeline containers={d.containers} today={now} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Calendar" action={<Link to="/calendar" className={linkClass}>Open calendar</Link>}>
            <MonthCalendar month={now} items={d.items} maxPerDay={2} />
            <div className="mt-2">
              <Legend />
            </div>
          </Card>
        </div>
        <Card title="Who's off">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Today</h3>
          {d.offToday.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Everyone's in.</p>
          ) : (
            <ul className="mb-3 text-sm">
              {d.offToday.map((h) => (
                <li key={h.id}>
                  {personName(profiles, h.staff_id)} <span className="text-slate-500">· {h.type}, back after {fmtDate(h.end_date)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="text-xs font-semibold uppercase text-slate-500">Rest of this week</h3>
          {d.offThisWeek.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nobody else.</p>
          ) : (
            <ul className="text-sm">
              {d.offThisWeek.map((h) => (
                <li key={h.id}>
                  {personName(profiles, h.staff_id)}{' '}
                  <span className="text-slate-500">
                    · {fmtDate(h.start_date)}
                    {h.end_date !== h.start_date && ` – ${fmtDate(h.end_date)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
