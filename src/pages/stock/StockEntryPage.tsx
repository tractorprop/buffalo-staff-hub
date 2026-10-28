import { useMemo, useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { personName, useProfiles } from '../../lib/useProfiles'
import type { AuditEntry, Model } from '../../lib/types'
import { Button, ErrorText, Loading, fmtDateTime, inputClass } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'

type Direction = 'out' | 'in'

interface Line {
  key: number
  modelId: string
  size: string
  direction: Direction
  qty: number
}

let nextKey = 1
const newLine = (): Line => ({ key: nextKey++, modelId: '', size: '', direction: 'out', qty: 1 })

interface Data {
  models: Model[]
  inStock: { model_id: string; size: string | null }[]
  log: AuditEntry[]
}

async function loadAll(days: number) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const [models, inStock, log] = await Promise.all([
    supabase!.from('models').select('*').order('model_number'),
    supabase!.from('machines').select('model_id, size').eq('status', 'in_stock'),
    supabase!
      .from('audit_log')
      .select('*')
      .eq('table_name', 'machines')
      .gte('changed_at', since)
      .order('changed_at', { ascending: false })
      .limit(5000),
  ])
  const error = models.error ?? inStock.error ?? log.error
  return {
    data: error
      ? null
      : { models: models.data as Model[], inStock: inStock.data as Data['inStock'], log: log.data as AuditEntry[] },
    error,
  }
}

// Turn activity-log rows into "−2 B600" / "+1 B600" movements.
function movements(log: AuditEntry[]) {
  const groups = new Map<string, { at: string; by: string | null; modelId: string; size: string | null; qty: number }>()
  for (const e of log) {
    const o = e.old_data as { status?: string } | null
    const n = e.new_data as { status?: string; model_id?: string; size?: string | null; notes?: string | null } | null
    let sign = 0
    if (e.action === 'UPDATE' && o?.status === 'in_stock' && n?.status === 'sold') sign = -1
    else if (e.action === 'UPDATE' && o?.status === 'sold' && n?.status === 'in_stock') sign = 1
    else if (e.action === 'INSERT' && n?.status === 'in_stock' && n?.notes === 'Return') sign = 1
    if (!sign || !n?.model_id) continue
    const key = `${e.changed_at}|${e.changed_by}|${n.model_id}|${n.size ?? ''}|${sign}`
    const g = groups.get(key) ?? { at: e.changed_at, by: e.changed_by, modelId: n.model_id, size: n.size ?? null, qty: 0 }
    g.qty += sign
    groups.set(key, g)
  }
  return [...groups.values()]
}

