import { useState, useEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  Sparkles, ChevronRight, ChevronLeft, Check, RefreshCw,
  ArrowRight, AlertTriangle,
} from 'lucide-react'
import {
  useMission, useProject, useTasks, useUpdateMission,
  useUpdateTask, useImproveTaskPrompt, useReviewObjective,
} from '../api/hooks'
import StatusBadge from '../components/StatusBadge'
import type { Task, ObjQuestion } from '../api/client'

// ── Shared helpers ────────────────────────────────────────────────────────────

type Phase = { depth: number; tasks: Task[] }

function computePhases(tasks: Task[]): Phase[] {
  const depthMap = new Map<string, number>()
  function getDepth(id: string, seen = new Set<string>()): number {
    if (depthMap.has(id)) return depthMap.get(id)!
    if (seen.has(id)) return 0; seen.add(id)
    const t = tasks.find(x => x.id === id)
    if (!t?.depends_on?.length) { depthMap.set(id, 0); return 0 }
    const max = Math.max(...t.depends_on.map(d => getDepth(d, new Set(seen))))
    const depth = max + 1; depthMap.set(id, depth); return depth
  }
  tasks.forEach(t => getDepth(t.id))
  const maxDepth = Math.max(-1, ...Array.from(depthMap.values()))
  if (maxDepth < 0) return []
  return Array.from({ length: maxDepth + 1 }, (_, d) => ({
    depth: d,
    tasks: tasks.filter(t => depthMap.get(t.id) === d),
  }))
}

// ── Mission Review Page — objectives list ─────────────────────────────────────

