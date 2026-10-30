import { useMemo, useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Machine, Model } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'
import { labelFor, modelLabel } from '../../lib/modelLabel'

interface Line {
  key: string
  modelId: string
  size: string | null
  ids: string[] // en-route machines expected on this line
  arrived: number
  missing: 'keep' | 'remove' // what to do with any that didn't arrive
}

interface Extra {
  key: number
  modelId: string
  size: string
  qty: number
}

let nextKey = 1

// Staff count what actually arrived in a container and submit it. It only goes into stock once a
// manager approves it; when a manager (or the founder) submits it themselves, it's approved straight away.
export function CheckInContainer({
  containerRef,
  machines,
  models,
  isManager,
  onClose,
  onDone,
}: {
  containerRef: string
  machines: Machine[]
  models: Model[]
  isManager: boolean
  onClose: () => void
  onDone: (summary: string) => void
}) {
  const initial = useMemo(() => {
    const map = new Map<string, Line>()
    for (const m of machines) {
      if (m.status !== 'en_route' || m.container_ref !== containerRef) continue
      const key = `${m.model_id}|${m.size ?? ''}`
      const line = map.get(key) ?? { key, modelId: m.model_id, size: m.size, ids: [], arrived: 0, missing: 'keep' as const }
      line.ids.push(m.id)
      line.arrived = line.ids.length
      map.set(key, line)
    }
    const num = (id: string) => labelFor(id, models)
    return [...map.values()].sort((a, b) => num(a.modelId).localeCompare(num(b.modelId)) || (a.size ?? '').localeCompare(b.size ?? ''))
  }, [machines, models, containerRef])

  const [lines, setLines] = useState<Line[]>(initial)
  const [extras, setExtras] = useState<Extra[]>([])
  const [location, setLocation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const label = (modelId: string, size: string | null) => {
    const m = models.find((x) => x.id === modelId)
    return `${modelLabel(m, models, size)}${m?.name ? ` · ${m.name}` : ''}`
  }
  const setLine = (key: string, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)))
  const setExtra = (key: number, change: Partial<Extra>) => setExtras((es) => es.map((e) => (e.key === key ? { ...e, ...change } : e)))

  const expected = lines.reduce((n, l) => n + l.ids.length, 0)
  const arrived = lines.reduce((n, l) => n + l.arrived, 0) + extras.reduce((n, e) => n + (e.modelId ? e.qty : 0), 0)
  const short = lines.reduce((n, l) => n + (l.ids.length - l.arrived), 0)

  async function approve() {
    if (!supabase) return
    for (const e of extras.filter((x) => x.modelId)) {
      const m = models.find((x) => x.id === e.modelId)!
      if (m.sizes.length && !e.size) return setError(`Choose a size for the extra ${m.model_number}.`)
      if (!(e.qty >= 1 && e.qty <= 500)) return setError(`Check the quantity for the extra ${m.model_number}.`)
    }
    setBusy(true)
    setError('')
    const removeIds = lines.filter((l) => l.missing === 'remove').flatMap((l) => l.ids.slice(l.arrived))
    const { data: row, error } = await supabase
      .from('container_checkins')
      .insert({
        container_ref: containerRef,
        arrive_ids: lines.flatMap((l) => l.ids.slice(0, l.arrived)),
        remove_ids: removeIds,
        extras: extras.filter((e) => e.modelId).map((e) => ({ model_id: e.modelId, size: e.size || null, qty: e.qty })),
        location: location.trim() || null,
      })
      .select('id')
      .single()
    if (error || !row) {
      setBusy(false)
      return setError(
        /container_checkins/.test(error?.message ?? '')
          ? 'Container approvals are not switched on yet. The founder needs to run database/10-founder-and-approvals.sql in Supabase.'
          : friendlyError(error),
      )
    }
    if (isManager) {
      const { error: approveError } = await supabase.rpc('approve_container_checkin', { p_id: row.id })
      setBusy(false)
      if (approveError) return setError(`Submitted, but approving failed: ${friendlyError(approveError)} Approve it from the containers list.`)
      const kept = short - removeIds.length
      return onDone(
        `Container ${containerRef} checked in: ${arrived} added to stock` +
          (removeIds.length ? `, ${removeIds.length} removed as missing` : '') +
          (kept ? `, ${kept} still on the way` : '') +
          '.',
      )
    }
    setBusy(false)
    onDone(`Container ${containerRef} sent for approval. Stock is added once a manager approves it.`)
  }

  return (
    <Modal title={`Check in container ${containerRef}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Count what has actually arrived and enter it below.{' '}
          {isManager ? 'Only what you approve is added to stock.' : 'A manager checks and approves it before anything is added to stock.'}
        </p>

        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-center">Expected</th>
                <th className="px-3 py-2 text-center">Arrived</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {lines.map((l) => {
                const diff = l.ids.length - l.arrived
                return (
                  <tr key={l.key} className={diff ? 'bg-amber-50 dark:bg-amber-950/30' : ''}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{label(l.modelId, l.size)}</div>
                      {diff > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-amber-700 dark:text-amber-400">⚠️ {diff} short</span>
                          <select
                            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-900"
                            value={l.missing}
                            onChange={(e) => setLine(l.key, { missing: e.target.value as Line['missing'] })}
                          >
                            <option value="keep">Keep as still on the way</option>
                            <option value="remove">Remove as missing</option>
                          </select>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-500">{l.ids.length}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="h-8 w-8 rounded-lg border border-slate-300 dark:border-slate-700"
                          onClick={() => setLine(l.key, { arrived: Math.max(0, l.arrived - 1) })}
                          aria-label="One fewer"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={l.ids.length}
                          aria-label="Arrived"
                          className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-semibold dark:border-slate-700 dark:bg-slate-950"
                          value={l.arrived}
                          onChange={(e) => setLine(l.key, { arrived: Math.min(l.ids.length, Math.max(0, parseInt(e.target.value) || 0)) })}
                        />
                        <button
                          type="button"
                          className="h-8 w-8 rounded-lg border border-slate-300 disabled:opacity-30 dark:border-slate-700"
                          disabled={l.arrived >= l.ids.length}
                          onClick={() => setLine(l.key, { arrived: Math.min(l.ids.length, l.arrived + 1) })}
                          aria-label="One more"
                        >
                          +
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div>
          <div className="mb-1 text-sm font-medium">Extra items not on the list</div>
          {extras.map((e) => {
            const m = models.find((x) => x.id === e.modelId)
            return (
              <div key={e.key} className="mb-2 flex flex-wrap items-start gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <div className="min-w-48 flex-1">
                  <ModelPicker models={models} value={e.modelId} onChange={(id) => setExtra(e.key, { modelId: id, size: '' })} />
                </div>
                {m && m.sizes.length > 0 && (
                  <select className={`${inputClass} w-32`} value={e.size} onChange={(ev) => setExtra(e.key, { size: ev.target.value })}>
                    <option value="">Size…</option>
                    {m.sizes.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                )}
                <input
                  type="number"
                  min={1}
                  aria-label="Quantity"
                  className={`${inputClass} w-20`}
                  value={e.qty}
                  onChange={(ev) => setExtra(e.key, { qty: parseInt(ev.target.value) || 0 })}
                />
                <Button variant="ghost" aria-label="Remove" onClick={() => setExtras((es) => es.filter((x) => x.key !== e.key))}>
                  ×
                </Button>
              </div>
            )
          })}
          <Button size="sm" onClick={() => setExtras((es) => [...es, { key: nextKey++, modelId: '', size: '', qty: 1 }])}>
            + Add extra item
          </Button>
        </div>

        <Field label="Location (optional)" hint="Where the stock has been put, e.g. Yard B. Applied to everything checked in.">
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>

        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
          Expected <strong>{expected}</strong> · Adding <strong className="text-green-700 dark:text-green-400">{arrived}</strong> to stock
          {short > 0 && (
            <>
              {' '}
              · <strong className="text-amber-700 dark:text-amber-400">{short} short</strong>
            </>
          )}
        </div>

        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || arrived === 0 && short === 0} onClick={approve}>
            {busy ? 'Saving…' : isManager ? 'Approve and add to stock' : 'Submit for approval'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
