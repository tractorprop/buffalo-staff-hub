import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { MachineStatus, Model } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'

interface Line {
  key: number
  modelId: string
  size: string
  qty: number
}

let nextKey = 1
const newLine = (): Line => ({ key: nextKey++, modelId: '', size: '', qty: 1 })

// Add a whole container in one go: one line per model (and size), with a quantity.
export function ContainerForm({ models, onClose }: { models: Model[]; onClose: () => void }) {
  const [containerRef, setContainerRef] = useState('')
  const [eta, setEta] = useState('')
  const [arrived, setArrived] = useState(false)
  const [location, setLocation] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (key: number, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)))
  const total = lines.reduce((n, l) => n + (l.modelId ? l.qty : 0), 0)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const filled = lines.filter((l) => l.modelId)
    if (!filled.length) return setError('Add at least one model to the container.')
    for (const l of filled) {
      const m = models.find((x) => x.id === l.modelId)!
      if (m.sizes.length && !l.size) return setError(`Choose a size for ${m.model_number}. For more than one size, add a line per size.`)
      if (!(l.qty >= 1 && l.qty <= 500)) return setError(`Check the quantity for ${m.model_number}.`)
    }
    const status: MachineStatus = arrived ? 'in_stock' : 'en_route'
    const rows = filled.flatMap((l) =>
      Array.from({ length: l.qty }, () => ({
        model_id: l.modelId,
        size: l.size || null,
        status,
        container_ref: containerRef.trim(),
        eta: eta || null,
        location: location.trim() || null,
      })),
    )
    setBusy(true)
    setError('')
    const { error } = await supabase.from('machines').insert(rows)
    setBusy(false)
    if (error) return setError(friendlyError(error))
    onClose()
  }

  return (
    <Modal title="Add container" onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Container reference *">
            <input className={inputClass} required autoFocus value={containerRef} onChange={(e) => setContainerRef(e.target.value)} />
          </Field>
          <Field label="Expected arrival (ETA)">
            <input type="date" className={inputClass} value={eta} onChange={(e) => setEta(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <div className="grid grid-cols-2 gap-2">
              {[
                [false, 'On the way'],
                [true, 'Already arrived'],
              ].map(([v, label]) => (
                <button
                  type="button"
                  key={String(v)}
                  onClick={() => setArrived(v as boolean)}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                    arrived === v ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-500' : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {label as string}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Location (optional)">
            <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">What's in the container</div>
          <div className="space-y-2">
            {lines.map((l) => {
              const m = models.find((x) => x.id === l.modelId)
              return (
                <div key={l.key} className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                  <div className="min-w-48 flex-1">
                    <ModelPicker models={models} value={l.modelId} onChange={(id) => update(l.key, { modelId: id, size: '' })} />
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
                    min={1}
                    max={500}
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
              )
            })}
          </div>
          <Button size="sm" className="mt-2" onClick={() => setLines((ls) => [...ls, newLine()])}>
            + Add another model
          </Button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Serial numbers can be added later by editing each machine.
        </p>
        <ErrorText>{error}</ErrorText>
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm text-slate-500">
            {total} machine{total === 1 ? '' : 's'} in total
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add container'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
