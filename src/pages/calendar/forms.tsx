import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { workingDays } from '../../lib/dates'
import type { CalendarEvent, HolidayStatus, HolidayType, Profile } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass } from '../../components/ui'

export function HolidayForm({
  profiles,
  me,
  isManager,
  leftFor,
  onClose,
}: {
  profiles: Profile[]
  me: string
  isManager: boolean
  leftFor?: (staffId: string, year: number) => number | null // annual leave days left, null if no allowance set
  onClose: () => void
}) {
  // Managers can add the same leave for several people at once (e.g. bank holidays, Christmas closure).
  const [staffIds, setStaffIds] = useState<string[]>([me])
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [type, setType] = useState<HolidayType>('Annual leave')
  const [status, setStatus] = useState<HolidayStatus>(isManager ? 'approved' : 'pending')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const days = start && end && end >= start ? workingDays(start, end) : null
  const who = isManager ? staffIds : [me]
  const left = days !== null && type === 'Annual leave' && leftFor && who.length === 1 ? leftFor(who[0], Number(start.slice(0, 4))) : null
  // With several people ticked, list anyone this would take below zero.
  const over =
    days !== null && type === 'Annual leave' && leftFor && who.length > 1
      ? who.filter((id) => {
          const l = leftFor(id, Number(start.slice(0, 4)))
          return l !== null && days > l
        })
      : []
  const nameOf = (id: string) => {
    const p = profiles.find((x) => x.id === id)
    return p?.full_name || p?.email || '?'
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (end < start) return setError('The last day must be on or after the first day.')
    if (who.length === 0) return setError('Tick at least one staff member.')
    setBusy(true)
    setError('')
    const { error } = await supabase.from('holidays').insert(
      who.map((id) => ({
        staff_id: id,
        start_date: start,
        end_date: end,
        type,
        status: isManager ? status : 'pending',
        note: note.trim() || null,
      })),
    )
    setBusy(false)
    if (error)
      return setError(
        isManager && (who.some((id) => id !== me) || status !== 'pending') && /row-level security/i.test(error.message)
          ? 'Adding approved leave for others is not switched on yet. Run database/03-calendar-and-low-stock.sql in Supabase first.'
          : friendlyError(error),
      )
    onClose()
  }

  return (
    <Modal title={isManager ? 'Add leave' : 'Request leave'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        {isManager && (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Staff</span>
              <span className="text-xs text-slate-500">{staffIds.length} selected</span>
              <button type="button" className="ml-auto text-xs font-medium text-sky-700 underline dark:text-sky-300" onClick={() => setStaffIds(profiles.map((p) => p.id))}>
                Select all
              </button>
              <button type="button" className="text-xs font-medium text-sky-700 underline dark:text-sky-300" onClick={() => setStaffIds([])}>
                Select none
              </button>
            </div>
            <div className="mt-1 grid max-h-44 gap-0.5 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2 dark:border-slate-800">
              {profiles.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={staffIds.includes(p.id)}
                    onChange={(e) => setStaffIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                  />
                  {p.full_name || p.email}
                  {p.id === me ? ' (me)' : ''}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First day off *">
            <input
              type="date"
              required
              className={inputClass}
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                if (!end || end < e.target.value) setEnd(e.target.value)
              }}
            />
          </Field>
          <Field label="Last day off *">
            <input type="date" required min={start} className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {days !== null && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {days} working day{days === 1 ? '' : 's'} (Mon–Fri)
            {left !== null && (
              <span className={days > left ? ' font-semibold text-red-600 dark:text-red-400' : ''}>
                {' '}· {left} day{left === 1 ? '' : 's'} of annual leave left
                {days > left && ' (this is more than is left)'}
              </span>
            )}
            {who.length > 1 && type === 'Annual leave' && <> · taken from each person's annual leave</>}
          </p>
        )}
        {over.length > 0 && (
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
            This is more than {over.map(nameOf).join(', ')} {over.length === 1 ? 'has' : 'have'} left.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as HolidayType)}>
              <option>Annual leave</option>
              <option>Sick</option>
              <option>Unpaid</option>
              <option>Other</option>
            </select>
          </Field>
          {isManager && (
            <Field label="Status">
              <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as HolidayStatus)}>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
              </select>
            </Field>
          )}
        </div>
        <Field label={isManager ? 'Label' : 'Note'} hint={isManager ? 'Shown on the calendar, e.g. Christmas Day, Easter Monday bank holiday' : undefined}>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {!isManager && <p className="text-xs text-slate-500">A manager will approve or decline your request.</p>}
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : isManager ? 'Save' : 'Send request'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function EventForm({ event, onClose }: { event?: CalendarEvent; onClose: () => void }) {
  const [title, setTitle] = useState(event?.title ?? '')
  const [start, setStart] = useState(event?.start_date ?? '')
  const [end, setEnd] = useState(event?.end_date ?? '')
  const [note, setNote] = useState(event?.note ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (end < start) return setError('The end date must be on or after the start date.')
    setBusy(true)
    setError('')
    const row = { title: title.trim(), start_date: start, end_date: end, note: note.trim() || null }
    const { error } = event
      ? await supabase.from('events').update(row).eq('id', event.id)
      : await supabase.from('events').insert(row)
    setBusy(false)
    if (error)
      return setError(
        /events/.test(error.message) && /not find|does not exist/i.test(error.message)
          ? 'Events are not switched on yet. Run database/03-calendar-and-low-stock.sql in Supabase first.'
          : friendlyError(error),
      )
    onClose()
  }

  return (
    <Modal title={event ? 'Edit event' : 'Add event'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Event *">
          <input className={inputClass} required autoFocus placeholder="e.g. Agricultural show, stocktake, office closed" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start *">
            <input
              type="date"
              required
              className={inputClass}
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                if (!end || end < e.target.value) setEnd(e.target.value)
              }}
            />
          </Field>
          <Field label="End *">
            <input type="date" required min={start} className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Note">
          <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
