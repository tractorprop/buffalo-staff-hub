import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLive } from '../lib/useLive'
import { useAuth } from '../auth/AuthProvider'
import { useProfiles } from '../lib/useProfiles'
import { calendarItems, groupContainers, loadCalendar, type CalendarData } from '../lib/calendarData'
import type { Machine, Model } from '../lib/types'
import { ErrorText, Loading, today } from '../components/ui'
import { Card, linkClass } from '../components/StockOverview'
import { Legend, MonthCalendar } from '../components/MonthCalendar'
import { ContainerTimeline } from '../components/ContainerTimeline'

interface Data {
  models: Model[]
  machines: Pick<Machine, 'model_id' | 'size' | 'status' | 'sold_date' | 'eta' | 'container_ref'>[]
  waiting: { model_id: string }[]
  calendar: CalendarData
}

async function loadAll() {
  const [models, machines, waiting, calendar] = await Promise.all([
    supabase!.from('models').select('*').order('model_number'),
    supabase!.from('machines').select('model_id, size, status, sold_date, eta, container_ref'),
    supabase!.from('waitlist').select('model_id').eq('contacted', false),
    loadCalendar(),
  ])
  const error = models.error ?? machines.error ?? waiting.error ?? calendar.error
  if (error) return { data: null, error }
  return {
    data: {
      models: models.data as Model[],
      machines: machines.data as Data['machines'],
      waiting: waiting.data as Data['waiting'],
      calendar: calendar.data!,
    },
    error: null,
  }
}

export function DashboardPage() {
  const { profile } = useAuth()
  const profiles = useProfiles()
  const { data, error, loading } = useLive<Data>(['models', 'machines', 'waitlist', 'holidays', 'events'], loadAll)
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
    return {
      toCall: data.models
        .filter((m) => (inStockBy.get(m.id) ?? 0) > 0 && (waitingBy.get(m.id) ?? 0) > 0)
        .map((m) => ({ model: m, inStock: inStockBy.get(m.id)!, waiting: waitingBy.get(m.id)! })),
      containers,
      items: calendarItems(data.calendar, profiles),
    }
  }, [data, profiles])

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

      <ContainerTimeline containers={d.containers} today={now} />

      <Card title="Calendar" action={<Link to="/calendar" className={linkClass}>Open calendar</Link>}>
        <MonthCalendar month={now} items={d.items} maxPerDay={3} />
        <div className="mt-2">
          <Legend />
        </div>
      </Card>
    </div>
  )
}
