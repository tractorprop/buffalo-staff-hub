import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { CompanySettings } from '../../lib/types'
import { Button, ErrorText, Field, inputClass } from '../../components/ui'

// Suggested starting values from the existing Buffalo Machines invoice (public company details only;
// bank details are typed in here and stored in the database, never in the code).
const suggested: Partial<CompanySettings> = {
  company_name: 'BUFFALO MACHINES',
  address: 'Unit 1, Hendon Barn, Ashford, Kent, TN26 3QP',
  phone: '01622 371145',
  email: 'sales@buffalomachines.co.uk',
  website: 'www.buffalomachines.co.uk',
  bank_name: 'Buffalo Machines Limited',
  vat_number: '454304805',
  company_number: '15271611',
  terms: "Please see our website to read the terms\nand conditions under our 'Policies' section",
}

const fields: { key: keyof CompanySettings; label: string; multiline?: boolean; group: string }[] = [
  { key: 'company_name', label: 'Company name', group: 'Top of the invoice' },
  { key: 'address', label: 'Address', group: 'Top of the invoice' },
  { key: 'phone', label: 'Phone', group: 'Top of the invoice' },
  { key: 'email', label: 'Email', group: 'Top of the invoice' },
  { key: 'bank_name', label: 'Bank / account name', group: 'Payment method' },
  { key: 'account_number', label: 'Account number', group: 'Payment method' },
  { key: 'sort_code', label: 'Sort code', group: 'Payment method' },
  { key: 'terms', label: 'Terms', multiline: true, group: 'Bottom of the invoice' },
  { key: 'website', label: 'Website', group: 'Bottom of the invoice' },
  { key: 'vat_number', label: 'VAT number', group: 'Bottom of the invoice' },
  { key: 'company_number', label: 'Company number', group: 'Bottom of the invoice' },
]

export function CompanyDetails({ company }: { company: CompanySettings | null }) {
  const [form, setForm] = useState<CompanySettings>(() => {
    const base = Object.fromEntries(fields.map((f) => [f.key, company?.[f.key] ?? ''])) as unknown as CompanySettings
    const empty = fields.every((f) => !company?.[f.key])
    return empty ? { ...base, ...suggested } : base
  })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    const row = Object.fromEntries(fields.map((f) => [f.key, (form[f.key] ?? '').trim() || null]))
    const { error } = await supabase!.from('company_settings').update(row).eq('id', 1)
    setBusy(false)
    if (error) return setError(friendlyError(error))
    setSaved(true)
  }

  const groups = [...new Set(fields.map((f) => f.group))]
  return (
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        These details print on every invoice. They are stored in the database (behind the login), not in the website code.
      </p>
      {groups.map((g) => (
        <section key={g} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-semibold">{g}</h2>
          {fields
            .filter((f) => f.group === g)
            .map((f) => (
              <Field key={f.key} label={f.label}>
                {f.multiline ? (
                  <textarea className={inputClass} rows={2} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                ) : (
                  <input className={inputClass} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                )}
              </Field>
            ))}
        </section>
      ))}
      <ErrorText>{error}</ErrorText>
      {saved && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">✓ Company details saved.</p>}
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save company details'}
      </Button>
    </form>
  )
}
