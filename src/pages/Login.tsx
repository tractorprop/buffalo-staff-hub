import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { Logo } from '../components/Logo'
import { brand } from '../brand'

const field =
  'mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-white placeholder-white/40 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(friendlyError(error))
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink p-4">
      <div className="w-full max-w-sm">
        <Logo className="mx-auto h-auto w-full max-w-xs rounded-lg shadow-[0_0_60px_-10px] shadow-brand-500/40" />
        <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
          <div>
            <h1 className="text-lg font-semibold text-white">Staff sign in</h1>
            <p className="text-sm text-white/50">{brand.appName}</p>
          </div>
          {!supabase && (
            <p className="rounded-lg bg-amber-500/15 p-3 text-sm text-amber-200">
              The app is not connected to the database yet. Add the Supabase URL and public key to the settings.
            </p>
          )}
          <label className="block">
            <span className="text-sm font-medium text-white/80">Email</span>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-white/80">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </label>
          {error && <p className="rounded-lg bg-red-500/15 p-3 text-sm text-red-200">{error}</p>}
          <button
            type="submit"
            disabled={busy || !supabase}
            className="w-full rounded-lg bg-brand-500 px-4 py-2.5 font-bold text-ink hover:bg-brand-400 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-xs text-white/40">Forgotten your password or need an account? Ask a manager.</p>
        </form>
      </div>
    </div>
  )
}