export function StockEntryPage() {
  const profiles = useProfiles()
  const [days, setDays] = useState(30)
  const [person, setPerson] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const { data, error, loading, reload } = useLive<Data>(['models', 'machines'], () => loadAll(days), [days])
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [formError, setFormError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  const stock = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of data?.inStock ?? []) {
      const k = `${m.model_id}|${m.size ?? ''}`
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return map
  }, [data])

  const update = (key: number, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)))
  const modelLabel = (id: string, size?: string | null) => {
    const m = data?.models.find((x) => x.id === id)
    return `${m?.model_number ?? '?'}${size ? ` ${size}` : ''}`
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !data) return
    setFormError('')
    setDone('')
    const filled = lines.filter((l) => l.modelId)
    if (!filled.length) return setFormError('Choose a model.')
    for (const l of filled) {
      const m = data.models.find((x) => x.id === l.modelId)!
      if (m.sizes.length && !l.size) return setFormError(`Choose a size for ${m.model_number}.`)
      if (!(l.qty >= 1 && l.qty <= 100)) return setFormError(`Check the quantity for ${m.model_number} (1 to 100).`)
    }

    setBusy(true)
    const ok: string[] = []
    const failed: Line[] = []
    const problems: string[] = []
    for (const l of filled) {
      const qty = l.direction === 'out' ? -l.qty : l.qty
      const { error } = await supabase.rpc('record_stock_movement', { p_model_id: l.modelId, p_size: l.size || null, p_qty: qty })
      if (error) {
        failed.push(l)
        problems.push(
          /could not find the function|record_stock_movement/i.test(error.message)
            ? 'Stock entry is not switched on in the database yet. A manager needs to run the stock-entry SQL in Supabase.'
            : `${modelLabel(l.modelId, l.size)}: ${friendlyError(error)}`,
        )
      } else ok.push(`${qty > 0 ? '+' : '−'}${l.qty} ${modelLabel(l.modelId, l.size)}`)
    }
    setBusy(false)
    setLines(failed.length ? failed : [newLine()])
    if (ok.length) setDone(`Saved: ${ok.join(', ')}`)
    if (problems.length) setFormError([...new Set(problems)].join(' '))
    reload()
  }

  const history = useMemo(() => {
    const q = modelSearch.trim().toLowerCase()
    return movements(data?.log ?? []).filter((g) => {
      if (person && g.by !== person) return false
      if (!q) return true
      const m = data?.models.find((x) => x.id === g.modelId)
      return `${m?.model_number ?? ''} ${m?.name ?? ''} ${g.size ?? ''}`.toLowerCase().includes(q)
    })
  }, [data, person, modelSearch])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Stock entry</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Record machines leaving the warehouse (sold / dispatched), or coming back (returns).
        </p>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Loading />
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {lines.map((l) => {
            const m = data?.models.find((x) => x.id === l.modelId)
            const have = m && (!m.sizes.length || l.size) ? stock.get(`${m.id}|${l.size}`) ?? 0 : null
            return (
              <div key={l.key} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['out', '− Leaving (sold)'],
                      ['in', '+ Return'],
                    ] as [Direction, string][]
                  ).map(([d, label]) => (
                    <button
                      type="button"
                      key={d}
                      onClick={() => update(l.key, { direction: d })}
                      className={`rounded-lg border px-2 py-2 text-sm font-semibold ${
                        l.direction === d
                          ? d === 'out'
                            ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                            : 'border-green-600 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                          : 'border-slate-300 text-slate-500 dark:border-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-48 flex-1">
                    <ModelPicker models={data?.models ?? []} value={l.modelId} onChange={(id) => update(l.key, { modelId: id, size: '' })} />
                  </div>
                  {m && m.sizes.length > 0 && (
                    <select className={`${inputClass} w-32`} value={l.size} onChange={(e) => update(l.key, { size: e.target.value })}>
                      <option value="">Size…</option>
                      {m.sizes.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    aria-label="Quantity"
                    className={`${inputClass} w-20`}
                    value={l.qty}
                    onChange={(e) => update(l.key, { qty: parseInt(e.target.value) || 0 })}
                  />
                  <Button
                    variant="ghost"
                    aria-label="Remove line"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    ×
                  </Button>
                </div>
                {have !== null && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {have} in stock now
                    {l.direction === 'out' && l.qty > have && <span className="ml-1 font-medium text-red-600"> (not enough to take out {l.qty})</span>}
                  </p>
                )}
              </div>
            )
          })}
          <Button size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
            + Add another model
          </Button>
          <ErrorText>{formError}</ErrorText>
          {done && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">✓ {done}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save stock entry'}
          </Button>
        </form>
      )}

      {data && (
        <section className="space-y-2">
          <h2 className="font-semibold">Stock entry history</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className={`${inputClass} sm:w-56`} value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Everyone</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
            <input className={inputClass} placeholder="Filter by model…" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} />
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No stock entries in the last {days} days{person || modelSearch ? ' matching these filters' : ''}.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Who</th>
                    <th className="px-3 py-2">Entry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {history.map((g) => (
                    <tr key={`${g.at}${g.modelId}${g.size}${g.qty}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-slate-400">{fmtDateTime(g.at)}</td>
                      <td className="px-3 py-2">{personName(profiles, g.by)}</td>
                      <td className="px-3 py-2">
                        <span className={`mr-2 font-bold ${g.qty < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                          {g.qty < 0 ? `−${-g.qty}` : `+${g.qty}`}
                        </span>
                        <span className="font-medium">{modelLabel(g.modelId, g.size)}</span>
                        <span className="ml-1 text-xs text-slate-500">{g.qty < 0 ? 'left (sold)' : 'returned'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
            Showing the last {days} days.
            <Button size="sm" onClick={() => setDays((n) => n + 90)}>
              Load older
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
