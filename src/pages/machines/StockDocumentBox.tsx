import { useRef, useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import { selectAll } from '../../lib/selectAll'
import { useLive } from '../../lib/useLive'
import type { StockDocument } from '../../lib/types'
import { Button, Confirm, ErrorText, fmtDate } from '../../components/ui'

const BUCKET = 'stock-documents'

const loadDocs = async () => {
  const res = await supabase!.from('stock_documents').select('*')
  // Not switched on yet (19-stock-documents.sql not run): show nothing rather than an error.
  return { data: res.error ? null : (res.data as StockDocument[]), error: null }
}

// Founder only: the factory invoice for a production order, or for a container once shipped.
export function StockDocumentBox({ productionId, containerRef }: { productionId?: string; containerRef?: string }) {
  const { data, reload } = useLive<StockDocument[] | null>(['stock_documents'], loadDocs)
  const doc = (data ?? []).find((d) => (productionId ? d.production_id === productionId : d.container_ref === containerRef))
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)

  if (!data) return null

  async function removeDoc(d: StockDocument) {
    await supabase!.storage.from(BUCKET).remove([d.path])
    await supabase!.from('stock_documents').delete().eq('id', d.id)
  }

  async function upload(file: File) {
    if (file.size > 20 * 1024 * 1024) return setError('That file is over 20 MB.')
    setBusy(true)
    setError('')
    const path = `${crypto.randomUUID()}/${file.name.replace(/[^\w.-]+/g, '_')}`
    const up = await supabase!.storage.from(BUCKET).upload(path, file, { contentType: file.type })
    if (up.error) {
      setBusy(false)
      return setError(/mime|type/i.test(up.error.message) ? 'Only PDF, pictures, Excel or Word files can be uploaded.' : friendlyError(up.error))
    }
    if (doc) await removeDoc(doc)
    const { error } = await supabase!
      .from('stock_documents')
      .insert({ production_id: productionId ?? null, container_ref: containerRef ?? null, path, name: file.name })
    setBusy(false)
    if (error) {
      await supabase!.storage.from(BUCKET).remove([path])
      return setError(friendlyError(error))
    }
    reload()
  }

  async function open(d: StockDocument) {
    // Open the tab straight away (so the browser doesn't block it), then point it at a link that works for one minute.
    const win = window.open('', '_blank')
    const { data: signed, error } = await supabase!.storage.from(BUCKET).createSignedUrl(d.path, 60)
    if (error || !signed) {
      win?.close()
      return setError(error ? friendlyError(error) : "Couldn't open the file.")
    }
    if (win) win.location.href = signed.signedUrl
    else window.location.href = signed.signedUrl
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">📄 Factory invoice</span>
        <span className="text-xs text-slate-500">Only you can see this. It's deleted automatically once the container has arrived.</span>
      </div>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) upload(f)
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {doc ? (
          <>
            <button className="font-medium text-sky-700 underline dark:text-sky-300" onClick={() => open(doc)}>
              {doc.name}
            </button>
            <span className="text-xs text-slate-500">added {fmtDate(doc.uploaded_at)}</span>
            <span className="ml-auto flex gap-1">
              <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
                {busy ? 'Uploading…' : 'Replace'}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setConfirm(true)}>
                Remove
              </Button>
            </span>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : '⬆️ Upload invoice'}
          </Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {confirm && doc && (
        <Confirm
          title="Remove the invoice?"
          message={`"${doc.name}" will be deleted.`}
          confirmLabel="Remove"
          onConfirm={async () => {
            await removeDoc(doc)
            setConfirm(false)
            reload()
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}

// When a production order is shipped, its invoice moves to the container.
export async function moveDocumentToContainer(productionId: string, containerRef: string) {
  await supabase!.from('stock_documents').update({ container_ref: containerRef }).eq('production_id', productionId).is('container_ref', null)
}

// Founder only: delete invoices whose container has arrived (no items still on the way) and
// whose production order is finished, plus any left over from deleted orders.
export async function cleanUpDocuments() {
  const { data, error } = await supabase!.from('stock_documents').select('*')
  if (error || !data?.length) return
  const onTheWay = await selectAll<{ container_ref: string | null }>(() => supabase!.from('machines').select('container_ref').eq('status', 'en_route').order('id'))
  if (onTheWay.error) return
  const refs = new Set((onTheWay.data as { container_ref: string | null }[]).map((m) => m.container_ref))
  const old = (data as StockDocument[]).filter((d) => !d.production_id && (!d.container_ref || !refs.has(d.container_ref)))
  if (!old.length) return
  await supabase!.storage.from(BUCKET).remove(old.map((d) => d.path))
  await supabase!.from('stock_documents').delete().in('id', old.map((d) => d.id))
}
