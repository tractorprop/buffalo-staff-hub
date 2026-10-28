import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, friendlyError } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { useAuth } from '../../auth/AuthProvider'
import type { Machine, MachineStatus, Model, WaitlistEntry } from '../../lib/types'
import {
  Button,
  Confirm,
  CountPill,
  Empty,
  ErrorText,
  Loading,
  Modal,
  StatusBadge,
  Toast,
  fmtDate,
  inputClass,
  today,
} from '../../components/ui'
import { ModelForm } from './ModelForm'
import { MachineForm } from './MachineForm'
import { History } from './History'
import { ContainerForm } from './ContainerForm'
import { CheckInContainer } from './CheckInContainer'

type Filter = 'all' | MachineStatus
type Sort = 'model' | 'in_stock' | 'waiting'

interface Data {
  models: Model[]
  machines: Machine[]
  waiting: WaitlistEntry[]
}

async function loadAll() {
  const [models, machines, waiting] = await Promise.all([
    supabase!.from('models').select('*').order('model_number'),
    supabase!.from('machines').select('*').order('created_at'),
    supabase!.from('waitlist').select('*').eq('contacted', false).order('created_at'),
  ])
  const error = models.error ?? machines.error ?? waiting.error
  return {
    data: error ? null : { models: models.data as Model[], machines: machines.data as Machine[], waiting: waiting.data as WaitlistEntry[] },
    error,
  }
}

const statusOrder: Record<MachineStatus, number> = { in_stock: 0, en_route: 1, sold: 2 }

