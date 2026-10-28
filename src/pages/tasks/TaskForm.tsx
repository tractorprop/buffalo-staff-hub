import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Priority, Profile, Task } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass } from '../../components/ui'

export function TaskForm({
  task,
  profiles,
  defaultAssignee,
  onClose,
}: {
  task?: Task
  profiles: Profile[]
  defaultAssignee?: string
  onClose: () => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [assignee, setAssignee] = useState(task ? task.assignee_id ?? '' : defaultAssignee ?? '')
  const [due, setDue] = useState(task?.due_date ?? '')
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'Normal')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const row = { title: title.trim(), assignee_id: assignee || null, due_date: due || null, priority }
    const { error } = task
      ? await supabase.from('tasks').update(row).eq('id', task.id)
      : await supabase.from('tasks').insert(row)
    setBusy(false)
    if (error) return setError(friendlyError(error))
    onClose()
  }

  return (
    <Modal title={task ? 'Edit task' : 'Add task'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Task *">
          <input className={inputClass} required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Assigned to">
          <select className={inputClass} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Nobody yet</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due date">
            <input type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Priority">
            <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option>Low</option>
              <option>Normal</option>
              <option>High</option>
            </select>
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
