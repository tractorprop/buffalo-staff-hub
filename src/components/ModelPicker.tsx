import { useMemo, useRef, useState } from 'react'
import type { Model } from '../lib/types'
import { inputClass } from './ui'

// Type-to-search dropdown for choosing a model.
export function ModelPicker({
  models,
  value,
  onChange,
  autoFocus,
}: {
  models: Model[]
  value: string
  onChange: (id: string) => void
  autoFocus?: boolean
}) {
  const selected = models.find((m) => m.id === value)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models
      .filter((m) => !q || m.model_number.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q))
      .slice(0, 50)
  }, [models, query])

  const label = (m: Model) => (m.name ? `${m.model_number} · ${m.name}` : m.model_number)

  return (
    <div
      ref={box}
      className="relative"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <input
        className={inputClass}
        placeholder="Type to search models…"
        autoFocus={autoFocus}
        value={open ? query : selected ? label(selected) : ''}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && open && matches[0]) {
            e.preventDefault()
            onChange(matches[0].id)
            setOpen(false)
          }
        }}
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No models match.</li>}
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  m.id === value ? 'font-semibold' : ''
                }`}
                onClick={() => {
                  onChange(m.id)
                  setOpen(false)
                }}
              >
                {label(m)}
                {m.sizes.length > 0 && <span className="ml-2 text-xs text-slate-500">({m.sizes.join(', ')})</span>}
                {m.kind === 'accessory' && (
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500 dark:bg-slate-800">
                    Accessory
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
