import { useEffect, useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Machine, Model } from '../../lib/types'
import { labelFor } from '../../lib/modelLabel'
import { Button, ErrorText, Field, Loading, Modal, inputClass } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'

type Item = Pick<Machine, 'id' | 'model_id' | 'size' | 'serial_number' | 'location'>

interface Line {
  key: number
  modelId: string
  size: string
  qty: number
  ids: string[] // the items already in the container for this line (empty for new lines)
}

let nextKey = 1

// Founder only: change what's in a container that is still on the way (e.g. two items were not loaded).
export function EditContainer({
  containerRef,
  eta: initialEta,
  models,
  hasPendingCheckin,
  onClose,
  onSaved,
}: {
  containerRef: string
  eta: string | null
  models: Model[]
  hasPendingCheckin: boolean
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [lines, setLines] = useState<Line[] | null>(null)
  const [location, setLocation] = useState<string | null>(null)
  const [eta, setEta] = useState(initialEta ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase!
      .from('machines')
      .select('id, model_id, size, serial_number, location')
      .eq('container_ref', containerRef)
      .eq('status', 'en_route')
      .then(({ data, error }) => {
        if (error) return setError(friendlyError(error))
        const items = data as Item[]
        const groups = new Map<string, Line>()
        for (const m of items) {
          const k = `${m.model_id}|${m.size ?? ''}`
          const line = groups.get(k) ?? { key: nextKey++, modelId: m.model_id, size: m.size ?? '', qty: 0, ids: [] }
          line.qty++
          // Items without a serial number are removed first when the quantity goes down.
          if (m.serial_number) line.ids.push(m.id)
          else line.ids.unshift(m.id)
          groups.set(k, line)
        }
        setLocation(items.find((m) => m.location)?.location ?? null)
        setLines([...groups.values()].sort((a, b) => labelFor(a.modelId, models, a.size).localeCompare(labelFor(b.modelId, models, b.size))))
      })
  }, [containerRef, models])

  const update = (key: number, change: Partial<Line>) => setLines((ls) => ls!.map((l) => (l.key === key ? { ...l, ...change } : l)))
  const total = (lines ?? []).reduce((n, l) => n + (l.modelId ? l.qty : 0), 0)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!lines) return
    for (const l of lines.filter((l) => l.modelId && l.ids.length === 0)) {
      const m = models.find((x) => x.id === l.modelId)!
      if (m.sizes.length && !l.size) return setError(`Choose a size for ${m.model_number}.`)
    }
    if (lines.some((l) => l.modelId && !(l.qty >= 0 && l.qty <= 500))) return setError('Check the quantities.')
    if (total === 0) return setError('That would leave the container empty. To remove it completely, use Delete container instead.')

    const remove: string[] = []
    const add: Record<string, unknown>[] = []
    for (const l of lines) {
      if (!l.modelId) continue
      if (l.qty < l.ids.length) remove.push(...l.ids.slice(0, l.ids.length - l.qty))
      for (let i = l.ids.length; i < l.qty; i++)
        add.push({ model_id: l.modelId, size: l.size || null, status: 'en_route', container_ref: containerRef, eta: eta || null, location })
    }

    setBusy(true)
    setError('')
    const steps = [
      remove.length ? supabase!.from('machines').delete().in('id', remove) : null,
      add.length ? supabase!.from('machines').insert(add) : null,
      (eta || null) !== initialEta
        ? supabase!.from('machines').update({ eta: eta || null }).eq('container_ref', containerRef).eq('status', 'en_route')
        : null,
    ]
    for (const step of steps) {
      if (!step) continue
      const { error } = await step
      if (error) {
        setBusy(false)
        return setError(friendlyError(error))
      }
    }
    setBusy(false)
    const changes = [remove.length && `${remove.length} removed`, add.length && `${add.length} added`, (eta || null) !== initialEta && 'ETA changed'].filter(Boolean)
    onSaved(changes.length ? `Container ${containerRef} updated: ${changes.join(', ')}.` : 'No changes made.')
  }

  return (
    <Modal title={`✏️ Edit container ${containerRef}`} onClose={onClose} wide>
      {!lines ? (
        error ? <ErrorText>{error}</ErrorText> : <Loading />
      ) : (
        <form onSubmit={save} className="space-y-4">
          {hasPendingCheckin && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              ⏳ Staff have already checked this container in and it's waiting for approval. Changing it now may not match what they counted.
            </p>
          )}
          <Field label="Expected arrival (ETA)">
            <input type="date" className={`${inputClass} sm:w-56`} value={eta} onChange={(e) => setEta(e.target.value)} />
          </Field>

          <div>
            <div className="mb-2 text-sm font-medium">What's in the container</div>
            <div className="space-y-2">
              {lines.map((l) => {
                const m = models.find((x) => x.id === l.modelId)
                const isNew = l.ids.length === 0
                const diff = l.qty - l.ids.length
                return (
                  <div key={l.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                    {isNew ? (
                      <>
                        <div className="min-w-48 flex-1">
                          <ModelPicker models={models} value={l.modelId} onChange={(id) => update(l.key, { modelId: id, size: '' })} />
                        </div>
                        {m && m.sizes.length > 0 && (
                          <select className={`${inputClass} w-32`} value={l.size} onChange={(e) => update(l.key, { size: e.target.value })}>
                            <option value="">Size…</option>
                            {m.sizes.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        )}
                      </>
                    ) : (
                      <span className={`min-w-48 flex-1 font-medium ${l.qty === 0 ? 'text-slate-400 line-through' : ''}`}>
                        {labelFor(l.modelId, models, l.size)}
                      </span>
                    )}
                    {!isNew && diff !== 0 && (
                      <span className={`text-xs font-semibold ${diff < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                        was {l.ids.length} ({diff > 0 ? '+' : ''}
                        {diff})
                      </span>
                    )}
                    <div className="flex items-center">
                      <Button aria-label="One less" disabled={l.qty === 0} onClick={() => update(l.key, { qty: Math.max(0, l.qty - 1) })}>
                        −
                      </Button>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        aria-label="Quantity"
                        className={`${inputClass} mx-1 w-16 text-center`}
                        value={l.qty}
                        onChange={(e) => update(l.key, { qty: Math.max(0, parseInt(e.target.value) || 0) })}
                      />
                      <Button aria-label="One more" onClick={() => update(l.key, { qty: l.qty + 1 })}>
                        +
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      aria-label="Remove line"
                      onClick={() => (isNew ? setLines((ls) => ls!.filter((x) => x.key !== l.key)) : update(l.key, { qty: 0 }))}
                    >
                      ×
                    </Button>
                  </div>
                )
              })}
            </div>
            <Button size="sm" className="mt-2" onClick={() => setLines((ls) => [...ls!, { key: nextKey++, modelId: '', size: '', qty: 1, ids: [] }])}>
              + Add another item
            </Button>
          </div>

          <ErrorText>{error}</ErrorText>
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-sm text-slate-500">
              {total} item{total === 1 ? '' : 's'} in total
            </span>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
