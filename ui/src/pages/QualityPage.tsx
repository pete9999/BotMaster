import { useState } from 'react'
import { Star, CheckCircle, AlertTriangle, BarChart3, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { useTasks, useReviews, useCreateReview, useUpdateReview, useQualitySummary } from '../api/hooks'
import { useToast } from '../components/Toasts'
import StatusBadge from '../components/StatusBadge'
import type { Task, Review, ReviewFlag } from '../api/client'

// ── Star rating widget ────────────────────────────────────────────────────────

function StarRating({ value, onChange, disabled }: { value: number; onChange?: (v: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" disabled={disabled}
          onClick={() => onChange?.(n)}
          onMouseEnter={() => !disabled && setHover(n)}
          onMouseLeave={() => !disabled && setHover(0)}
          className="disabled:cursor-default">
          <Star size={20}
            className={`transition-colors ${
              n <= (hover || value)
                ? 'text-yellow-400 fill-yellow-400'
                : 'text-gray-300'
            }`} />
        </button>
      ))}
    </div>
  )
}

// ── Flag chips ────────────────────────────────────────────────────────────────

const FLAG_CONFIG: Record<ReviewFlag, { label: string; color: string }> = {
  exemplary:    { label: 'Exemplary',    color: 'bg-green-100 text-green-700 border-green-300' },
  hallucination:{ label: 'Hallucination',color: 'bg-red-100 text-red-700 border-red-300' },
  code_error:   { label: 'Code error',   color: 'bg-orange-100 text-orange-700 border-orange-300' },
  incomplete:   { label: 'Incomplete',   color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  off_track:    { label: 'Off track',    color: 'bg-purple-100 text-purple-700 border-purple-300' },
}

function FlagChip({ flag, selected, onClick }: { flag: ReviewFlag; selected: boolean; onClick?: () => void }) {
  const cfg = FLAG_CONFIG[flag]
  return (
    <button type="button" onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-opacity ${cfg.color} ${selected ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}>
      {cfg.label}
    </button>
  )
}

function FlagDisplay({ flags }: { flags: ReviewFlag[] }) {
  if (!flags.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map(f => (
        <span key={f} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${FLAG_CONFIG[f].color}`}>
          {FLAG_CONFIG[f].label}
        </span>
      ))}
    </div>
  )
}

// ── Review form ───────────────────────────────────────────────────────────────

function ReviewForm({ task, existing, onDone }: { task: Task; existing?: Review; onDone: () => void }) {
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [flags, setFlags] = useState<ReviewFlag[]>(existing?.flags ?? [])
  const [error, setError] = useState('')
  const createReview = useCreateReview()
  const updateReview = useUpdateReview()
  const addToast = useToast()

  const allFlags: ReviewFlag[] = ['exemplary', 'hallucination', 'code_error', 'incomplete', 'off_track']

  function toggleFlag(f: ReviewFlag) {
    setFlags(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!rating) { setError('Please select a rating'); return }
    try {
      if (existing) {
        await updateReview.mutateAsync({ id: existing.id, rating, notes, flags })
        addToast('Review updated', 'success')
      } else {
        await createReview.mutateAsync({
          task_id: task.id, rating, notes, flags,
          model: task.model_hint ?? undefined,
          project_id: task.project_id,
          mission_id: task.mission_id ?? undefined,
        })
        addToast('Review submitted', 'success')
      }
      onDone()
    } catch (err: any) {
      const msg = err.message ?? 'Failed to submit review'
      setError(msg)
      addToast(msg)
    }
  }

  const isPending = createReview.isPending || updateReview.isPending

  return (
    <form onSubmit={handleSubmit} className="space-y-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Quality rating</p>
        <StarRating value={rating} onChange={setRating} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Flags</p>
        <div className="flex flex-wrap gap-1.5">
          {allFlags.map(f => (
            <FlagChip key={f} flag={f} selected={flags.includes(f)} onClick={() => toggleFlag(f)} />
          ))}
        </div>
      </div>
      <div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          rows={2} placeholder="Notes about the quality of this work…"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none" />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">
          Cancel
        </button>
        <button type="submit" disabled={isPending}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-yellow-400 text-gray-900 font-semibold text-sm rounded-lg hover:bg-yellow-500 disabled:opacity-50">
          {isPending && <RefreshCw size={12} className="animate-spin" />}
          {existing ? 'Update' : 'Submit review'}
        </button>
      </div>
    </form>
  )
}

// ── Task review row ───────────────────────────────────────────────────────────

function TaskReviewRow({ task, reviews }: { task: Task; reviews: Review[] }) {
  const existing = reviews.find(r => r.task_id === task.id) ?? null
  const [expanded, setExpanded] = useState(false)

  const elapsed = (() => {
    if (!task.started_at || !task.completed_at) return null
    const secs = Math.floor((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 1000)
    if (secs < 60) return `${secs}s`
    if (secs < 3600) return `${Math.floor(secs / 60)}m`
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
  })()

  return (
    <div className="border-b border-gray-100 last:border-0">
      <div className="flex items-start gap-4 px-5 py-4">
        <div className="flex-shrink-0 mt-0.5">
          {existing
            ? <CheckCircle size={18} className="text-green-500" />
            : <AlertTriangle size={18} className="text-amber-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm">{task.title}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <StatusBadge status={task.status} />
            {task.model_hint && (
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">{task.model_hint}</span>
            )}
            {task.stream_id && (
              <span className="text-xs text-gray-400 font-mono">{task.stream_id}</span>
            )}
            {elapsed && <span className="text-xs text-gray-400">{elapsed}</span>}
          </div>
          {existing && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <StarRating value={existing.rating} disabled />
                <span className="text-xs text-gray-500">{existing.rating}/5</span>
              </div>
              {existing.flags.length > 0 && <FlagDisplay flags={existing.flags} />}
              {existing.notes && <p className="text-xs text-gray-500 italic">{existing.notes}</p>}
            </div>
          )}
        </div>
        <button onClick={() => setExpanded(e => !e)}
          className="flex-shrink-0 flex items-center gap-1 text-xs text-yellow-700 hover:text-yellow-900 font-medium px-2 py-1 rounded hover:bg-yellow-50">
          {existing ? 'Edit' : 'Review'}
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {expanded && (
        <div className="px-5 pb-4">
          <ReviewForm task={task} existing={existing ?? undefined} onDone={() => setExpanded(false)} />
        </div>
      )}
    </div>
  )
}

// ── Model stats card ──────────────────────────────────────────────────────────

function ModelStatCard({ model, stats }: { model: string; stats: { count: number; avg_rating: number|null; flags: Record<string, number> } }) {
  const pct = stats.avg_rating != null ? Math.round((stats.avg_rating / 5) * 100) : 0
  const barColor = pct >= 80 ? 'bg-green-400' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="font-semibold text-gray-800 text-sm font-mono">{model}</p>
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 bg-gray-100 rounded-full h-2">
          <div className={`${barColor} rounded-full h-2 transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm font-bold text-gray-700">
          {stats.avg_rating != null ? stats.avg_rating.toFixed(1) : '—'}
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-1">{stats.count} review{stats.count !== 1 ? 's' : ''}</p>
      {Object.keys(stats.flags).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {Object.entries(stats.flags).map(([flag, count]) => (
            <span key={flag} className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${FLAG_CONFIG[flag as ReviewFlag]?.color ?? 'bg-gray-100 text-gray-500'}`}>
              {count}× {FLAG_CONFIG[flag as ReviewFlag]?.label ?? flag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Filter = 'pending' | 'reviewed' | 'all'

export default function QualityPage() {
  const [filter, setFilter] = useState<Filter>('pending')

  const { data: summary, isLoading: summaryLoading } = useQualitySummary()
  const { data: reviews = [] } = useReviews()
  const { data: doneTasks = [] } = useTasks({ status: 'done' })
  const { data: reviewTasks = [] } = useTasks({ status: 'review' })

  const reviewedIds = new Set(reviews.map(r => r.task_id))
  const candidateTasks = [...doneTasks, ...reviewTasks]

  const pendingTasks = candidateTasks.filter(t => !reviewedIds.has(t.id))
  const reviewedTasks = candidateTasks.filter(t => reviewedIds.has(t.id))

  const visibleTasks = filter === 'pending' ? pendingTasks
    : filter === 'reviewed' ? reviewedTasks
    : candidateTasks

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Avg Quality Score</p>
          <p className="text-3xl font-black text-gray-900 mt-1">
            {summaryLoading ? '…' : summary?.avg_rating != null ? summary.avg_rating.toFixed(1) : '—'}
            <span className="text-sm font-normal text-gray-400">/5</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Reviewed Tasks</p>
          <p className="text-3xl font-black text-gray-900 mt-1">{summary?.total_reviewed ?? '…'}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 border-l-4 border-l-amber-400">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Needs Review</p>
          <p className="text-3xl font-black text-gray-900 mt-1">{summary?.unreviewed_done ?? '…'}</p>
        </div>
      </div>

      {/* Model performance */}
      {summary && Object.keys(summary.by_model).length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={16} className="text-gray-400" />
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Model Performance</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Object.entries(summary.by_model).map(([model, stats]) => (
              <ModelStatCard key={model} model={model} stats={stats} />
            ))}
          </div>
        </div>
      )}

      {/* Task list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Tasks</h2>
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
            {(['pending', 'reviewed', 'all'] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                  filter === f ? 'bg-yellow-400 text-gray-900' : 'text-gray-500 hover:text-gray-900'
                }`}>
                {f === 'pending' ? `Needs review ${pendingTasks.length > 0 ? `(${pendingTasks.length})` : ''}` : f === 'reviewed' ? 'Reviewed' : 'All'}
              </button>
            ))}
          </div>
        </div>

        {visibleTasks.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <CheckCircle size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              {filter === 'pending' ? 'All done tasks have been reviewed.' : 'No tasks to show.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {visibleTasks.map(t => (
              <TaskReviewRow key={t.id} task={t} reviews={reviews} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
