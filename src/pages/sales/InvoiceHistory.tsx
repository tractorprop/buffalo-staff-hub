import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { personName, useProfiles } from '../../lib/useProfiles'
import { invoiceNumber, money } from '../../lib/money'
import type { Invoice } from '../../lib/types'
import { Button, Confirm, Empty, ErrorText, Modal, Toast, fmtDate, inputClass } from '../../components/ui'
import { CustomerFields, emptyCustomer } from './CustomerFields'
import { invoiceHtml, openInvoiceWindow, showInvoice } from './invoiceDocument'
import type { SalesData } from './SalesPage'

export function InvoiceHistory({ data }: { data: SalesData }) {
  const { isManager } = useAuth()
  const profiles = useProfiles()
  const [search, setSearch] = useState('')
  const [reprint, setReprint] = useState<Invoice | null>(null)
  const [customer, setCustomer] = useState(emptyCustomer)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<Invoice | null>(null)
  const [toast, setToast] = useState('')

  const q = search.trim().toLowerCase().replace(/^bm-?/, '')
  const list = data.invoices.filter(
    (i) => !q || String(i.number).includes(q) || i.lines.some((l) => l.description.toLowerCase().includes(q)),
  )

  function print() {
    if (!reprint || !data.company) return
    if (!customer.name.trim()) return setError('Enter the customer name.')
    const win = openInvoiceWindow()
    if (!win) return setError('Your browser blocked the invoice window. Allow pop-ups for this site and try again.')
    showInvoice(win, invoiceHtml({ number: reprint.number, date: reprint.invoice_date, customer, lines: reprint.lines, company: data.company }))
    setReprint(null)
  }

  async function remove(inv: Invoice) {
    const { error } = await supabase!.from('invoices').delete().eq('id', inv.id)
    if (error) setToast(friendlyError(error))
    setConfirm(null)
  }

  return (
    <div className="space-y-3">
      <input className={inputClass} placeholder="Search invoice number (e.g. 1001) or item…" value={search} onChange={(e) => setSearch(e.target.value)} />
      {list.length === 0 ? (
        <Empty title={search ? 'No invoices match' : 'No invoices yet'}>{!search && 'Create one on the New invoice tab.'}</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {list.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-bold">{invoiceNumber(i.number)}</span>
                  <span className="text-slate-500">{fmtDate(i.invoice_date)}</span>
                  <span className="font-semibold">{money(i.total)}</span>
                  <span className="text-xs text-slate-500">by {personName(profiles, i.created_by)}</span>
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {i.lines.map((l) => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.description}`).join(', ')}
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  onClick={() => {
                    setReprint(i)
                    setCustomer(emptyCustomer)
                    setError('')
                  }}
                >
                  🖨️ Reprint
                </Button>
                {isManager && (
                  <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setConfirm(i)}>
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">Showing the latest 500 invoices. Customer details are never stored, so a reprint asks for them again.</p>

      {reprint && (
        <Modal title={`Reprint ${invoiceNumber(reprint.number)}`} onClose={() => setReprint(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Same number, date, items and totals as the original ({money(reprint.total)}). Enter the customer details again.
            </p>
            <CustomerFields value={customer} onChange={setCustomer} />
            <ErrorText>{error}</ErrorText>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setReprint(null)}>Cancel</Button>
              <Button variant="primary" onClick={print}>
                Open PDF
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {confirm && (
        <Confirm
          title={`Delete ${invoiceNumber(confirm.number)}?`}
          message="The record is removed from the history. Its number is not reused. Only do this for an invoice created by mistake."
          onConfirm={() => remove(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {toast && <Toast onClose={() => setToast('')}>{toast}</Toast>}
    </div>
  )
}
