import { addDays, addMonths, monthLabel, monthStart, parse, ymd } from '../lib/dates'
import { today } from './ui'

export type Tone = 'green' | 'amber' | 'blue' | 'purple' | 'grey'

export interface CalItem {
  key: string
  start: string
  end: string
  label: string
  tone: Tone
}

const toneClass: Record<Tone, string> = {
  green: 'bg-green-100 text-green-900 dark:bg-green-900/60 dark:text-green-100',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
  blue: 'bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100',
  purple: 'bg-violet-100 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100',
  grey: 'bg-slate-100 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400',
}

export const legend: { tone: Tone; label: string }[] = [
  { tone: 'green', label: 'Approved leave' },
  { tone: 'amber', label: 'Leave requested' },
  { tone: 'blue', label: 'Event' },
  { tone: 'purple', label: 'Container due' },
]

export function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {legend.map((l) => (
        <span key={l.tone} className="flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded ${toneClass[l.tone]}`} /> {l.label}
        </span>
      ))}
    </div>
  )
}

export function MonthCalendar({
  month,
  items,
  onMonthChange,
  onItemClick,
  maxPerDay = 3,
}: {
  month: string // any date in the month, 'YYYY-MM-DD'
  items: CalItem[]
  onMonthChange?: (month: string) => void
  onItemClick?: (key: string) => void
  maxPerDay?: number
}) {
  const first = monthStart(month)
  const offset = (parse(first).getDay() + 6) % 7 // Monday = 0
  const gridStart = addDays(first, -offset)
  const nextMonth = addMonths(first, 1)
  const weeks = Math.ceil((offset + (parse(addDays(nextMonth, -1)).getDate())) / 7)
  const now = today()

  const days: string[] = []
  for (let i = 0; i < weeks * 7; i++) days.push(addDays(gridStart, i))

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-semibold">{monthLabel(first)}</h3>
        {onMonthChange && (
          <div className="ml-auto flex gap-1">
            <button className="rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => onMonthChange(addMonths(first, -1))} aria-label="Previous month">
              ‹
            </button>
            <button className="rounded-lg px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => onMonthChange(ymd(new Date()))}>
              Today
            </button>
            <button className="rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => onMonthChange(addMonths(first, 1))} aria-label="Next month">
              ›
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-slate-200 text-xs dark:border-slate-800">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="border-b border-slate-200 bg-slate-50 py-1 text-center font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            {d}
          </div>
        ))}
        {days.map((d, i) => {
          const inMonth = d >= first && d < nextMonth
          const dayItems = items.filter((it) => it.start <= d && it.end >= d)
          const weekend = i % 7 >= 5
          return (
            <div
              key={d}
              className={`min-h-16 border-b border-r border-slate-100 p-0.5 sm:min-h-24 sm:p-1 dark:border-slate-800 ${
                inMonth ? (weekend ? 'bg-slate-50/60 dark:bg-slate-900/60' : 'bg-white dark:bg-slate-950') : 'bg-slate-50 opacity-50 dark:bg-slate-900'
              }`}
            >
              <div
                className={`mb-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  d === now ? 'bg-brand-500 font-bold text-ink' : 'text-slate-500'
                }`}
              >
                {parse(d).getDate()}
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, maxPerDay).map((it) => (
                  <button
                    key={it.key}
                    onClick={() => onItemClick?.(it.key)}
                    title={it.label}
                    className={`block w-full truncate rounded px-1 text-left text-[10px] leading-4 sm:text-[11px] ${toneClass[it.tone]} ${onItemClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                  >
                    {it.label}
                  </button>
                ))}
                {dayItems.length > maxPerDay && <div className="px-1 text-[10px] text-slate-500">+{dayItems.length - maxPerDay} more</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
