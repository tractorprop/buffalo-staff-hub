import { useState } from 'react'
import { Button, inputClass } from './ui'

// "Last [12 months] ⬇️ Download for Excel". onDownload gets the number of months chosen.
export function DownloadButton({ onDownload, busy = false }: { onDownload: (months: number) => void | Promise<void>; busy?: boolean }) {
  const [months, setMonths] = useState(12)
  const [working, setWorking] = useState(false)
  return (
    <span className="inline-flex items-center gap-1.5">
      <select className={`${inputClass} w-auto py-1 text-xs`} value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Period">
        {[3, 6, 12, 24].map((m) => (
          <option key={m} value={m}>
            Last {m} months
          </option>
        ))}
      </select>
      <Button
        size="sm"
        disabled={busy || working}
        onClick={async () => {
          setWorking(true)
          try {
            await onDownload(months)
          } finally {
            setWorking(false)
          }
        }}
      >
        {busy || working ? 'Preparing…' : '⬇️ Download for Excel'}
      </Button>
    </span>
  )
}
