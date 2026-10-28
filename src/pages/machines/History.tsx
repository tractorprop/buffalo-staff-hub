import { supabase } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { personName, useProfiles } from '../../lib/useProfiles'
import type { AuditEntry, Model } from '../../lib/types'
import { ErrorText, Loading, Modal, fmtDateTime, statusLabel } from '../../components/ui'

const fieldLabels: Record<string, string> = {
  model_id: 'Model',
  size: 'Size',
  serial_number: 'Serial number',
  status: 'Status',
  container_ref: 'Container',
  eta: 'ETA',
  location: 'Location',
  sold_date: 'Date sold',
  notes: 'Notes',
}

function show(field: string, v: unknown, models: Model[]): string {
  if (v === null || v === undefined || v === '') return '(empty)'
  if (field === 'status') return statusLabel[v as keyof typeof statusLabel] ?? String(v)
  if (field === 'model_id') return models.find((m) => m.id === v)?.model_number ?? 'another model'
  return String(v)
}

function describe(e: AuditEntry, models: Model[]): string[] {
  if (e.action === 'INSERT') return ['Added']
  if (e.action === 'DELETE') return ['Deleted']
  const changes: string[] = []
  for (const f of Object.keys(fieldLabels)) {
    const a = e.old_data?.[f]
    const b = e.new_data?.[f]
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push(`${fieldLabels[f]}: ${show(f, a, models)} → ${show(f, b, models)}`)
  }
  return changes.length ? changes : ['Saved (no visible changes)']
}

export function History({ machineId, title, models, onClose }: { machineId: string; title: string; models: Model[]; onClose: () => void }) {
  const profiles = useProfiles()
  const { data, error, loading } = useLive<AuditEntry[]>(
    ['machines'],
    () =>
      supabase!
        .from('audit_log')
        .select('*')
        .eq('table_name', 'machines')
        .eq('record_id', machineId)
        .order('changed_at', { ascending: false }),
    [machineId],
  )

  return (
    <Modal title={`History: ${title}`} onClose={onClose}>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{error}</ErrorText>
      ) : !data?.length ? (
        <p className="text-sm text-slate-500">No history recorded yet.</p>
      ) : (
        <ol className="space-y-3">
          {data.map((e) => (
            <li key={e.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {fmtDateTime(e.changed_at)} · {personName(profiles, e.changed_by)}
              </div>
              {describe(e, models).map((line) => (
                <div key={line} className="text-sm">
                  {line}
                </div>
              ))}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}
