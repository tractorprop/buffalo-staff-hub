import { useMemo, useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { isMachine, modelLabel } from '../../lib/modelLabel'
import { invoiceNumber, invoiceTotals, lineTotals, money, priceOf } from '../../lib/money'
import type { Invoice, InvoiceLine, Model } from '../../lib/types'
import { Button, ErrorText, Field, inputClass, today } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'
import { CustomerFields, emptyCustomer } from './CustomerFields'
import { invoiceHtml, openInvoiceWindow, showInvoice, type Customer } from './invoiceDocument'
import type { SalesData } from './SalesPage'

interface Line extends InvoiceLine {
  key: number
  noPrice?: boolean
}

let nextKey = 1
const categories = ['Construction', 'Forestry', 'Agriculture'] as const

export function NewInvoice({ data }: { data: SalesData }) {
  const { models, company } = data
  const [customer, setCustomer] = useState<Customer>(emptyCustomer)
  const [date, setDate] = useState(today())
  const [lines, setLines] = useState<Line[]>([])
  const [category, setCategory] = useState<string>('Construction')
  const [machineId, setMachineId] = useState('')
  const [picked, setPicked] = useState<Record<string, number>>({}) // "accessoryId|size" -> qty
  const [includeMachine, setIncludeMachine] = useState(true)
  const [machineSize, setMachineSize] = useState('')
  const [sizeFor, setSizeFor] = useState<Model | null>(null) // item from "find any item" that needs a size
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [delivery, setDelivery] = useState('') // required, inc VAT; 0 for collection
  const [discount, setDiscount] = useState('') // optional, inc VAT; left off the invoice when 0
  const [done, setDone] = useState<Invoice | null>(null)

  const machines = useMemo(
    () =>
      models
        .filter(isMachine)
        .filter((m) => category === 'all' || m.category === category || (category === 'none' && !m.category))
        .sort((a, b) => a.model_number.localeCompare(b.model_number, undefined, { numeric: true })),
    [models, category],
  )
  const machine = models.find((m) => m.id === machineId)
  // One row per accessory, or per size for accessories that come in sizes.
  const accessories = useMemo(
    () =>
      models
        .filter((m) => m.kind === 'accessory' && (m.fits_models ?? []).includes(machineId))
        .sort((a, b) => a.model_number.localeCompare(b.model_number))
        .flatMap((m) => (m.sizes.length ? m.sizes.map((size) => ({ m, size })) : [{ m, size: null as string | null }])),
    [models, machineId],
  )
  const pickKey = (id: string, size: string | null) => `${id}|${size ?? ''}`
  const hasUncategorised = models.some((m) => isMachine(m) && !m.category)

  const describe = (m: Model) => (isMachine(m) && m.name ? `${m.name} (${m.model_number})` : modelLabel(m, models))
  const toLine = (m: Model, qty = 1, size: string | null = null): Line => {
    const price = priceOf(m, size)
    return {
      key: nextKey++,
      description: size ? `${describe(m)} ${size}` : describe(m),
      qty,
      unit_price_inc: price ?? 0,
      vat_rate: 0.2,
      noPrice: price == null,
    }
  }

  function addSelection() {
    const add: Line[] = []
    if (machine && includeMachine) {
      if (machine.sizes.length && !machineSize) return setError(`Choose a size for ${machine.model_number}.`)
      add.push(toLine(machine, 1, machine.sizes.length ? machineSize : null))
    }
    for (const { m, size } of accessories) if (picked[pickKey(m.id, size)]) add.push(toLine(m, picked[pickKey(m.id, size)], size))
    if (!add.length) return setError('Tick the machine and/or some accessories to add.')
    setError('')
    setLines((ls) => [...ls, ...add])
    setPicked({})
  }

  const addCustom = (description = '', price = 0) =>
    setLines((ls) => [...ls, { key: nextKey++, description, qty: 1, unit_price_inc: price, vat_rate: 0.2 }])
  const update = (key: number, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change, noPrice: false } : l)))
  // Delivery always goes on the invoice (even £0); a discount only when above 0.
  // Both follow "No VAT" when every item on the invoice is No VAT (exports).
  const extraRate = lines.length && lines.every((l) => l.vat_rate === 0) ? 0 : 0.2
  const deliveryValue = delivery.trim() === '' ? null : Math.max(0, parseFloat(delivery) || 0)
  const discountValue = Math.max(0, parseFloat(discount) || 0)
  const extras: InvoiceLine[] = [
    ...(deliveryValue !== null ? [{ description: 'Delivery', qty: 1, unit_price_inc: deliveryValue, vat_rate: extraRate }] : []),
    ...(discountValue > 0 ? [{ description: 'Discount', qty: 1, unit_price_inc: -discountValue, vat_rate: extraRate }] : []),
  ]
  const totals = invoiceTotals([...lines, ...extras])

  async function create() {
    if (!supabase) return
    if (!customer.name.trim()) return setError('Enter the customer name.')
    if (!lines.length) return setError('Add at least one item.')
    if (lines.some((l) => !l.description.trim() || !(l.qty > 0))) return setError('Every line needs a description and a quantity above 0.')
    if (deliveryValue === null) return setError('Enter the delivery charge. Type 0 if the customer is collecting.')
    if (totals.total < 0) return setError('The discount is more than the invoice total.')
    if (!company?.prices_include_vat)
      return setError('Prices including VAT are not switched on yet. A manager needs to run database/09-prices-include-vat.sql in Supabase.')
    if (!company?.account_number || !company?.sort_code)
      return setError('Bank details are missing. A manager needs to fill in Sales → Company details first.')
    setError('')
    // Open the window now, while the click is fresh, so the browser doesn't block it.
    const win = openInvoiceWindow()
    if (!win) return setError('Your browser blocked the invoice window. Allow pop-ups for this site and try again.')
    setBusy(true)
    const clean: InvoiceLine[] = [
      ...lines.map(({ description, qty, unit_price_inc, vat_rate }) => ({ description: description.trim(), qty, unit_price_inc, vat_rate })),
      ...extras,
    ]
    const { data: inv, error } = await supabase
      .from('invoices')
      .insert({ invoice_date: date, lines: clean, ...totals })
      .select()
      .single()
    setBusy(false)
    if (error || !inv) {
      win.close()
      return setError(friendlyError(error))
    }
    showInvoice(win, invoiceHtml({ number: inv.number, date, customer, lines: clean, company }))
    setDone(inv as Invoice)
  }

  function startAgain() {
    setCustomer(emptyCustomer)
    setLines([])
    setDelivery('')
    setDiscount('')
    setDate(today())
    setDone(null)
    setMachineId('')
  }

  if (done)
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 text-center dark:border-green-900 dark:bg-green-950/30">
        <div className="text-4xl">✅</div>
        <h2 className="mt-2 text-xl font-bold">Invoice {invoiceNumber(done.number)} created</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          It opened in a new tab. Choose <strong>Save as PDF</strong> in the print window and save it to your invoices folder.
        </p>
        <p className="mt-1 text-xs text-slate-500">If nothing opened, check that pop-ups are allowed, then use Reprint in Invoice history.</p>
        <Button variant="primary" className="mt-4" onClick={startAgain}>
          Start a new invoice
        </Button>
      </div>
    )

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 font-semibold">1. Customer</h2>
          <CustomerFields value={customer} onChange={setCustomer} />
          <div className="mt-3 w-48">
            <Field label="Invoice date">
              <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 font-semibold">2. Choose a machine and its accessories</h2>
          <div className="flex flex-wrap gap-2">
            {[...categories, ...(hasUncategorised ? ['none'] : []), 'all'].map((c) => (
              <button
                key={c}
                onClick={() => {
                  setCategory(c)
                  setMachineId('')
                }}
                className={`rounded-lg border-2 px-3 py-1.5 text-sm font-semibold ${
                  category === c ? 'border-ink bg-ink text-brand-500 dark:border-brand-500 dark:bg-brand-500 dark:text-ink' : 'border-slate-200 hover:border-brand-500 dark:border-slate-700'
                }`}
              >
                {c === 'Construction' ? '🚜 ' : c === 'Forestry' ? '🌲 ' : c === 'Agriculture' ? '🌾 ' : ''}
                {c === 'all' ? 'All' : c === 'none' ? 'No category' : c}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {machines.length === 0 && <p className="text-sm text-slate-500">No machines in this category.</p>}
            {machines.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMachineId(m.id)
                  setPicked({})
                  setIncludeMachine(true)
                  setMachineSize('')
                }}
                className={`rounded-lg border p-2 text-left text-sm ${
                  machineId === m.id ? 'border-brand-600 bg-brand-50 dark:bg-slate-800' : 'border-slate-200 hover:border-brand-500 dark:border-slate-700'
                }`}
              >
                <div className="font-semibold">{m.model_number}</div>
                <div className="truncate text-xs text-slate-500">{m.name}</div>
                <div className="text-xs font-medium">
                  {m.sizes.length ? (
                    <span className="text-slate-500">{m.sizes.length} sizes</span>
                  ) : priceOf(m) != null ? (
                    `${money(priceOf(m)!)} inc VAT`
                  ) : (
                    <span className="text-amber-600">No price set</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {machine && (
            <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="h-4 w-4" checked={includeMachine} onChange={(e) => setIncludeMachine(e.target.checked)} />
                {describe(machine)}
                {machine.sizes.length > 0 && (
                  <select
                    aria-label="Size"
                    className="rounded border border-slate-300 bg-white px-1 py-0.5 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
                    value={machineSize}
                    onChange={(e) => setMachineSize(e.target.value)}
                  >
                    <option value="">Size…</option>
                    {machine.sizes.map((sz) => (
                      <option key={sz}>{sz}</option>
                    ))}
                  </select>
                )}
                <span className="ml-auto font-normal">
                  {priceOf(machine, machine.sizes.length ? machineSize : null) != null ? money(priceOf(machine, machine.sizes.length ? machineSize : null)!) : '–'}
                </span>
              </label>
              <div className="mt-3 text-xs font-semibold uppercase text-slate-500">Accessories for {machine.model_number}</div>
              {accessories.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">No accessories linked to this machine.</p>
              ) : (
                <ul className="mt-1 max-h-72 space-y-0.5 overflow-y-auto">
                  {accessories.map(({ m: a, size }) => {
                    const k = pickKey(a.id, size)
                    const price = priceOf(a, size)
                    return (
                      <li key={k} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={!!picked[k]}
                          onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked ? 1 : 0 }))}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {modelLabel(a, models)}
                          {size && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold dark:bg-slate-800">{size}</span>}
                        </span>
                        {!!picked[k] && (
                          <input
                            type="number"
                            min={1}
                            aria-label="Quantity"
                            className="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-center dark:border-slate-700 dark:bg-slate-950"
                            value={picked[k]}
                            onChange={(e) => setPicked((p) => ({ ...p, [k]: Math.max(1, parseInt(e.target.value) || 1) }))}
                          />
                        )}
                        <span className="w-24 text-right">{price != null ? money(price) : <span className="text-amber-600">No price</span>}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
              <Button variant="primary" className="mt-3" onClick={addSelection}>
                + Add to invoice
              </Button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div className="min-w-56 flex-1">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Or find any item</div>
              <ModelPicker
                models={models}
                value=""
                onChange={(id) => {
                  const m = models.find((x) => x.id === id)!
                  if (m.sizes.length) setSizeFor(m)
                  else setLines((ls) => [...ls, toLine(m)])
                }}
              />
              {sizeFor && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-brand-50 p-2 text-sm dark:bg-slate-800">
                  <span className="font-medium">Which size of {modelLabel(sizeFor, models)}?</span>
                  {sizeFor.sizes.map((sz) => (
                    <Button
                      key={sz}
                      size="sm"
                      onClick={() => {
                        setLines((ls) => [...ls, toLine(sizeFor, 1, sz)])
                        setSizeFor(null)
                      }}
                    >
                      {sz}
                      {priceOf(sizeFor, sz) != null && <span className="text-slate-500"> · {money(priceOf(sizeFor, sz)!)}</span>}
                    </Button>
                  ))}
                  <button className="ml-auto text-xs underline" onClick={() => setSizeFor(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <Button onClick={() => addCustom()}>+ Custom line</Button>
          </div>
        </section>

        <section
          className={`rounded-xl border-4 p-4 ${
            deliveryValue === null ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-green-500 bg-white dark:bg-slate-900'
          }`}
        >
          <h2 className="text-lg font-bold">
            🚚 3. Delivery <span className="text-red-600">*</span>
          </h2>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
            Required. Enter the delivery charge <strong>including VAT</strong>, or press <strong>Customer is collecting</strong> for £0.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative">
              <span className="absolute left-3 top-2.5 text-lg font-semibold text-slate-400">£</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                aria-label="Delivery charge including VAT"
                placeholder="0.00"
                className="w-44 rounded-lg border-2 border-slate-400 bg-white py-2 pl-8 pr-3 text-lg font-bold dark:border-slate-600 dark:bg-slate-950"
                value={delivery}
                onChange={(e) => setDelivery(e.target.value)}
              />
            </span>
            <Button onClick={() => setDelivery('0')}>🏠 Customer is collecting (£0)</Button>
            {deliveryValue !== null && <span className="font-semibold text-green-700 dark:text-green-400">✓ Delivery {money(deliveryValue)}</span>}
          </div>
        </section>

        <section className="rounded-xl border-2 border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-lg font-bold">🏷️ 4. Discount</h2>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
            Optional. Enter the discount <strong>including VAT</strong>. Leave empty if there's no discount; the word "Discount" then won't appear on the invoice.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative">
              <span className="absolute left-3 top-2.5 text-lg font-semibold text-slate-400">£</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                aria-label="Discount including VAT"
                placeholder="0.00"
                className="w-44 rounded-lg border-2 border-slate-300 bg-white py-2 pl-8 pr-3 text-lg font-bold dark:border-slate-600 dark:bg-slate-950"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </span>
            {discountValue > 0 && (
              <>
                <span className="font-semibold text-slate-700 dark:text-slate-200">−{money(discountValue)} off the total</span>
                <Button size="sm" variant="ghost" onClick={() => setDiscount('')}>
                  Remove discount
                </Button>
              </>
            )}
          </div>
        </section>
      </div>

      <section className="h-fit space-y-3 rounded-xl border border-slate-200 bg-white p-4 lg:sticky lg:top-24 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-semibold">5. Invoice</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No items yet. Choose a machine and accessories, or add a custom line.</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((l) => (
              <li key={l.key} className={`rounded-lg border p-2 text-sm ${l.noPrice ? 'border-amber-400' : 'border-slate-200 dark:border-slate-700'}`}>
                <div className="flex gap-1">
                  <input
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 font-medium hover:border-slate-300 focus:border-brand-500 dark:hover:border-slate-700"
                    value={l.description}
                    placeholder="Description"
                    onChange={(e) => update(l.key, { description: e.target.value })}
                  />
                  <button className="px-1 text-slate-400 hover:text-red-600" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    ×
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  <input
                    type="number"
                    min={1}
                    aria-label="Quantity"
                    className="w-12 rounded border border-slate-300 bg-white px-1 py-0.5 text-center dark:border-slate-700 dark:bg-slate-950"
                    value={l.qty}
                    onChange={(e) => update(l.key, { qty: Math.max(0, parseInt(e.target.value) || 0) })}
                  />
                  ×
                  <span className="relative">
                    <span className="absolute left-1.5 top-0.5 text-slate-400">£</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label="Price including VAT"
                      title="Price including VAT"
                      className="w-24 rounded border border-slate-300 bg-white py-0.5 pl-4 pr-1 text-right dark:border-slate-700 dark:bg-slate-950"
                      value={l.unit_price_inc ?? 0}
                      onChange={(e) => update(l.key, { unit_price_inc: Math.max(0, parseFloat(e.target.value) || 0) })}
                    />
                  </span>
                  <select
                    aria-label="VAT rate"
                    className="rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-950"
                    value={l.vat_rate}
                    onChange={(e) => update(l.key, { vat_rate: parseFloat(e.target.value) })}
                  >
                    <option value={0.2}>inc VAT</option>
                    <option value={0}>No VAT (export)</option>
                  </select>
                  <span className="ml-auto font-semibold">{money(lineTotals(l).amount)}</span>
                </div>
                {l.noPrice && <div className="mt-1 text-xs text-amber-600">No price set for this item. Type the price in.</div>}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-1 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
          {deliveryValue !== null && (
            <div className="flex justify-between text-slate-500">
              <span>Delivery</span>
              <span>{money(lineTotals(extras[0]).amount)}</span>
            </div>
          )}
          {discountValue > 0 && (
            <div className="flex justify-between text-slate-500">
              <span>Discount</span>
              <span>{money(lineTotals(extras[extras.length - 1]).amount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Subtotal (ex VAT)</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT</span>
            <span>{money(totals.vat)}</span>
          </div>
          <div className="flex justify-between rounded bg-brand-500 px-2 py-1 font-bold text-ink">
            <span>Total</span>
            <span>{money(totals.total)}</span>
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button variant="primary" className="w-full" disabled={busy} onClick={create}>
          {busy ? 'Creating…' : '🧾 Create invoice & save as PDF'}
        </Button>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Prices are including VAT. This gives the invoice the next number. The PDF opens in a new tab; choose <strong>Save as PDF</strong>.
        </p>
      </section>
    </div>
  )
}
