import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Only the public (anon / publishable) key is ever used here.
// Row Level Security in the database decides what each signed-in person can do.
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null

// Turn database errors into something staff can understand.
export function friendlyError(err: { message?: string; code?: string } | null | undefined): string {
  if (!err) return 'Something went wrong.'
  const msg = err.message ?? ''
  if (err.code === '42501' || /row-level security|permission denied/i.test(msg))
    return "You don't have permission to do that. Ask a manager if you think you should."
  if (msg.startsWith('Size must be one of')) return msg.replace('Size must be one of', 'Please pick a size. Choose one of')
  if (err.code === '23505') return 'That already exists. Please check for a duplicate.'
  if (err.code === '23503') return "This can't be deleted because other records still use it."
  if (/invalid login credentials/i.test(msg)) return 'Email or password is incorrect.'
  if (/failed to fetch|network/i.test(msg)) return 'Could not reach the server. Check your internet connection.'
  return msg || 'Something went wrong.'
}
