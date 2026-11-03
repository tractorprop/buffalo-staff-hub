import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { useAuth } from '../../auth/AuthProvider'
import { personName, useProfiles } from '../../lib/useProfiles'
import type { AuditEntry, Invoice, Model, ShopifyLink, ShopifyOrder } from '../../lib/types'
import { Button, Confirm, ErrorText, Loading, fmtDate, fmtDateTime, inputClass } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'
import { invoiceDescription, modelLabel as nameOf } from '../../lib/modelLabel'
import { invoiceNumber } from '../../lib/money'

type Direction = 'out' | 'in'

interface Line {
  key: number
  modelId: string
  size: string
  direction: Direction
  qty: number
  fromInvoice?: number // quantity on the invoice/order: model and size are locked, qty can only go down
  itemKeys?: string[] // Shopify listings this line came from
}

// An invoice or Shopify order loaded into the form: its stock items fill the lines.
interface LoadedInvoice {
  ref: string
  title: string // "invoice BM-1001" or "Shopify order #1052"
  skipped: string[] // lines that aren't a stock item (or no longer exist)
  alreadySent: number // items already taken out of stock under this reference
  order?: ShopifyOrder
  unlinked?: ShopifyOrder['items'] // Shopify listings not yet linked to a hub item
  removed?: string[] // Shopify listings staff took off this entry (not being sent now)
}

const shopifyRef = (o: ShopifyOrder) => `Shopify ${o.name}`

// Turn a Shopify order into stock lines using the founder's links.
function linesFromOrder(order: ShopifyOrder, links: Map<string, ShopifyLink>) {
  const found = new Map<string, Line>()
  const unlinked: ShopifyOrder['items'] = []
  const skipped: string[] = []
  for (const item of order.items) {
    const link = links.get(item.key)
    if (!link) unlinked.push(item)
    else if (!link.model_id) skipped.push(item.title)
    else {
      const k = `${link.model_id}|${link.size ?? ''}`
      const line = found.get(k) ?? { key: nextKey++, modelId: link.model_id, size: link.size ?? '', direction: 'out' as const, qty: 0, fromInvoice: 0, itemKeys: [] }
      line.qty += item.qty
      line.fromInvoice! += item.qty
      line.itemKeys!.push(item.key)
      found.set(k, line)
    }
  }
  return { lines: [...found.values()], unlinked, skipped }
}

let nextKey = 1
const newLine = (): Line => ({
  key: nextKey++,
  modelId: '',
  size: '',
  direction: 'out',
  qty: 1,
})

interface Data {
  models: Model[]
  inStock: { model_id: string; size: string | null }[]
  log: AuditEntry[]
  shopify: { orders: ShopifyOrder[]; links: ShopifyLink[]; sent: Set<string> } | null // null until 13-shopify-orders.sql is run
}

async function loadAll(days: number) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const [models, inStock, log, orders, links, sent] = await Promise.all([
    supabase!.from('models').select('*').order('model_number'),
    supabase!.from('machines').select('model_id, size').eq('status', 'in_stock'),
    supabase!.from('audit_log').select('*').eq('table_name', 'machines').gte('changed_at', since).order('changed_at', { ascending: false }).limit(5000),
    supabase!.from('shopify_orders').select('*, id_text:id::text').order('ordered_at', { ascending: false }).limit(100),
    supabase!.from('shopify_links').select('*'),
    supabase!.from('machines').select('stock_reference').like('stock_reference', 'Shopify #%'),
  ])
  const error = models.error ?? inStock.error ?? log.error
  return {
    data: error
      ? null
      : {
          models: models.data as Model[],
          inStock: inStock.data as Data['inStock'],
          log: log.data as AuditEntry[],
          shopify:
            orders.error || links.error
              ? null
              : {
                  orders: orders.data as ShopifyOrder[],
                  links: links.data as ShopifyLink[],
                  sent: new Set(((sent.data ?? []) as { stock_reference: string }[]).map((m) => m.stock_reference)),
                },
        },
    error,
  }
}

