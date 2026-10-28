import { Link } from 'react-router-dom'
import type { Container } from '../lib/calendarData'
import { addDays, parse } from '../lib/dates'
import { fmtDate } from './ui'

const DAYS = 28

// Height of the wavy line (0–100 % of the track) at a horizontal position (0–1).
const waveY = (x: number) => 50 + 20 * Math.sin(x * Math.PI * 3)

function wavePath() {
  const pts: string[] = []
  for (let i = 0; i <= 200; i++) {
    const x = i / 200
    pts.push(`${i === 0 ? 'M' : 'L'} ${(x * 1000).toFixed(1)} ${waveY(x).toFixed(2)}`)
  }
  return pts.join(' ')
}
const PATH = wavePath()

const short = (d: string) => parse(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function ContainerTimeline({ containers, today }: { containers: Container[]; today: string }) {
  const end = addDays(today, DAYS)
  const upcoming = containers.filter((c) => c.eta && c.eta <= end).sort((a, b) => a.eta!.localeCompare(b.eta!))
  const dayIndex = (d: string) => Math.round((parse(d).getTime() - parse(today).getTime()) / 864e5)

  // Lay labels out above/below the line, stepping further out when they would overlap.
  const lastX = { up: [-1, -1], down: [-1, -1] }
  const placed = upcoming.map((c, i) => {
    const overdue = c.eta! < today
    const x = overdue ? 0 : Math.min(1, dayIndex(c.eta!) / DAYS)
    const side: 'up' | 'down' = i % 2 === 0 ? 'up' : 'down'
    const level = x - lastX[side][0] < 0.16 && lastX[side][0] >= 0 ? (lastX[side][1] === 0 ? 1 : 0) : 0
    lastX[side] = [x, level]
    return { c, x, side, level, overdue }
  })

  const ticks = [0, 7, 14, 21, 28].map((d) => ({ x: d / DAYS, label: d === 0 ? 'Today' : `${d / 7} week${d > 7 ? 's' : ''}`, date: addDays(today, d) }))

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-semibold">🚢 Container timeline: next 4 weeks</h2>
        <Link to="/machines?status=en_route" className="ml-auto text-sm font-medium text-sky-700 underline dark:text-sky-300">
          All en route
        </Link>
      </div>

      {upcoming.length === 0 && <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">No containers due in the next 4 weeks.</p>}

      {/* Wide screens: wavy line across the page */}
      <div className="relative mx-10 hidden h-64 md:block">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-x-0 top-1/2 h-24 w-full -translate-y-1/2 overflow-visible">
          <defs>
            <linearGradient id="tl-grad" x1="0" x2="1">
              <stop offset="0" stopColor="#fdda03" />
              <stop offset="1" stopColor="#fdda03" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <path d={PATH} fill="none" stroke="currentColor" strokeWidth="8" vectorEffect="non-scaling-stroke" className="text-slate-900/5 dark:text-white/5" />
          <path d={PATH} fill="none" stroke="url(#tl-grad)" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={PATH} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" className="text-slate-900/40 dark:text-white/40" />
        </svg>

        {/* Week markers */}
        {ticks.map((t) => (
          <div
            key={t.x}
            className="absolute -translate-x-1/2 text-center"
            style={{ left: `${t.x * 100}%`, top: `calc(50% + ${(waveY(t.x) - 50) * 0.96}px - 5px)` }}
          >
            <div className={`mx-auto h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${t.x === 0 ? 'bg-ink dark:bg-white' : 'bg-slate-300 dark:bg-slate-600'}`} />
          </div>
        ))}
        <div className="absolute inset-x-0 bottom-0 flex justify-between text-[11px] text-slate-400">
          {ticks.map((t) => (
            <span key={t.x} className={`w-0 whitespace-nowrap ${t.x === 0 ? 'font-semibold text-slate-700 dark:text-slate-200' : ''}`}>
              <span className="block -translate-x-1/2 text-center">
                {t.label}
                <span className="block font-normal text-slate-400">{short(t.date)}</span>
              </span>
            </span>
          ))}
        </div>

        {/* Containers */}
        {placed.map(({ c, x, side, level, overdue }) => {
          const lineY = (waveY(x) - 50) * 0.96 // px offset of the wave from the middle
          const reach = 34 + level * 46
          // Keep labels near the ends inside the box.
          const shift = x < 0.1 ? '-15%' : x > 0.9 ? '-85%' : '-50%'
          return (
            <div key={c.ref} className="group absolute" style={{ left: `${x * 100}%`, top: `calc(50% + ${lineY}px)` }}>
              <div
                className={`absolute z-[1] flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-white text-base shadow dark:bg-slate-900 ${
                  overdue ? 'border-red-600' : 'border-ink dark:border-brand-500'
                }`}
              >
                🚢
              </div>
              <div className="absolute w-px -translate-x-1/2 bg-slate-300 dark:bg-slate-600" style={side === 'up' ? { bottom: 16, height: reach - 16 } : { top: 16, height: reach - 16 }} />
              <div
                className="absolute whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-800"
                style={{ ...(side === 'up' ? { bottom: reach } : { top: reach }), transform: `translateX(${shift})` }}
                title={c.contents.map(([l, n]) => `${n}× ${l}`).join(', ')}
              >
                <div className="font-semibold">📦 {c.ref}</div>
                <div className={overdue ? 'font-medium text-red-600' : 'text-slate-500 dark:text-slate-400'}>
                  {overdue ? `Overdue · was ${short(c.eta!)}` : short(c.eta!)} · {c.total}
                </div>
              </div>
              <div
                className="pointer-events-none absolute z-10 hidden w-56 rounded-lg bg-ink p-2 text-xs text-white shadow-lg group-hover:block"
                style={{ ...(side === 'up' ? { top: 20 } : { bottom: 20 }), transform: `translateX(${shift})` }}
              >
                <div className="mb-1 font-semibold text-brand-500">
                  {c.ref} · {fmtDate(c.eta)}
                </div>
                {c.contents.map(([l, n]) => (
                  <div key={l}>
                    {n}× {l}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Phones: vertical timeline */}
      {upcoming.length > 0 && (
        <ol className="relative ml-2 space-y-4 border-l-2 border-dashed border-brand-500 pl-5 md:hidden">
          {placed.map(({ c, overdue }) => (
            <li key={c.ref} className="relative">
              <span
                className={`absolute -left-[37px] top-0 flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white text-base dark:bg-slate-900 ${
                  overdue ? 'border-red-600' : 'border-ink dark:border-brand-500'
                }`}
              >
                🚢
              </span>
              <div className="text-xs font-medium text-slate-500">
                {overdue ? <span className="text-red-600">Overdue · was {fmtDate(c.eta)}</span> : `${fmtDate(c.eta)} · in ${dayIndex(c.eta!)} day${dayIndex(c.eta!) === 1 ? '' : 's'}`}
              </div>
              <div className="font-semibold">
                📦 {c.ref} <span className="font-normal text-slate-500">· {c.total} items</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{c.contents.map(([l, n]) => `${n}× ${l}`).join(', ')}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
