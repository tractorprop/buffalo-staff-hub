import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { balanceFor, fmtDays, type Allowance, type Balance } from '../../lib/leave'
import type { Holiday, Profile } from '../../lib/types'
import { Button, ErrorText, inputClass, today } from '../../components/ui'

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex items-baseline justify-between py-1 ${strong ? 'border-t border-slate-200 pt-2 dark:border-slate-700' : ''}`}>
      <span className={strong ? 'font-semibold' : 'text-slate-600 dark:text-slate-300'}>{label}</span>
      <span className={`${strong ? 'text-2xl font-bold' : 'font-semibold'} ${tone ?? ''}`}>{value}</span>
    </div>
  )
}

function leftTone(b: Balance) {
  if (b.left === null) return ''
  return b.left < 0 ? 'text-red-600 dark:text-red-400' : b.left <= 3 ? 'text-amber-600 dark:text-amber-400' : 'text-green-700 dark:text-green-400'
}

// Annual leave summary beside the calendar. Staff see only their own figures
// (the database only returns their own allowance); managers also see the team.
export function LeavePanel({
  me,
  isManager,
  profiles,
  holidays,
  allowances,
  missing,
}: {
  me: string
  isManager: boolean
  profiles: Profile[]
  holidays: Holiday[]
  allowances: Allowance[]
  missing: boolean
}) {
  const now = today()
  const [year, setYear] = useState(Number(now.slice(0, 4)))
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const mine = balanceFor(me, year, holidays, allowances, now)

  async function saveAllowance(staffId: string) {
    const days = parseFloat(value)
    if (!(days >= 0 && days <= 366)) return setError('Enter a number of days between 0 and 366.')
    const { error } = await supabase!.from('leave_allowances').upsert({ staff_id: staffId, year, days })
    if (error) return setError(friendlyError(error))
    setError('')
    setEditing(null)
  }

  return (
    <aside className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-semibold">🏖️ My annual leave</h2>
          <div className="ml-auto flex items-center gap-1 text-xs">
            <button className="rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
              ‹
            </button>
            <span className="font-semibold">{year}</span>
            <button className="rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
              ›
            </button>
          </div>
        </div>
        {missing ? (
          <p className="text-slate-500 dark:text-slate-400">
            Leave allowances are not switched on yet. A manager needs to run <code>database/06-leave-allowances.sql</code> in Supabase.
          </p>
        ) : (
          <>
            <Row label="Allowance" value={mine.allowance === null ? 'Not set' : `${fmtDays(mine.allowance)} days`} />
            <Row label="Taken" value={fmtDays(mine.taken)} />
            <Row label="Booked (rest of year)" value={fmtDays(mine.booked)} />
            {mine.pending > 0 && <Row label="Waiting for approval" value={fmtDays(mine.pending)} tone="text-amber-600 dark:text-amber-400" />}
            <Row label="Days left" value={mine.left === null ? '–' : fmtDays(mine.left)} strong tone={leftTone(mine)} />
            {mine.allowance === null && <p className="mt-2 text-xs text-slate-500">Your allowance for {year} hasn't been set yet. Ask a manager.</p>}
            <p className="mt-2 text-xs text-slate-400">Annual leave only, counted Monday to Friday. Only you and managers can see this.</p>
          </>
        )}
      </section>

      {isManager && !missing && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-1 font-semibold">👥 Team leave {year}</h2>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Days left / allowance. Click ✏️ to set an allowance.</p>
          <ErrorText>{error}</ErrorText>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {profiles.map((p) => {
              const b = balanceFor(p.id, year, holidays, allowances, now)
              return (
                <li key={p.id} className="py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{p.full_name || p.email}</span>
                    <span className={`font-bold ${leftTone(b)}`}>{b.left === null ? '–' : fmtDays(b.left)}</span>
                    <span className="text-xs text-slate-500">/ {b.allowance === null ? 'not set' : fmtDays(b.allowance)}</span>
                    <button
                      className="rounded px-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                      aria-label={`Set allowance for ${p.full_name || p.email}`}
                      onClick={() => {
                        setEditing(p.id)
                        setValue(b.allowance === null ? '' : String(b.allowance))
                        setError('')
                      }}
                    >
                      ✏️
                    </button>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Taken {fmtDays(b.taken)} · Booked {fmtDays(b.booked)}
                    {b.pending > 0 && <span className="text-amber-600"> · Pending {fmtDays(b.pending)}</span>}
                  </div>
                  {editing === p.id && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        inputMode="decimal"
                        autoFocus
                        className={`${inputClass} w-24`}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveAllowance(p.id)}
                      />
                      <Button size="sm" variant="primary" onClick={() => saveAllowance(p.id)}>
                        Save
                      </Button>
                      <Button size="sm" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </aside>
  )
}
