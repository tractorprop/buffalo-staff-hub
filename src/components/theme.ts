export type Theme = 'light' | 'dark'

function stored(): Theme | null {
  try {
    const t = localStorage.getItem('theme')
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

export function currentTheme(): Theme {
  return stored() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

export function applyTheme(t: Theme, remember = false) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  if (remember) {
    try {
      localStorage.setItem('theme', t)
    } catch {
      /* ignore */
    }
  }
}
