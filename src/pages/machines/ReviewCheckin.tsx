import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { personName, useProfiles } from '../../lib/useProfiles'
import { labelFor } from '../../lib/modelLabel'
import type { ContainerCheckin, Machine, Model } from '../../lib/types'
import { Button, ErrorText, Modal, fmtDateTime } from '../../components/ui'

const list = (counts: Map<string, number>) =>
  [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([l, n]) => `${n}× ${l}`)
    .join(', ')

// Manager (or founder) checks a staff member's container check-in, then approves or rejects it.
export function ReviewCheckin({
  checkin: c,
  machines,
  models,
  onClose,
  onDone,
}: {
  checkin: ContainerCheckin
  machines: Machine[]
  models: Model[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  const profiles = useProfiles()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const count = (ids: string[]) => {
    const m = new Map<string, number>()
    for (const id of ids) {
      const machine = machines.find((x) => x.id === id)
      if (!machine) continue
      const l = labelFor(machine.model_id, models, machine.size)
      m.set(l, (m.get(l) ?? 0) + 1)
    }
    return m
  }
  const arrived = count(c.arrive_ids)
  const removed = count(c.remove_ids)
  const expected = machines.filter((m) => m.status === 'en_route' && m.container_ref === c.container_ref).length
  const extras = new Map(c.extras.map((e) => [labelFor(e.model_id, models, e.size), e.qty]))
  const stillOnWay = expected - c.arrive_ids.length - c.remove_ids.length

  async function decide(approve: boolean) {
    setBusy(true)
    setError('')
    const { error } = approve
      ? await supabase!.rpc('approve_container_checkin', { p_id: c.id })
      : await supabase!
          .from('container_checkins')
          .update({ status: 'rejected', decided_by: (await supabase!.auth.getUser()).data.user?.id, decided_at: new Date().toISOString() })
          .eq('id', c.id)
    setBusy(false)
    if (error) return setError(friendlyError(error))
    onDone(approve ? `Container ${c.container_ref} approved and added to stock.` : `Check-in for ${c.container_ref} rejected. Staff can submit it again.`)
  }

  return (
    <Modal title={`Approve check-in: ${c.container_ref}`} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600 dark:text-slate-300">
          Submitted by <strong>{personName(profiles, c.submitted_by)}</strong> · {fmtDateTime(c.submitted_at)}
          {c.location && <> · Location: {c.location}</>}
        </p>
        <div className="rounded-lg bg-green-50 p-3 dark:bg-green-950/30">
          <div className="font-semibold">✅ Arrived: {c.arrive_ids.length} into stock</div>
          <div>{list(arrived) || 'Nothing'}</div>
        </div>
        {extras.size > 0 && (
          <div className="rounded-lg bg-sky-50 p-3 dark:bg-sky-950/30">
            <div className="font-semibold">➕ Extras not on the list (added to stock)</div>
            <div>{list(extras)}</div>
          </div>
        )}
        {removed.size > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
            <div className="font-semibold">⚠️ Missing: removed from the system</div>
            <div>{list(removed)}</div>
          </div>
        )}
        {stillOnWay > 0 && <p className="text-slate-500">{stillOnWay} item(s) short will stay as still on the way.</p>}
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button variant="danger" disabled={busy} onClick={() => decide(false)}>
            Reject
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => decide(true)}>
            {busy ? 'Saving…' : 'Approve and add to stock'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
