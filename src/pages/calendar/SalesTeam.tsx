import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { Confirm, ErrorText } from '../../components/ui'

// Founder only: tick who is in the sales team. Sales staff can add events and see sales-only events.
export function SalesTeam({ profiles }: { profiles: Profile[] }) {
  const [team, setTeam] = useState<Record<string, boolean>>(() => Object.fromEntries(profiles.map((p) => [p.id, p.team === 'sales'])))
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ p: Profile; inSales: boolean } | null>(null) // waiting for confirmation
  const people = profiles.filter((p) => p.role === 'staff')

  async function toggle(p: Profile, inSales: boolean) {
    setTeam((t) => ({ ...t, [p.id]: inSales }))
    const { error } = await supabase!.rpc('set_staff_team', { p_user: p.id, p_team: inSales ? 'sales' : null })
    if (error) {
      setTeam((t) => ({ ...t, [p.id]: !inSales }))
      setError(/set_staff_team/.test(error.message) ? 'Teams are not switched on yet. Run database/24-sales-team-events.sql in Supabase first.' : friendlyError(error))
    } else setError('')
  }

  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
      <h2
        className="text-sm font-semibold"
        title="Tick who's in sales. They can add events (for everyone or sales only) and see sales events. Everyone else counts as warehouse."
      >
        🤝 Sales team:
      </h2>
      {people.length === 0 ? (
        <p className="text-sm text-slate-500">No staff accounts yet.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-orange-500" checked={!!team[p.id]} onChange={(e) => setPending({ p, inSales: e.target.checked })} />
              {p.full_name || p.email}
            </label>
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {pending && (
        <Confirm
          title={pending.inSales ? `Add ${pending.p.full_name || pending.p.email} to the sales team?` : `Remove ${pending.p.full_name || pending.p.email} from the sales team?`}
          message={
            pending.inSales
              ? 'They will be able to add events (for everyone or sales only) and see sales-only events such as customer visits.'
              : "They will no longer see sales-only events or be able to add events. Events they already added stay on the calendar."
          }
          confirmLabel={pending.inSales ? 'Yes, add to sales' : 'Yes, remove from sales'}
          onConfirm={async () => {
            await toggle(pending.p, pending.inSales)
            setPending(null)
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  )
}
