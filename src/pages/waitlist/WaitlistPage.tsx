import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, friendlyError } from '../../lib/supabase'
import { selectAll } from '../../lib/selectAll'
import { useLive } from '../../lib/useLive'
import { useAuth } from '../../auth/AuthProvider'
import { personName, useProfiles } from '../../lib/useProfiles'
import type { Model, WaitlistEntry } from '../../lib/types'
import { Button, Confirm, Empty, ErrorText, Loading, Toast, fmtDate, inputClass } from '../../components/ui'
import { WaitlistForm } from './WaitlistForm'
import { WaitlistHistory } from './WaitlistHistory'
import { modelLabel } from '../../lib/modelLabel'
import { money } from '../../lib/money'

type Show = 'waiting' | 'contacted' | 'all'

interface Data {
  models: Model[]
  entries: WaitlistEntry[]
  inStock: { model_id: string }[]
}

async function loadAll() {
  const [models, entries, inStock] = await Promise.all([
    supabase!.from('models').select('*').order('model_number'),
    supabase!.from('waitlist').select('*').order('created_at'),
    selectAll(() => supabase!.from('machines').select('model_id').eq('status', 'in_stock').order('id')),
  ])
  const error = models.error ?? entries.error ?? inStock.error
  return {
    data: error
      ? null
      : { models: models.data as Model[], entries: entries.data as WaitlistEntry[], inStock: inStock.data as { model_id: string }[] },
    error,
  }
}

