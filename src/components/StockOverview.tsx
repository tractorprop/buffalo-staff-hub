import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { groupContainers } from '../lib/calendarData'
import { addDays } from '../lib/dates'
import type { Machine, Model } from '../lib/types'
import { fmtDate, today } from './ui'

export const linkClass = 'font-medium text-sky-700 underline dark:text-sky-300'

export function Card({ title, action, children, tone = 'default' }: { title: string; action?: ReactNode; children: ReactNode; tone?: 'default' | 'alert' | 'warn' }) {
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

function Stat({ label, value, onClick, tone }: { label: string; value: number; onClick: () => void; tone: string }) {
  return (
    <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-brand-500 dark:border-slate-800 dark:bg-slate-900">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </button>
  )
}

// Stock totals, low stock and containers due soon (top of the Machines page).
export function StockOverview({
  models,
  machines,
  onStatus,
  onModel,
}: {
  models: Model[]
  machines: Pick<Machine, 'model_id' | 'size' | 'status' | 'sold_date' | 'eta' | 'container_ref'>[]
  onStatus: (status: 'in_stock' | 'en_route' | 'sold') => void
  onModel: (modelId: string) => void
}) {
  const now = today()
  const d = useMemo(() => {
    const inStockBy = new Map<string, number>()
    const enRouteBy = new Map<string, number>()
    for (const m of machines) {
      if (m.status === 'in_stock') inStockBy.set(m.model_id, (inStockBy.get(m.model_id) ?? 0) + 1)
      if (m.status === 'en_route') enRouteBy.set(m.model_id, (enRouteBy.get(m.model_id) ?? 0) + 1)
    }
    const containers = groupContainers(
      machines.filter((m) => m.status === 'en_route'),
      models,
    )
    return {
      inStock: machines.filter((m) => m.status === 'in_stock').length,
      enRoute: machines.filter((m) => m.status === 'en_route').length,
      soldThisMonth: machines.filter((m) => m.status === 'sold' && m.sold_date?.startsWith(now.slice(0, 7))).length,
      levelsSet: models.some((m) => m.reorder_level != null),
      levelsMissing: models.length > 0 && models.every((m) => m.reorder_level === undefined),
      lowStock: models
        .filter((m) => m.reorder_level != null && (inStockBy.get(m.id) ?? 0) <= m.reorder_level)
        .map((m) => ({ model: m, inStock: inStockBy.get(m.id) ?? 0, enRoute: enRouteBy.get(m.id) ?? 0 }))
        .sort((a, b) => a.inStock - b.inStock),
      arriving: containers.filter((c) => c.eta && c.eta <= addDays(now, 28)),
      noEta: containers.filter((c) => !c.eta).length,
    }
  }, [models, machines, now])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="In stock" value={d.inStock} onClick={() => onStatus('in_stock')} tone="text-green-700 dark:text-green-400" />
        <Stat label="🚢 En route" value={d.enRoute} onClick={() => onStatus('en_route')} tone="text-amber-600 dark:text-amber-400" />
        <Stat label="Sold this month" value={d.soldThisMonth} onClick={() => onStatus('sold')} tone="text-slate-700 dark:text-slate-300" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="⚠️ Low stock: needs ordering" tone={d.lowStock.length ? 'warn' : 'default'}>
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
            <ul className="divide-y divide-red-100 text-sm dark:divide-red-900/50">
              {d.lowStock.map((l) => (
                <li key={l.model.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                  <button onClick={() => onModel(l.model.id)} className="font-semibold hover:underline">
                    {l.model.model_number}
                  </button>
                  {l.model.name && <span className="text-slate-500">{l.model.name}</span>}
                  <span className="ml-auto">
                    <strong className={l.inStock === 0 ? 'text-red-600 dark:text-red-400' : ''}>{l.inStock}</strong> in stock
                    <span className="text-slate-500"> (low at {l.model.reorder_level})</span>
                    {l.enRoute > 0 && <span className="text-amber-700 dark:text-amber-400"> · {l.enRoute} on the way</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="🚢 Containers arriving in the next 4 weeks">
          {d.arriving.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No containers due in the next 4 weeks.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {d.arriving.map((c) => (
                <li key={c.ref} className="py-1.5">
                  <div className="flex flex-wrap gap-x-3">
                    <span className="font-semibold">📦 {c.ref}</span>
                    <span className={c.eta! < now ? 'font-semibold text-red-600' : 'text-slate-600 dark:text-slate-300'}>
                      {c.eta! < now ? `Overdue (ETA ${fmtDate(c.eta)})` : `ETA ${fmtDate(c.eta)}`}
                    </span>
                    <span className="ml-auto text-slate-500">{c.total} items</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{c.contents.map(([l, n]) => `${n}× ${l}`).join(', ')}</div>
                </li>
              ))}
            </ul>
          )}
          {d.noEta > 0 && <p className="mt-2 text-xs text-slate-500">+ {d.noEta} container{d.noEta === 1 ? '' : 's'} with no ETA set.</p>}
          <Link to="/" className={`mt-2 inline-block text-sm ${linkClass}`}>
            See the timeline on the Dashboard
          </Link>
        </Card>
      </div>
    </div>
  )
}
