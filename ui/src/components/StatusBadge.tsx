import type { WorkerStatus, TaskStatus } from '../api/client'

const WORKER_COLORS: Record<WorkerStatus | string, string> = {
  pending:  'bg-gray-100 text-gray-600',
  starting: 'bg-blue-100 text-blue-700',
  active:   'bg-green-100 text-green-700',
  idle:     'bg-teal-100 text-teal-700',
  stuck:    'bg-amber-100 text-amber-700',
  done:     'bg-slate-100 text-slate-600',
  failed:   'bg-red-100 text-red-700',
  killed:   'bg-gray-200 text-gray-500',
}
const TASK_COLORS: Record<TaskStatus | string, string> = {
  queued:      'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  blocked:     'bg-red-100 text-red-700',
  review:      'bg-purple-100 text-purple-700',
  done:        'bg-green-100 text-green-700',
}
const HUB_COLORS: Record<string, string> = {
  ok:      'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  urgent:  'bg-red-100 text-red-700',
  stale:   'bg-orange-100 text-orange-700',
  stopped: 'bg-gray-200 text-gray-500',
  unknown: 'bg-gray-100 text-gray-400',
}

type Mode = 'worker' | 'task' | 'hub'

export default function StatusBadge({ status, mode = 'task' }: { status: string; mode?: Mode }) {
  const colors =
    mode === 'worker' ? WORKER_COLORS :
    mode === 'hub'    ? HUB_COLORS :
    TASK_COLORS
  const cls = colors[status] ?? 'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
