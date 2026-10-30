import { supabase } from './supabase'
import { addDays, workingDays } from './dates'
import type { Holiday } from './types'

export interface Allowance {
  staff_id: string
  year: number
  days: number
}

export interface Balance {
  allowance: number | null // null = not set by a manager yet
  taken: number // approved annual leave already used this year
  booked: number // approved annual leave still to come this year
  pending: number // annual leave requested but not decided yet
  left: number | null
}

// Only rows the database lets this person see: their own, or everyone's for managers.
export async function loadAllowances() {
  const { data, error } = await supabase!.from('leave_allowances').select('staff_id, year, days')
  return { data: (data as Allowance[] | null) ?? [], error, missing: !!error && /leave_allowances/.test(error.message) }
}

// Mon–Fri days of a holiday that fall between two dates (inclusive).
function daysBetween(h: Holiday, from: string, to: string) {
  const start = h.start_date > from ? h.start_date : from
  const end = h.end_date < to ? h.end_date : to
  return start <= end ? workingDays(start, end) : 0
}

// Annual leave balance for one person in one calendar year (Jan–Dec).
export function balanceFor(staffId: string, year: number, holidays: Holiday[], allowances: Allowance[], today: string): Balance {
  const yStart = `${year}-01-01`
  const yEnd = `${year}-12-31`
  const yesterday = addDays(today, -1)
  let taken = 0
  let booked = 0
  let pending = 0
  for (const h of holidays) {
    if (h.staff_id !== staffId || h.type !== 'Annual leave') continue
    if (h.status === 'approved') {
      taken += daysBetween(h, yStart, yesterday < yEnd ? yesterday : yEnd)
      booked += daysBetween(h, today > yStart ? today : yStart, yEnd)
    } else if (h.status === 'pending') pending += daysBetween(h, yStart, yEnd)
  }
  const a = allowances.find((x) => x.staff_id === staffId && x.year === year)
  const allowance = a ? Number(a.days) : null
  return { allowance, taken, booked, pending, left: allowance === null ? null : allowance - taken - booked }
}

export const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
