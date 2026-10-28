import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Profile } from './types'

let cache: Profile[] | null = null

// Staff list (for names and assignees). Loaded once per visit.
export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>(cache ?? [])
  useEffect(() => {
    if (cache || !supabase) return
    supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .order('full_name')
      .then(({ data }) => {
        cache = (data as Profile[]) ?? []
        setProfiles(cache)
      })
  }, [])
  return profiles
}

export function personName(profiles: Profile[], id: string | null | undefined) {
  if (!id) return 'System'
  const p = profiles.find((x) => x.id === id)
  return p?.full_name || p?.email || 'Unknown'
}