export function MachinesPage() {
  const { isManager } = useAuth()
  const { data, error, loading } = useLive<Data>(['models', 'machines', 'waitlist'], loadAll)
  const [params, setParams] = useSearchParams()
  const filter = (params.get('status') as Filter) || 'all'
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('model')
  const [open, setOpen] = useState<Set<string>>(new Set(params.get('model') ? [params.get('model')!] : []))

  const [modelForm, setModelForm] = useState<{ model?: Model; accessoryFor?: string } | null>(null)
  const [machineForm, setMachineForm] = useState<{ machine?: Machine; modelId?: string } | null>(null)
  const [containerForm, setContainerForm] = useState(false)
  const [showContainers, setShowContainers] = useState(false)
  const [checkIn, setCheckIn] = useState<string | null>(null)
  const [history, setHistory] = useState<{ machine: Machine; title: string } | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmLabel?: string; run: () => Promise<void> } | null>(null)
  const [toast, setToast] = useState('')

  const rows = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    const numberOf = (id: string) => data.models.find((m) => m.id === id)
    const list = data.models.map((model) => {
      const machines = data.machines
        .filter((m) => m.model_id === model.id)
        .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || (a.size ?? '').localeCompare(b.size ?? ''))
      const count = (s: MachineStatus) => machines.filter((m) => m.status === s).length
      return {
        model,
        machines,
        waiting: data.waiting.filter((w) => w.model_id === model.id),
        inStock: count('in_stock'),
        enRoute: count('en_route'),
        sold: count('sold'),
      }
    })
    return list
      .filter((r) => filter === 'all' || r.machines.some((m) => m.status === filter))
      .filter(
        (r) =>
          !q ||
          r.model.model_number.toLowerCase().includes(q) ||
          (r.model.name ?? '').toLowerCase().includes(q) ||
          (r.model.fits_models ?? []).some((id) => `${numberOf(id)?.model_number} ${numberOf(id)?.name ?? ''}`.toLowerCase().includes(q)) ||
          r.machines.some((m) =>
            [m.serial_number, m.container_ref, m.location, m.notes].some((v) => (v ?? '').toLowerCase().includes(q)),
          ),
      )
      .sort((a, b) =>
        sort === 'in_stock'
          ? b.inStock - a.inStock
          : sort === 'waiting'
            ? b.waiting.length - a.waiting.length
            : a.model.model_number.localeCompare(b.model.model_number, undefined, { numeric: true }),
      )
  }, [data, search, filter, sort])

  type Row = (typeof rows)[number]
  const machineRows = rows.filter((r) => r.model.kind !== 'accessory')
  const accessoryRows = rows.filter((r) => r.model.kind === 'accessory')
  const inStockOf = (id: string) => data?.machines.filter((m) => m.model_id === id && m.status === 'in_stock').length ?? 0

  function openModel(id: string) {
    setOpen((prev) => new Set(prev).add(id))
    setTimeout(() => document.getElementById(`model-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const totals = useMemo(() => {
    const ms = data?.machines ?? []
    return {
      all: data?.models.length ?? 0,
      in_stock: ms.filter((m) => m.status === 'in_stock').length,
      en_route: ms.filter((m) => m.status === 'en_route').length,
      sold: ms.filter((m) => m.status === 'sold').length,
    }
  }, [data])

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function setStatus(m: Machine, status: MachineStatus) {
    const { error } = await supabase!
      .from('machines')
      .update({ status, sold_date: status === 'sold' ? today() : null })
      .eq('id', m.id)
    if (error) setToast(friendlyError(error))
  }

  function askDeleteMachine(m: Machine, modelNumber: string) {
    setConfirm({
      title: 'Delete machine?',
      message: `This permanently removes this ${modelNumber}${m.serial_number ? ` (serial ${m.serial_number})` : ''}. If it was sold, consider keeping it for your records instead.`,
      run: async () => {
        const { error } = await supabase!.from('machines').delete().eq('id', m.id)
        if (error) setToast(friendlyError(error))
        setConfirm(null)
      },
    })
  }

  function askDeleteModel(model: Model) {
    setConfirm({
      title: `Delete model ${model.model_number}?`,
      message: 'You can only delete a model that has no machines and no waiting customers.',
      run: async () => {
        const { error } = await supabase!.from('models').delete().eq('id', model.id)
        if (error)
          setToast(
            error.code === '23503'
              ? `${model.model_number} still has machines or waiting customers, so it can't be deleted.`
              : friendlyError(error),
          )
        setConfirm(null)
      },
    })
  }

  // Containers on the way: en-route machines grouped by container reference.
  const containers = useMemo(() => {
    if (!data) return []
    const byRef = new Map<string, Machine[]>()
    for (const m of data.machines) {
      if (m.status !== 'en_route' || !m.container_ref) continue
      byRef.set(m.container_ref, [...(byRef.get(m.container_ref) ?? []), m])
    }
    return [...byRef.entries()]
      .map(([ref, machines]) => {
        const counts = new Map<string, number>()
        for (const m of machines) {
          const model = data.models.find((x) => x.id === m.model_id)
          const label = `${model?.model_number ?? '?'}${m.size ? ` ${m.size}` : ''}`
          counts.set(label, (counts.get(label) ?? 0) + 1)
        }
        const etas = machines.map((m) => m.eta).filter(Boolean).sort() as string[]
        return { ref, eta: etas[0] ?? null, total: machines.length, contents: [...counts.entries()] }
      })
      .sort((a, b) => (a.eta ?? '9999').localeCompare(b.eta ?? '9999'))
  }, [data])

  const tabs: { key: Filter; label: string; n: number }[] = [
    { key: 'all', label: 'All models', n: totals.all },
    { key: 'in_stock', label: 'In stock', n: totals.in_stock },
    { key: 'en_route', label: 'En route', n: totals.en_route },
    { key: 'sold', label: 'Sold', n: totals.sold },
  ]

  function renderRow(r: Row) {
            const isOpen = open.has(r.model.id) || (search.trim() !== '' && rows.length <= 3)
            const shown = filter === 'all' ? r.machines : r.machines.filter((m) => m.status === filter)
            return (
              <li key={r.model.id} id={`model-${r.model.id}`} className="scroll-mt-20 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <button onClick={() => toggle(r.model.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left">
                  <span className="text-slate-400">{isOpen ? '▾' : '▸'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{r.model.model_number}</span>
                    {r.model.name && <span className="ml-2 text-slate-500 dark:text-slate-400">{r.model.name}</span>}
                    {r.model.kind === 'accessory' && (r.model.fits_models ?? []).length > 0 && (
                      <span className="ml-2 text-xs text-slate-400">
                        Fits {(r.model.fits_models ?? []).map((id) => data?.models.find((m) => m.id === id)?.model_number).filter(Boolean).join(', ')}
                      </span>
                    )}
                    {r.model.sizes.length > 0 && (
                      <span className="ml-2 text-xs text-slate-400">Sizes: {r.model.sizes.join(', ')}</span>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <CountPill n={r.inStock} label="in stock" tone="green" />
                    <CountPill n={r.enRoute} label="en route" tone="amber" />
                    <CountPill n={r.sold} label="sold" tone="grey" />
                    <CountPill n={r.waiting.length} label="waiting" tone="blue" />
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-4 border-t border-slate-200 px-4 py-4 dark:border-slate-800">
                    {r.model.notes && <p className="text-sm text-slate-600 dark:text-slate-300">{r.model.notes}</p>}

                    {isManager && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => setModelForm({ model: r.model })}>
                          Edit {r.model.kind === 'accessory' ? 'accessory' : 'model'}
                        </Button>
                        {r.model.kind !== 'accessory' && (
                          <Button size="sm" onClick={() => setModelForm({ accessoryFor: r.model.id })}>
                            + Add accessory for this machine
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => askDeleteModel(r.model)}>
                          Delete
                        </Button>
                      </div>
                    )}

                    {shown.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No {filter === 'all' ? '' : filter === 'in_stock' ? 'in-stock ' : filter === 'en_route' ? 'en-route ' : 'sold '}
                        machines for this model.
                      </p>
                    ) : (
                      <MachineList
                        machines={shown}
                        hasSizes={r.model.sizes.length > 0}
                        isManager={isManager}
                        onEdit={(m) => setMachineForm({ machine: m })}
                        onHistory={(m) => setHistory({ machine: m, title: `${r.model.model_number}${m.size ? ` ${m.size}` : ''}` })}
                        onArrived={(m) => setStatus(m, 'in_stock')}
                        onSold={(m) => setStatus(m, 'sold')}
                        onDelete={(m) => askDeleteMachine(m, r.model.model_number)}
                      />
                    )}

                    {r.model.kind !== 'accessory' && (() => {
                      const accs = (data?.models ?? []).filter((m) => m.kind === 'accessory' && (m.fits_models ?? []).includes(r.model.id))
                      if (!accs.length) return null
                      return (
                        <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                          <div className="mb-1 font-medium">Accessories for this machine</div>
                          <ul className="flex flex-wrap gap-2">
                            {accs.map((a) => (
                              <li key={a.id}>
                                <button
                                  onClick={() => openModel(a.id)}
                                  className="rounded-full border border-slate-300 px-2.5 py-1 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                                >
                                  {a.model_number}
                                  {a.name && <span className="text-slate-500"> {a.name}</span>}
                                  <span className={`ml-1.5 font-semibold ${inStockOf(a.id) ? 'text-green-700 dark:text-green-400' : 'text-slate-400'}`}>
                                    {inStockOf(a.id)}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })()}

                    <div className="rounded-lg bg-sky-50 p-3 text-sm dark:bg-sky-950/40">
                      {r.waiting.length === 0 ? (
                        <span className="text-slate-600 dark:text-slate-300">No customers waiting for this model.</span>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">
                              {r.waiting.length} customer{r.waiting.length === 1 ? '' : 's'} waiting
                            </span>
                            <Link to={`/waitlist?model=${r.model.id}`} className="font-medium text-sky-700 underline dark:text-sky-300">
                              Open waiting list →
                            </Link>
                          </div>
                          <ul className="mt-2 space-y-1">
                            {r.waiting.map((w) => (
                              <li key={w.id} className="flex flex-wrap gap-x-3">
                                <span>{w.customer_name}</span>
                                {w.size_wanted && <span className="text-slate-500">wants {w.size_wanted}</span>}
                                {w.phone && (
                                  <a href={`tel:${w.phone}`} className="text-sky-700 underline dark:text-sky-300">
                                    {w.phone}
                                  </a>
                                )}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Machines</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link
            to="/stock"
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            ± Stock entry
          </Link>
          <Button onClick={() => setModelForm({})} disabled={!isManager} title={isManager ? undefined : 'Managers only'}>
            + Add model / accessory
          </Button>
          <Button
            variant="primary"
            onClick={() => setContainerForm(true)}
            disabled={!isManager || !data?.models.length}
            title={isManager ? undefined : 'Managers only'}
          >
            + Add container
          </Button>
        </div>
      </div>

      {containers.length > 0 && (
        <button
          onClick={() => setShowContainers(true)}
          className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:hover:bg-amber-950/60"
        >
          <span className="font-semibold">🚢 Containers on the way</span>
          <span>
            <strong>{containers.length}</strong> container{containers.length === 1 ? '' : 's'} ·{' '}
            <strong>{containers.reduce((n, c) => n + c.total, 0)}</strong> machines
          </span>
          {containers[0].eta && <span className="text-slate-600 dark:text-slate-300">Next ETA {fmtDate(containers[0].eta)}</span>}
          <span className="ml-auto font-medium text-amber-800 underline dark:text-amber-300">View all →</span>
        </button>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              const p = new URLSearchParams(params)
              if (t.key === 'all') p.delete('status')
              else p.set('status', t.key)
              setParams(p, { replace: true })
            }}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              filter === t.key
                ? 'border-brand-600 text-brand-700 dark:text-brand-500'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t.label} <span className="ml-1 text-xs opacity-70">{t.n}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={inputClass}
          placeholder="Search model, name, serial number, container…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={`${inputClass} sm:w-56`} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="model">Sort: Model number</option>
          <option value="in_stock">Sort: Most in stock</option>
          <option value="waiting">Sort: Most customers waiting</option>
        </select>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Loading />
      ) : !data?.models.length ? (
        <Empty title="No models yet">
          {isManager ? 'Click "+ Add model" to add each model you sell, then "+ Add container" to add stock.' : 'A manager needs to add the models you sell.'}
        </Empty>
      ) : rows.length === 0 ? (
        <Empty title="Nothing matches">Try a different search or tab.</Empty>
      ) : (
        <>
          {machineRows.length > 0 && (
            <section className="space-y-2">
              {accessoryRows.length > 0 && <h2 className="text-lg font-semibold">Machines</h2>}
              <ul className="space-y-2">{machineRows.map(renderRow)}</ul>
            </section>
          )}
          {accessoryRows.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Accessories</h2>
              <ul className="space-y-2">{accessoryRows.map(renderRow)}</ul>
            </section>
          )}
        </>
      )}

      {modelForm && data && (
        <ModelForm model={modelForm.model} models={data.models} accessoryFor={modelForm.accessoryFor} onClose={() => setModelForm(null)} />
      )}
      {machineForm && data && (
        <MachineForm
          models={data.models}
          machine={machineForm.machine}
          defaultModelId={machineForm.modelId}
          onClose={() => setMachineForm(null)}
        />
      )}
      {showContainers && (
        <Modal title="Containers on the way" onClose={() => setShowContainers(false)} wide>
          {containers.length === 0 ? (
            <p className="text-sm text-slate-500">No containers on the way.</p>
          ) : (
            <ul className="space-y-2">
              {containers.map((c) => (
                <li key={c.ref} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 text-sm sm:flex-row sm:items-center dark:border-slate-800">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      📦 {c.ref}
                      <span className="ml-2 font-normal text-slate-500">
                        {c.total} machine{c.total === 1 ? '' : 's'}
                        {c.eta && ` · ETA ${fmtDate(c.eta)}`}
                      </span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-300">{c.contents.map(([label, n]) => `${n}× ${label}`).join(', ')}</div>
                  </div>
                  {isManager && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setShowContainers(false)
                        setCheckIn(c.ref)
                      }}
                    >
                      Check in container
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
      {checkIn && data && (
        <CheckInContainer
          containerRef={checkIn}
          machines={data.machines}
          models={data.models}
          onClose={() => setCheckIn(null)}
          onDone={(summary) => {
            setCheckIn(null)
            setToast(summary)
          }}
        />
      )}
      {containerForm && data && <ContainerForm models={data.models} onClose={() => setContainerForm(false)} />}
      {history && data && (
        <History machineId={history.machine.id} title={history.title} models={data.models} onClose={() => setHistory(null)} />
      )}
      {confirm && <Confirm title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} onConfirm={confirm.run} onCancel={() => setConfirm(null)} />}
      {toast && <Toast onClose={() => setToast('')}>{toast}</Toast>}
    </div>
  )
}

function MachineList({
  machines,
  hasSizes,
  isManager,
  onEdit,
  onHistory,
  onArrived,
  onSold,
  onDelete,
}: {
  machines: Machine[]
  hasSizes: boolean
  isManager: boolean
  onEdit: (m: Machine) => void
  onHistory: (m: Machine) => void
  onArrived: (m: Machine) => void
  onSold: (m: Machine) => void
  onDelete: (m: Machine) => void
}) {
  const actions = (m: Machine) => (
    <div className="flex flex-wrap gap-1.5">
      {isManager && m.status === 'en_route' && (
        <Button size="sm" variant="primary" onClick={() => onArrived(m)}>
          Mark arrived
        </Button>
      )}
      {isManager && m.status === 'in_stock' && (
        <Button size="sm" onClick={() => onSold(m)}>
          Mark sold
        </Button>
      )}
      {isManager && (
        <Button size="sm" variant="ghost" onClick={() => onEdit(m)}>
          Edit
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => onHistory(m)}>
        History
      </Button>
      {isManager && (
        <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => onDelete(m)}>
          Delete
        </Button>
      )}
    </div>
  )

  const detail = (m: Machine) =>
    m.status === 'en_route'
      ? [m.container_ref && `Container ${m.container_ref}`, m.eta && `ETA ${fmtDate(m.eta)}`].filter(Boolean).join(' · ')
      : m.status === 'sold'
        ? m.sold_date && `Sold ${fmtDate(m.sold_date)}`
        : ''

  return (
    <>
      {/* Phone layout */}
      <ul className="space-y-2 md:hidden">
        {machines.map((m) => (
          <li key={m.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={m.status} />
              {hasSizes && <span className="font-medium">{m.size}</span>}
              {m.serial_number && <span className="text-slate-500">S/N {m.serial_number}</span>}
            </div>
            {(detail(m) || m.location) && (
              <div className="mt-1 text-slate-600 dark:text-slate-300">{[detail(m), m.location].filter(Boolean).join(' · ')}</div>
            )}
            {m.notes && <div className="mt-1 text-slate-500">{m.notes}</div>}
            <div className="mt-2">{actions(m)}</div>
          </li>
        ))}
      </ul>

      {/* Desktop layout */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-2 pr-3">Status</th>
              {hasSizes && <th className="py-2 pr-3">Size</th>}
              <th className="py-2 pr-3">Serial no.</th>
              <th className="py-2 pr-3">Container / ETA</th>
              <th className="py-2 pr-3">Location</th>
              <th className="py-2 pr-3">Notes</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {machines.map((m) => (
              <tr key={m.id} className="align-top">
                <td className="py-2 pr-3">
                  <StatusBadge status={m.status} />
                </td>
                {hasSizes && <td className="py-2 pr-3 font-medium">{m.size}</td>}
                <td className="py-2 pr-3">{m.serial_number}</td>
                <td className="py-2 pr-3">{detail(m)}</td>
                <td className="py-2 pr-3">{m.location}</td>
                <td className="py-2 pr-3 text-slate-500">{m.notes}</td>
                <td className="py-2">{actions(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
