import { useMemo, useState, type ReactNode } from 'react'
import { groupContainers } from '../lib/calendarData'
import { addDays } from '../lib/dates'
import type { Machine, Model, ProductionOrder } from '../lib/types'
import { Modal, fmtDate, inputClass, today } from './ui'
import { MACHINE_CATEGORIES, isCountedMachine, isImplement, isMachine, lowStockLevel, modelLabel } from '../lib/modelLabel'

export const linkClass = 'font-medium text-sky-700 underline dark:text-sky-300'

export function Card({
  title,
  action,
  children,
  tone = 'default',
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  tone?: 'default' | 'alert' | 'warn'
}) {
  const tones = {
    default: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
    alert: 'border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30',
    warn: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
  }
  return (
    <section className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action && <div className="ml-auto text-sm">{action}</div>}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, onClick, tone, detail }: { label: string; value: number; onClick: () => void; tone: string; detail?: string }) {
  return (
    <button
      onClick={onClick}
      className="group rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-brand-500 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-baseline">
        <span className={`text-2xl font-bold ${tone}`}>{value}</span>
        <span className="ml-auto text-xs font-medium text-sky-700 group-hover:underline dark:text-sky-300">View →</span>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      {detail && <div className="mt-1 text-[11px] text-slate-400">{detail}</div>}
    </button>
  )
}

