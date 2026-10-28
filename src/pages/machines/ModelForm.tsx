import { useMemo, useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Model } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass } from '../../components/ui'

export function ModelForm({
  model,
  models,
  accessoryFor,
  onClose,
}: {
  model?: Model
  models: Model[]
  accessoryFor?: string // pre-fill as an accessory for this machine model
  onClose: () => void
}) {
  const [kind, setKind] = useState<'machine' | 'accessory'>(model?.kind ?? (accessoryFor ? 'accessory' : 'machine'))
  const [fits, setFits] = useState<string[]>(model?.fits_models ?? (accessoryFor ? [accessoryFor] : []))
  const [fitsSearch, setFitsSearch] = useState('')
  const machineModels = useMemo(
    () => models.filter((m) => m.kind !== 'accessory' && m.id !== model?.id),
    [models, model],
  )
  const [modelNumber, setModelNumber] = useState(model?.model_number ?? '')
  const [name, setName] = useState(model?.name ?? '')
  const [sizes, setSizes] = useState((model?.sizes ?? []).join(', '))
  const [notes, setNotes] = useState(model?.notes ?? '')
  const [reorder, setReorder] = useState(model?.reorder_level != null ? String(model.reorder_level) : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const sizeList = [...new Set(sizes.split(',').map((s) => s.trim()).filter(Boolean))]
    const row: Record<string, unknown> = {
      model_number: modelNumber.trim(),
      name: name.trim() || null,
      sizes: sizeList,
      notes: notes.trim() || null,
    }
    // Only send machine/accessory once the database has those columns (or an accessory is being added).
    if (kind === 'accessory' || model?.kind !== undefined) {
      row.kind = kind
      row.fits_models = kind === 'accessory' ? fits : []
    }
    // Only send the low-stock level once the database has that column (or one was typed).
    if (reorder !== '' || model?.reorder_level !== undefined) row.reorder_level = reorder === '' ? null : Math.max(0, parseInt(reorder) || 0)
    const { error } = model
      ? await supabase.from('models').update(row).eq('id', model.id)
      : await supabase.from('models').insert(row)
    setBusy(false)
    if (error) {
      setError(
        error.code === '23505'
          ? `Model number "${row.model_number}" already exists.`
          : /fits_models|'kind'|\bkind\b/.test(error.message)
            ? 'Accessories are not switched on yet. Run database/04-accessories-and-task-rules.sql in Supabase first.'
            : /reorder_level/.test(error.message)
            ? 'Low stock levels are not switched on yet. Run database/03-calendar-and-low-stock.sql in Supabase first.'
            : friendlyError(error),
      )
      return
    }
    onClose()
  }

  return (
    <Modal title={model ? `Edit ${model.model_number}` : kind === 'accessory' ? 'Add accessory' : 'Add model'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['machine', 'Machine'],
              ['accessory', 'Accessory'],
            ] as const
          ).map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                kind === k ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-500' : 'border-slate-300 dark:border-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label={kind === 'accessory' ? 'Part / model number *' : 'Model number *'}>
          <input className={inputClass} required autoFocus value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
        </Field>
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {kind === 'accessory' && (
          <div>
            <div className="text-sm font-medium">Fits which machines?</div>
            <input className={`${inputClass} mt-1`} placeholder="Search machines…" value={fitsSearch} onChange={(e) => setFitsSearch(e.target.value)} />
            <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              {machineModels.length === 0 && <p className="text-sm text-slate-500">No machine models yet.</p>}
              {machineModels
                .filter((m) => {
                  const q = fitsSearch.trim().toLowerCase()
                  return !q || fits.includes(m.id) || `${m.model_number} ${m.name ?? ''}`.toLowerCase().includes(q)
                })
                .map((m) => (
                  <label key={m.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={fits.includes(m.id)}
                      onChange={(e) => setFits((f) => (e.target.checked ? [...f, m.id] : f.filter((x) => x !== m.id)))}
                    />
                    <span className="font-medium">{m.model_number}</span>
                    {m.name && <span className="text-slate-500">{m.name}</span>}
                  </label>
                ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">{fits.length} selected</p>
          </div>
        )}
        <Field label="Sizes" hint="Separate with commas, e.g. Small, Medium, Large. Leave empty if this model comes in one size.">
          <input className={inputClass} value={sizes} onChange={(e) => setSizes(e.target.value)} />
        </Field>
        <Field label="Low stock level" hint="The dashboard warns when the number in stock is at or below this. Leave empty for no warning.">
          <input type="number" min={0} inputMode="numeric" className={inputClass} value={reorder} onChange={(e) => setReorder(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
