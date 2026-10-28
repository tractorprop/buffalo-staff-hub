import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Model, WaitlistEntry } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'

export function WaitlistForm({
  models,
  entry,
  defaultModelId,
  onClose,
}: {
  models: Model[]
  entry?: WaitlistEntry
  defaultModelId?: string
  onClose: () => void
}) {
  const [name, setName] = useState(entry?.customer_name ?? '')
  const [phone, setPhone] = useState(entry?.phone ?? '')
  const [email, setEmail] = useState(entry?.email ?? '')
  const [modelId, setModelId] = useState(entry?.model_id ?? defaultModelId ?? '')
  const [size, setSize] = useState(entry?.size_wanted ?? '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const model = models.find((m) => m.id === modelId)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!modelId) return setError('Please choose the model the customer wants.')
    if (!phone.trim() && !email.trim()) return setError('Please enter a phone number or an email so we can contact them.')
    setBusy(true)
    setError('')
    const row = {
      customer_name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      model_id: modelId,
      size_wanted: size || null,
      notes: notes.trim() || null,
    }
    const { error } = entry
      ? await supabase.from('waitlist').update(row).eq('id', entry.id)
      : await supabase.from('waitlist').insert(row)
    setBusy(false)
    if (error) return setError(friendlyError(error))
    onClose()
  }

  return (
    <Modal title={entry ? 'Edit waiting customer' : 'Add waiting customer'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Customer name *">
          <input className={inputClass} required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            <input type="tel" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="Model wanted *">
          <ModelPicker
            models={models}
            value={modelId}
            onChange={(id) => {
              setModelId(id)
              setSize('')
            }}
          />
        </Field>
        {model && model.sizes.length > 0 && (
          <Field label="Size wanted" hint="Optional. For information only: the customer is alerted when any size of this model is in stock.">
            <select className={inputClass} value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="">Any / not sure</option>
              {model.sizes.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
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
