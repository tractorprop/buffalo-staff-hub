import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { ErrorText } from '../../components/ui'

// Founder only: tick who is in the sales team. Sales staff can add events and see sales-only events.
export function SalesTeam({ profiles }: { profiles: Profile[] }) {
  const [team, setTeam] = useState<Record<string, boolean>>(() => Object.fromEntries(profiles.map((p) => [p.id, p.team === 'sales'])))
  const [error, setError] = useState('')
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
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="font-semibold">🤝 Sales team</h2>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
        Tick who's in sales. They can add events (for everyone, or sales team only) and see sales events. Everyone else counts as warehouse. CEO and founder see
        everything.
      </p>
      {people.length === 0 ? (
        <p className="text-sm text-slate-500">No staff accounts yet.</p>
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-orange-500" checked={!!team[p.id]} onChange={(e) => toggle(p, e.target.checked)} />
              {p.full_name || p.email}
            </label>
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  )
}
