import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, friendlyError } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { useAuth } from '../../auth/AuthProvider'
import { personName, useProfiles } from '../../lib/useProfiles'
import { calendarItems, calendarTables, loadCalendar, type CalendarData } from '../../lib/calendarData'
import { addDays, workingDays } from '../../lib/dates'
import type { CalendarEvent, Holiday, HolidayStatus } from '../../lib/types'
import { Button, Confirm, ErrorText, Loading, Modal, Toast, fmtDate, today } from '../../components/ui'
import { Legend, MonthCalendar } from '../../components/MonthCalendar'
import { EventForm, HolidayForm } from './forms'
import { LeavePanel } from './LeavePanel'
import { balanceFor, loadAllowances, type Allowance } from '../../lib/leave'

const statusBadge: Record<HolidayStatus, string> = {
  approved: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  declined: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

function dateRange(a: string, b: string) {
  return a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`
}

export function CalendarPage() {
  const { profile, isManager } = useAuth()
  const profiles = useProfiles()
  const { data, error, loading } = useLive<CalendarData>(calendarTables, loadCalendar)
  // Allowances: the database only returns the person's own row (or everyone's for managers).
  const { data: leave } = useLive<{ list: Allowance[]; missing: boolean }>(['leave_allowances'], async () => {
    const r = await loadAllowances()
    return { data: { list: r.data, missing: r.missing }, error: null }
  })
  const [month, setMonth] = useState(today())
  const [selected, setSelected] = useState<string | null>(null)
  const [holidayForm, setHolidayForm] = useState(false)
  const [eventForm, setEventForm] = useState<{ event?: CalendarEvent } | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; run: () => Promise<void> } | null>(null)
  const [toast, setToast] = useState('')
  const now = today()

  const items = useMemo(() => (data ? calendarItems(data, profiles) : []), [data, profiles])
  const pending = (data?.holidays ?? []).filter((h) => h.status === 'pending' && (isManager || h.staff_id === profile?.id))
  const upcoming = useMemo(() => {
    if (!data) return []
    const to = addDays(now, 60)
    return [
      ...data.holidays
        .filter((h) => h.status === 'approved' && h.end_date >= now && h.start_date <= to)
        .map((h) => ({ key: `h:${h.id}`, start: h.start_date, end: h.end_date, kind: 'leave' as const, h })),
      ...data.events
        .filter((e) => e.end_date >= now && e.start_date <= to)
        .map((e) => ({ key: `e:${e.id}`, start: e.start_date, end: e.end_date, kind: 'event' as const, e })),
    ].sort((a, b) => a.start.localeCompare(b.start))
  }, [data, now])

  async function decide(h: Holiday, status: HolidayStatus) {
    const { error } = await supabase!.from('holidays').update({ status }).eq('id', h.id)
    if (error) setToast(friendlyError(error))
    else setSelected(null)
  }

  function askDelete(title: string, message: string, label: string, run: () => PromiseLike<{ error: { message?: string; code?: string } | null }>) {
    setConfirm({
      title,
      message,
      label,
      run: async () => {
        const { error } = await run()
        if (error) setToast(friendlyError(error))
        setConfirm(null)
        setSelected(null)
      },
    })
  }

  // ----- Details of the clicked item -----
  function details() {
    if (!selected || !data) return null
    const [kind, id] = [selected.slice(0, 1), selected.slice(2)]
    if (kind === 'h') {
      const h = data.holidays.find((x) => x.id === id)
      if (!h) return null
      const mine = h.staff_id === profile?.id
      return (
        <Modal title={`${personName(profiles, h.staff_id)}: ${h.type}`} onClose={() => setSelected(null)}>
          <div className="space-y-2 text-sm">
            <p>
              {dateRange(h.start_date, h.end_date)} · <strong>{workingDays(h.start_date, h.end_date)} working days</strong>
            </p>
            <p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge[h.status]}`}>{h.status}</span>
            </p>
            {h.note && <p className="text-slate-600 dark:text-slate-300">{h.note}</p>}
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {isManager && h.status !== 'approved' && (
              <Button variant="primary" onClick={() => decide(h, 'approved')}>
                Approve
              </Button>
            )}
            {isManager && h.status !== 'declined' && <Button onClick={() => decide(h, 'declined')}>Decline</Button>}
            {(isManager || (mine && h.status === 'pending')) && (
              <Button
                variant="ghost"
                className="text-red-600 dark:text-red-400"
                onClick={() =>
                  askDelete(
                    mine && h.status === 'pending' ? 'Cancel this request?' : 'Delete this leave?',
                    'It will be removed from the calendar.',
                    mine && h.status === 'pending' ? 'Cancel request' : 'Delete',
                    () => supabase!.from('holidays').delete().eq('id', h.id),
                  )
                }
              >
                {mine && h.status === 'pending' ? 'Cancel request' : 'Delete'}
              </Button>
            )}
          </div>
        </Modal>
      )
    }
    if (kind === 'e') {
      const e = data.events.find((x) => x.id === id)
      if (!e) return null
      return (
        <Modal title={e.title} onClose={() => setSelected(null)}>
          <div className="space-y-2 text-sm">
            <p>{dateRange(e.start_date, e.end_date)}</p>
            {e.note && <p className="text-slate-600 dark:text-slate-300">{e.note}</p>}
          </div>
          {isManager && (
            <div className="mt-5 flex justify-end gap-2">
              <Button
                onClick={() => {
                  setSelected(null)
                  setEventForm({ event: e })
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                className="text-red-600 dark:text-red-400"
                onClick={() => askDelete('Delete event?', `"${e.title}" will be removed from the calendar.`, 'Delete', () => supabase!.from('events').delete().eq('id', e.id))}
              >
                Delete
              </Button>
            </div>
          )}
        </Modal>
      )
    }
    const c = data.containers.find((x) => x.ref === id)
    if (!c) return null
    return (
      <Modal title={`Container ${c.ref}`} onClose={() => setSelected(null)}>
        <div className="space-y-2 text-sm">
          <p>
            Due {c.eta ? fmtDate(c.eta) : '(no ETA)'} · {c.total} machines
          </p>
          <p className="text-slate-600 dark:text-slate-300">{c.contents.map(([l, n]) => `${n}× ${l}`).join(', ')}</p>
          <Link to="/machines?status=en_route" className="inline-block font-medium text-sky-700 underline dark:text-sky-300">
            Open on Machines page →
          </Link>
        </div>
      </Modal>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => setEventForm({})} disabled={!isManager} title={isManager ? undefined : 'Managers only'}>
            + Add event
          </Button>
          <Button variant="primary" onClick={() => setHolidayForm(true)}>
            {isManager ? '+ Add leave' : '+ Request holiday'}
          </Button>
        </div>
      </div>

      {isManager && data?.eventsMissing && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Events are not switched on yet. Run <code>database/03-calendar-and-low-stock.sql</code> in Supabase.
        </p>
      )}
      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Loading />
      ) : (
        <>
          {pending.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
              <h2 className="mb-2 font-semibold">{isManager ? 'Leave requests waiting for a decision' : 'Your requests waiting for a decision'}</h2>
              <ul className="space-y-2">
                {pending.map((h) => (
                  <li key={h.id} className="flex flex-col gap-2 rounded-lg bg-white p-3 text-sm sm:flex-row sm:items-center dark:bg-slate-900">
                    <div className="flex-1">
                      <span className="font-medium">{personName(profiles, h.staff_id)}</span> · {h.type} · {dateRange(h.start_date, h.end_date)} ·{' '}
                      <strong>{workingDays(h.start_date, h.end_date)} working days</strong>
                      {h.note && <div className="text-slate-500">{h.note}</div>}
                    </div>
                    <div className="flex gap-1.5">
                      {isManager ? (
                        <>
                          <Button size="sm" variant="primary" onClick={() => decide(h, 'approved')}>
                            Approve
                          </Button>
                          <Button size="sm" onClick={() => decide(h, 'declined')}>
                            Decline
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" onClick={() => setSelected(`h:${h.id}`)}>
                          Cancel request
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section className="space-y-2">
              <MonthCalendar month={month} items={items} onMonthChange={setMonth} onItemClick={setSelected} />
              <Legend />
            </section>
            {profile && data && (
              <LeavePanel
                me={profile.id}
                isManager={isManager}
                profiles={profiles}
                holidays={data.holidays}
                allowances={leave?.list ?? []}
                missing={leave?.missing ?? false}
              />
            )}
          </div>

          <section>
            <h2 className="mb-2 font-semibold">Coming up (next 60 days)</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No leave or events in the next 60 days.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                {upcoming.map((u) => (
                  <li key={u.key}>
                    <button onClick={() => setSelected(u.key)} className="flex w-full flex-wrap items-center gap-x-3 px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <span className={`h-2.5 w-2.5 rounded-full ${u.kind === 'leave' ? 'bg-green-500' : 'bg-sky-500'}`} />
                      <span className="font-medium">{u.kind === 'leave' ? `${personName(profiles, u.h.staff_id)}: ${u.h.type}` : u.e.title}</span>
                      <span className="text-slate-500">{dateRange(u.start, u.end)}</span>
                      {u.kind === 'leave' && <span className="ml-auto text-xs text-slate-500">{workingDays(u.start, u.end)} working days</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {details()}
      {holidayForm && profile && (
        <HolidayForm
          profiles={profiles}
          me={profile.id}
          isManager={isManager}
          leftFor={(staffId, year) => balanceFor(staffId, year, data?.holidays ?? [], leave?.list ?? [], now).left}
          onClose={() => setHolidayForm(false)}
        />
      )}
      {eventForm && <EventForm event={eventForm.event} onClose={() => setEventForm(null)} />}
      {confirm && <Confirm title={confirm.title} message={confirm.message} confirmLabel={confirm.label} onConfirm={confirm.run} onCancel={() => setConfirm(null)} />}
      {toast && <Toast onClose={() => setToast('')}>{toast}</Toast>}
    </div>
  )
}
