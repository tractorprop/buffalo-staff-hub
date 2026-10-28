import { supabase } from './supabase'
import { addDays } from './dates'
import { personName } from './useProfiles'
import type { CalendarEvent, Holiday, Machine, Model, Profile } from './types'
import type { CalItem } from '../components/MonthCalendar'
import { today } from '../components/ui'

export interface Container {
  ref: string
  eta: string | null
  total: number
  contents: [string, number][]
}

export interface CalendarData {
  holidays: Holiday[]
  events: CalendarEvent[]
  eventsMissing: boolean // true until 03-calendar-and-low-stock.sql has been run
  containers: Container[]
}

export const calendarTables = ['holidays', 'events', 'machines', 'models']

// Loads leave, events and containers on the way (from about a year ago onwards).
export async function loadCalendar() {
  const since = addDays(today(), -400)
  const [holidays, events, enRoute, models] = await Promise.all([
    supabase!.from('holidays').select('*').gte('end_date', since).order('start_date'),
    supabase!.from('events').select('*').gte('end_date', since).order('start_date'),
    supabase!.from('machines').select('model_id, size, container_ref, eta').eq('status', 'en_route'),
    supabase!.from('models').select('id, model_number'),
  ])
  const error = holidays.error ?? enRoute.error ?? models.error
  if (error) return { data: null, error }
  return {
    data: {
      holidays: holidays.data as Holiday[],
      events: (events.data as CalendarEvent[] | null) ?? [],
      eventsMissing: !!events.error,
      containers: groupContainers(enRoute.data as Machine[], models.data as Model[]),
    } satisfies CalendarData,
    error: null,
  }
}

export function groupContainers(enRoute: Pick<Machine, 'model_id' | 'size' | 'container_ref' | 'eta'>[], models: Pick<Model, 'id' | 'model_number'>[]): Container[] {
  const byRef = new Map<string, typeof enRoute>()
  for (const m of enRoute) {
    if (!m.container_ref) continue
    byRef.set(m.container_ref, [...(byRef.get(m.container_ref) ?? []), m])
  }
  return [...byRef.entries()]
    .map(([ref, ms]) => {
      const counts = new Map<string, number>()
      for (const m of ms) {
        const label = `${models.find((x) => x.id === m.model_id)?.model_number ?? '?'}${m.size ? ` ${m.size}` : ''}`
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
      const etas = ms.map((m) => m.eta).filter(Boolean).sort() as string[]
      return { ref, eta: etas[0] ?? null, total: ms.length, contents: [...counts.entries()] }
    })
    .sort((a, b) => (a.eta ?? '9999').localeCompare(b.eta ?? '9999'))
}

export function calendarItems(data: CalendarData, profiles: Profile[], { showDeclined = false } = {}): CalItem[] {
  const items: CalItem[] = []
  for (const h of data.holidays) {
    if (h.status === 'declined' && !showDeclined) continue
    const who = personName(profiles, h.staff_id).split(' ')[0]
    items.push({
      key: `h:${h.id}`,
      start: h.start_date,
      end: h.end_date,
      label: `${who}${h.type !== 'Annual leave' ? ` (${h.type})` : ''}${h.status === 'pending' ? ' ?' : ''}`,
      tone: h.status === 'approved' ? 'green' : h.status === 'pending' ? 'amber' : 'grey',
    })
  }
  for (const e of data.events) items.push({ key: `e:${e.id}`, start: e.start_date, end: e.end_date, label: e.title, tone: 'blue' })
  for (const c of data.containers)
    if (c.eta) items.push({ key: `c:${c.ref}`, start: c.eta, end: c.eta, label: `🚢 ${c.ref}`, tone: 'purple' })
  return items
}
