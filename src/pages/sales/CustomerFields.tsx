import { Field, inputClass } from '../../components/ui'
import type { Customer } from './invoiceDocument'

export const emptyCustomer: Customer = { name: '', address: '', phone: '', email: '' }

// Customer details go onto the PDF. Only the name is saved (for the invoice history).
export function CustomerFields({ value, onChange }: { value: Customer; onChange: (c: Customer) => void }) {
  const set = (k: keyof Customer) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer name *">
          <input className={inputClass} value={value.name} onChange={set('name')} autoComplete="off" />
        </Field>
        <Field label="Phone">
          <input type="tel" className={inputClass} value={value.phone} onChange={set('phone')} autoComplete="off" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Address">
          <textarea className={inputClass} rows={2} value={value.address} onChange={set('address')} autoComplete="off" />
        </Field>
        <Field label="Email">
          <input type="email" className={inputClass} value={value.email} onChange={set('email')} autoComplete="off" />
        </Field>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">🔒 Only the customer's name is saved (for the invoice history). Address, phone and email only go on the PDF.</p>
    </div>
  )
}
