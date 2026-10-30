import { useState } from 'react'
import type { Container } from '../../lib/calendarData'
import { addDays } from '../../lib/dates'
import type { ContainerCheckin } from '../../lib/types'
import { Button, Modal, fmtDate, today } from '../../components/ui'

function when(eta: string | null) {
  if (!eta) return { text: 'No ETA set', tone: 'text-slate-500' }
  const now = today()
  if (eta < now) return { text: `Overdue · ETA ${fmtDate(eta)}`, tone: 'font-semibold text-red-600 dark:text-red-400' }
  if (eta === now) return { text: 'Due today', tone: 'font-semibold text-green-700 dark:text-green-400' }
  let days = 0
  for (let d = now; d < eta; d = addDays(d, 1)) days++
  return { text: `ETA ${fmtDate(eta)} · in ${days} day${days === 1 ? '' : 's'}`, tone: 'text-slate-600 dark:text-slate-300' }
}

// Large window over the Machines page: every container on the way, and the chosen one's contents and actions.
export function ContainersWindow({
  containers,
  initial,
  pendingFor,
  isManager,
  onCheckIn,
  onReview,
  onClose,
}: {
  containers: Container[]
  initial: string | null
  pendingFor: (ref: string) => ContainerCheckin | undefined
  isManager: boolean
  onCheckIn: (ref: string) => void
  onReview: (c: ContainerCheckin) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState(initial && containers.some((c) => c.ref === initial) ? initial : containers[0]?.ref ?? null)
  const c = containers.find((x) => x.ref === selected)
  const pending = c ? pendingFor(c.ref) : undefined

  return (
    <Modal title="🚢 Containers on the way" onClose={onClose} wide="xl">
      {containers.length === 0 ? (
        <p className="py-8 text-center text-slate-500">No containers on the way.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {containers.map((x) => {
              const w = when(x.eta)
              return (
                <li key={x.ref}>
                  <button
                    onClick={() => setSelected(x.ref)}
                    className={`w-full rounded-xl border-2 p-3 text-left ${
                      x.ref === selected ? 'border-ink bg-brand-50 dark:border-brand-500 dark:bg-slate-800' : 'border-slate-200 hover:border-brand-500 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📦</span>
                      <span className="font-bold">{x.ref}</span>
                      <span className="ml-auto text-sm font-semibold">{x.total} items</span>
                    </div>
                    <div className={`text-sm ${w.tone}`}>{w.text}</div>
                    {pendingFor(x.ref) && (
                      <div className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        ⏳ Waiting for approval
                      </div>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          {c && (
            <section className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-start gap-3">
                <div>
                  <h3 className="text-2xl font-bold">📦 {c.ref}</h3>
                  <p className={when(c.eta).tone}>{when(c.eta).text}</p>
                </div>
                <div className="ml-auto">
                  {pending ? (
                    isManager ? (
                      <Button variant="primary" className="px-5 py-3 text-base" onClick={() => onReview(pending)}>
                        ⏳ Review & approve
                      </Button>
                    ) : (
                      <span className="inline-block rounded-xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        ⏳ Submitted. Waiting for a manager to approve
                      </span>
                    )
                  ) : (
                    <Button variant="primary" className="px-5 py-3 text-base" onClick={() => onCheckIn(c.ref)}>
                      ✅ Check in container
                    </Button>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">What's in it</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {c.contents.map(([label, n]) => (
                      <tr key={label}>
                        <td className="px-3 py-2">{label}</td>
                        <td className="px-3 py-2 text-right font-semibold">{n}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold dark:bg-slate-800/50">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right">{c.total}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {!pending && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  When it lands, click <strong>Check in container</strong> and count what actually arrived.{' '}
                  {isManager ? 'Your check-in goes straight into stock.' : 'A manager then approves it before it goes into stock.'}
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}
