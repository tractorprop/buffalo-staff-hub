import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Model, WaitlistEntry } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass, today } from '../../components/ui'
import { useAuth } from '../../auth/AuthProvider'
import { ModelPicker } from '../../components/ModelPicker'
import { modelLabel } from '../../lib/modelLabel'

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
  // The machines wanted. A new customer can want several: one waiting-list entry is saved per machine.
  const [picks, setPicks] = useState<{ key: number; modelId: string; size: string }[]>([
    { key: 0, modelId: entry?.model_id ?? defaultModelId ?? '', size: entry?.size_wanted ?? '' },
  ])
  const [depositFor, setDepositFor] = useState(0) // which machine the deposit is for (index in picks)
  const updatePick = (key: number, change: Partial<{ modelId: string; size: string }>) =>
    setPicks((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)))
  const chosen = picks.filter((p) => p.modelId)
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)


  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!chosen.length) return setError('Please choose the machine the customer wants.')
    if (new Set(chosen.map((p) => p.modelId)).size < chosen.length) return setError('The same machine is chosen twice.')
    if (!phone.trim() && !email.trim()) return setError('Please enter a phone number or an email so we can contact them.')
    const amountValue = amount.trim() === '' ? null : Number(amount.replace(/[£,\s]/g, ''))
    if (deposit && !(amountValue !== null && amountValue > 0))
      return setError('Enter the deposit amount (more than £0), or untick "Deposit received" if no deposit has been paid.')
    setBusy(true)
    setError('')
    const rows = chosen.map((p, i) => {
      const row: Record<string, unknown> = {
        customer_name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        model_id: p.modelId,
        size_wanted: p.size || null,
        notes: notes.trim() || null,
      }
      // Only send deposit fields once the database has them (or a deposit is being recorded).
      // A deposit goes on one machine only, so it isn't counted twice.
      const paid = deposit && i === Math.min(depositFor, chosen.length - 1)
      if (deposit || entry?.deposit_paid !== undefined) {
        row.deposit_paid = paid
        row.deposit_amount = paid ? amountValue : null
        row.deposit_date = paid ? depositDate || null : null
        row.deposit_by = paid ? ((entry?.deposit_paid ? entry.deposit_by : profile?.id) ?? null) : null
      }
      return row
    })
    // Editing: the first machine is this entry; any machines added become new entries for the same customer.
    let { error } = entry ? await supabase.from('waitlist').update(rows[0]).eq('id', entry.id) : await supabase.from('waitlist').insert(rows)
    if (!error && entry && rows.length > 1) ({ error } = await supabase.from('waitlist').insert(rows.slice(1)))
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
        <div>
          <div className="text-sm font-medium">Machines wanted *</div>
          <div className="mt-1 space-y-2">
            {picks.map((p) => {
              const m = models.find((x) => x.id === p.modelId)
              return (
                <div key={p.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <div className="min-w-48 flex-1">
                    <ModelPicker models={models} value={p.modelId} onChange={(id) => updatePick(p.key, { modelId: id, size: '' })} />
                  </div>
                  {m && m.sizes.length > 0 && (
                    <select className={inputClass} style={{ width: '9rem' }} value={p.size} onChange={(e) => updatePick(p.key, { size: e.target.value })} aria-label="Size wanted">
                      <option value="">Any size</option>
                      {m.sizes.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  )}
                  {picks.length > 1 && !(entry && p.key === 0) && (
                    <Button size="sm" variant="danger" className="font-bold" onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))}>
                      ✕ Remove
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <Button size="sm" className="mt-2" onClick={() => setPicks((ps) => [...ps, { key: Date.now(), modelId: '', size: '' }])}>
            + Add another machine
          </Button>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            The customer appears under each machine, and is flagged when any of them is back in stock.
          </p>
        </div>
        <div className={`rounded-lg border-2 p-3 ${deposit ? 'border-green-600 bg-green-50 dark:bg-green-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-green-600" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} />
            💷 Deposit received
          </label>
          {entry?.deposit_paid && !deposit && (
            <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">The deposit will be removed when you save.</p>
          )}
          {!deposit && !entry?.deposit_paid && <p className="mt-1 text-xs text-slate-500">Only tick this once the customer has actually paid.</p>}
          {deposit && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Amount (£) *">
                <input inputMode="decimal" className={inputClass} placeholder="e.g. 500" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              {chosen.length > 1 && (
                <Field label="Deposit is for">
                  <select className={inputClass} value={Math.min(depositFor, chosen.length - 1)} onChange={(e) => setDepositFor(Number(e.target.value))}>
                    {chosen.map((p, i) => (
                      <option key={p.key} value={i}>
                        {modelLabel(models.find((m) => m.id === p.modelId), models, p.size || null)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
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
