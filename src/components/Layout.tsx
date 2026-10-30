import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Logo } from './Logo'
import { applyTheme, currentTheme, type Theme } from './theme'

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/machines', label: 'Machines' },
  { to: '/stock', label: 'Stock entry' },
  { to: '/waitlist', label: 'Waiting list' },
  { to: '/sales', label: 'Sales' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/calendar', label: 'Calendar' },
]

export function Layout() {
  const { profile, isManager, isFounder, signOut } = useAuth()
  const roleLabel = isFounder ? 'Founder' : isManager ? 'Manager' : 'Staff'
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(currentTheme())

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next, true)
    setTheme(next)
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2 text-sm font-medium ${
      isActive
        ? 'bg-brand-500 text-ink'
        : 'text-white/70 hover:bg-white/10 hover:text-white'
    }`

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b-4 border-brand-500 bg-ink text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
          <button
            className="rounded-lg p-2 hover:bg-white/10 lg:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
          >
            ☰
          </button>
          <NavLink to="/" aria-label="Dashboard" className="shrink-0">
            <Logo className="h-10 w-auto rounded" />
          </NavLink>
          <nav className="hidden gap-1 lg:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 hover:bg-white/10"
              aria-label="Switch light or dark mode"
              title="Switch light or dark mode"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <div className="hidden text-right text-sm sm:block">
              <div className="font-medium">{profile?.full_name ?? profile?.email}</div>
              <div className="text-xs text-brand-500">{roleLabel}</div>
            </div>
            <button
              onClick={signOut}
              className="rounded-lg border border-white/25 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              Log out
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="space-y-1 border-t border-white/10 px-4 py-2 lg:hidden">
            <div className="px-3 py-1 text-sm text-white/60 sm:hidden">
              {profile?.full_name ?? profile?.email} · {roleLabel}
            </div>
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} className={linkClass} onClick={() => setMenuOpen(false)}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
