import { useMemo, useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { accessoryBaseName, isMachine, modelLabel } from '../../lib/modelLabel'
import { money, priceOf, round2 } from '../../lib/money'
import type { Model } from '../../lib/types'
import { Button, ErrorText, inputClass } from '../../components/ui'

type Show = 'all' | 'machines' | 'accessories' | 'missing'

// One priced row: a model, or one size of a model that comes in sizes.
interface Entry {
  key: string
  model: Model
  size: string | null
}

const keyOf = (id: string, size: string | null) => `${id}|${size ?? ''}`

// Everyone can see prices; managers can type them in and save them all at once.
export function PriceList({ models }: { models: Model[] }) {
  const { isManager } = useAuth()
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [linked, setLinked] = useState(true) // same price for matching accessories on other machines

  // Accessories with the same part name on different machines, e.g. "Hydraulic thumb" for B1000, B1200 and B1800.
  const siblings = useMemo(() => {
    const groups = new Map<string, Model[]>()
    for (const m of models) {
      if (m.kind !== 'accessory') continue
      const k = accessoryBaseName(m, models).trim().toLowerCase()
      groups.set(k, [...(groups.get(k) ?? []), m])
    }
    const out = new Map<string, Model[]>()
    for (const list of groups.values()) if (list.length > 1) for (const m of list) out.set(m.id, list.filter((x) => x.id !== m.id))
    return out
  }, [models])

  // Typing a price also fills in the same price (same size) on matching accessories when linked.
  function setPrice(m: Model, size: string | null, value: string) {
    setEdits((x) => {
      const next = { ...x, [keyOf(m.id, size)]: value }
      if (linked)
        for (const s of siblings.get(m.id) ?? []) {
          if (size ? s.sizes.includes(size) : !s.sizes.length) next[keyOf(s.id, size)] = value
        }
      return next
    })
  }

  // Machines first, then each machine's accessories underneath it; sized models get one row per size.
  const entries = useMemo(() => {
    const byNumber = (a: Model, b: Model) => a.model_number.localeCompare(b.model_number, undefined, { numeric: true })
    const ordered: Model[] = []
    const seen = new Set<string>()
    for (const m of models.filter(isMachine).sort(byNumber)) {
      ordered.push(m)
      for (const a of models.filter((x) => x.kind === 'accessory' && (x.fits_models ?? [])[0] === m.id).sort(byNumber)) {
        ordered.push(a)
        seen.add(a.id)
      }
    }
    ordered.push(...models.filter((x) => x.kind === 'accessory' && !seen.has(x.id)).sort(byNumber))
    const out: Entry[] = []
    for (const m of ordered) {
      if (m.sizes.length) for (const s of m.sizes) out.push({ key: keyOf(m.id, s), model: m, size: s })
      else out.push({ key: keyOf(m.id, null), model: m, size: null })
    }
    return out
  }, [models])

  const q = search.trim().toLowerCase()
  const rows = entries.filter(({ model: m, size }) => {
    if (show === 'machines' && !isMachine(m)) return false
    if (show === 'accessories' && isMachine(m)) return false
    if (show === 'missing' && priceOf(m, size) != null) return false
    return !q || `${modelLabel(m, models)} ${m.name ?? ''} ${size ?? ''}`.toLowerCase().includes(q)
  })
  const missingCount = entries.filter((e) => priceOf(e.model, e.size) == null).length

  const changed = entries.filter((e) => {
    const v = edits[e.key]
    if (v === undefined) return false
    const n = v.trim() === '' ? null : round2(parseFloat(v))
    return n === null ? priceOf(e.model, e.size) != null : !Number.isNaN(n) && n >= 0 && n !== priceOf(e.model, e.size)
  })

  async function save() {
    setBusy(true)
    setError('')
    setSaved('')
    // One update per model: a plain price, or the whole set of size prices.
    const byModel = new Map<string, Entry[]>()
    for (const e of changed) byModel.set(e.model.id, [...(byModel.get(e.model.id) ?? []), e])
    let ok = 0
    for (const [id, list] of byModel) {
      const m = list[0].model
      const value = (e: Entry) => (edits[e.key].trim() === '' ? null : round2(parseFloat(edits[e.key])))
      let change: Record<string, unknown>
      if (m.sizes.length) {
        const sp: Record<string, number> = { ...(m.size_prices ?? {}) }
        for (const e of list) {
          const v = value(e)
          if (v === null) delete sp[e.size!]
          else sp[e.size!] = v
        }
        change = { size_prices: sp }
      } else change = { price: value(list[0]) }
      const { error } = await supabase!.from('models').update(change).eq('id', id)
      if (error) {
        setError(
          /size_prices/.test(error.message)
            ? 'Prices per size are not switched on yet. Run database/08-size-prices.sql in Supabase first.'
            : friendlyError(error),
        )
        break
      }
      ok += list.length
    }
    setBusy(false)
    if (ok) {
      setSaved(`Saved ${ok} price${ok === 1 ? '' : 's'}.`)
      setEdits({})
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Prices are <strong>including VAT</strong>, the same as your website. Items that come in sizes have a price for each size.{' '}
        {isManager ? 'Type a price in, then click Save.' : 'Only managers can change prices.'}
      </p>
      {siblings.size > 0 && isManager && (
        <label className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm dark:bg-slate-800">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          <span>
            <strong>Same price for matching accessories.</strong> Typing a price for e.g. "Hydraulic thumb B1000" also fills in the same price for
            "Hydraulic thumb B1200" and any others with the same name. Untick if their prices differ.
          </span>
        </label>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className={inputClass} placeholder="Search machine, accessory or size…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={`${inputClass} sm:w-56`} value={show} onChange={(e) => setShow(e.target.value as Show)}>
          <option value="all">Show: everything</option>
          <option value="machines">Show: machines</option>
          <option value="accessories">Show: accessories</option>
          <option value="missing">Show: no price yet ({missingCount})</option>
        </select>
      </div>

      {isManager && changed.length > 0 && (
        <div className="sticky top-20 z-10 flex items-center gap-3 rounded-lg bg-ink p-3 text-sm text-white">
          {changed.length} unsaved change{changed.length === 1 ? '' : 's'}
          <Button size="sm" variant="primary" className="ml-auto" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save prices'}
          </Button>
          <Button size="sm" onClick={() => setEdits({})}>
            Undo
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {saved && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">✓ {saved}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Price inc VAT</th>
              <th className="hidden px-3 py-2 text-right sm:table-cell">Ex VAT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map(({ key, model: m, size }, i) => {
              const current = priceOf(m, size)
              const value = edits[key] ?? (current != null ? String(current) : '')
              const n = parseFloat(value)
              const firstOfModel = !size || rows[i - 1]?.model.id !== m.id
              return (
                <tr key={key} className={isMachine(m) ? 'bg-slate-50/60 dark:bg-slate-800/30' : ''}>
                  <td className={`px-3 py-1.5 ${isMachine(m) ? 'font-semibold' : 'pl-7'}`}>
                    {firstOfModel ? (
                      <>
                        {isMachine(m) ? '' : '🔧 '}
                        {modelLabel(m, models)}
                        {m.name && <span className="ml-2 font-normal text-slate-500">{m.name}</span>}
                        {linked && isManager && siblings.has(m.id) && (
                          <span className="block text-xs font-normal text-sky-700 dark:text-sky-300">
                            🔗 also sets {siblings.get(m.id)!.map((s) => modelLabel(s, models)).join(', ')}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="invisible">{modelLabel(m, models)}</span>
                    )}
                    {size && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{size}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {isManager ? (
                      <span className="relative inline-block">
                        <span className="absolute left-2 top-1.5 text-slate-400">£</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          aria-label={`Price for ${modelLabel(m, models)}${size ? ` ${size}` : ''}`}
                          className={`w-32 rounded-lg border bg-white py-1 pl-5 pr-2 text-right dark:bg-slate-950 ${
                            edits[key] !== undefined ? 'border-brand-600' : current == null ? 'border-amber-400' : 'border-slate-300 dark:border-slate-700'
                          }`}
                          value={value}
                          onChange={(e) => setPrice(m, size, e.target.value)}
                        />
                      </span>
                    ) : current != null ? (
                      money(current)
                    ) : (
                      <span className="text-amber-600">Not set</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-1.5 text-right text-slate-500 sm:table-cell">{value !== '' && !Number.isNaN(n) ? money(round2(n / 1.2)) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
