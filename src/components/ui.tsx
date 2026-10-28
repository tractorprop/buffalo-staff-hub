import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { MachineStatus } from '../lib/types'

// ---------- Buttons ----------
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary:
    'border border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1 rounded-lg font-medium disabled:cursor-not-allowed disabled:opacity-50 ${sz} ${variants[variant]} ${className}`}
    />
  )
}

// ---------- Form fields ----------
export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  )
}

// ---------- Modal ----------
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-slate-900 ${
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-xl leading-none hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------- Confirm dialog ----------
export function Confirm({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  onConfirm: () => Promise<void> | void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-sm text-slate-600 dark:text-slate-300">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await onConfirm()
            setBusy(false)
          }}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

// ---------- Messages ----------
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{children}</p>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{children}</div>}
    </div>
  )
}

export function Loading() {
  return <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>
}

// A short message that appears at the bottom of the screen, e.g. after an action fails or can be undone.
export function Toast({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
        {children}
        <button onClick={onClose} aria-label="Close" className="opacity-60 hover:opacity-100">
          ×
        </button>
      </div>
    </div>
  )
}

// ---------- Status ----------
export const statusLabel: Record<MachineStatus, string> = {
  in_stock: 'In stock',
  en_route: 'En route',
  sold: 'Sold',
}

const statusClass: Record<MachineStatus, string> = {
  in_stock: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  en_route: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  sold: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

export function StatusBadge({ status }: { status: MachineStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[status]}`}>{statusLabel[status]}</span>
}

export function CountPill({ n, label, tone }: { n: number; label: string; tone: 'green' | 'amber' | 'grey' | 'blue' }) {
  const tones = {
    green: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    grey: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${n === 0 ? 'opacity-40' : ''} ${tones[tone]}`}>
      <span className="font-bold">{n}</span> {label}
    </span>
  )
}

// ---------- Dates ----------
export function fmtDate(d: string | null | undefined) {
  if (!d) return ''
  const date = d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
