import { useMemo, useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { accessoryBaseName } from '../../lib/modelLabel'
import { money, priceOf } from '../../lib/money'
import type { Machine, Model } from '../../lib/types'
import { Button, ErrorText, Modal } from '../../components/ui'

// Accessories with the same part name on different machines, e.g. "Hydraulic Thumb" saved
// separately for the B1000, B1200 and B1800. Founder only.
export function duplicateAccessoryGroups(models: Model[]) {
  const groups = new Map<string, Model[]>()
  for (const m of models) {
    if (m.kind !== 'accessory') continue
    const k = accessoryBaseName(m, models).trim().toLowerCase()
    groups.set(k, [...(groups.get(k) ?? []), m])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

export function MergeAccessories({ models, machines, onClose, onDone }: { models: Model[]; machines: Machine[]; onClose: () => void; onDone: (msg: string) => void }) {
  const groups = useMemo(() => duplicateAccessoryGroups(models), [models])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const machineNo = (id: string) => models.find((m) => m.id === id)?.model_number ?? '?'
  const stockOf = (id: string) => machines.filter((m) => m.model_id === id && m.status !== 'sold').length

  async function merge(group: Model[]) {
    // Keep one that already has a price, if any.
    const keep = group.find((m) => priceOf(m, m.sizes[0]) != null) ?? group[0]
    const base = accessoryBaseName(keep, models).trim()
    const fits = [...new Set(group.flatMap((m) => m.fits_models ?? []))]
    const name = `${base} ${fits.map(machineNo).join('/')}`
    setBusy(keep.id)
    setError('')
    const { error } = await supabase!.rpc('merge_accessories', {
      p_keep: keep.id,
      p_merge: group.filter((m) => m.id !== keep.id).map((m) => m.id),
      p_name: name,
    })
    setBusy(null)
    if (error)
      return setError(
        /merge_accessories/.test(error.message)
          ? 'Merging is not switched on yet. Run database/11-merge-accessories.sql in Supabase first.'
          : friendlyError(error),
      )
    onDone(`Merged into one accessory: ${name}`)
  }

  return (
    <Modal title="🔗 Merge duplicate accessories" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          These accessories have the same name but were saved separately for each machine. Merging makes each set <strong>one accessory</strong>{' '}
          that fits all those machines, with one price and one stock count. Stock and waiting customers move across. Only merge parts that
          really are identical.
        </p>
        <ErrorText>{error}</ErrorText>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-slate-500">No duplicates found. 👍</p>
        ) : (
          groups.map((g) => {
            const keep = g.find((m) => priceOf(m, m.sizes[0]) != null) ?? g[0]
            const fits = [...new Set(g.flatMap((m) => m.fits_models ?? []))]
            const prices = [...new Set(g.map((m) => priceOf(m, m.sizes[0])).filter((p): p is number => p != null))]
            return (
              <section key={g[0].id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="font-semibold">🔧 {accessoryBaseName(keep, models)}</div>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {g.map((m) => (
                    <li key={m.id} className="flex flex-wrap gap-x-3">
                      <span>{m.model_number}</span>
                      <span className="text-slate-500">{priceOf(m, m.sizes[0]) != null ? money(priceOf(m, m.sizes[0])!) : 'no price'}</span>
                      <span className="text-slate-500">{stockOf(m.id)} in stock / on the way</span>
                    </li>
                  ))}
                </ul>
                {prices.length > 1 && (
                  <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    ⚠️ These have different prices. If they're really different parts, don't merge them.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-slate-500">
                    Becomes: <strong className="text-slate-800 dark:text-slate-100">{`${accessoryBaseName(keep, models).trim()} ${fits.map(machineNo).join('/')}`}</strong>
                    {priceOf(keep, keep.sizes[0]) != null && <> at {money(priceOf(keep, keep.sizes[0])!)}</>}
                  </span>
                  <Button size="sm" variant="primary" className="ml-auto" disabled={!!busy} onClick={() => merge(g)}>
                    {busy === keep.id ? 'Merging…' : 'Merge into one'}
                  </Button>
                </div>
              </section>
            )
          })
        )}
      </div>
    </Modal>
  )
}