// Turn activity-log rows into "−2 B600" / "+1 B600" movements.
function movements(log: AuditEntry[]) {
  const groups = new Map<
    string,
    {
      at: string
      by: string | null
      modelId: string
      size: string | null
      reference: string | null
      qty: number
      ids: number[]
    }
  >()
  for (const e of log) {
    const o = e.old_data as { status?: string } | null
    const n = e.new_data as {
      status?: string
      model_id?: string
      size?: string | null
      notes?: string | null
      stock_reference?: string | null
    } | null
    let sign = 0
    if (e.action === 'UPDATE' && o?.status === 'in_stock' && n?.status === 'sold') sign = -1
    else if (e.action === 'UPDATE' && o?.status === 'sold' && n?.status === 'in_stock') sign = 1
    else if (e.action === 'INSERT' && n?.status === 'in_stock' && n?.notes === 'Return') sign = 1
    if (!sign || !n?.model_id) continue
    const reference = n.stock_reference ?? null
    const key = `${e.changed_at}|${e.changed_by}|${n.model_id}|${n.size ?? ''}|${sign}|${reference ?? ''}`
    const g = groups.get(key) ?? {
      at: e.changed_at,
      by: e.changed_by,
      modelId: n.model_id,
      size: n.size ?? null,
      reference,
      qty: 0,
      ids: [],
    }
    g.qty += sign
    g.ids.push(e.id)
    groups.set(key, g)
  }
  return [...groups.values()]
}

