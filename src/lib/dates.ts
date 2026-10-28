// Dates are handled as 'YYYY-MM-DD' strings (the same format the database uses).

export function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parse(s: string) {
  return new Date(s + 'T00:00:00')
}

export function addDays(s: string, n: number) {
  const d = parse(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export function monthStart(s: string) {
  return s.slice(0, 8) + '01'
}

export function addMonths(s: string, n: number) {
  const d = parse(monthStart(s))
  d.setMonth(d.getMonth() + n)
  return ymd(d)
}

export function monthLabel(s: string) {
  return parse(s).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// Monday to Friday between two dates, inclusive (bank holidays not excluded).
export function workingDays(start: string, end: string) {
  let n = 0
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const day = parse(d).getDay()
    if (day !== 0 && day !== 6) n++
  }
  return n
}

export function overlaps(start: string, end: string, from: string, to: string) {
  return start <= to && end >= from
}
