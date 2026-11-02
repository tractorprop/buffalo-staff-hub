import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Model, ProductionOrder } from '../../lib/types'
import { labelFor } from '../../lib/modelLabel'
import { Button, Confirm, ErrorText, Field, Modal, fmtDate, inputClass, today } from '../../components/ui'
import { ProductionForm } from './ProductionForm'

const itemTotal = (o: ProductionOrder) => o.items.reduce((n, i) => n + i.qty, 0)

function due(o: ProductionOrder) {
  if (o.ready_date && o.ready_date < today()) return { text: `Should have left the factory ${fmtDate(o.ready_date)}`, tone: 'font-semibold text-red-600 dark:text-red-400' }
  return {
    text: [o.ready_date && `Leaves factory ${fmtDate(o.ready_date)}`, o.eta && `ETA UK ${fmtDate(o.eta)}`].filter(Boolean).join(' · ') || 'No dates set',
    tone: 'text-slate-600 dark:text-slate-300',
  }
}

// Large window over the Machines page: everything being built at the factory.
export function ProductionWindow({
  orders,
  models,
  isFounder,
  onMessage,
  onClose,
}: {
  orders: ProductionOrder[]
  models: Model[]
  isFounder: boolean
  onMessage: (msg: string) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string | null>(orders[0]?.id ?? null)
  const [form, setForm] = useState<{ order?: ProductionOrder } | null>(null)
  const [shipping, setShipping] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const o = orders.find((x) => x.id === selected) ?? orders[0]

  return (
    <Modal title="🏭 Machines in production" onClose={onClose} wide="xl">
      {isFounder && (
        <div className="mb-3 flex justify-end">
          <Button variant="primary" onClick={() => setForm({})}>
            + Add production order
          </Button>
        </div>
      )}
      {orders.length === 0 ? (
        <p className="py-8 text-center text-slate-500">Nothing in production.{isFounder && ' Click "+ Add production order" to add one.'}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {orders.map((x) => {
              const d = due(x)
              return (
                <li key={x.id}>
                  <button
                    onClick={() => setSelected(x.id)}
                    className={`w-full rounded-xl border-2 p-3 text-left ${
                      x.id === o?.id ? 'border-ink bg-brand-50 dark:border-brand-500 dark:bg-slate-800' : 'border-slate-200 hover:border-brand-500 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🏭</span>
                      <span className="font-bold">{x.ref}</span>
                      <span className="ml-auto text-sm font-semibold">{itemTotal(x)} items</span>
                    </div>
                    <div className={`text-sm ${d.tone}`}>{d.text}</div>
                  </button>
                </li>
              )
            })}
          </ul>

          {o && (
            <section className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-start gap-3">
                <div>
                  <h3 className="text-2xl font-bold">🏭 {o.ref}</h3>
                  <p className={due(o).tone}>{due(o).text}</p>
                </div>
                {isFounder && (
                  <Button variant="primary" className="ml-auto px-5 py-3 text-base" onClick={() => setShipping(true)}>
                    🚢 Shipped: move to containers
                  </Button>
                )}
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">What's being made</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {o.items.map((i) => (
                      <tr key={`${i.model_id}${i.size}`}>
                        <td className="px-3 py-2">{labelFor(i.model_id, models, i.size)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{i.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold dark:bg-slate-800/50">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right">{itemTotal(o)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {o.notes && <p className="text-sm text-slate-600 dark:text-slate-300">📝 {o.notes}</p>}
              <ErrorText>{error}</ErrorText>
              {isFounder && (
                <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <Button size="sm" onClick={() => setForm({ order: o })}>
                    ✏️ Edit contents / dates
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setConfirmDelete(true)}>
                    🗑️ Delete
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {form && (
        <ProductionForm
          order={form.order}
          models={models}
          onClose={() => setForm(null)}
          onSaved={(msg) => {
            setForm(null)
            onMessage(msg)
          }}
        />
      )}
      {shipping && o && (
        <ShipOrder
          order={o}
          models={models}
          onClose={() => setShipping(false)}
          onShipped={(msg) => {
            setShipping(false)
            setSelected(null)
            onMessage(msg)
          }}
        />
      )}
      {confirmDelete && o && (
        <Confirm
          title={`Delete production order ${o.ref}?`}
          message="Use this for an order that was cancelled or added by mistake. Stock doesn't change."
          onConfirm={async () => {
            const { error } = await supabase!.from('production_orders').delete().eq('id', o.id)
            setConfirmDelete(false)
            if (error) return setError(friendlyError(error))
            setSelected(null)
            onMessage(`Production order ${o.ref} deleted.`)
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  )
}

// Founder: the order has left the factory. What's shipped becomes a container on the way;
// anything not shipped stays in production.
function ShipOrder({ order, models, onClose, onShipped }: { order: ProductionOrder; models: Model[]; onClose: () => void; onShipped: (msg: string) => void }) {
  const [containerRef, setContainerRef] = useState(order.ref)
  const [eta, setEta] = useState(order.eta ?? '')
  const [qty, setQty] = useState(order.items.map((i) => i.qty))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const shipped = qty.reduce((a, b) => a + b, 0)

  async function ship(e: FormEvent) {
    e.preventDefault()
    if (!containerRef.trim()) return setError('Enter the container reference.')
    if (shipped === 0) return setError('Nothing to ship. Set how many of each item are in the container.')
    if (order.items.some((i, n) => qty[n] < 0 || qty[n] > i.qty)) return setError("You can't ship more than is in production.")
    const rows = order.items.flatMap((i, n) =>
      Array.from({ length: qty[n] }, () => ({ model_id: i.model_id, size: i.size, status: 'en_route', container_ref: containerRef.trim(), eta: eta || null })),
    )
    setBusy(true)
    setError('')
    const { error } = await supabase!.from('machines').insert(rows)
    if (error) {
      setBusy(false)
      return setError(friendlyError(error))
    }
    const left = order.items.map((i, n) => ({ ...i, qty: i.qty - qty[n] })).filter((i) => i.qty > 0)
    const done = left.length
      ? await supabase!.from('production_orders').update({ items: left }).eq('id', order.id)
      : await supabase!.from('production_orders').delete().eq('id', order.id)
    setBusy(false)
    if (done.error) return setError(`The container was added, but the production order couldn't be updated: ${friendlyError(done.error)}`)
    onShipped(
      `${shipped} item${shipped === 1 ? '' : 's'} moved to container ${containerRef.trim()}.` +
        (left.length ? ` ${left.reduce((n, i) => n + i.qty, 0)} still in production.` : ''),
    )
  }

  return (
    <Modal title={`🚢 Ship ${order.ref}`} onClose={onClose} wide>
      <form onSubmit={ship} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          These become a container on the way. If only part of the order is in this container, lower the numbers: the rest stays in production.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Container reference *">
            <input className={inputClass} required value={containerRef} onChange={(e) => setContainerRef(e.target.value)} />
          </Field>
          <Field label="ETA in the UK">
            <input type="date" className={inputClass} value={eta} onChange={(e) => setEta(e.target.value)} />
          </Field>
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
          {order.items.map((i, n) => (
            <li key={`${i.model_id}${i.size}`} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1 font-medium">{labelFor(i.model_id, models, i.size)}</span>
              <span className="text-xs text-slate-500">{i.qty} in production</span>
              <input
                type="number"
                min={0}
                max={i.qty}
                aria-label="Quantity shipped"
                className={`${inputClass} w-20`}
                value={qty[n]}
                onChange={(e) => setQty((q) => q.map((v, k) => (k === n ? Math.min(i.qty, Math.max(0, parseInt(e.target.value) || 0)) : v)))}
              />
            </li>
          ))}
        </ul>
        <ErrorText>{error}</ErrorText>
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm text-slate-500">{shipped} going into the container</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Move to containers'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