// Stock totals, low stock and containers due soon (top of the Machines page).
export function StockOverview({
  models,
  machines,
  onStatus,
  onModel,
  onContainer,
  production = [],
}: {
  models: Model[]
  machines: Pick<Machine, 'model_id' | 'size' | 'status' | 'sold_date' | 'eta' | 'container_ref'>[]
  onStatus: (status: 'in_stock' | 'en_route' | 'sold') => void
  onModel: (modelId: string) => void
  onContainer: (ref: string | null) => void // open the containers window (optionally on one container)
  production?: ProductionOrder[]
}) {
  const now = today()
  const d = useMemo(() => {
    // Counts per model ("id") and per model and size ("id|size").
    const inStockBy = new Map<string, number>()
    const enRouteBy = new Map<string, number>()
    const makingBy = new Map<string, number>()
    const add = (map: Map<string, number>, id: string, size: string | null, n = 1) => {
      map.set(id, (map.get(id) ?? 0) + n)
      map.set(`${id}|${size ?? ''}`, (map.get(`${id}|${size ?? ''}`) ?? 0) + n)
    }
    for (const m of machines) {
      if (m.status === 'in_stock') add(inStockBy, m.model_id, m.size)
      if (m.status === 'en_route') add(enRouteBy, m.model_id, m.size)
    }
    for (const o of production) for (const i of o.items) add(makingBy, i.model_id, i.size, i.qty)
    const categoryOf = new Map(models.filter(isCountedMachine).map((m) => [m.id, m.category!]))
    const onlyMachines = machines.filter((m) => categoryOf.has(m.model_id))
    const thisMonth = (m: (typeof machines)[number]) => m.status === 'sold' && !!m.sold_date?.startsWith(now.slice(0, 7))
    // "Construction 120 · Forestry 10 · Agriculture 89"
    const split = (keep: (m: (typeof machines)[number]) => boolean) =>
      MACHINE_CATEGORIES.map((c) => [c, onlyMachines.filter((m) => keep(m) && categoryOf.get(m.model_id) === c).length] as const)
        .filter(([, n]) => n > 0)
        .map(([c, n]) => `${c} ${n}`)
        .join(' · ')
    // Machine models with no category and some stock: probably attachments saved as machines.
    const uncategorised = models.filter((m) => isMachine(m) && !isCountedMachine(m) && machines.some((x) => x.model_id === m.id && x.status !== 'sold'))
    const containers = groupContainers(
      machines.filter((m) => m.status === 'en_route'),
      models,
    )
    return {
      // Totals count Construction, Forestry and Agriculture machines only: no attachments.
      inStock: onlyMachines.filter((m) => m.status === 'in_stock').length,
      enRoute: onlyMachines.filter((m) => m.status === 'en_route').length,
      soldThisMonth: onlyMachines.filter(thisMonth).length,
      inStockSplit: split((m) => m.status === 'in_stock'),
      enRouteSplit: split((m) => m.status === 'en_route'),
      soldSplit: split(thisMonth),
      uncategorised,
      // Every machine model behind the totals, with its stock, for "See what's counted".
      counted: models
        .filter(isCountedMachine)
        .map((m) => ({
          model: m,
          inStock: onlyMachines.filter((x) => x.model_id === m.id && x.status === 'in_stock').length,
          enRoute: onlyMachines.filter((x) => x.model_id === m.id && x.status === 'en_route').length,
        }))
        .filter((r) => r.inStock + r.enRoute > 0)
        .sort((a, b) => b.inStock + b.enRoute - (a.inStock + a.enRoute)),
      levelsSet: models.some((m) => lowStockLevel(m) != null),
      levelsMissing: models.length > 0 && models.every((m) => m.reorder_level === undefined),
      // Tractor implements are checked size by size; everything else on its total.
      lowStock: models
        .flatMap((m) => {
          const level = lowStockLevel(m)
          if (level == null) return []
          const keys = isImplement(m) && m.sizes.length ? m.sizes.map((s) => ({ size: s as string | null, k: `${m.id}|${s}` })) : [{ size: null, k: m.id }]
          return keys
            .filter(({ k }) => (inStockBy.get(k) ?? 0) <= level)
            .map(({ size, k }) => ({ model: m, size, level, inStock: inStockBy.get(k) ?? 0, enRoute: enRouteBy.get(k) ?? 0, making: makingBy.get(k) ?? 0 }))
        })
        .sort((a, b) => a.inStock - b.inStock),
      arriving: containers.filter((c) => c.eta && c.eta <= addDays(now, 28)),
      noEta: containers.filter((c) => !c.eta).length,
      allContainers: containers.length,
    }
  }, [models, machines, now, production])

  const [showAll, setShowAll] = useState(false)
  const [showCounted, setShowCounted] = useState(false)
  const [lowSearch, setLowSearch] = useState('')
  type Low = (typeof d.lowStock)[number]
  const lowRow = (l: Low) => (
    <li key={`${l.model.id}|${l.size ?? ''}`} className="flex flex-wrap items-center gap-x-3 py-1.5">
      <button onClick={() => (setShowAll(false), onModel(l.model.id))} className="font-semibold hover:underline">
        {modelLabel(l.model, models, l.size)}
      </button>
      {l.model.name && <span className="text-slate-500">{l.model.name}</span>}
      <span className="ml-auto">
        <strong className={l.inStock === 0 ? 'text-red-600 dark:text-red-400' : ''}>{l.inStock}</strong> in stock
        <span className="text-slate-500">
          {' '}
          (low at {l.level}
          {l.size ? ' per size' : ''})
        </span>
        {l.enRoute > 0 && <span className="text-amber-700 dark:text-amber-400"> · {l.enRoute} on the way</span>}
        {l.making > 0 && <span className="text-violet-700 dark:text-violet-400"> · {l.making} in production</span>}
      </span>
    </li>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Machines in stock"
          value={d.inStock}
          detail={d.inStockSplit}
          onClick={() => onStatus('in_stock')}
          tone="text-green-700 dark:text-green-400"
        />
        <Stat
          label="🚢 Machines en route"
          value={d.enRoute}
          detail={d.enRouteSplit}
          onClick={() => onStatus('en_route')}
          tone="text-amber-600 dark:text-amber-400"
        />
        <Stat
          label="Machines sold this month"
          value={d.soldThisMonth}
          detail={d.soldSplit}
          onClick={() => onStatus('sold')}
          tone="text-slate-700 dark:text-slate-300"
        />
      </div>

      <div className="text-sm">
        <button onClick={() => setShowCounted(true)} className={linkClass}>
          🔎 See what's counted
        </button>
      </div>
      {showCounted && (
        <Modal title="🔎 Machines counted in the figures above" onClose={() => setShowCounted(false)} wide>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
            These are saved as <strong>machines</strong>. If any are really attachments, click the name, then <strong>Edit model</strong>, choose{' '}
            <strong>Accessory</strong> and tick the machines it fits. It then stops counting here.
          </p>
          <div className="space-y-5">
            {MACHINE_CATEGORIES.map((c) => [c, d.counted.filter((r) => r.model.category === c)] as const)
              .filter(([, rows]) => rows.length)
              .map(([label, rows]) => (
                <section key={label}>
                  <h3 className="mb-1 border-b-2 border-slate-200 pb-1 font-bold dark:border-slate-700">
                    {label} <span className="font-normal text-slate-500">({rows.length})</span>
                  </h3>
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    {rows.map((r) => (
                      <li key={r.model.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                        <button onClick={() => (setShowCounted(false), onModel(r.model.id))} className="font-semibold hover:underline">
                          {modelLabel(r.model, models)}
                        </button>
                        {r.model.name && <span className="text-slate-500">{r.model.name}</span>}
                        <span className="ml-auto">
                          <strong>{r.inStock}</strong> in stock
                          {r.enRoute > 0 && <span className="text-amber-700 dark:text-amber-400"> · {r.enRoute} en route</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        </Modal>
      )}
      {d.uncategorised.length > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          ⚠️ Not counted above, because they're saved as machines with <strong>no category</strong>:{' '}
          {d.uncategorised.map((m, i) => (
            <span key={m.id}>
              {i > 0 && ', '}
              <button onClick={() => onModel(m.id)} className="font-semibold underline">
                {modelLabel(m, models)}
              </button>
            </span>
          ))}
          . If these are attachments, open them, click <strong>Edit model</strong> and choose <strong>Accessory</strong>; if they're machines, choose their
          category.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`⚠️ Low stock: needs ordering${d.lowStock.length ? ` (${d.lowStock.length})` : ''}`} tone={d.lowStock.length ? 'warn' : 'default'}>
          {d.levelsMissing ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Low stock levels are not switched on yet. A manager needs to run <code>database/03-calendar-and-low-stock.sql</code> in Supabase.
            </p>
          ) : !d.levelsSet ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No low stock levels set yet. Managers: open a model below and click <strong>Edit model</strong> to set its low stock level.
            </p>
          ) : d.lowStock.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">All models are above their low stock level. 👍</p>
          ) : (
            <>
              <ul className="divide-y divide-red-100 text-sm dark:divide-red-900/50">{d.lowStock.slice(0, PREVIEW).map(lowRow)}</ul>
              <button onClick={() => setShowAll(true)} className={`mt-2 inline-block text-sm ${linkClass}`}>
                Open all low stock ({d.lowStock.length}) →
              </button>
            </>
          )}
        </Card>

        <Card title={`🚢 Containers arriving in the next 4 weeks${d.arriving.length ? ` (${d.arriving.length})` : ''}`}>
          {d.arriving.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No containers due in the next 4 weeks.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {d.arriving.slice(0, PREVIEW).map((c) => (
                <li key={c.ref}>
                  <button onClick={() => onContainer(c.ref)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
                    <span className="font-semibold">🚢 {c.ref}</span>
                    <span className={`ml-3 ${c.eta! < now ? 'font-semibold text-red-600' : 'text-slate-600 dark:text-slate-300'}`}>
                      {c.eta! < now ? `Overdue (ETA ${fmtDate(c.eta)})` : `ETA ${fmtDate(c.eta)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {d.noEta > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              + {d.noEta} container{d.noEta === 1 ? '' : 's'} with no ETA set.
            </p>
          )}
          <button onClick={() => onContainer(null)} className={`mt-2 inline-block text-sm ${linkClass}`}>
            Open all containers{d.allContainers ? ` (${d.allContainers})` : ''} →
          </button>
        </Card>
      </div>
      {showAll && (
        <Modal title={`⚠️ Low stock: needs ordering (${d.lowStock.length})`} onClose={() => setShowAll(false)} wide>
          <input className={`${inputClass} mb-3`} placeholder="Search…" autoFocus value={lowSearch} onChange={(e) => setLowSearch(e.target.value)} />
          {(() => {
            const q = lowSearch.trim().toLowerCase()
            const found = d.lowStock.filter((l) => !q || modelLabel(l.model, models, l.size).toLowerCase().includes(q))
            // An accessory belongs to the category of the (first) machine it fits.
            const categoryOf = (m: Model) => (isMachine(m) ? m.category : models.find((x) => x.id === m.fits_models?.[0])?.category) ?? null
            const sections: [string, typeof found][] = [
              ...CATEGORIES.map(([c, label]) => [label, found.filter((l) => isMachine(l.model) && categoryOf(l.model) === c)] as [string, typeof found]),
              ['Other machines', found.filter((l) => isMachine(l.model) && !CATEGORIES.some(([c]) => c === categoryOf(l.model)))],
              ...CATEGORIES.map(
                ([c, label]) =>
                  [
                    `🔧 Accessories · ${label.replace(/^\S+ /, '').replace(' machines', '')}`,
                    found.filter((l) => !isMachine(l.model) && categoryOf(l.model) === c),
                  ] as [string, typeof found],
              ),
              ['🔧 Accessories · other', found.filter((l) => !isMachine(l.model) && !CATEGORIES.some(([c]) => c === categoryOf(l.model)))],
            ]
            const shown = sections.filter(([, rows]) => rows.length)
            if (!shown.length) return <p className="py-4 text-sm text-slate-500">Nothing matches your search.</p>
            return (
              <div className="space-y-5">
                {shown.map(([label, rows]) => (
                  <section key={label}>
                    <h3 className="mb-1 border-b-2 border-slate-200 pb-1 font-bold dark:border-slate-700">
                      {label} <span className="font-normal text-slate-500">({rows.length})</span>
                    </h3>
                    <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{rows.map(lowRow)}</ul>
                  </section>
                ))}
              </div>
            )
          })()}
        </Modal>
      )}
    </div>
  )
}

const CATEGORIES = [
  ['Construction', '🏗️ Construction machines'],
  ['Forestry', '🌲 Forestry machines'],
  ['Agriculture', '🚜 Agriculture machines'],
] as const

const PREVIEW = 5 // low stock lines and containers shown on the page; the rest open in a window
