import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Machine, Model } from '../../lib/types'
import { modelLabel } from '../../lib/modelLabel'
import { Button, ErrorText, Modal, inputClass } from '../../components/ui'

// Founder only: set how many of a model (per size) are in stock right now. The hub adds or
// removes in-stock items to match. Items with no serial number are removed first.
export function SetStockCount({ model, models, machines, onClose, onSaved }: { model: Model; models: Model[]; machines: Machine[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const sizes: (string | null)[] = model.sizes.length ? model.sizes : [null]
  const inStock = (size: string | null) => machines.filter((m) => m.model_id === model.id && m.status === 'in_stock' && (m.size ?? null) === size)
  const [counts, setCounts] = useState(sizes.map((s) => String(inStock(s).length)))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    const targets = counts.map((c) => (c.trim() === '' ? NaN : Number(c)))
    if (targets.some((n) => !Number.isInteger(n) || n < 0 || n > 2000)) return setError('Enter a whole number (0 or more) for each size.')
    setBusy(true)
    setError('')
    const add: Record<string, unknown>[] = []
    const remove: string[] = []
    sizes.forEach((size, i) => {
      const now = inStock(size)
      const diff = targets[i] - now.length
      if (diff > 0) for (let k = 0; k < diff; k++) add.push({ model_id: model.id, size, status: 'in_stock', stock_reference: 'Stock count' })
      if (diff < 0)
        remove.push(
          ...[...now]
            .sort((a, b) => Number(!!a.serial_number) - Number(!!b.serial_number) || b.created_at.localeCompare(a.created_at))
            .slice(0, -diff)
            .map((m) => m.id),
        )
    })
    if (add.length) {
      let res = await supabase!.from('machines').insert(add)
      // Before 12-stock-entry-reference.sql there's no reference column: save without it.
      if (res.error && /stock_reference/.test(res.error.message)) res = await supabase!.from('machines').insert(add.map(({ stock_reference: _, ...r }) => r))
      if (res.error) {
        setBusy(false)
        return setError(friendlyError(res.error))
      }
    }
    if (remove.length) {
      const { error } = await supabase!.from('machines').delete().in('id', remove)
      if (error) {
        setBusy(false)
        return setError(friendlyError(error))
      }
    }
    setBusy(false)
    onSaved(
      add.length || remove.length
        ? `Stock count saved for ${modelLabel(model, models)}: ${[add.length && `${add.length} added`, remove.length && `${remove.length} removed`].filter(Boolean).join(', ')}.`
        : 'No change: the numbers were already right.',
    )
  }

  return (
    <Modal title={`📦 Set stock count: ${modelLabel(model, models)}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Type how many are <strong>in stock right now</strong>. The hub adds or removes stock to match, and records it in the Machines history. Machines on the way and sold
          aren't affected.
        </p>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
          {sizes.map((size, i) => {
            const now = inStock(size).length
            const target = Number(counts[i])
            const diff = Number.isInteger(target) ? target - now : 0
            return (
              <li key={size ?? '-'} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="flex-1 font-medium">{size ?? 'In stock'}</span>
                <span className="text-xs text-slate-500">now {now}</span>
                <input
                  type="number"
                  min={0}
                  max={2000}
                  inputMode="numeric"
                  aria-label={`In stock${size ? ` (${size})` : ''}`}
                  className={`${inputClass} w-24`}
                  value={counts[i]}
                  autoFocus={i === 0}
                  onChange={(e) => setCounts((c) => c.map((v, k) => (k === i ? e.target.value : v)))}
                />
                <span className={`w-12 text-right text-xs font-semibold ${diff > 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                  {diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : '–'}
                </span>
              </li>
            )
          })}
        </ul>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save stock count'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
