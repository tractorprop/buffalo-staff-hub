import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase'

type Result<T> = { data: T | null; error: { message?: string; code?: string } | null }

// Loads data, then reloads it whenever any of the listed tables change (live updates).
export function useLive<T>(tables: string[], load: () => PromiseLike<Result<T>>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const loadRef = useRef(load)
  loadRef.current = load

  const reload = useCallback(async () => {
    const { data, error } = await loadRef.current()
    if (error) setError(friendlyError(error))
    else {
      setError('')
      setData(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    setLoading(true)
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const tableKey = tables.join(',')
  useEffect(() => {
    if (!supabase) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const channel = supabase.channel(`live-${tableKey}-${Math.random().toString(36).slice(2)}`)
    for (const table of tableKey.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        clearTimeout(timer)
        timer = setTimeout(reload, 300)
      })
    }
    channel.subscribe()
    return () => {
      clearTimeout(timer)
      supabase?.removeChannel(channel)
    }
  }, [tableKey, reload])

  return { data, error, loading, reload }
}