export function StockEntryPage() {
  const profiles = useProfiles()
  const { isFounder } = useAuth()
  const [removeEntry, setRemoveEntry] = useState<{
    ids: number[]
    label: string
  } | null>(null)
  const [days, setDays] = useState(30)
  const [person, setPerson] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const { data, error, loading, reload } = useLive<Data>(['models', 'machines', 'shopify_orders', 'shopify_links'], () => loadAll(days), [days])
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [reference, setReference] = useState('')
  const [invoiceInput, setInvoiceInput] = useState('')
  const [invoice, setInvoice] = useState<LoadedInvoice | null>(null)
  const [loadingInvoice, setLoadingInvoice] = useState(false)
  const [removeOrder, setRemoveOrder] = useState<ShopifyOrder | null>(null)
  const { isManager } = useAuth()
  const [formError, setFormError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  const stock = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of data?.inStock ?? []) {
      const k = `${m.model_id}|${m.size ?? ''}`
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return map
  }, [data])

  const update = (key: number, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)))
  const modelLabel = (id: string, size?: string | null) =>
    nameOf(
      data?.models.find((x) => x.id === id),
      data?.models ?? [],
      size,
    )

  // Fill the form from an invoice, so the right machines and accessories are picked.
  async function loadInvoice() {
    if (!data) return
    setFormError('')
    setDone('')
    const n = parseInt(invoiceInput.replace(/\D/g, ''))
    if (!n) return setFormError('Type the invoice number, e.g. BM-1001.')
    setLoadingInvoice(true)
    const { data: inv, error } = await supabase!.from('invoices').select('*').eq('number', n).maybeSingle()
    setLoadingInvoice(false)
    if (error) return setFormError(friendlyError(error))
    if (!inv) return setFormError(`There's no invoice ${invoiceNumber(n)}. Check the number on the invoice.`)
    const ref = invoiceNumber(n)

    // Older invoices don't say which stock item a line is, so match on the wording.
    const byDescription = new Map<string, { modelId: string; size: string }>()
    for (const m of data.models)
      for (const size of m.sizes.length ? m.sizes : [null])
        byDescription.set(invoiceDescription(m, data.models, size).toLowerCase(), { modelId: m.id, size: size ?? '' })

    const found = new Map<string, Line>()
    const skipped: string[] = []
    for (const l of (inv as Invoice).lines) {
      if (/^(delivery|discount)$/i.test(l.description)) continue
      const match =
        l.model_id && data.models.some((m) => m.id === l.model_id)
          ? { modelId: l.model_id, size: l.size ?? '' }
          : byDescription.get(l.description.trim().toLowerCase())
      if (!match) {
        skipped.push(l.description)
        continue
      }
      const k = `${match.modelId}|${match.size}`
      const line = found.get(k) ?? {
        key: nextKey++,
        ...match,
        direction: 'out' as const,
        qty: 0,
        fromInvoice: 0,
      }
      line.qty += l.qty
      line.fromInvoice! += l.qty
      found.set(k, line)
    }
    if (!found.size) return setFormError(`Invoice ${ref} has no stock items on it to send out.`)

    const sent = await supabase!.from('machines').select('id', { count: 'exact', head: true }).eq('stock_reference', ref)
    setInvoice({
      ref,
      title: `invoice ${ref}`,
      skipped,
      alreadySent: sent.error ? 0 : (sent.count ?? 0),
    })
    setReference(ref)
    setLines([...found.values()])
  }

  const links = useMemo(() => new Map((data?.shopify?.links ?? []).map((l) => [l.item_key, l])), [data])
  const toSend = (data?.shopify?.orders ?? []).filter((o) => !data?.shopify?.sent.has(shopifyRef(o)))

  // Fill the form from a Shopify order.
  async function loadOrder(order: ShopifyOrder) {
    setFormError('')
    setDone('')
    const ref = shopifyRef(order)
    const built = linesFromOrder(order, links)
    if (!built.lines.length && !built.unlinked.length) return setFormError(`Order ${order.name} has no stock items on it to send out.`)
    const sent = await supabase!.from('machines').select('id', { count: 'exact', head: true }).eq('stock_reference', ref)
    setInvoice({ ref, title: `Shopify order ${order.name}`, skipped: built.skipped, alreadySent: sent.error ? 0 : (sent.count ?? 0), order, unlinked: built.unlinked })
    setReference(ref)
    setLines(built.lines)
  }

  // When the founder links a listing, rebuild the loaded order's lines.
  useEffect(() => {
    if (!invoice?.order) return
    const removed = new Set(invoice.removed ?? [])
    const built = linesFromOrder({ ...invoice.order, items: invoice.order.items.filter((i) => !removed.has(i.key)) }, links)
    setInvoice((i) => (i ? { ...i, unlinked: built.unlinked, skipped: built.skipped } : i))
    setLines(built.lines)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links])

  // Take a line (or an unlinked Shopify listing) off this entry, e.g. it isn't going out today.
  function removeLine(l: Line) {
    setLines((ls) => ls.filter((x) => x.key !== l.key))
    if (l.itemKeys?.length) setInvoice((i) => (i ? { ...i, removed: [...(i.removed ?? []), ...l.itemKeys!] } : i))
  }
  function removeUnlinked(key: string) {
    setInvoice((i) => (i ? { ...i, unlinked: i.unlinked?.filter((u) => u.key !== key), removed: [...(i.removed ?? []), key] } : i))
  }

  async function saveLink(item: ShopifyOrder['items'][number], modelId: string | null, size: string | null) {
    const { error } = await supabase!.from('shopify_links').upsert({ item_key: item.key, model_id: modelId, size, title: item.title })
    if (error) return setFormError(friendlyError(error))
    reload()
  }

  async function unlink(keys: string[]) {
    const { error } = await supabase!.from('shopify_links').delete().in('item_key', keys)
    if (error) return setFormError(friendlyError(error))
    reload()
  }

  function clearInvoice() {
    setInvoice(null)
    setInvoiceInput('')
    setReference('')
    setLines([newLine()])
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !data) return
    setFormError('')
    setDone('')
    const filled = lines.filter((l) => l.modelId)
    const ref = reference.trim()
    if (!ref) return setFormError('Enter a reference number.')
    if (invoice?.unlinked?.length) return setFormError('Some items on this order are not linked to the hub yet. The founder needs to link them first.')
    if (!filled.length) return setFormError(invoice ? `Nothing left to send on ${invoice.title}. Add an item, or click Clear.` : 'Choose a model.')
    for (const l of filled) {
      const m = data.models.find((x) => x.id === l.modelId)!
      if (m.sizes.length && !l.size) return setFormError(`Choose a size for ${m.model_number}.`)
      if (l.fromInvoice && l.qty > l.fromInvoice) return setFormError(`Only ${l.fromInvoice} ${m.model_number} on ${invoice?.title}.`)
      if (!(l.qty >= 1 && l.qty <= 100)) return setFormError(`Check the quantity for ${m.model_number} (1 to 100).`)
    }

    setBusy(true)
    const ok: string[] = []
    const failed: Line[] = []
    const problems: string[] = []
    for (const l of filled) {
      const qty = l.direction === 'out' ? -l.qty : l.qty
      const { error } = await supabase.rpc('record_stock_movement', {
        p_model_id: l.modelId,
        p_size: l.size || null,
        p_qty: qty,
        p_reference: ref,
      })
      if (error) {
        failed.push(l)
        problems.push(
          /could not find the function|record_stock_movement|stock_reference/i.test(error.message)
            ? 'Reference numbers are not switched on in the database yet. The founder needs to run database/12-stock-entry-reference.sql in Supabase.'
            : `${modelLabel(l.modelId, l.size)}: ${friendlyError(error)}`,
        )
      } else ok.push(`${qty > 0 ? '+' : '−'}${l.qty} ${modelLabel(l.modelId, l.size)}`)
    }
    setBusy(false)
    setLines(failed.length ? failed : [newLine()])
    if (!failed.length) {
      setReference('')
      setInvoice(null)
      setInvoiceInput('')
    }
    if (ok.length) setDone(`Saved under reference ${ref}: ${ok.join(', ')}`)
    if (problems.length) setFormError([...new Set(problems)].join(' '))
    reload()
  }

  const history = useMemo(() => {
    const q = modelSearch.trim().toLowerCase()
    return movements(data?.log ?? []).filter((g) => {
      if (person && g.by !== person) return false
      if (!q) return true
      const m = data?.models.find((x) => x.id === g.modelId)
      return `${nameOf(m, data?.models ?? [])} ${m?.name ?? ''} ${g.size ?? ''} ${g.reference ?? ''}`.toLowerCase().includes(q)
    })
  }, [data, person, modelSearch])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Stock entry</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Record machines leaving the warehouse (sold / dispatched), or coming back (returns).</p>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Loading />
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="rounded-lg border-2 border-brand-500 bg-brand-50 p-3 dark:bg-slate-800">
            {invoice ? (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    {invoice.order ? '🛒' : '🧾'} Sending out <strong>{invoice.title}</strong>. The items below come from the {invoice.order ? 'order' : 'invoice'}.
                  </span>
                  <Button size="sm" className="ml-auto" onClick={clearInvoice}>
                    Clear
                  </Button>
                </div>
                {invoice.alreadySent > 0 && (
                  <p className="rounded-lg bg-red-50 p-2 font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                    ⚠️ {invoice.alreadySent} item
                    {invoice.alreadySent === 1 ? ' has' : 's have'} already been sent out under {invoice.ref}. Check before sending again.
                  </p>
                )}
                {!!invoice.unlinked?.length && (
                  <div className="space-y-2 rounded-lg border border-red-300 bg-white p-2 dark:border-red-900 dark:bg-slate-900">
                    <p className="font-medium text-red-700 dark:text-red-300">
                      ⚠️ {invoice.unlinked.length} Shopify listing{invoice.unlinked.length === 1 ? ' is' : 's are'} not linked to a hub item yet.
                      {isFounder
                        ? ' Choose the matching item once, and future orders will be recognised automatically.'
                        : ' Ask the founder to link it, or remove it if it isn\'t being sent now.'}
                    </p>
                    {invoice.unlinked.map((item) =>
                      isFounder ? (
                        <LinkItem key={item.key} item={item} models={data?.models ?? []} onSave={saveLink} onRemove={() => removeUnlinked(item.key)} />
                      ) : (
                        <div key={item.key} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                          <span className="flex-1">
                            <strong>{item.title}</strong> <span className="text-slate-500">× {item.qty}</span>
                          </span>
                          <Button size="sm" variant="danger" className="font-bold" onClick={() => removeUnlinked(item.key)}>
                            ✕ Remove
                          </Button>
                        </div>
                      ),
                    )}
                  </div>
                )}
                {invoice.skipped.length > 0 && (
                  <p className="text-xs text-slate-600 dark:text-slate-300">Not stock items, so not included: {invoice.skipped.join(', ')}</p>
                )}
              </div>
            ) : (
              <div>
                <span className="text-sm font-semibold">Sending out an invoice?</span>
                <div className="mt-1 flex gap-2">
                  <input
                    className={inputClass}
                    placeholder="Invoice number, e.g. BM-1001"
                    value={invoiceInput}
                    onChange={(e) => setInvoiceInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        loadInvoice()
                      }
                    }}
                  />
                  <Button variant="primary" disabled={loadingInvoice || !invoiceInput.trim()} onClick={loadInvoice}>
                    {loadingInvoice ? 'Finding…' : 'Load items'}
                  </Button>
                </div>
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  Fills in the machine and accessories from the invoice, so nothing is missed or picked wrongly.
                </span>
                {data?.shopify && (
                  <div className="mt-3 border-t border-brand-500/40 pt-3">
                    <span className="text-sm font-semibold">🛒 Shopify orders to send</span>
                    {toSend.length === 0 ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">No Shopify orders waiting. New orders appear here automatically.</p>
                    ) : (
                      <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto">
                        {toSend.map((o) => {
                          const waiting = o.items.some((i) => !links.has(i.key))
                          return (
                            <li key={o.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-sm dark:bg-slate-900">
                              <div className="min-w-0 flex-1">
                                <span className="font-bold">{o.name}</span>
                                <span className="ml-2 text-xs text-slate-500">{fmtDate(o.ordered_at)}</span>
                                {waiting && <span className="ml-2 text-xs font-semibold text-red-600 dark:text-red-400">⚠️ needs linking</span>}
                                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{o.items.map((i) => `${i.qty}× ${i.title}`).join(', ')}</div>
                              </div>
                              <Button size="sm" variant="primary" onClick={() => loadOrder(o)}>
                                Load
                              </Button>
                              {isManager && (
                                <Button size="sm" variant="danger" className="font-bold" title="Remove from list (e.g. cancelled)" onClick={() => setRemoveOrder(o)}>
                                  ✕
                                </Button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <label className="block">
            <span className="text-sm font-semibold">Reference number *</span>
            <input
              className={`${inputClass} mt-1 read-only:bg-slate-100 dark:read-only:bg-slate-800`}
              readOnly={!!invoice}
              required
              maxLength={60}
              placeholder="e.g. invoice number BM-1001 or delivery note number"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Needed for every entry. Please don't type customer names here.</span>
          </label>
          {lines.map((l) => {
            const m = data?.models.find((x) => x.id === l.modelId)
            const have = m && (!m.sizes.length || l.size) ? (stock.get(`${m.id}|${l.size}`) ?? 0) : null
            return (
              <div key={l.key} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                {!l.fromInvoice && (
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['out', '− Leaving (sold)'],
                        ['in', '+ Return'],
                      ] as [Direction, string][]
                    ).map(([d, label]) => (
                      <button
                        type="button"
                        key={d}
                        onClick={() => update(l.key, { direction: d })}
                        className={`rounded-lg border px-2 py-2 text-sm font-semibold ${
                          l.direction === d
                            ? d === 'out'
                              ? 'border-green-600 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                              : 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                            : 'border-slate-300 text-slate-500 dark:border-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-start gap-2">
                  {l.fromInvoice ? (
                    <div className="min-w-48 flex-1 py-2">
                      <span className="mr-2 font-bold text-green-700 dark:text-green-400">− Leaving</span>
                      <span className="font-semibold">{modelLabel(l.modelId, l.size)}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {l.fromInvoice} on {invoice?.order ? 'order' : 'invoice'}
                      </span>
                      {isFounder && l.itemKeys && (
                        <button type="button" className="ml-2 text-xs text-sky-700 underline dark:text-sky-300" onClick={() => unlink(l.itemKeys!)}>
                          Wrong item? Change link
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="min-w-48 flex-1">
                      <ModelPicker models={data?.models ?? []} value={l.modelId} onChange={(id) => update(l.key, { modelId: id, size: '' })} />
                    </div>
                  )}
                  {m && m.sizes.length > 0 && !l.fromInvoice && (
                    <select className={`${inputClass} w-32`} value={l.size} onChange={(e) => update(l.key, { size: e.target.value })}>
                      <option value="">Size…</option>
                      {m.sizes.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={l.fromInvoice ?? 100}
                    aria-label="Quantity"
                    className={`${inputClass} w-20`}
                    value={l.qty}
                    onChange={(e) => update(l.key, { qty: parseInt(e.target.value) || 0 })}
                  />
                  {l.fromInvoice ? (
                    <Button variant="danger" className="font-bold" title="Not sending this item now" onClick={() => removeLine(l)}>
                      ✕ Remove
                    </Button>
                  ) : (
                    <Button variant="danger" className="font-bold" aria-label="Remove line" disabled={lines.length === 1 && !invoice} onClick={() => removeLine(l)}>
                      ✕ Remove
                    </Button>
                  )}
                </div>
                {have !== null && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {have} in stock now
                    {l.direction === 'out' && l.qty > have && <span className="ml-1 font-medium text-red-600"> (not enough to take out {l.qty})</span>}
                  </p>
                )}
              </div>
            )
          })}
          {(!invoice || invoice.order) && (
            <Button size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
              {invoice ? '+ Add an item not on the order' : '+ Add another model'}
            </Button>
          )}
          <ErrorText>{formError}</ErrorText>
          {done && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">✓ {done}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !reference.trim() || !!invoice?.unlinked?.length}>
            {busy ? 'Saving…' : 'Save stock entry'}
          </Button>
        </form>
      )}

      {data && (
        <section className="space-y-2">
          <h2 className="font-semibold">Stock entry history</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className={`${inputClass} sm:w-56`} value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Everyone</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Filter by model or reference number…"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
            />
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No stock entries in the last {days} days
              {person || modelSearch ? ' matching these filters' : ''}.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Who</th>
                    <th className="px-3 py-2">Reference</th>
                    <th className="px-3 py-2">Entry</th>
                    {isFounder && <th className="px-3 py-2"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {history.map((g) => (
                    <tr key={`${g.at}${g.modelId}${g.size}${g.qty}${g.reference}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-slate-400">{fmtDateTime(g.at)}</td>
                      <td className="px-3 py-2">{personName(profiles, g.by)}</td>
                      <td className="px-3 py-2">
                        {g.reference ? (
                          <button
                            className="font-mono text-xs font-semibold hover:underline"
                            title="Show only this reference"
                            onClick={() => setModelSearch(g.reference!)}
                          >
                            {g.reference}
                          </button>
                        ) : (
                          <span className="text-slate-400">–</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`mr-2 font-bold ${g.qty < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                          {g.qty < 0 ? `−${-g.qty}` : `+${g.qty}`}
                        </span>
                        <span className="font-medium">{modelLabel(g.modelId, g.size)}</span>
                        <span className="ml-1 text-xs text-slate-500">{g.qty < 0 ? 'left (sold)' : 'returned'}</span>
                      </td>
                      {isFounder && (
                        <td className="px-3 py-2 text-right">
                          <button
                            className="text-xs text-red-600 hover:underline dark:text-red-400"
                            onClick={() =>
                              setRemoveEntry({
                                ids: g.ids,
                                label: `${g.qty < 0 ? '−' : '+'}${Math.abs(g.qty)} ${modelLabel(g.modelId, g.size)}${g.reference ? ` (ref ${g.reference})` : ''}`,
                              })
                            }
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
            Showing the last {days} days.
            <Button size="sm" onClick={() => setDays((n) => n + 90)}>
              Load older
            </Button>
          </div>
        </section>
      )}
      {removeOrder && (
        <Confirm
          title={`Remove order ${removeOrder.name} from the list?`}
          message="Use this for an order that was cancelled or won't be sent. Stock doesn't change."
          confirmLabel="Remove"
          onConfirm={async () => {
            const { error } = await supabase!.from('shopify_orders').delete().eq('id', removeOrder.id_text)
            if (error) setFormError(friendlyError(error))
            setRemoveOrder(null)
            reload()
          }}
          onCancel={() => setRemoveOrder(null)}
        />
      )}
      {removeEntry && (
        <Confirm
          title="Delete this history entry?"
          message={`"${removeEntry.label}" is removed from the history only. Stock levels do not change.`}
          onConfirm={async () => {
            const { error } = await supabase!.from('audit_log').delete().in('id', removeEntry.ids)
            if (error) setFormError(friendlyError(error))
            setRemoveEntry(null)
            reload()
          }}
          onCancel={() => setRemoveEntry(null)}
        />
      )}
    </div>
  )
}

// Founder: link one Shopify listing to the hub item (and size) it really is.
function LinkItem({
  item,
  models,
  onSave,
  onRemove,
}: {
  item: ShopifyOrder['items'][number]
  models: Model[]
  onSave: (item: ShopifyOrder['items'][number], modelId: string | null, size: string | null) => void
  onRemove: () => void
}) {
  const [modelId, setModelId] = useState('')
  const [size, setSize] = useState('')
  const m = models.find((x) => x.id === modelId)
  return (
    <div className="space-y-1 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
      <div className="text-sm">
        Shopify: <strong>{item.title}</strong> <span className="text-slate-500">× {item.qty}</span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-48 flex-1">
          <ModelPicker models={models} value={modelId} onChange={(id) => (setModelId(id), setSize(''))} />
        </div>
        {m && m.sizes.length > 0 && (
          <select className={`${inputClass} w-32`} value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">Size…</option>
            {m.sizes.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        <Button size="sm" variant="primary" disabled={!m || (m.sizes.length > 0 && !size)} onClick={() => onSave(item, modelId, size || null)}>
          Link
        </Button>
        <Button size="sm" onClick={() => onSave(item, null, null)}>
          Not a stock item
        </Button>
        <Button size="sm" variant="danger" className="font-bold" title="Not sending it now (the link isn't saved)" onClick={onRemove}>
          ✕ Remove
        </Button>
      </div>
    </div>
  )
}
