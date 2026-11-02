import { useMemo, useState } from 'react'
import type { Model, WaitlistEntry } from '../../lib/types'
import { labelFor } from '../../lib/modelLabel'
import { personName, useProfiles } from '../../lib/useProfiles'
import { HistorySection, useAuditLog, type HistoryEvent } from '../../components/HistorySection'

// Who added people to the waiting list, who contacted them and who removed them.
export function WaitlistHistory({ models }: { models: Model[] }) {
  const profiles = useProfiles()
  const [days, setDays] = useState(180)
  const { data, error, reload } = useAuditLog('waitlist', days)

  const events = useMemo(
    () =>
      (data ?? []).flatMap((e): HistoryEvent[] => {
        const o = e.old_data as Partial<WaitlistEntry> | null
        const n = e.new_data as Partial<WaitlistEntry> | null
        const w = (n ?? o)!
        const what = `${w.customer_name ?? '?'} · ${labelFor(w.model_id ?? '', models, w.size_wanted)}`
        let icon = '✏️'
        let title = `Edited: ${what}`
        let kind = 'edited'
        if (e.action === 'INSERT') [icon, title, kind] = ['➕', `Added: ${what}`, 'added']
        else if (e.action === 'DELETE') [icon, title, kind] = ['🗑️', `Removed: ${what}`, 'removed']
        else if (!o?.contacted && n?.contacted) [icon, title, kind] = ['📞', `Contacted: ${what}`, 'contacted']
        else if (o?.contacted && !n?.contacted) [icon, title, kind] = ['↩️', `Moved back to waiting: ${what}`, 'edited']
        return [
          {
            key: String(e.id),
            at: e.changed_at,
            by: e.changed_by,
            icon,
            kind,
            title,
            detail: e.action === 'INSERT' && w.notes ? <span className="text-xs">Note: {w.notes}</span> : undefined,
            search: `${title} ${w.notes ?? ''} ${personName(profiles, e.changed_by)}`,
            ids: [e.id],
          },
        ]
      }),
    [data, models, profiles],
  )

  return (
    <HistorySection
      title="📜 Waiting list history"
      description="Who added each customer, who contacted them and who removed them."
      events={events}
      kinds={[
        ['added', '➕ Added'],
        ['contacted', '📞 Contacted'],
        ['removed', '🗑️ Removed'],
        ['edited', '✏️ Changes'],
      ]}
      days={days}
      onLoadOlder={() => setDays((d) => d + 365)}
      error={error}
      onDeleted={reload}
    />
  )
}
