import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { workingDays } from '../../lib/dates'
import type { CalendarEvent, HolidayStatus, HolidayType, Profile } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass } from '../../components/ui'

export function HolidayForm({
  profiles,
  me,
  isManager,
  onClose,
}: {
  profiles: Profile[]
  me: string
  isManager: boolean
  onClose: () => void
}) {
  const [staffId, setStaffId] = useState(me)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [type, setType] = useState<HolidayType>('Annual leave')
  const [status, setStatus] = useState<HolidayStatus>(isManager ? 'approved' : 'pending')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const days = start && end && end >= start ? workingDays(start, end) : null

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (end < start) return setError('The last day must be on or after the first day.')
    setBusy(true)
    setError('')
    const { error } = await supabase.from('holidays').insert({
      staff_id: isManager ? staffId : me,
      start_date: start,
      end_date: end,
      type,
      status: isManager ? status : 'pending',
      note: note.trim() || null,
    })
    setBusy(false)
    if (error)
      return setError(
        isManager && (staffId !== me || status !== 'pending') && /row-level security/i.test(error.message)
          ? 'Adding approved leave for others is not switched on yet. Run database/03-calendar-and-low-stock.sql in Supabase first.'
          : friendlyError(error),
      )
    onClose()
  }

  return (
    <Modal title={isManager ? 'Add leave' : 'Request leave'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        {isManager && (
          <Field label="Staff member">
            <select className={inputClass} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                  {p.id === me ? ' (me)' : ''}
                </option>
              ))}
            </select>
          </Field>
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
        <Field label="Note">
          <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
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