export function WaitlistPage() {
  const { isManager, profile } = useAuth()
  const profiles = useProfiles()
  const { data, error, loading } = useLive<Data>(['models', 'machines', 'waitlist'], loadAll)
  const [params, setParams] = useSearchParams()
  const modelFilter = params.get('model')
  const [show, setShow] = useState<Show>('waiting')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<{ entry?: WaitlistEntry; modelId?: string; deposit?: boolean } | null>(null)
  const [confirm, setConfirm] = useState<WaitlistEntry | null>(null)
  const [removeDeposit, setRemoveDeposit] = useState<WaitlistEntry | null>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)

  const groups = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    const stock = new Map<string, number>()
    for (const m of data.inStock) stock.set(m.model_id, (stock.get(m.model_id) ?? 0) + 1)

    const modelText = new Map(data.models.map((m) => [m.id, `${modelLabel(m, data.models)} ${m.name ?? ''}`.toLowerCase()]))
    const entries = data.entries.filter(
      (e) =>
        (show === 'all' || (show === 'waiting' ? !e.contacted : e.contacted)) &&
        (!modelFilter || e.model_id === modelFilter) &&
        (!q ||
          (modelText.get(e.model_id) ?? '').includes(q) ||
          [e.customer_name, e.phone, e.email, e.notes, e.size_wanted].some((v) => (v ?? '').toLowerCase().includes(q))),
    )
    return data.models
      .map((model) => ({
        model,
        inStock: stock.get(model.id) ?? 0,
        entries: entries.filter((e) => e.model_id === model.id && !e.deposit_paid),
      }))
      .filter((g) => g.entries.length > 0)
      .sort(
        (a, b) =>
          Number(b.inStock > 0) - Number(a.inStock > 0) ||
          a.model.model_number.localeCompare(b.model.model_number, undefined, { numeric: true }),
      )
  }, [data, search, show, modelFilter])

  // Customers who have paid a deposit get their own section at the top.
  const deposits = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.entries
      .filter((e) => e.deposit_paid)
      .filter((e) => show === 'all' || (show === 'waiting' ? !e.contacted : e.contacted))
      .filter((e) => !modelFilter || e.model_id === modelFilter)
      .filter(
        (e) =>
          !q ||
          `${modelLabel(data.models.find((m) => m.id === e.model_id), data.models)} ${e.customer_name} ${e.phone ?? ''} ${e.email ?? ''} ${e.notes ?? ''}`
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => (a.deposit_date ?? a.created_at).localeCompare(b.deposit_date ?? b.created_at))
  }, [data, search, show, modelFilter])
  const inStockOf = (id: string) => data?.inStock.filter((m) => m.model_id === id).length ?? 0

  const filteredModel = data?.models.find((m) => m.id === modelFilter)

  async function setContacted(e: WaitlistEntry, contacted: boolean, allowUndo = true) {
    const { error } = await supabase!
      .from('waitlist')
      .update(
        contacted
          ? { contacted: true, contacted_by: profile?.id, contacted_at: new Date().toISOString() }
          : { contacted: false, contacted_by: null, contacted_at: null },
      )
      .eq('id', e.id)
    if (error) return setToast({ text: friendlyError(error) })
    if (allowUndo)
      setToast({
        text: contacted ? `${e.customer_name} marked as contacted.` : `${e.customer_name} moved back to waiting.`,
        undo: () => setContacted(e, !contacted, false),
      })
  }

  async function remove(e: WaitlistEntry) {
    const { error } = await supabase!.from('waitlist').delete().eq('id', e.id)
    if (error) setToast({ text: friendlyError(error) })
    setConfirm(null)
  }

  const waitingTotal = data?.entries.filter((e) => !e.contacted).length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Waiting list</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Customers who wanted a model we didn't have in stock.</p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setForm({ modelId: modelFilter ?? undefined })} disabled={!data?.models.length}>
          + Add customer
        </Button>
      </div>

      {filteredModel && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm dark:bg-slate-800">
          Showing only <strong>{modelLabel(filteredModel, data?.models ?? [])}</strong>
          <button
            className="ml-auto font-medium text-brand-700 underline dark:text-brand-500"
            onClick={() => {
              const p = new URLSearchParams(params)
              p.delete('model')
              setParams(p, { replace: true })
            }}
          >
            Show all models
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex shrink-0 rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
          {(
            [
              ['waiting', `Waiting (${waitingTotal})`],
              ['contacted', 'Contacted'],
              ['all', 'All'],
            ] as [Show, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setShow(k)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
                show === k ? 'bg-brand-500 text-ink' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input className={inputClass} placeholder="Search model (e.g. X digger), customer name, phone, email…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Loading />
      ) : !data?.models.length ? (
        <Empty title="No models yet">A manager needs to add models on the Machines page first.</Empty>
      ) : groups.length === 0 && deposits.length === 0 ? (
        <Empty title={show === 'waiting' ? 'Nobody is waiting' : 'Nothing to show'}>
          {show === 'waiting' && !search ? 'When a customer asks for a model we don\'t have, click "+ Add customer".' : 'Try a different search or filter.'}
        </Empty>
      ) : (
        <div className="space-y-4">
          {deposits.length > 0 && (
            <section className="overflow-hidden rounded-xl border-2 border-green-600 bg-white dark:bg-slate-900">
              <header className="flex flex-wrap items-center gap-2 border-b border-green-200 bg-green-50 px-4 py-3 dark:border-green-900 dark:bg-green-950/40">
                <span className="text-lg font-bold">💷 Deposits paid</span>
                <span className="text-sm text-slate-600 dark:text-slate-300">Customers who have paid a deposit on a machine that hasn't arrived yet.</span>
                <span className="ml-auto text-xs font-semibold">
                  {deposits.length} customer{deposits.length === 1 ? '' : 's'}
                </span>
              </header>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {deposits.map((e) => {
                  const model = data?.models.find((m) => m.id === e.model_id)
                  const have = inStockOf(e.model_id)
                  return (
                    <li key={e.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start ${e.contacted ? 'opacity-60' : ''}`}>
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-base font-bold">{e.customer_name}</span>
                          <span className="font-bold">
                            wants{' '}
                            <Link to={`/machines?model=${e.model_id}`} className="underline">
                              {modelLabel(model, data?.models ?? [])}
                            </Link>
                            {e.size_wanted && ` (${e.size_wanted})`}
                          </span>
                          {have > 0 && <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">In stock · {have}</span>}
                        </div>
                        <div className="mt-1.5 inline-block rounded-lg bg-green-600 px-3 py-1 text-sm font-bold text-white">
                          💷 DEPOSIT PAID{!!e.deposit_amount && ` · ${money(e.deposit_amount)}`}
                          {e.deposit_date && ` · ${fmtDate(e.deposit_date)}`}
                        </div>
                        {e.deposit_by && <span className="ml-2 text-xs text-slate-500">recorded by {personName(profiles, e.deposit_by)}</span>}
                        <div className="mt-1 flex flex-wrap gap-x-4">
                          {e.phone && (
                            <a href={`tel:${e.phone.replace(/\s/g, '')}`} className="text-sky-700 underline dark:text-sky-300">
                              📞 {e.phone}
                            </a>
                          )}
                          {e.email && (
                            <a href={`mailto:${e.email}`} className="break-all text-sky-700 underline dark:text-sky-300">
                              ✉️ {e.email}
                            </a>
                          )}
                        </div>
                        {e.notes && <div className="mt-1 text-slate-500 dark:text-slate-400">{e.notes}</div>}
                        {e.contacted && (
                          <div className="mt-1 text-xs text-green-700 dark:text-green-400">
                            ✓ Contacted by {personName(profiles, e.contacted_by)} on {e.contacted_at && fmtDate(e.contacted_at)}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {e.contacted ? (
                          <Button size="sm" onClick={() => setContacted(e, false)}>
                            Undo contacted
                          </Button>
                        ) : (
                          <Button size="sm" variant="primary" onClick={() => setContacted(e, true)}>
                            Mark contacted
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setForm({ entry: e })}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setRemoveDeposit(e)}>
                          Remove deposit
                        </Button>
                        {isManager && (
                          <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setConfirm(e)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          {groups.map((g) => (
            <section key={g.model.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <Link to={`/machines?model=${g.model.id}`} className="font-semibold hover:underline">
                  {modelLabel(g.model, data?.models ?? [])}
                </Link>
                {g.model.name && <span className="text-slate-500 dark:text-slate-400">{g.model.name}</span>}
                {g.inStock > 0 && (
                  <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">
                    Back in stock · {g.inStock}
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-500">
                  {g.entries.length} customer{g.entries.length === 1 ? '' : 's'}
                </span>
              </header>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {g.entries.map((e) => (
                  <li key={e.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start ${e.contacted ? 'opacity-60' : ''}`}>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3">
                        <span className="font-medium">{e.customer_name}</span>
                        {e.size_wanted && <span className="text-slate-500">wants {e.size_wanted}</span>}
                        <span className="text-xs text-slate-400">Added {fmtDate(e.created_at)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4">
                        {e.phone && (
                          <a href={`tel:${e.phone.replace(/\s/g, '')}`} className="text-sky-700 underline dark:text-sky-300">
                            📞 {e.phone}
                          </a>
                        )}
                        {e.email && (
                          <a href={`mailto:${e.email}`} className="break-all text-sky-700 underline dark:text-sky-300">
                            ✉️ {e.email}
                          </a>
                        )}
                      </div>
                      {e.notes && <div className="mt-1 text-slate-500 dark:text-slate-400">{e.notes}</div>}
                      {e.contacted && (
                        <div className="mt-1 text-xs text-green-700 dark:text-green-400">
                          ✓ Contacted by {personName(profiles, e.contacted_by)} on {e.contacted_at && fmtDate(e.contacted_at)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {e.contacted ? (
                        <Button size="sm" onClick={() => setContacted(e, false)}>
                          Undo contacted
                        </Button>
                      ) : (
                        <Button size="sm" variant="primary" onClick={() => setContacted(e, true)}>
                          Mark contacted
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setForm({ entry: e })}>
                        Edit
                      </Button>
                      {isManager && (
                        <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setConfirm(e)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {isManager && data && <WaitlistHistory models={data.models} />}

      {form && data && <WaitlistForm models={data.models} entry={form.entry} defaultModelId={form.modelId} deposit={form.deposit} onClose={() => setForm(null)} />}
      {removeDeposit && (
        <Confirm
          title="Remove the deposit?"
          message={`${removeDeposit.customer_name} stays on the waiting list as a normal customer, with no deposit. Use this if the deposit was added by mistake or refunded.`}
          confirmLabel="Remove deposit"
          onConfirm={async () => {
            const { error } = await supabase!
              .from('waitlist')
              .update({ deposit_paid: false, deposit_amount: null, deposit_date: null, deposit_by: null })
              .eq('id', removeDeposit.id)
            setRemoveDeposit(null)
            setToast({ text: error ? friendlyError(error) : `Deposit removed for ${removeDeposit.customer_name}.` })
          }}
          onCancel={() => setRemoveDeposit(null)}
        />
      )}
      {confirm && (
        <Confirm
          title="Delete waiting customer?"
          message={`This permanently removes ${confirm.customer_name} from the waiting list. To keep a record, use "Mark contacted" instead.`}
          onConfirm={() => remove(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {toast && (
        <Toast onClose={() => setToast(null)}>
          {toast.text}
          {toast.undo && (
            <button
              className="font-semibold underline"
              onClick={() => {
                toast.undo!()
                setToast(null)
              }}
            >
              Undo
            </button>
          )}
        </Toast>
      )}
    </div>
  )
}