export default function MissionReviewPage() {
  const { id, missionId } = useParams<{ id: string; missionId: string }>()
  const navigate = useNavigate()
  const { data: project } = useProject(id!)
  const { data: mission } = useMission(missionId!)
  const { data: tasks = [] } = useTasks({ mission_id: missionId! })
  const updateMission = useUpdateMission()
  const phases = computePhases(tasks)
  const withPrompt = tasks.filter(t => t.description?.trim()).length

  async function handleSavePlan() {
    await updateMission.mutateAsync({ id: missionId!, project_id: id!, stage: 'approved' } as any)
    navigate(`/projects/${id}/missions/${missionId}`)
  }

  async function handleBack() {
    await updateMission.mutateAsync({ id: missionId!, project_id: id!, stage: 'draft' } as any)
    navigate(`/projects/${id}/missions/${missionId}`)
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
        <Link to="/projects" className="hover:text-yellow-600">Projects</Link>
        <ChevronRight size={12} />
        <Link to={`/projects/${id}`} className="hover:text-yellow-600">{project?.name ?? id}</Link>
        <ChevronRight size={12} />
        <Link to={`/projects/${id}/missions/${missionId}`} className="hover:text-yellow-600">{mission?.name ?? missionId}</Link>
        <ChevronRight size={12} />
        <span className="text-gray-600">Review Mission</span>
      </div>

      {/* Stage title */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-purple-500 rounded-2xl flex items-center justify-center flex-shrink-0">
          <Sparkles size={22} className="text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] font-bold text-purple-500 uppercase tracking-widest">Step 2 of 5</span>
          </div>
          <h1 className="text-3xl font-black text-gray-900 leading-none">Review Mission</h1>
          <p className="text-sm text-gray-500 mt-1">
            Write a clear prompt for each objective — click <strong>Review</strong> to write and refine each one.
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-600">Objectives with prompts</span>
          <span className={`text-xs font-bold ${withPrompt === tasks.length && tasks.length > 0 ? 'text-green-600' : 'text-amber-600'}`}>
            {withPrompt} / {tasks.length}
          </span>
        </div>
        <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${withPrompt === tasks.length && tasks.length > 0 ? 'bg-green-500' : 'bg-amber-400'}`}
            style={{ width: tasks.length > 0 ? `${(withPrompt / tasks.length) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Objectives list by phase */}
      {tasks.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
          No objectives yet — go back to Planning to add some.
        </div>
      ) : (
        <div className="space-y-5">
          {phases.map((phase, phaseIdx) => (
            <div key={phase.depth} className="space-y-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest px-1">
                Phase {phaseIdx + 1}
                {phaseIdx === 0 ? ' — runs immediately' : ` — after Phase ${phaseIdx}`}
              </p>
              {phase.tasks.map(task => {
                const hasPrompt = !!task.description?.trim()
                const deps = tasks.filter(t => task.depends_on?.includes(t.id))
                return (
                  <div key={task.id}
                    className={`bg-white rounded-xl border p-4 flex items-center gap-4 transition-colors ${hasPrompt ? 'border-gray-200' : 'border-amber-200'}`}>
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${hasPrompt ? 'bg-green-100' : 'bg-amber-100'}`}>
                      {hasPrompt
                        ? <Check size={16} className="text-green-600" />
                        : <AlertTriangle size={16} className="text-amber-600" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800 text-sm">{task.title}</span>
                        <StatusBadge status={task.status} />
                        {deps.length > 0 && (
                          <span className="text-[10px] text-gray-400 italic">after: {deps.map(d => d.title).join(', ')}</span>
                        )}
                      </div>
                      {hasPrompt
                        ? <p className="text-xs text-gray-400 mt-0.5 truncate">{task.description}</p>
                        : <p className="text-xs text-amber-600 mt-0.5 font-medium">No prompt written yet</p>
                      }
                    </div>
                    <button
                      onClick={() => navigate(`/projects/${id}/missions/${missionId}/review/${task.id}`)}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-purple-500 text-white rounded-lg hover:bg-purple-600 flex-shrink-0">
                      Review <ArrowRight size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <button onClick={handleBack} disabled={updateMission.isPending}
          className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          ← Back to Planning
        </button>
        <button onClick={handleSavePlan} disabled={updateMission.isPending}
          className="flex items-center gap-2 px-5 py-2 text-sm bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:opacity-50">
          {updateMission.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
          Save Plan → Pre-launch
        </button>
      </div>
    </div>
  )
}

// ── Objective Review Page ─────────────────────────────────────────────────────

export function ObjectiveReviewPage() {
  const { id, missionId, taskId } = useParams<{ id: string; missionId: string; taskId: string }>()
  const navigate = useNavigate()
  const { data: project } = useProject(id!)
  const { data: mission } = useMission(missionId!)
  const { data: tasks = [] } = useTasks({ mission_id: missionId! })

  const phases = computePhases(tasks)
  const sortedTasks = phases.flatMap(p => p.tasks)
  const taskIdx = sortedTasks.findIndex(t => t.id === taskId)
  const task = sortedTasks[taskIdx] ?? null
  const prevTask = taskIdx > 0 ? sortedTasks[taskIdx - 1] : null
  const nextTask = taskIdx < sortedTasks.length - 1 ? sortedTasks[taskIdx + 1] : null
  const phaseNum = phases.findIndex(p => p.tasks.some(t => t.id === taskId)) + 1

  // ── Per-objective state ────────────────────────────────────────────────────
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [steer, setSteer] = useState('')
  const [showSteer, setShowSteer] = useState(false)
  const [suggestion, setSuggestion] = useState<{ improved: string; reasoning: string } | null>(null)
  const [questions, setQuestions] = useState<ObjQuestion[]>([])
  const [analysis, setAnalysis] = useState('')
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const initedFor = useRef('')

  // Initialize state when we land on a new objective
  useEffect(() => {
    if (initedFor.current === taskId) return
    const t = tasks.find(x => x.id === taskId)
    if (!t) return
    setDesc(t.description ?? '')
    setSteer('')
    setShowSteer(false)
    setSuggestion(null)
    setQuestions([])
    setAnalysis('')
    setAnswers({})
    initedFor.current = taskId ?? ''
  }, [taskId, tasks])

  const updateTask = useUpdateTask()
  const improveMut = useImproveTaskPrompt()
  const reviewObjMut = useReviewObjective()

  async function handleBlur() {
    if (!task || desc === (task.description ?? '')) return
    setSaving(true)
    try { await updateTask.mutateAsync({ id: task.id, description: desc } as any) }
    finally { setSaving(false) }
  }

  async function handleImprove() {
    if (!task) return
    const answeredSteer = Object.entries(answers)
      .filter(([, v]) => v.trim())
      .map(([i, v]) => `${questions[+i]?.question}: ${v}`)
      .join('; ')
    const fullSteer = [steer.trim(), answeredSteer].filter(Boolean).join('. ')
    const result = await improveMut.mutateAsync({
      taskId: task.id, current_description: desc, steer: fullSteer || undefined,
    })
    setSuggestion(result)
  }

  function acceptSuggestion() {
    const text = suggestion!.improved
    setDesc(text); setSuggestion(null)
    if (task) updateTask.mutateAsync({ id: task.id, description: text } as any)
  }

  async function handleAnalyze() {
    if (!task) return
    const prior = questions.map((q, i) => ({ ...q, answer: answers[i] ?? '' }))
    const result = await reviewObjMut.mutateAsync({ taskId: task.id, prior_answers: prior })
    setQuestions(result.questions ?? [])
    setAnalysis(result.analysis ?? '')
    setAnswers({})
  }

  async function handleSaveAndContinue() {
    if (task && desc !== (task.description ?? '')) {
      await updateTask.mutateAsync({ id: task.id, description: desc } as any)
    }
    navigate(
      nextTask
        ? `/projects/${id}/missions/${missionId}/review/${nextTask.id}`
        : `/projects/${id}/missions/${missionId}/review`
    )
  }

  const hasPrompt = desc.trim().length > 0
  const anyAnswered = Object.values(answers).some(v => v.trim())
  const deps = tasks.filter(t => task?.depends_on?.includes(t.id))

  if (tasks.length > 0 && !task) return (
    <div className="text-center py-12 text-gray-400">
      <p>Objective not found.</p>
      <Link to={`/projects/${id}/missions/${missionId}/review`} className="text-purple-600 hover:underline mt-2 block text-sm">
        ← Back to Review Mission
      </Link>
    </div>
  )

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
        <Link to="/projects" className="hover:text-yellow-600">Projects</Link>
        <ChevronRight size={12} />
        <Link to={`/projects/${id}`} className="hover:text-yellow-600">{project?.name ?? id}</Link>
        <ChevronRight size={12} />
        <Link to={`/projects/${id}/missions/${missionId}`} className="hover:text-yellow-600">{mission?.name ?? missionId}</Link>
        <ChevronRight size={12} />
        <Link to={`/projects/${id}/missions/${missionId}/review`} className="hover:text-yellow-600">Review Mission</Link>
        <ChevronRight size={12} />
        <span className="text-gray-600">{task?.title ?? '…'}</span>
      </div>

      {/* Objective header + prev/next nav */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-purple-500 uppercase tracking-widest mb-1">
            Review Mission — Objective {taskIdx + 1} of {sortedTasks.length}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-black text-gray-900 leading-tight">{task?.title ?? '…'}</h1>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {task && <StatusBadge status={task.status} />}
            {phaseNum > 0 && (
              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                Phase {phaseNum}
              </span>
            )}
            {deps.length > 0 && (
              <span className="text-[10px] text-gray-400 italic">after: {deps.map(d => d.title).join(', ')}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {prevTask && (
            <button onClick={() => navigate(`/projects/${id}/missions/${missionId}/review/${prevTask.id}`)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              <ChevronLeft size={12} /> Prev
            </button>
          )}
          {nextTask && (
            <button onClick={() => navigate(`/projects/${id}/missions/${missionId}/review/${nextTask.id}`)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              Next <ChevronRight size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">

        {/* LEFT — prompt editor (3 cols) */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-800">Objective Prompt</h2>
              <p className="text-xs text-gray-400 mt-0.5">What the bot reads as its task — be specific</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {saving && <><RefreshCw size={11} className="text-gray-400 animate-spin" /><span className="text-gray-400">saving…</span></>}
              {!saving && hasPrompt && <span className="text-green-600 font-medium flex items-center gap-1"><Check size={10} /> saved</span>}
              {!saving && !hasPrompt && <span className="text-amber-600 font-semibold">needs a prompt</span>}
            </div>
          </div>

          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onBlur={handleBlur}
            rows={12}
            placeholder={`What exactly should the bot build, create, or change?\n\nInclude:\n• File names, component names, or API endpoints\n• Acceptance criteria — what does "done" look like?\n• Any constraints or gotchas\n\nThe more specific, the better.`}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none bg-gray-50 leading-relaxed"
          />

          {/* AI suggestion */}
          {suggestion && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-3">
              <p className="text-[10px] font-bold text-purple-600 uppercase tracking-wide flex items-center gap-1.5">
                <Sparkles size={11} /> AI suggestion
              </p>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{suggestion.improved}</p>
              <p className="text-xs text-purple-400 italic">{suggestion.reasoning}</p>
              <div className="flex gap-2">
                <button onClick={acceptSuggestion}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700">
                  <Check size={11} /> Accept
                </button>
                <button onClick={() => setSuggestion(null)}
                  className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Improve controls */}
          {!suggestion && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleImprove} disabled={improveMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-50">
                  {improveMut.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  Improve with AI
                </button>
                <button onClick={() => setShowSteer(v => !v)}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">
                  {showSteer ? '− hide direction' : '+ give AI direction'}
                </button>
              </div>
              {showSteer && (
                <input
                  value={steer}
                  onChange={e => setSteer(e.target.value)}
                  placeholder="Direction for AI — e.g. 'focus on error handling', 'keep it minimal', 'use TypeScript generics'…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-200 bg-white"
                />
              )}
            </div>
          )}
        </div>

        {/* RIGHT — AI questions (2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-800">AI Questions</h2>
              <p className="text-xs text-gray-400 mt-0.5">Answers feed into the prompt</p>
            </div>
            <button onClick={handleAnalyze} disabled={reviewObjMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-50">
              {reviewObjMut.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {questions.length > 0 ? 'Re-analyze' : 'Analyze'}
            </button>
          </div>

          {!analysis && questions.length === 0 && !reviewObjMut.isPending && (
            <div className="py-6 text-center space-y-2">
              <Sparkles size={24} className="text-purple-200 mx-auto" />
              <p className="text-xs text-gray-400 leading-relaxed">
                Click <strong>Analyze</strong> to get AI questions specific to this objective.<br />
                Answering them will improve the prompt.
              </p>
            </div>
          )}

          {reviewObjMut.isPending && (
            <div className="py-6 text-center">
              <RefreshCw size={18} className="text-purple-400 animate-spin mx-auto mb-2" />
              <p className="text-xs text-gray-400">Analyzing objective…</p>
            </div>
          )}

          {analysis && !reviewObjMut.isPending && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide mb-1">Analysis</p>
              <p className="text-xs text-blue-900 leading-relaxed">{analysis}</p>
            </div>
          )}

          {questions.length > 0 && !reviewObjMut.isPending && (
            <div className="space-y-3">
              {questions.map((q, i) => (
                <div key={i} className={`rounded-lg border p-3 space-y-2 transition-colors ${(answers[i] ?? '').trim() ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
                  <div className="flex items-start gap-2">
                    {(answers[i] ?? '').trim()
                      ? <Check size={12} className="text-green-500 flex-shrink-0 mt-0.5" />
                      : <span className="w-3 h-3 rounded-full border-2 border-gray-300 flex-shrink-0 mt-0.5" />
                    }
                    <div className="min-w-0">
                      <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold uppercase">{q.topic}</span>
                      <p className="text-xs font-medium text-gray-800 mt-1 leading-relaxed">{q.question}</p>
                      {q.context && <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">{q.context}</p>}
                    </div>
                  </div>
                  <textarea
                    value={answers[i] ?? ''}
                    onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))}
                    rows={2}
                    placeholder="Your answer…"
                    className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300 resize-none bg-white"
                  />
                </div>
              ))}

              {anyAnswered && (
                <button onClick={handleImprove} disabled={improveMut.isPending}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50">
                  {improveMut.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  Apply answers → improve prompt
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <Link to={`/projects/${id}/missions/${missionId}/review`}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
          <ChevronLeft size={13} /> Review Mission
        </Link>
        <button onClick={handleSaveAndContinue} disabled={updateTask.isPending}
          className="flex items-center gap-2 px-5 py-2 text-sm bg-purple-500 text-white font-semibold rounded-lg hover:bg-purple-600 disabled:opacity-50">
          {updateTask.isPending ? <RefreshCw size={13} className="animate-spin" /> : null}
          {nextTask ? <>Save & Next <ArrowRight size={13} /></> : <>Done <Check size={13} /></>}
        </button>
      </div>
    </div>
  )
}
