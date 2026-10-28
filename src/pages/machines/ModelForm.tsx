import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Model } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass } from '../../components/ui'

export function ModelForm({ model, onClose }: { model?: Model; onClose: () => void }) {
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
          : /reorder_level/.test(error.message)
            ? 'Low stock levels are not switched on yet. Run database/03-calendar-and-low-stock.sql in Supabase first.'
            : friendlyError(error),
      )
      return
    }
    onClose()
  }

  return (
    <Modal title={model ? `Edit model ${model.model_number}` : 'Add model'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Model number *">
          <input className={inputClass} required autoFocus value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
        </Field>
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
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
