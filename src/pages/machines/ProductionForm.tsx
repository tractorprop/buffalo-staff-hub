import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Model, ProductionOrder } from '../../lib/types'
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

// Founder: add or change a production order (what's being built at the factory, and when it's due).
export function ProductionForm({ order, models, onClose, onSaved }: { order?: ProductionOrder; models: Model[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [ref, setRef] = useState(order?.ref ?? '')
  const [readyDate, setReadyDate] = useState(order?.ready_date ?? '')
  const [eta, setEta] = useState(order?.eta ?? '')
  const [notes, setNotes] = useState(order?.notes ?? '')
  const [lines, setLines] = useState<Line[]>(
    order?.items.length ? order.items.map((i) => ({ key: nextKey++, modelId: i.model_id, size: i.size ?? '', qty: i.qty })) : [newLine()],
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (key: number, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)))
  const total = lines.reduce((n, l) => n + (l.modelId ? l.qty : 0), 0)

  async function save(e: FormEvent) {
    e.preventDefault()
    const filled = lines.filter((l) => l.modelId)
    if (!filled.length) return setError('Add at least one model.')
    for (const l of filled) {
      const m = models.find((x) => x.id === l.modelId)!
      if (m.sizes.length && !l.size) return setError(`Choose a size for ${m.model_number}. For more than one size, add a line per size.`)
      if (!(l.qty >= 1 && l.qty <= 500)) return setError(`Check the quantity for ${m.model_number}.`)
    }
    // One line per model and size.
    const merged = new Map<string, { model_id: string; size: string | null; qty: number }>()
    for (const l of filled) {
      const k = `${l.modelId}|${l.size}`
      const item = merged.get(k) ?? { model_id: l.modelId, size: l.size || null, qty: 0 }
      item.qty += l.qty
      merged.set(k, item)
    }
    const row = { ref: ref.trim(), ready_date: readyDate || null, eta: eta || null, notes: notes.trim() || null, items: [...merged.values()] }
    setBusy(true)
    setError('')
    const { error } = order ? await supabase!.from('production_orders').update(row).eq('id', order.id) : await supabase!.from('production_orders').insert(row)
    setBusy(false)
    if (error)
      return setError(
        /production_orders/.test(error.message) ? 'Production orders are not switched on yet. Run database/18-production-orders.sql in Supabase first.' : friendlyError(error),
      )
    onSaved(order ? `Production order ${row.ref} updated.` : `Production order ${row.ref} added.`)
  }

  return (
    <Modal title={order ? `Edit production order ${order.ref}` : '🏭 Add production order'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Order reference *" hint="e.g. the factory's order or PI number">
            <input className={inputClass} required autoFocus maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
          <Field label="Leaves the factory">
            <input type="date" className={inputClass} value={readyDate} onChange={(e) => setReadyDate(e.target.value)} />
          </Field>
          <Field label="ETA in the UK">
            <input type="date" className={inputClass} value={eta} onChange={(e) => setEta(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">What's being made</div>
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
                  <Button variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
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

        <Field label="Notes">
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm text-slate-500">
            {total} item{total === 1 ? '' : 's'} in total
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !ref.trim()}>
            {busy ? 'Saving…' : order ? 'Save changes' : 'Add production order'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
