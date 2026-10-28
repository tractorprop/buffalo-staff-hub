import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, friendlyError } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { useAuth } from '../../auth/AuthProvider'
import { personName, useProfiles } from '../../lib/useProfiles'
import type { Model, Task } from '../../lib/types'
import { Button, Confirm, Empty, ErrorText, Loading, Toast, fmtDate, today } from '../../components/ui'
import { TaskForm } from './TaskForm'

interface Data {
  tasks: Task[]
  models: Pick<Model, 'id' | 'model_number'>[]
}

async function loadAll() {
  const [tasks, models] = await Promise.all([
    supabase!.from('tasks').select('*').order('done').order('due_date', { nullsFirst: false }).order('created_at'),
    supabase!.from('models').select('id, model_number'),
  ])
  const error = tasks.error ?? models.error
  return { data: error ? null : { tasks: tasks.data as Task[], models: models.data as Data['models'] }, error }
}

const priorityClass = {
  High: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  Normal: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  Low: 'bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400',
}
const priorityRank = { High: 0, Normal: 1, Low: 2 }

export function TasksPage() {
  const { profile, isManager } = useAuth()
  const profiles = useProfiles()
  const { data, error, loading } = useLive<Data>(['tasks', 'models'], loadAll)
  const [params, setParams] = useSearchParams()
  // Whose tasks: a staff id, 'all' or 'none' (unassigned). Defaults to the signed-in person.
  const who = params.get('who') ?? profile?.id ?? 'all'
  const [showDone, setShowDone] = useState(false)
  const [form, setForm] = useState<{ task?: Task } | null>(null)
  const [confirm, setConfirm] = useState<Task | null>(null)
  // Task waiting for the second "Has this job been completed?" step.
  const [confirmDone, setConfirmDone] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const now = today()

  const openCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of data?.tasks ?? []) if (!t.done) map.set(t.assignee_id ?? 'none', (map.get(t.assignee_id ?? 'none') ?? 0) + 1)
    return map
  }, [data])
  const allOpen = [...openCount.values()].reduce((a, b) => a + b, 0)

  const list = useMemo(
    () =>
      (data?.tasks ?? [])
        .filter((t) => t.done === showDone)
        .filter((t) => who === 'all' || (who === 'none' ? !t.assignee_id : t.assignee_id === who))
        .sort((a, b) =>
          showDone
            ? b.created_at.localeCompare(a.created_at)
            : (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || priorityRank[a.priority] - priorityRank[b.priority],
        ),
    [data, showDone, who],
  )

  function pick(id: string) {
    const p = new URLSearchParams(params)
    p.set('who', id)
    setParams(p, { replace: true })
  }

  async function setDone(t: Task, done: boolean, allowUndo = true) {
    setConfirmDone(null)
    const { error } = await supabase!.from('tasks').update({ done }).eq('id', t.id)
    if (error) return setToast({ text: friendlyError(error) })
    if (allowUndo) setToast({ text: done ? 'Task completed. 👍' : 'Task reopened.', undo: () => setDone(t, !done, false) })
  }

  async function remove(t: Task) {
    const { error } = await supabase!.from('tasks').delete().eq('id', t.id)
    if (error) setToast({ text: friendlyError(error) })
    setConfirm(null)
  }

  const chip = (id: string, label: string, n: number) => (
    <button
      key={id}
      onClick={() => pick(id)}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${
        who === id
          ? 'border-brand-600 bg-brand-500 text-ink'
          : 'border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 text-xs ${who === id ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-800'}`}>{n}</span>
    </button>
  )

  const heading =
    who === 'all' ? 'Everyone' : who === 'none' ? 'Not assigned' : who === profile?.id ? 'My tasks' : personName(profiles, who)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <Button variant="primary" className="ml-auto" onClick={() => setForm({})}>
          + Add task
        </Button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {profile && chip(profile.id, 'Me', openCount.get(profile.id) ?? 0)}
        {chip('all', 'Everyone', allOpen)}
        {profiles.filter((p) => p.id !== profile?.id).map((p) => chip(p.id, p.full_name || p.email || '?', openCount.get(p.id) ?? 0))}
        {chip('none', 'Not assigned', openCount.get('none') ?? 0)}
      </div>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <div className="ml-auto flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
          {[false, true].map((d) => (
            <button
              key={String(d)}
              onClick={() => setShowDone(d)}
              className={`rounded-md px-3 py-1 text-sm font-medium ${showDone === d ? 'bg-brand-500 text-ink' : 'text-slate-600 dark:text-slate-300'}`}
            >
              {d ? 'Completed' : 'To do'}
            </button>
          ))}
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title={showDone ? 'No completed tasks' : 'Nothing to do 🎉'}>{!showDone && 'Click "+ Add task" to create one.'}</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {list.map((t) => {
            const overdue = !t.done && t.due_date && t.due_date < now
            const model = t.related_model && data?.models.find((m) => m.model_number === t.related_model)
            const canComplete = !t.assignee_id || t.assignee_id === profile?.id
            const canDelete = isManager || !t.assignee_id || t.assignee_id === profile?.id
            const asking = confirmDone === t.id
            return (
              <li key={t.id} className={`flex items-start gap-3 px-4 py-3 ${overdue ? 'bg-red-50 dark:bg-red-950/30' : ''}`}>
                <input
                  type="checkbox"
                  checked={t.done || asking}
                  disabled={!canComplete}
                  onChange={(e) => (e.target.checked ? setConfirmDone(t.id) : asking ? setConfirmDone(null) : setDone(t, false))}
                  className="mt-1 h-5 w-5 shrink-0 accent-green-600 disabled:cursor-not-allowed disabled:opacity-40"
                  title={canComplete ? undefined : `Only ${personName(profiles, t.assignee_id)} can complete this task`}
                  aria-label={t.done ? 'Mark as not done' : 'Mark as completed'}
                />
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${t.done ? 'text-slate-400 line-through' : ''}`}>{t.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${priorityClass[t.priority]}`}>{t.priority}</span>
                    {who === 'all' && <span>👤 {t.assignee_id ? personName(profiles, t.assignee_id) : 'Not assigned'}</span>}
                    {t.due_date && (
                      <span className={overdue ? 'font-semibold text-red-600 dark:text-red-400' : ''}>
                        {overdue ? 'Overdue: ' : 'Due '}
                        {fmtDate(t.due_date)}
                      </span>
                    )}
                    {model && (
                      <Link to={`/waitlist?model=${model.id}`} className="font-medium text-sky-700 underline dark:text-sky-300">
                        See waiting customers for {model.model_number} →
                      </Link>
                    )}
                  </div>
                  {asking && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-2 text-sm dark:border-green-900 dark:bg-green-950/40">
                      <span className="font-medium">Has this job been completed?</span>
                      <Button size="sm" variant="primary" onClick={() => setDone(t, true)}>
                        Yes, it's completed
                      </Button>
                      <Button size="sm" onClick={() => setConfirmDone(null)}>
                        Not yet
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setForm({ task: t })}>
                    Edit
                  </Button>
                  {canDelete && (
                    <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setConfirm(t)}>
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {form && (
        <TaskForm
          task={form.task}
          profiles={profiles}
          lockAssignee={!isManager && !!form.task?.assignee_id && form.task.assignee_id !== profile?.id}
          defaultAssignee={who !== 'all' && who !== 'none' ? who : undefined}
          onClose={() => setForm(null)}
        />
      )}
      {confirm && (
        <Confirm
          title="Delete task?"
          message={`"${confirm.title}" will be permanently deleted. To keep a record, tick it as completed instead.`}
          onConfirm={() => remove(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {toast && (
        <Toast onClose={() => setToast(null)}>
          {toast.text}
          {toast.undo && (
            <button
              className="font-semibold underline"
              onClick={() => {
                toast.undo!()
                setToast(null)
              }}
            >
              Undo
            </button>
          )}
        </Toast>
      )}
    </div>
  )
}
