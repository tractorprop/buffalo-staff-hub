import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, currentTheme } from './components/theme'

applyTheme(currentTheme())

// Agentation (visual feedback tool) is loaded only while developing, never on the live site.
const Agentation = import.meta.env.DEV
  ? lazy(() => import('agentation').then((m) => ({ default: m.Agentation })))
  : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {Agentation && (
      <Suspense fallback={null}>
        <Agentation useHashLocation appName="Buffalo Staff Hub" />
      </Suspense>
    )}
  </StrictMode>,
)
