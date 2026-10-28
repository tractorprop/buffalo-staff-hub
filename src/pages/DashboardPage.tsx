import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLive } from '../lib/useLive'
import { useAuth } from '../auth/AuthProvider'
import { personName, useProfiles } from '../lib/useProfiles'
import { addDays, overlaps } from '../lib/dates'
import { calendarItems, groupContainers, loadCalendar, type CalendarData } from '../lib/calendarData'
import type { Machine, Model } from '../lib/types'
import { ErrorText, Loading, fmtDate, today } from '../components/ui'
import { Card, linkClass } from '../components/StockOverview'
import { Legend, MonthCalendar } from '../components/MonthCalendar'
import { ContainerTimeline } from '../components/ContainerTimeline'
import { modelLabel } from '../lib/modelLabel'

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

const diggers = [
  { src: '/machines/b1800.png', alt: 'B1800', h: 'h-28 sm:h-44' },
  { src: '/machines/b1000.png', alt: 'B1000', h: 'h-24 sm:h-36' },
  { src: '/machines/b600.png', alt: 'B600', h: 'h-20 sm:h-28' },
]

export function DashboardPage() {
  const { profile } = useAuth()
  const profiles = useProfiles()
  const { data, error, loading } = useLive<Data>(['models', 'machines', 'waitlist', 'tasks', 'holidays', 'events'], loadAll)
  const now = today()

  const d = useMemo(() => {
    if (!data) return null
    const inStockBy = new Map<string, number>()
    for (const m of data.machines) if (m.status === 'in_stock') inStockBy.set(m.model_id, (inStockBy.get(m.model_id) ?? 0) + 1)
    const waitingBy = new Map<string, number>()
    for (const w of data.waiting) waitingBy.set(w.model_id, (waitingBy.get(w.model_id) ?? 0) + 1)

    const containers = groupContainers(
      data.machines.filter((m) => m.status === 'en_route'),
      data.models,
    )
    const leave = data.calendar.holidays.filter((h) => h.status === 'approved')
    const mine = data.openTasks.filter((t) => t.assignee_id === profile?.id)
    return {
      myTasks: mine.length,
      myOverdue: mine.filter((t) => t.due_date && t.due_date < now).length,
      myToday: mine.filter((t) => t.due_date === now).length,
      offToday: leave.filter((h) => overlaps(h.start_date, h.end_date, now, now)),
      offThisWeek: leave.filter((h) => overlaps(h.start_date, h.end_date, addDays(now, 1), addDays(now, 6))),
      toCall: data.models
        .filter((m) => (inStockBy.get(m.id) ?? 0) > 0 && (waitingBy.get(m.id) ?? 0) > 0)
        .map((m) => ({ model: m, inStock: inStockBy.get(m.id)!, waiting: waitingBy.get(m.id)! })),
      containers,
      items: calendarItems(data.calendar, profiles),
    }
  }, [data, profiles, profile, now])

  if (loading) return <Loading />
  if (error || !d) return <ErrorText>{error}</ErrorText>

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-white to-brand-50 dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="p-5 sm:self-center sm:p-6">
            <h1 className="text-2xl font-bold sm:text-3xl">
              {greeting}
              {profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          {/* Our diggers, largest to smallest (left to right) */}
          <div className="flex items-end justify-center gap-1 px-4 sm:ml-auto sm:gap-3 sm:pr-8">
            {diggers.map((m) => (
              <img key={m.alt} src={m.src} alt={m.alt} className={`${m.h} w-auto object-contain drop-shadow-md`} />
            ))}
          </div>
        </div>
        <div className="h-1.5 bg-brand-500" />
      </section>

      {d.toCall.length > 0 && (
        <Card title="📞 Customers to call: back in stock" tone="alert">
          <ul className="space-y-2">
            {d.toCall.map((c) => (
              <li key={c.model.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2 text-sm dark:bg-slate-900">
                <span className="font-semibold">{modelLabel(c.model, data?.models ?? [])}</span>
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
        <div className="space-y-5">
          <Card
            title="✅ My tasks"
            tone={d.myOverdue ? 'warn' : 'default'}
            action={<Link to="/tasks" className={linkClass}>Open tasks</Link>}
          >
            <div className="flex items-center gap-3">
              <span className={`text-3xl font-bold ${d.myOverdue ? 'text-red-600 dark:text-red-400' : ''}`}>{d.myTasks}</span>
              <span className="text-sm">
                <span className="block font-medium">
                  {d.myTasks === 0 ? 'Nothing to do 🎉' : `task${d.myTasks === 1 ? '' : 's'} to do`}
                </span>
                {(d.myOverdue > 0 || d.myToday > 0) && (
                  <span className="block">
                    {d.myOverdue > 0 && <span className="font-semibold text-red-600 dark:text-red-400">{d.myOverdue} overdue</span>}
                    {d.myOverdue > 0 && d.myToday > 0 && ' · '}
                    {d.myToday > 0 && <span>{d.myToday} due today</span>}
                  </span>
                )}
              </span>
            </div>
          </Card>
          <Card title="🏖️ Who's off">
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
    </div>
  )
}
