import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'
import type { Priority, Profile, Task } from '../../lib/types'
import { Button, ErrorText, Field, Modal, inputClass } from '../../components/ui'

export function TaskForm({
  task,
  profiles,
  defaultAssignee,
  lockAssignee = false,
  onClose,
}: {
  lockAssignee?: boolean
  task?: Task
  profiles: Profile[]
  defaultAssignee?: string
  onClose: () => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [assignee, setAssignee] = useState(task ? task.assignee_id ?? '' : defaultAssignee ?? '')
  const [start, setStart] = useState(task?.start_date ?? '')
  const [due, setDue] = useState(task?.due_date ?? '')
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'Normal')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (start && due && start > due) return setError('The start date is after the due date.')
    setBusy(true)
    setError('')
    const row: Record<string, unknown> = { title: title.trim(), assignee_id: assignee || null, due_date: due || null, priority }
    // Only send the start date once the database has that column (or one was chosen).
    if (start || task?.start_date !== undefined) row.start_date = start || null
    const { error } = task
      ? await supabase.from('tasks').update(row).eq('id', task.id)
      : await supabase.from('tasks').insert(row)
    setBusy(false)
    if (error)
      return setError(/start_date/.test(error.message) ? 'Start dates are not switched on yet. The founder needs to run database/22-task-start-date.sql in Supabase.' : friendlyError(error))
    onClose()
  }

  return (
    <Modal title={task ? 'Edit task' : 'Add task'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Task *">
          <input className={inputClass} required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Assigned to" hint={lockAssignee ? 'Only a manager can reassign a task that belongs to someone else.' : undefined}>
          <select className={inputClass} disabled={lockAssignee} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Nobody yet</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" hint="Leave empty to start straight away.">
            <input type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Due date">
            <input type="date" className={inputClass} min={start || undefined} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
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
