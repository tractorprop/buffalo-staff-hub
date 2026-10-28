import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Machine, MachineStatus, Model } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass, statusLabel, today } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'

export function MachineForm({
  models,
  machine,
  defaultModelId,
  onClose,
}: {
  models: Model[]
  machine?: Machine
  defaultModelId?: string
  onClose: () => void
}) {
  const [modelId, setModelId] = useState(machine?.model_id ?? defaultModelId ?? '')
  const [size, setSize] = useState(machine?.size ?? '')
  const [serial, setSerial] = useState(machine?.serial_number ?? '')
  const [status, setStatus] = useState<MachineStatus>(machine?.status ?? 'in_stock')
  const [containerRef, setContainerRef] = useState(machine?.container_ref ?? '')
  const [eta, setEta] = useState(machine?.eta ?? '')
  const [location, setLocation] = useState(machine?.location ?? '')
  const [soldDate, setSoldDate] = useState(machine?.sold_date ?? '')
  const [notes, setNotes] = useState(machine?.notes ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const model = models.find((m) => m.id === modelId)
  const hasSizes = (model?.sizes.length ?? 0) > 0

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!modelId) return setError('Please choose a model.')
    if (hasSizes && !size) return setError('Please choose a size.')
    setBusy(true)
    setError('')
    const row = {
      model_id: modelId,
      size: hasSizes ? size : null,
      serial_number: serial.trim() || null,
      status,
      container_ref: containerRef.trim() || null,
      eta: status === 'en_route' ? eta || null : machine?.eta ?? null,
      location: location.trim() || null,
      sold_date: status === 'sold' ? soldDate || today() : null,
      notes: notes.trim() || null,
    }
    const { error } = machine
      ? await supabase.from('machines').update(row).eq('id', machine.id)
      : await supabase.from('machines').insert(row)
    setBusy(false)
    if (error) return setError(friendlyError(error))
    onClose()
  }

  return (
    <Modal title={machine ? 'Edit machine' : 'Add machine'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Model *">
          <ModelPicker
            models={models}
            value={modelId}
            autoFocus={!modelId}
            onChange={(id) => {
              setModelId(id)
              setSize('')
            }}
          />
        </Field>
        {hasSizes && (
          <Field label="Size *">
            <select className={inputClass} required value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="">Choose a size…</option>
              {model!.sizes.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Status">
          <div className="grid grid-cols-3 gap-2">
            {(['in_stock', 'en_route', 'sold'] as MachineStatus[]).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                  status === s
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-500'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                {statusLabel[s]}
              </button>
            ))}
          </div>
        </Field>
        {status === 'en_route' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Container reference">
              <input className={inputClass} value={containerRef} onChange={(e) => setContainerRef(e.target.value)} />
            </Field>
            <Field label="Expected arrival (ETA)">
              <input type="date" className={inputClass} value={eta} onChange={(e) => setEta(e.target.value)} />
            </Field>
          </div>
        )}
        {status === 'sold' && (
          <Field label="Date sold">
            <input type="date" className={inputClass} value={soldDate || today()} onChange={(e) => setSoldDate(e.target.value)} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Serial number">
            <input className={inputClass} value={serial} onChange={(e) => setSerial(e.target.value)} />
          </Field>
          <Field label="Location">
            <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
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
