import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { ComingSoon } from './pages/ComingSoon'
import { MachinesPage } from './pages/machines/MachinesPage'
import { WaitlistPage } from './pages/waitlist/WaitlistPage'

function Gate() {
  const { session, profile, loading, signOut } = useAuth()

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>
  }

  // Signed out: only the login screen exists.
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
        <p>Your login works, but no staff profile was found for it. Please ask a manager.</p>
        <button onClick={signOut} className="rounded-lg border px-3 py-1.5">
          Log out
        </button>
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ComingSoon title="Dashboard" />} />
        <Route path="models" element={<Navigate to="/machines" replace />} />
        <Route path="machines" element={<MachinesPage />} />
        <Route path="waitlist" element={<WaitlistPage />} />
        <Route path="tasks" element={<ComingSoon title="Tasks" />} />
        <Route path="holidays" element={<ComingSoon title="Holidays" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </HashRouter>
  )
}
