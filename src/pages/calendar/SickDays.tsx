import { useMemo, useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { addDays, addMonths, monthLabel, monthStart, overlaps, workingDays } from '../../lib/dates'
import { personName } from '../../lib/useProfiles'
import type { Holiday, Profile } from '../../lib/types'
import { Button, ErrorText, Field, Modal, fmtDate, inputClass, today } from '../../components/ui'
import { parse } from '../../lib/dates'

// CEO and founder only: who was off sick in the month on screen, and for how many working days.
export function SickDays({ holidays, profiles, month }: { holidays: Holiday[]; profiles: Profile[]; month: string }) {
  const [adding, setAdding] = useState(false)
  const rows = useMemo(() => {
    const from = monthStart(month)
    const to = addDays(addMonths(from, 1), -1)
    const yearFrom = `${from.slice(0, 4)}-01-01`
    const sick = holidays.filter((h) => h.type === 'Sick' && h.status !== 'declined')
    const byPerson = new Map<string, { days: number; yearDays: number; spells: { start: string; end: string; pending: boolean }[] }>()
    for (const h of sick) {
      // Working days this year up to the end of the month shown.
      const yStart = h.start_date < yearFrom ? yearFrom : h.start_date
      const yEnd = h.end_date > to ? to : h.end_date
      const p = byPerson.get(h.staff_id) ?? { days: 0, yearDays: 0, spells: [] }
      if (yStart <= yEnd) p.yearDays += workingDays(yStart, yEnd)
      if (overlaps(h.start_date, h.end_date, from, to)) {
        const s = h.start_date < from ? from : h.start_date
        const e = h.end_date > to ? to : h.end_date
        p.days += workingDays(s, e)
        p.spells.push({ start: s, end: e, pending: h.status === 'pending' })
      }
      byPerson.set(h.staff_id, p)
    }
    return [...byPerson.entries()]
      .filter(([, p]) => p.spells.length)
      .map(([id, p]) => ({ id, ...p, spells: p.spells.sort((a, b) => a.start.localeCompare(b.start)) }))
      .sort((a, b) => b.days - a.days)
  }, [holidays, month])

  const total = rows.reduce((n, r) => n + r.days, 0)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h2 className="font-semibold">🤒 Sick days: {monthLabel(month)}</h2>
        <span className="text-sm text-slate-500">
          {total} working day{total === 1 ? '' : 's'} in total
        </span>
        <span className="ml-auto text-xs text-slate-400">Only the CEO and founder can see this</span>
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          + Add sick leave
        </Button>
      </div>
      {adding && <AddSickLeave profiles={profiles} onClose={() => setAdding(false)} />}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nobody was off sick this month. 👍</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-1 pr-3">Staff member</th>
              <th className="py-1 pr-3 text-right">Days this month</th>
              <th className="py-1 pr-3">Dates</th>
              <th className="py-1 text-right">So far this year</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="py-1.5 pr-3 font-medium">{personName(profiles, r.id)}</td>
                <td className="py-1.5 pr-3 text-right font-bold text-red-600 dark:text-red-400">{r.days}</td>
                <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-300">
                  {r.spells.map((s, i) => (
                    <span key={i}>
                      {i > 0 && ', '}
                      {s.start === s.end ? fmtDate(s.start) : `${fmtDate(s.start)} – ${fmtDate(s.end)}`}
                      {s.pending && <span className="text-amber-600"> (not yet approved)</span>}
                    </span>
                  ))}
                </td>
                <td className="py-1.5 text-right text-slate-500">{r.yearDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-slate-400">Working days only (Monday to Friday). Sick leave is leave recorded with the type "Sick".</p>
    </section>
  )
}

// The last day of a sickness that started on `start` and lasted `days` working days (weekends skipped).
function lastWorkingDay(start: string, days: number) {
  let d = start
  let counted = 0
  for (let i = 0; i < 400; i++) {
    const wd = parse(d).getDay()
    if (wd !== 0 && wd !== 6) counted++
    if (counted >= days) return d
    d = addDays(d, 1)
  }
  return d
}

// CEO and founder: record that someone was off sick (saved as approved sick leave).
function AddSickLeave({ profiles, onClose }: { profiles: Profile[]; onClose: () => void }) {
  const [who, setWho] = useState('')
  const [start, setStart] = useState(today())
  const [days, setDays] = useState('1')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const n = parseInt(days)
  const end = start && n >= 1 ? lastWorkingDay(start, n) : ''

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!who) return setError('Choose who was off sick.')
    if (!start) return setError('Enter the first day they were off.')
    if (!(n >= 1 && n <= 260)) return setError('Enter how many working days they were off (1 or more).')
    setBusy(true)
    setError('')
    const { error } = await supabase!
      .from('holidays')
      .insert({ staff_id: who, start_date: start, end_date: end, type: 'Sick', status: 'approved', note: note.trim() || null })
    setBusy(false)
    if (error) return setError(friendlyError(error))
    onClose()
  }

  return (
    <Modal title="🤒 Add sick leave" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Who was off sick? *">
          <select className={inputClass} required value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose a person…</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First day off *">
            <input type="date" required className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="How many working days? *" hint="Monday to Friday; weekends are skipped.">
            <input type="number" min={1} max={260} inputMode="numeric" required className={inputClass} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        {end && (
          <p className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800/50">
            Off sick <strong>{start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`}</strong> ({n} working day{n === 1 ? '' : 's'})
          </p>
        )}
        <Field label="Note" hint="Optional. Keep medical details out of it.">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save sick leave'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
