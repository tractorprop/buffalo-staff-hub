import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Model, WaitlistEntry } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass, today } from '../../components/ui'
import { useAuth } from '../../auth/AuthProvider'
import { ModelPicker } from '../../components/ModelPicker'

export function WaitlistForm({
  models,
  entry,
  defaultModelId,
  deposit: startWithDeposit = false,
  onClose,
}: {
  models: Model[]
  entry?: WaitlistEntry
  defaultModelId?: string
  deposit?: boolean // open with "Deposit received" ticked
  onClose: () => void
}) {
  const { profile } = useAuth()
  const [deposit, setDeposit] = useState(!!entry?.deposit_paid || startWithDeposit)
  const [amount, setAmount] = useState(entry?.deposit_amount != null ? String(entry.deposit_amount) : '')
  const [depositDate, setDepositDate] = useState(entry?.deposit_date ?? today())
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
    const amountValue = amount.trim() === '' ? null : Number(amount.replace(/[£,\s]/g, ''))
    if (deposit && amountValue !== null && !(amountValue >= 0)) return setError('Check the deposit amount.')
    setBusy(true)
    setError('')
    const row: Record<string, unknown> = {
      customer_name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      model_id: modelId,
      size_wanted: size || null,
      notes: notes.trim() || null,
    }
    // Only send deposit fields once the database has them (or a deposit is being recorded).
    if (deposit || entry?.deposit_paid !== undefined) {
      row.deposit_paid = deposit
      row.deposit_amount = deposit ? amountValue : null
      row.deposit_date = deposit ? depositDate || null : null
      row.deposit_by = deposit ? ((entry?.deposit_paid ? entry.deposit_by : profile?.id) ?? null) : null
    }
    const { error } = entry
      ? await supabase.from('waitlist').update(row).eq('id', entry.id)
      : await supabase.from('waitlist').insert(row)
    setBusy(false)
    if (error)
      return setError(/deposit/.test(error.message) ? 'Deposits are not switched on yet. The founder needs to run database/20-waitlist-deposits.sql in Supabase.' : friendlyError(error))
    onClose()
  }

  return (
    <Modal title={entry ? 'Edit waiting customer' : deposit ? '💷 Add deposit customer' : 'Add waiting customer'} onClose={onClose}>
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
        <div className={`rounded-lg border-2 p-3 ${deposit ? 'border-green-600 bg-green-50 dark:bg-green-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-green-600" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} />
            💷 Deposit received
          </label>
          {deposit && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Amount (£)" hint="Optional">
                <input inputMode="decimal" className={inputClass} placeholder="e.g. 500" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Date received">
                <input type="date" className={inputClass} value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
              </Field>
            </div>
          )}
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
