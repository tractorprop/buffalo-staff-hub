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
  { to: '/tasks', label: 'Tasks' },
  { to: '/holidays', label: 'Holidays' },
]

export function Layout() {
  const { profile, isManager, signOut } = useAuth()
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
        ? 'bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-500'
        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
    }`

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <button
            className="rounded-lg p-2 hover:bg-slate-100 md:hidden dark:hover:bg-slate-800"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
          >
            ☰
          </button>
          <Logo />
          <nav className="hidden gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Switch light or dark mode"
              title="Switch light or dark mode"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <div className="hidden text-right text-sm sm:block">
              <div className="font-medium">{profile?.full_name ?? profile?.email}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{isManager ? 'Manager' : 'Staff'}</div>
            </div>
            <button
              onClick={signOut}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Log out
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="space-y-1 border-t border-slate-200 px-4 py-2 md:hidden dark:border-slate-800">
            <div className="px-3 py-1 text-sm text-slate-500 sm:hidden dark:text-slate-400">
              {profile?.full_name ?? profile?.email} · {isManager ? 'Manager' : 'Staff'}
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
