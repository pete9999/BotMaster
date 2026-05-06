import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import {
  Plus, RefreshCw, Bot, CheckSquare, AlertTriangle, Clock,
  ChevronRight, X, Play, Square, MessageSquare, BookOpen,
  Activity, Layers, Send, Shield, GitBranch, Cpu, Pencil, Network,
  Sparkles, ChevronDown, ChevronUp, FileText, Star,
  TrendingUp, Zap, Trophy, Check, ArrowRight,
  Bookmark, History, Search, Library, RotateCcw,
  Lock, Terminal, Edit2, FolderPlus, FolderOpen, Copy,
} from 'lucide-react'
import FolderBrowserInput from '../components/FolderBrowserInput'
import {
  ReactFlow, Background, Controls, Handle, Position, MarkerType,
  useNodesState, useEdgesState,
  type Node, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  useMission, useProject, useWorkers, useTasks,
  useCreateTask, useUpdateTask, useConfig, useUpdateMission, useUpdateProject,
  useMissionQuestions, useStartMissionBot, useReplyToQuestion,
  useKillWorker, useBotEvents, useReviewMissionPlan, useMissionReport,
  useObjectiveTemplates, useSaveTaskAsTemplate, useRecordTemplateUse, useAuditLog,
  useWorkerTranscript,
} from '../api/hooks'
import StatusBadge from '../components/StatusBadge'
import LogViewer from '../components/LogViewer'
import type { Task, TaskStatus, Worker, MissionQuestion, MissionStage, MissionReport, ObjectiveTemplate, AuditEntry } from '../api/client'

// ── Constants ─────────────────────────────────────────────────────────────────

const TASK_STATUSES: TaskStatus[] = ['queued', 'in_progress', 'review', 'blocked', 'done']
const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: 'Queued', in_progress: 'In Progress', review: 'Review', blocked: 'Blocked', done: 'Done',
}
const COL_COLORS: Record<TaskStatus, string> = {
  queued: 'border-gray-200', in_progress: 'border-blue-200',
  review: 'border-purple-200', blocked: 'border-red-200', done: 'border-green-200',
}
const STATUS_DOT: Record<TaskStatus, string> = {
  queued: 'bg-gray-300', in_progress: 'bg-blue-400', review: 'bg-purple-400',
  blocked: 'bg-red-400', done: 'bg-green-400',
}
const NODE_BG: Record<TaskStatus, string> = {
  queued: '#f9fafb', in_progress: '#eff6ff', review: '#f5f3ff', blocked: '#fef2f2', done: '#f0fdf4',
}
const NODE_BORDER: Record<TaskStatus, string> = {
  queued: '#d1d5db', in_progress: '#93c5fd', review: '#c4b5fd', blocked: '#fca5a5', done: '#86efac',
}

const STAGE_STEPS: { key: MissionStage; label: string; num: number }[] = [
  { key: 'draft',    label: 'Plan Mission',    num: 1 },
  { key: 'review',   label: 'Review Mission',  num: 2 },
  { key: 'approved', label: 'Pre-launch',      num: 3 },
  { key: 'running',  label: 'Run Mission',     num: 4 },
  { key: 'complete', label: 'Complete',        num: 5 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleToBranch(t: string) {
  return 'feature/' + t.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

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
  return Array.from({ length: maxDepth + 1 }, (_, i) => ({
    depth: i, tasks: tasks.filter(t => (depthMap.get(t.id) ?? 0) === i),
  })).filter(p => p.tasks.length > 0)
}

function fmtTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }
function fmtDuration(a: string, b: string) {
  const ms = new Date(b).getTime() - new Date(a).getTime()
  if (ms < 0) return '—'
  const h = Math.floor(ms / 3_600_000); const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Stage Progress Bar ────────────────────────────────────────────────────────

function PreLaunchChecklist({ tasks, projectId, projectPath, onRevise, onLaunch, onProjectPathSet }: {
  tasks: Task[]
  projectId: string
  projectPath?: string | null
  onRevise: () => void
  onLaunch: () => void
  onProjectPathSet: (path: string) => void
}) {
  const [editingPath, setEditingPath] = useState(false)
  const [pathInput, setPathInput] = useState(projectPath ?? '')

  const hasObjectives = tasks.length > 0
  const allDescribed  = tasks.length > 0 && tasks.every(t => t.description?.trim())

  // A task has a valid folder if it has its own working_dir OR the project path is set
  const tasksNeedingFolder = tasks.filter(t => !t.working_dir?.trim() && !projectPath?.trim())
  const allHaveFolder = tasksNeedingFolder.length === 0

  const checks = [
    { label: 'Objectives added',             ok: hasObjectives, detail: hasObjectives ? `${tasks.length} objective${tasks.length !== 1 ? 's' : ''}` : 'Add at least one objective' },
    { label: 'Every objective has a prompt',  ok: allDescribed,  detail: allDescribed ? 'All bot prompts filled in' : `${tasks.filter(t => !t.description?.trim()).length} missing a bot prompt` },
    { label: 'Working folder configured',     ok: allHaveFolder, detail: allHaveFolder ? (projectPath ?? 'Per-objective folders set') : `${tasksNeedingFolder.length} objective${tasksNeedingFolder.length !== 1 ? 's' : ''} have no folder` },
  ]
  // allHaveFolder is a hard requirement — without a folder the bot runs in the hub directory
  const readyToLaunch = hasObjectives && allDescribed && allHaveFolder

  function handleSavePath() {
    const p = pathInput.trim()
    if (p) { onProjectPathSet(p); setEditingPath(false) }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {checks.map(c => (
          <div key={c.label} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border ${c.ok ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${c.ok ? 'bg-green-500' : 'bg-amber-400'}`}>
              {c.ok ? <Check size={9} /> : '!'}
            </span>
            <div className="min-w-0">
              <p className={`text-xs font-semibold ${c.ok ? 'text-green-800' : 'text-amber-800'}`}>{c.label}</p>
              <p className={`text-[11px] truncate ${c.ok ? 'text-green-600' : 'text-amber-600'}`}>{c.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Inline project path setter when folder check fails */}
      {!allHaveFolder && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800">
            Set the project folder so bots know where to write files.
            Each objective with no custom folder will run here.
          </p>
          {editingPath ? (
            <div className="flex items-center gap-2">
              <input
                value={pathInput}
                onChange={e => setPathInput(e.target.value)}
                placeholder="e.g. D:\Dev\Projects\my-app"
                className="flex-1 border border-amber-300 rounded px-2 py-1.5 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
                onKeyDown={e => e.key === 'Enter' && handleSavePath()}
                autoFocus
              />
              <button onClick={handleSavePath}
                className="px-3 py-1.5 text-xs bg-green-500 text-white font-semibold rounded hover:bg-green-600">
                Save
              </button>
              <button onClick={() => setEditingPath(false)}
                className="px-3 py-1.5 text-xs text-gray-500 border border-gray-300 rounded hover:bg-gray-50">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setEditingPath(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-500 text-white font-semibold rounded hover:bg-amber-600">
              <FolderOpen size={12} /> Set project folder
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button onClick={onRevise}
          className="px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
          ← Back to Review
        </button>
        <button onClick={onLaunch} disabled={!readyToLaunch}
          className="flex items-center gap-2 px-6 py-2 text-sm bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed animate-pulse">
          <Play size={14} /> Begin Mission →
        </button>
      </div>
    </div>
  )
}

function StageBar({ stage }: { stage: MissionStage }) {
  const currentIdx = STAGE_STEPS.findIndex(s => s.key === stage)
  return (
    <div className="flex items-center gap-0 w-full">
      {STAGE_STEPS.map((step, i) => {
        const done    = i < currentIdx
        const current = i === currentIdx
        const future  = i > currentIdx
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className={`flex items-center gap-1.5 flex-shrink-0 ${future ? 'opacity-40' : ''}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                done    ? 'bg-green-500 text-white' :
                current ? 'bg-yellow-400 text-gray-900' :
                          'bg-gray-100 text-gray-400'
              }`}>
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span className={`text-xs font-medium whitespace-nowrap ${
                current ? 'text-gray-900' : future ? 'text-gray-400' : 'text-gray-600'
              }`}>{step.label}</span>
            </div>
            {i < STAGE_STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Transcript Modal ──────────────────────────────────────────────────────────

function TranscriptModal({ workerId, streamId, onClose }: {
  workerId: string; streamId: string; onClose: () => void
}) {
  const [live, setLive] = useState(true)
  const { data, isLoading, error } = useWorkerTranscript(workerId, live)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [data?.lines, live])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-950 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col border border-gray-700">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-green-400" />
            <span className="font-mono text-sm text-green-400 font-bold">{streamId}</span>
            {data?.transcript_path && (
              <span className="text-xs text-gray-500 font-mono truncate max-w-xs">{data.transcript_path}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
              <input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)}
                className="accent-green-500" />
              Live
            </label>
            <span className="text-xs text-gray-600">{data?.total_lines ?? 0} lines</span>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none ml-2">&times;</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-green-300 leading-relaxed">
          {isLoading && <p className="text-gray-500">Loading transcript…</p>}
          {error && <p className="text-red-400">Error: {(error as Error).message}</p>}
          {data && !data.available && (
            <p className="text-gray-500">
              No transcript available yet.
              {data.transcript_path
                ? ` Waiting for session to start writing to ${data.transcript_path}`
                : ' Session has not been spawned yet.'}
            </p>
          )}
          {data?.available && data.lines.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${
              line.startsWith('****') ? 'text-yellow-500' :
              line.startsWith('PS>') ? 'text-cyan-400' :
              line.includes('ERROR') || line.includes('error') ? 'text-red-400' :
              line.includes('✓') || line.includes('COMPLETED') ? 'text-green-400' :
              'text-gray-300'
            }`}>{line || ' '}</div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}

// ── Inline Transcript with Heartbeat ─────────────────────────────────────────

function InlineTranscript({ worker, terminalClass = 'h-52', noBorder = false }: {
  worker: Worker; terminalClass?: string; noBorder?: boolean
}) {
  const isActive = ['starting', 'active', 'idle'].includes(worker.status)
  const { data } = useWorkerTranscript(worker.id, true)

  const [lastLineCount, setLastLineCount] = useState<number>(-1)
  const [lastActivityAt, setLastActivityAt] = useState<Date | null>(null)
  const [now, setNow] = useState(Date.now())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const count = data?.total_lines ?? 0
    if (count !== lastLineCount && count > 0) {
      setLastLineCount(count)
      setLastActivityAt(new Date())
    }
  }, [data?.total_lines])

  // 1-second tick for countdown
  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isActive])

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [data?.lines?.length])

  const stallSec = lastActivityAt ? Math.floor((now - lastActivityAt.getTime()) / 1000) : 0
  const killIn = Math.max(0, 180 - stallSec)
  const isStalling = isActive && lastActivityAt !== null && stallSec > 20
  const nearKill = isActive && killIn < 60

  const visibleLines = data?.lines ?? []

  return (
    <div className={noBorder ? '' : 'border-t border-gray-200'}>
      {/* Heartbeat bar */}
      <div className={`flex items-center gap-3 px-4 py-2 text-xs flex-shrink-0 ${
        nearKill ? 'bg-red-950/80' : isStalling ? 'bg-amber-950/60' : 'bg-gray-900'
      }`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          !isActive        ? 'bg-gray-600' :
          nearKill         ? 'bg-red-500 animate-pulse' :
          isStalling       ? 'bg-amber-400 animate-pulse' :
          lastActivityAt   ? 'bg-green-400 animate-pulse' :
                             'bg-gray-500 animate-pulse'
        }`} />
        <span className={`font-mono flex-1 ${
          nearKill   ? 'text-red-400' :
          isStalling ? 'text-amber-400' :
                       'text-gray-400'
        }`}>
          {!isActive
            ? `Bot ${worker.status}`
            : lastActivityAt
              ? isStalling
                ? `No new output for ${stallSec}s — auto-kill in ${killIn}s`
                : `Output streaming — hang check resets after 180s idle`
              : 'Waiting for first output…'}
        </span>
        {/* Hang progress bar */}
        {isActive && lastActivityAt && (
          <div className="w-32 h-1.5 bg-gray-700 rounded-full overflow-hidden flex-shrink-0">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                nearKill ? 'bg-red-500' : isStalling ? 'bg-amber-400' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, (stallSec / 180) * 100)}%` }}
            />
          </div>
        )}
        <span className="text-gray-600 flex-shrink-0">{data?.total_lines ?? 0} lines</span>
      </div>
      {/* Terminal output */}
      <div className={`bg-gray-950 font-mono text-xs text-gray-300 leading-relaxed p-3 ${terminalClass} overflow-y-auto`}>
        {!data?.available && (
          <p className="text-gray-600 italic">
            {data === undefined
              ? 'Loading transcript…'
              : isActive
                ? 'No output yet — waiting for bot to start…'
                : worker.status === 'failed'
                  ? 'Bot failed to start — no output was captured. Check the error and try again.'
                  : 'No transcript recorded for this run.'}
          </p>
        )}
        {visibleLines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${
            line.startsWith('****') ? 'text-yellow-400 font-semibold' :
            line.startsWith('PS>') || line.startsWith('>>> ') ? 'text-cyan-400' :
            /error|failed|exception/i.test(line) ? 'text-red-400' :
            /✓|COMPLETED|SUCCESS|Done/i.test(line) ? 'text-green-400' :
            'text-gray-300'
          }`}>{line || ' '}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Console Panel — Current Bot Output + Run History ────────────────────────

function HistoryRunItem({ worker, runNum }: { worker: Worker; runNum: number }) {
  const [expanded, setExpanded] = useState(false)
  const { data } = useWorkerTranscript(worker.id, expanded)
  const isActive = ['starting','active','idle'].includes(worker.status)
  const isFailed = ['failed','killed','stuck'].includes(worker.status)
  const isDone = worker.status === 'done'

  return (
    <div className="border-t border-gray-800/60">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-gray-900/50 transition-colors">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isActive ? 'bg-green-400 animate-pulse' : isFailed ? 'bg-red-500' : 'bg-green-600'
        }`} />
        <span className="font-semibold text-gray-400 flex-shrink-0">Run {runNum}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${
          isDone ? 'bg-green-900/60 text-green-400' :
          isFailed ? 'bg-red-900/60 text-red-400' : 'bg-blue-900/60 text-blue-300'
        }`}>{worker.status.charAt(0).toUpperCase() + worker.status.slice(1)}</span>
        {worker.started_at && worker.completed_at && (
          <span className="text-gray-600 flex-shrink-0">{taskDuration(worker)}</span>
        )}
        {worker.completed_at && (
          <span className="text-gray-600 flex-shrink-0">{new Date(worker.completed_at).toLocaleString()}</span>
        )}
        {worker.notes && (
          <span className={`truncate flex-1 text-left ${isDone ? 'text-green-700' : 'text-amber-400'}`}>
            {worker.notes}
          </span>
        )}
        <span className="ml-auto text-gray-600 flex-shrink-0">
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-gray-800/40">
          {!data?.available ? (
            <div className="px-4 py-3 text-xs text-gray-600 italic font-mono">
              {data === undefined ? 'Loading…' : 'Transcript not available'}
            </div>
          ) : (
            <div className="bg-gray-950 font-mono text-xs text-gray-300 leading-relaxed p-3 max-h-64 overflow-y-auto">
              {(data.lines ?? []).map((line, i) => (
                <div key={i} className={`whitespace-pre-wrap break-all ${
                  line.startsWith('****') ? 'text-yellow-400 font-semibold' :
                  line.startsWith('PS>') || line.startsWith('>>> ') ? 'text-cyan-400' :
                  /error|failed|exception/i.test(line) ? 'text-red-400' :
                  /✓|COMPLETED|SUCCESS|Done/i.test(line) ? 'text-green-400' : 'text-gray-300'
                }`}>{line || ' '}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ConsolePanel({ tasks, workers, selectedTaskId, missionId, projectPath, onLaunchReview }: {
  tasks: Task[]; workers: Worker[]; selectedTaskId: string | null
  missionId: string; projectPath: string
  onLaunchReview: (task: Task, worker: Worker | null, model: string, runner: string) => void
}) {
  const task = tasks.find(t => t.id === selectedTaskId) ?? null
  // All workers for this task, most recent first
  const taskWorkers = task
    ? [...workers.filter(w => w.task_id === task.id)]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : []
  // Fall back to most recent mission-level bot when no task-specific worker exists
  const missionWorker = [...workers.filter(w => !w.task_id)]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null
  const currentWorker = taskWorkers[0] ?? (task ? missionWorker : null)
  const isMissionFallback = !taskWorkers[0] && !!missionWorker && !!task

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      {/* ── CURRENT BOT OUTPUT header ── */}
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-3">
        <Terminal size={13} className="text-green-400 flex-shrink-0" />
        <span className="text-xs font-bold text-gray-200 uppercase tracking-widest">Current Bot Output</span>
        {task ? (
          <>
            <span className="text-gray-700">—</span>
            <span className="text-xs text-gray-400 truncate max-w-xs">{task.title}</span>
            {isMissionFallback && (
              <span className="text-[10px] text-gray-600 italic flex-shrink-0">(mission bot)</span>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-600 italic">Select an objective</span>
        )}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {currentWorker && (
            <>
              <code className="text-[10px] font-mono text-green-400">{currentWorker.stream_id}</code>
              {currentWorker.pid != null && (
                <span className="text-[10px] font-mono text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">PID {currentWorker.pid}</span>
              )}
            </>
          )}
          {task && currentWorker && ['done','failed','killed','stuck'].includes(currentWorker.status) && (
            <button onClick={() => onLaunchReview(task, currentWorker, 'claude-sonnet-4-6', 'claude_code')}
              className="flex items-center gap-1 text-[10px] px-2 py-1 bg-yellow-500/20 text-yellow-300 border border-yellow-700/50 rounded hover:bg-yellow-500/30 transition-colors">
              <Zap size={9} /> Review
            </button>
          )}
        </div>
      </div>

      {/* Completion status / success reason */}
      {currentWorker && ['done','failed','killed','stuck'].includes(currentWorker.status) && (
        <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/60 flex items-center gap-3 text-xs flex-wrap">
          <span className={`font-semibold flex-shrink-0 ${currentWorker.status === 'done' ? 'text-green-400' : 'text-red-400'}`}>
            {currentWorker.status === 'done' ? '✓ Completed successfully' : `✗ ${currentWorker.status.charAt(0).toUpperCase() + currentWorker.status.slice(1)}`}
          </span>
          {currentWorker.started_at && currentWorker.completed_at && (
            <span className="text-gray-600">{taskDuration(currentWorker)} runtime</span>
          )}
          {currentWorker.completed_at && (
            <span className="text-gray-500">{new Date(currentWorker.completed_at).toLocaleString()}</span>
          )}
          {currentWorker.notes && (
            <span className={`truncate flex-1 ${currentWorker.status === 'done' ? 'text-green-600' : 'text-amber-400'}`}>
              {currentWorker.notes}
            </span>
          )}
        </div>
      )}

      {/* Transcript — never disappears after completion */}
      {!task ? (
        <div className="h-64 flex items-center justify-center text-gray-600 text-sm italic">
          Select an objective above to view its console output
        </div>
      ) : !currentWorker ? (
        <div className="h-64 flex items-center justify-center text-gray-600 text-sm italic">
          No bot has run this objective yet
        </div>
      ) : (
        <InlineTranscript worker={currentWorker} terminalClass="h-80" noBorder />
      )}

      {/* ── RUN HISTORY ── */}
      {taskWorkers.length > 0 && (
        <div className="border-t border-gray-800">
          <div className="px-4 py-2 bg-gray-900/40 flex items-center gap-2">
            <History size={11} className="text-gray-500 flex-shrink-0" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Run History</span>
            <span className="text-[10px] text-gray-700 ml-1">
              {taskWorkers.length} run{taskWorkers.length !== 1 ? 's' : ''}
            </span>
          </div>
          {taskWorkers.map((w, i) => (
            <HistoryRunItem key={w.id} worker={w} runNum={taskWorkers.length - i} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Review Modal ──────────────────────────────────────────────────────────────

function ReviewModal({ task, worker, missionId, projectPath, onClose, onLaunch }: {
  task: Task; worker: Worker | null; missionId: string; projectPath: string
  onClose: () => void
  onLaunch: (model: string, runner: string) => void
}) {
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [runner, setRunner] = useState('claude_code')

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">Request Review</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{task.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1">
            <p className="font-semibold text-gray-700">What this does:</p>
            <p>Launches a bot to inspect the project folder and assess whether the objective was completed correctly. The reviewer will check the actual files created/modified.</p>
            {projectPath && <p className="font-mono text-gray-500 truncate">📁 {projectPath}</p>}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Runner</label>
            <div className="flex gap-2">
              {(['claude_code', 'ollama', 'lmstudio'] as const).map(r => (
                <button key={r} onClick={() => { setRunner(r); setModel(runnerDefaultModel(r)) }}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border font-medium transition-colors ${
                    runner === r ? 'bg-yellow-400 border-yellow-400 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {r === 'claude_code' ? 'Claude Code' : r === 'ollama' ? 'Ollama (local)' : 'LM Studio'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Model</label>
            <input value={model} onChange={e => setModel(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-yellow-400"
              placeholder="Model name" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={() => { onLaunch(model, runner); onClose() }}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-yellow-400 text-gray-900 font-semibold rounded-lg hover:bg-yellow-500">
            <Zap size={13} /> Launch Review Bot
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Runner / Model Constants ──────────────────────────────────────────────────

const OLLAMA_CODING_MODELS = [
  { value: 'qwen3-coder:latest',  label: 'Qwen3 Coder',             note: '★ Best available — run `ollama pull qwen3-coder`' },
  { value: 'qwen2.5-coder:7b',    label: 'Qwen 2.5 Coder 7B',      note: 'Lighter — run `ollama pull qwen2.5-coder:7b`' },
  { value: 'qwen2.5-coder:14b',   label: 'Qwen 2.5 Coder 14B',     note: 'More capable, needs ~16 GB RAM' },
  { value: 'deepseek-coder-v2',   label: 'DeepSeek Coder V2 16B',  note: 'Strong on complex / multi-file code' },
  { value: 'codellama:13b',       label: 'Code Llama 13B',          note: 'Meta — solid general coding' },
  { value: 'llama3.2:3b',         label: 'Llama 3.2 3B',            note: 'Fast — basic tasks, monitoring scripts' },
  { value: 'mistral:7b',          label: 'Mistral 7B',              note: 'Balanced — code + general' },
  { value: 'phi3:mini',           label: 'Phi-3 Mini (3.8B)',       note: 'Tiny but surprisingly capable, very fast' },
]

const CLAUDE_MODELS = [
  { value: 'claude-sonnet-4-6',         label: 'Sonnet 4.6',  note: '★ Best balance of quality & cost' },
  { value: 'claude-opus-4-7',           label: 'Opus 4.7',    note: 'Highest quality, complex reasoning' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',   note: 'Fastest and cheapest' },
]

const CODEX_MODELS = [
  { value: 'gpt-4o',      label: 'GPT-4o',      note: 'Best quality' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', note: 'Faster and cheaper' },
  { value: 'o1-mini',     label: 'o1-mini',     note: 'Strong reasoning' },
]

type TaskFolderMode = 'inherit' | 'new' | 'existing' | 'clone'

const TASK_FOLDER_MODES: { id: TaskFolderMode; icon: React.ReactNode; label: string; hint: string }[] = [
  { id: 'inherit',  icon: <FolderOpen size={12} />,  label: 'Project folder', hint: 'Run inside the project folder — the default for most objectives' },
  { id: 'new',      icon: <FolderPlus size={12} />,  label: 'New subfolder',  hint: 'Create a fresh subfolder inside the project folder for this objective' },
  { id: 'existing', icon: <FolderOpen size={12} />,  label: 'Existing',       hint: 'Point to an existing folder anywhere on disk' },
  { id: 'clone',    icon: <Copy size={12} />,         label: 'Clone',          hint: 'Copy an existing folder to a new location for this objective' },
]

type RunnerType = 'claude_code' | 'codex' | 'ollama' | 'aider' | 'lmstudio' | 'custom'

const RUNNER_OPTIONS: { key: RunnerType; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: 'claude_code', label: 'Claude Code', icon: <Sparkles size={13} />, desc: 'Official Anthropic CLI' },
  { key: 'codex',       label: 'Codex CLI',   icon: <Terminal size={13} />, desc: 'OpenAI Codex CLI' },
  { key: 'ollama',      label: 'Ollama',      icon: <Cpu size={13} />,      desc: 'Free — local models' },
  { key: 'lmstudio',    label: 'LM Studio',   icon: <Cpu size={13} />,      desc: 'Local via LM Studio' },
  { key: 'aider',       label: 'Aider',       icon: <Bot size={13} />,      desc: 'AI pair programmer' },
  { key: 'custom',      label: 'Custom',      icon: <Edit2 size={13} />,    desc: 'Any CLI command' },
]

function runnerLabel(r?: string) {
  return RUNNER_OPTIONS.find(o => o.key === r)?.label ?? 'Claude Code'
}
function runnerDefaultModel(r?: string): string {
  if (r === 'codex')    return 'gpt-4o'
  if (r === 'ollama')   return 'qwen3-coder:latest'
  if (r === 'lmstudio') return ''
  return 'claude-sonnet-4-6'
}

// ── Task Modal ────────────────────────────────────────────────────────────────

function TaskModal({ projectId, missionId, projectPath, existingTasks, editTask, onClose }: {
  projectId: string; missionId: string; projectPath?: string
  existingTasks: Task[]; editTask?: Task | null; onClose: () => void
}) {
  const isEdit = !!editTask
  const { data: config } = useConfig()
  const defaultRunner = (config?.['default_runner']?.value ?? 'ollama') as RunnerType
  const defaultModel  = runnerDefaultModel(defaultRunner)

  const [form, setForm] = useState({
    title:       isEdit ? editTask.title : '',
    description: isEdit ? editTask.description ?? '' : '',
    runner_type: isEdit ? (editTask.runner_type ?? defaultRunner) : defaultRunner,
    model_hint:  isEdit ? (editTask.model_hint ?? '') : defaultModel,
    branch:      isEdit ? editTask.branch ?? '' : '',
    priority:    String(isEdit ? editTask.priority ?? 50 : 50),
    status:      isEdit ? editTask.status : 'queued' as TaskStatus,
    depends_on:  isEdit ? editTask.depends_on ?? [] : [] as string[],
    folder_mode: (isEdit ? (editTask.folder_mode ?? 'inherit') : 'inherit') as TaskFolderMode,
    working_dir: isEdit ? (editTask.working_dir ?? '') : '',
    clone_dest:  '',
    git_repo:    isEdit ? (editTask.git_repo ?? '') : '',
  })
  const [branchTouched, setBranchTouched] = useState(isEdit)
  const [error, setError] = useState('')
  const create = useCreateTask(); const update = useUpdateTask()

  const set = (k: string, v: string | string[]) => setForm(f => ({ ...f, [k]: v }))
  function handleTitleChange(title: string) {
    set('title', title)
    if (!branchTouched && !!projectPath) set('branch', title ? titleToBranch(title) : '')
  }
  function handleRunnerChange(runner: string) {
    set('runner_type', runner)
    set('model_hint', runnerDefaultModel(runner))
  }
  function toggleDep(id: string) {
    setForm(f => ({ ...f, depends_on: f.depends_on.includes(id) ? f.depends_on.filter((d: string) => d !== id) : [...f.depends_on, id] }))
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!form.title.trim()) { setError('Title is required'); return }
    try {
      const folderFields = {
        folder_mode: form.folder_mode,
        working_dir: form.working_dir.trim() || undefined,
        ...(form.folder_mode === 'clone' && form.clone_dest.trim() ? { clone_dest: form.clone_dest.trim() } : {}),
      }
      if (isEdit) {
        await update.mutateAsync({ id: editTask.id, title: form.title.trim(),
          description: form.description.trim() || undefined,
          runner_type: form.runner_type,
          model_hint: form.model_hint.trim() || undefined,
          branch: form.branch.trim() || undefined,
          priority: parseInt(form.priority) || 50,
          status: form.status as TaskStatus,
          depends_on: form.depends_on,
          git_repo: form.git_repo.trim() || undefined,
          ...folderFields } as any)
      } else {
        await create.mutateAsync({ project_id: projectId, mission_id: missionId,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          runner_type: form.runner_type,
          model_hint: form.model_hint.trim() || undefined,
          branch: form.branch.trim() || undefined,
          priority: parseInt(form.priority) || 50,
          depends_on: form.depends_on,
          git_repo: form.git_repo.trim() || undefined,
          ...folderFields } as any)
      }
      onClose()
    } catch (err: any) { setError(err.message ?? 'Failed') }
  }

  const isPending = isEdit ? update.isPending : create.isPending
  const otherTasks = existingTasks.filter(t => t.id !== editTask?.id)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-950 rounded-t-xl flex-shrink-0">
          <h2 className="font-bold text-white">{isEdit ? 'Edit Objective' : 'Add Objective'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
            <input value={form.title} onChange={e => handleTitleChange(e.target.value)} placeholder="Build the home page"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
          </div>

          {/* ── Bot Prompt ── */}
          <div className="rounded-xl bg-gray-950 border border-gray-700 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Terminal size={12} className="text-yellow-400" />
              <span className="text-xs font-bold text-yellow-400 uppercase tracking-wide">Bot Prompt</span>
              <span className="text-[10px] text-gray-500 font-normal">— exactly what this bot reads when it runs</span>
            </div>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={7}
              placeholder="Describe what to build, files to create/modify, acceptance criteria, any constraints…"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-y font-mono leading-relaxed" />
          </div>

          {/* ── Bot Assignment ── */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Bot size={13} className="text-gray-500" />
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Bot Assignment</span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Runner</label>
              <div className="flex gap-1.5 flex-wrap">
                {RUNNER_OPTIONS.map(opt => (
                  <button key={opt.key} type="button" onClick={() => handleRunnerChange(opt.key)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                      form.runner_type === opt.key
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}>
                    {opt.icon}{opt.label}
                  </button>
                ))}
              </div>
            </div>

            {form.runner_type === 'claude_code' && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Model</label>
                <select value={form.model_hint} onChange={e => set('model_hint', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400">
                  {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label} — {m.note}</option>)}
                </select>
              </div>
            )}
            {form.runner_type === 'codex' && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Model</label>
                <select value={form.model_hint} onChange={e => set('model_hint', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400">
                  {CODEX_MODELS.map(m => <option key={m.value} value={m.value}>{m.label} — {m.note}</option>)}
                </select>
              </div>
            )}
            {form.runner_type === 'ollama' && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Model</label>
                <select value={form.model_hint} onChange={e => set('model_hint', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400">
                  {OLLAMA_CODING_MODELS.map(m => <option key={m.value} value={m.value}>{m.label} — {m.note}</option>)}
                </select>
                <input value={form.model_hint} onChange={e => set('model_hint', e.target.value)}
                  placeholder="or type any Ollama model name"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400" />
              </div>
            )}
            {(form.runner_type === 'aider' || form.runner_type === 'custom') && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  {form.runner_type === 'aider' ? 'Model (blank = aider default)' : 'Model / command override'}
                </label>
                <input value={form.model_hint} onChange={e => set('model_hint', e.target.value)}
                  placeholder={form.runner_type === 'aider' ? 'gpt-4o' : 'path/to/cli --flags'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Priority</label>
              <input type="number" min="1" max="100" value={form.priority} onChange={e => set('priority', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
            </div>
            {isEdit && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
                  {TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
            )}
          </div>
          {!!projectPath
            ? <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Branch</label>
                <input value={form.branch} onChange={e => { setBranchTouched(true); set('branch', e.target.value) }}
                  placeholder="feature/my-page"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400" />
              </div>
            : <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">Git not initialised — branch tracking unavailable.</div>
          }

          {/* ── Working Directory ── */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Working directory</label>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {TASK_FOLDER_MODES.map(m => (
                <button key={m.id} type="button" onClick={() => set('folder_mode', m.id)}
                  className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                    form.folder_mode === m.id
                      ? 'border-yellow-400 bg-yellow-50 text-gray-900 font-semibold'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}>
                  {m.icon} {m.label}
                </button>
              ))}
            </div>

            {form.folder_mode === 'inherit' ? (
              <div className={`rounded-lg px-3 py-2 border ${projectPath ? 'bg-gray-950 border-gray-700' : 'bg-amber-50 border-amber-200'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${projectPath ? 'text-gray-500' : 'text-amber-600'}`}>
                  {projectPath ? '📂 Bot will run here' : '⚠️ Project path not set'}
                </p>
                <p className={`text-xs font-mono break-all ${projectPath ? 'text-green-400' : 'text-amber-700 italic'}`}>
                  {projectPath || 'Configure project path on the project page before launching'}
                </p>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-gray-400 mb-2">
                  {TASK_FOLDER_MODES.find(m => m.id === form.folder_mode)?.hint}
                </p>
                <div className="space-y-1.5">
                  <FolderBrowserInput
                    value={form.working_dir}
                    onChange={v => set('working_dir', v)}
                    placeholder={
                      form.folder_mode === 'new' ? 'Subfolder name (blank = auto-named inside project folder)' :
                      form.folder_mode === 'existing' ? 'D:\\dev\\MyProject\\backend' :
                      'Source folder to clone from'
                    }
                    inputClassName="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400 min-w-0"
                  />
                  {form.folder_mode === 'clone' && (
                    <FolderBrowserInput
                      value={form.clone_dest}
                      onChange={v => set('clone_dest', v)}
                      placeholder="Destination (blank = auto)"
                      inputClassName="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400 min-w-0"
                    />
                  )}
                </div>
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Git Repository URL <span className="text-gray-400 font-normal">(optional — clone before running)</span></label>
            <input value={form.git_repo} onChange={e => set('git_repo', e.target.value)}
              placeholder="https://github.com/org/repo.git"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400" />
          </div>
          {otherTasks.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Depends on</label>
              <div className="space-y-1 max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {otherTasks.map(t => (
                  <label key={t.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                    <input type="checkbox" checked={form.depends_on.includes(t.id)} onChange={() => toggleDep(t.id)}
                      className="rounded border-gray-300 accent-yellow-500" />
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[t.status]}`} />
                    <span className="text-xs text-gray-700 flex-1">{t.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
        </form>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleSubmit as any} disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-yellow-400 text-gray-900 font-semibold rounded-lg hover:bg-yellow-500 disabled:opacity-50">
            {isPending && <RefreshCw size={14} className="animate-spin" />}
            {isEdit ? 'Save Changes' : 'Add Objective'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Template Library Modal ────────────────────────────────────────────────────

function TemplateLibraryModal({ projectId, missionId, existingTasks, onClose }: {
  projectId: string; missionId: string; existingTasks: Task[]; onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [imported, setImported] = useState<Set<string>>(new Set())
  const { data: templates = [], isLoading } = useObjectiveTemplates({ search: search || undefined })
  const createTask = useCreateTask()
  const recordUse = useRecordTemplateUse()

  async function handleUse(tmpl: ObjectiveTemplate) {
    try {
      await createTask.mutateAsync({
        project_id: projectId, mission_id: missionId,
        title: tmpl.title, description: tmpl.description || undefined,
        model_hint: tmpl.model_hint || undefined,
      } as any)
      recordUse.mutate(tmpl.id)
      setImported(s => new Set([...s, tmpl.id]))
    } catch { /* ignore */ }
  }

  const TAG_COLORS: Record<string, string> = {
    frontend: 'bg-blue-100 text-blue-700', backend: 'bg-green-100 text-green-700',
    testing: 'bg-purple-100 text-purple-700', setup: 'bg-gray-100 text-gray-600',
    api: 'bg-orange-100 text-orange-700', database: 'bg-teal-100 text-teal-700',
    layout: 'bg-pink-100 text-pink-700', components: 'bg-indigo-100 text-indigo-700',
    e2e: 'bg-red-100 text-red-700', qa: 'bg-red-100 text-red-700',
    migrations: 'bg-teal-100 text-teal-700', typescript: 'bg-blue-100 text-blue-700',
    page: 'bg-pink-100 text-pink-700', marketing: 'bg-amber-100 text-amber-700',
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-950 rounded-t-xl flex-shrink-0">
          <div className="flex items-center gap-2">
            <Library size={16} className="text-yellow-400" />
            <h2 className="font-bold text-white">Objective Library</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-xl">&times;</button>
        </div>
        <div className="px-6 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search objectives…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-2">
          {isLoading && <div className="text-center py-6 text-gray-400 text-sm">Loading…</div>}
          {!isLoading && templates.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              <Library size={24} className="mx-auto mb-2 opacity-40" />
              <p>{search ? 'No objectives match your search.' : 'No objectives in the library yet. Save some from your mission objectives!'}</p>
            </div>
          )}
          {templates.map(tmpl => {
            const alreadyImported = imported.has(tmpl.id)
            const alreadyExists = existingTasks.some(t => t.title === tmpl.title)
            return (
              <div key={tmpl.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:border-yellow-200 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-sm text-gray-800">{tmpl.title}</p>
                      {tmpl.use_count > 0 && (
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                          used {tmpl.use_count}×
                        </span>
                      )}
                    </div>
                    {tmpl.description && <p className="text-xs text-gray-500 leading-relaxed mb-2">{tmpl.description.slice(0, 120)}{tmpl.description.length > 120 ? '…' : ''}</p>}
                    {tmpl.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tmpl.tags.map(tag => (
                          <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TAG_COLORS[tag] ?? 'bg-gray-100 text-gray-600'}`}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleUse(tmpl)}
                    disabled={createTask.isPending || alreadyImported || alreadyExists}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 ${
                      alreadyImported || alreadyExists
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-400 text-gray-900 hover:bg-yellow-500'
                    }`}>
                    {alreadyImported || alreadyExists ? <><Check size={11} /> Added</> : <><Plus size={11} /> Use This</>}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400 flex-shrink-0">
          {templates.length} template{templates.length !== 1 ? 's' : ''} — save objectives from any mission to build up this library.
        </div>
      </div>
    </div>
  )
}

// ── Audit Timeline ─────────────────────────────────────────────────────────────

function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  function eventLabel(e: AuditEntry): string {
    const d = e.details
    switch (e.event_type) {
      case 'mission_created':    return `Mission created: ${d.name ?? e.entity_id}`
      case 'stage_changed':      return `Stage: ${d.from} → ${d.to}`
      case 'task_created':       return `Objective added: ${d.title ?? e.entity_id}`
      case 'task_status_changed': return `"${d.title}": ${d.from} → ${d.to}`
      case 'template_saved':     return `Saved as template: ${d.title ?? e.entity_id}`
      case 'template_created':   return `Template created: ${d.title ?? e.entity_id}`
      case 'plan_reviewed':      return `AI plan reviewed (${d.questions_count ?? 0} questions, ${d.answered ?? 0} answered)`
      case 'bot_started':        return `Bot deployed: ${d.stream_id ?? e.entity_id}`
      default:                   return e.event_type.replace(/_/g, ' ')
    }
  }
  function eventIcon(e: AuditEntry): React.ReactNode {
    switch (e.event_type) {
      case 'mission_created':    return <Plus size={12} className="text-green-500" />
      case 'stage_changed':      return <ArrowRight size={12} className="text-blue-500" />
      case 'task_created':       return <CheckSquare size={12} className="text-gray-500" />
      case 'task_status_changed': {
        const to = String(e.details.to ?? '')
        return to === 'done' ? <Check size={12} className="text-green-500" /> :
               to === 'blocked' ? <AlertTriangle size={12} className="text-red-500" /> :
               to === 'in_progress' ? <Play size={12} className="text-blue-500" /> :
               <RotateCcw size={12} className="text-purple-500" />
      }
      case 'template_saved':     return <Bookmark size={12} className="text-yellow-500" />
      case 'template_created':   return <Bookmark size={12} className="text-yellow-500" />
      case 'plan_reviewed':      return <Sparkles size={12} className="text-purple-500" />
      case 'bot_started':        return <Bot size={12} className="text-green-500" />
      default:                   return <Activity size={12} className="text-gray-400" />
    }
  }
  function fmtTime(ts: string): string {
    const d = new Date(ts)
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  if (entries.length === 0) return (
    <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
      <History size={24} className="mx-auto mb-2 opacity-40" />
      <p>No audit history yet. Actions on this mission will appear here.</p>
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      {entries.map((e, i) => (
        <div key={e.id} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
          <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
            {eventIcon(e)}
          </div>
          <span className="flex-1 text-gray-700">{eventLabel(e)}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">{fmtTime(e.timestamp)}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
            e.actor === 'bot' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
          }`}>{e.actor}</span>
        </div>
      ))}
    </div>
  )
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, allTasks, onEdit, onSaveTemplate }: {
  task: Task; allTasks: Task[]; onEdit: (t: Task) => void
  onSaveTemplate?: (t: Task) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [savedTemplate, setSavedTemplate] = useState(false)
  const update = useUpdateTask()
  const depTasks = allTasks.filter(t => task.depends_on?.includes(t.id))
  const unmet = depTasks.filter(t => t.status !== 'done')

  function handleSaveTemplate() {
    if (!onSaveTemplate) return
    onSaveTemplate(task)
    setSavedTemplate(true)
    setTimeout(() => setSavedTemplate(false), 2500)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2 text-xs hover:border-yellow-300 transition-colors group">
      <div className="flex items-start gap-2">
        <button onClick={() => setExpanded(e => !e)} className="flex-1 text-left">
          <p className="font-semibold text-gray-800 text-sm leading-snug">{task.title}</p>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          {unmet.length > 0 && <AlertTriangle size={13} className="text-amber-500" />}
          {onSaveTemplate && (
            <button onClick={handleSaveTemplate} title={savedTemplate ? 'Saved!' : 'Save as template'}
              className={`opacity-0 group-hover:opacity-100 transition-all p-0.5 ${savedTemplate ? 'text-yellow-500 opacity-100' : 'text-gray-400 hover:text-yellow-500'}`}>
              <Bookmark size={12} fill={savedTemplate ? 'currentColor' : 'none'} />
            </button>
          )}
          <button onClick={() => onEdit(task)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 transition-opacity p-0.5"><Pencil size={12} /></button>
        </div>
      </div>
      {task.stream_id && <p className="text-gray-400"><code className="bg-gray-100 px-1 rounded">{task.stream_id}</code></p>}
      {(task.runner_type || task.model_hint) && (
        <div className="flex items-center gap-1 text-[10px]">
          <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">
            {runnerLabel(task.runner_type)}{task.model_hint ? ` · ${task.model_hint.replace('claude-', '').replace('-20251001', '')}` : ''}
          </span>
        </div>
      )}
      {expanded && (
        <div className="space-y-1.5 pt-1 border-t border-gray-100">
          {task.description && <p className="text-gray-600 whitespace-pre-wrap">{task.description}</p>}
          {depTasks.length > 0 && <div>
            <p className="text-gray-400 font-semibold mb-0.5">Depends on:</p>
            {depTasks.map(d => (
              <div key={d.id} className="flex items-center gap-1.5 ml-2">
                {d.status === 'done' ? <CheckSquare size={10} className="text-green-500" /> : <Clock size={10} className="text-amber-500" />}
                <span className={d.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}>{d.title}</span>
              </div>
            ))}
          </div>}
          {task.branch && <p className="font-mono text-gray-400">{task.branch}</p>}
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <button onClick={() => { const idx = TASK_STATUSES.indexOf(task.status); update.mutate({ id: task.id, status: TASK_STATUSES[(idx+1)%TASK_STATUSES.length] }) }}
          disabled={update.isPending} className="text-yellow-700 hover:text-yellow-900 font-semibold disabled:opacity-50">
          Next status →
        </button>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600">
          {expanded ? <X size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>
    </div>
  )
}

// ── Pipeline Views ────────────────────────────────────────────────────────────

function KanbanBoard({ tasks, projectId, missionId, projectPath, onEdit, onSaveTemplate, onFromLibrary }: {
  tasks: Task[]; projectId: string; missionId: string; projectPath?: string
  onEdit: (t: Task) => void; onSaveTemplate: (t: Task) => void; onFromLibrary: () => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const cols: Record<TaskStatus, Task[]> = { queued: [], in_progress: [], review: [], blocked: [], done: [] }
  for (const t of tasks) { if (cols[t.status]) cols[t.status].push(t) }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <button onClick={onFromLibrary} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
          <Library size={14} /> From Library
        </button>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-3 py-1.5 bg-yellow-400 text-gray-900 font-semibold rounded-lg text-sm hover:bg-yellow-500">
          <Plus size={14} /> Add Objective
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {TASK_STATUSES.map(st => (
          <div key={st} className={`rounded-xl border-2 ${COL_COLORS[st]} bg-gray-50 p-3`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-600">{STATUS_LABELS[st]}</span>
              <span className="text-xs bg-white border border-gray-200 rounded-full px-1.5 py-0.5 text-gray-500">{cols[st].length}</span>
            </div>
            <div className="space-y-2">{cols[st].map(t => <TaskCard key={t.id} task={t} allTasks={tasks} onEdit={onEdit} onSaveTemplate={onSaveTemplate} />)}</div>
          </div>
        ))}
      </div>
      {showAdd && <TaskModal projectId={projectId} missionId={missionId} projectPath={projectPath} existingTasks={tasks} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

function PipelineView({ tasks, projectId, missionId, projectPath, onEdit, onSaveTemplate, onFromLibrary, readonly }: {
  tasks: Task[]; projectId: string; missionId: string; projectPath?: string
  onEdit: (t: Task) => void; onSaveTemplate: (t: Task) => void; onFromLibrary: () => void
  readonly?: boolean
}) {
  const [showAdd, setShowAdd] = useState(false)
  const phases = computePhases(tasks)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {readonly ? 'Objectives are locked for review. Click any card to view.' : 'Same phase runs in parallel. Click any card to edit.'}
        </p>
        {!readonly && (
        <div className="flex gap-2">
          <button onClick={onFromLibrary} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            <Library size={14} /> From Library
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-3 py-1.5 bg-yellow-400 text-gray-900 font-semibold rounded-lg text-sm hover:bg-yellow-500">
            <Plus size={14} /> Add Objective
          </button>
        </div>
        )}
      </div>
      {phases.length === 0
        ? <div className="text-center py-12 text-gray-400 text-sm bg-gray-50 rounded-xl border border-gray-200 border-dashed">No objectives yet. Add some to build your pipeline.</div>
        : <div className="flex gap-3 overflow-x-auto pb-4">
            {phases.map((phase, idx) => (
              <div key={phase.depth} className="flex-shrink-0 w-52">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Phase {idx + 1}</span>
                  {idx === 0 && <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">START</span>}
                </div>
                <div className="space-y-2">
                  {phase.tasks.map(t => (
                    <div key={t.id}
                      className={`bg-white rounded-lg border px-3 py-2.5 text-xs group hover:shadow-sm transition-all ${
                        t.status === 'done' ? 'border-green-200 opacity-70' : 'border-gray-200 hover:border-yellow-300'
                      }`}>
                      <div className="flex items-start gap-1.5">
                        <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[t.status]}`} />
                        <button onClick={() => onEdit(t)} className="font-semibold text-gray-800 leading-snug flex-1 text-left cursor-pointer">{t.title}</button>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button onClick={() => onSaveTemplate(t)} title="Save as template"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-yellow-500 p-0.5">
                            <Bookmark size={9} />
                          </button>
                          <button onClick={() => onEdit(t)} className="opacity-0 group-hover:opacity-100 text-gray-300 group-hover:text-gray-500 mt-0.5 flex-shrink-0 transition-opacity p-0.5">
                            <Pencil size={9} />
                          </button>
                        </div>
                      </div>
                      <div className="pl-3.5 mt-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          t.status === 'done' ? 'bg-green-100 text-green-700' :
                          t.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                          t.status === 'blocked' ? 'bg-red-100 text-red-700' :
                          t.status === 'review' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}>{STATUS_LABELS[t.status]}</span>
                        {t.model_hint && (
                          <span className="text-[9px] text-gray-400 ml-1 font-mono">{runnerLabel(t.runner_type)} · {t.model_hint.replace('claude-', '').replace('-20251001', '')}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {idx < phases.length - 1 && <div className="flex justify-end mt-2"><ChevronRight size={16} className="text-gray-300" /></div>}
              </div>
            ))}
          </div>
      }
      {!readonly && showAdd && <TaskModal projectId={projectId} missionId={missionId} projectPath={projectPath} existingTasks={tasks} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ── Mission Control View ──────────────────────────────────────────────────────

function taskDuration(w: Worker): string {
  if (!w.started_at) return ''
  const end = w.completed_at ? new Date(w.completed_at) : new Date()
  const s = Math.floor((end.getTime() - new Date(w.started_at).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function MissionControlView({ tasks, workers, selectedId, onSelectId, onEdit, onLaunch, onKill, onMarkDone }: {
  tasks: Task[]
  workers: Worker[]
  selectedId: string | null
  onSelectId: (id: string) => void
  onEdit?: (t: Task) => void
  onLaunch?: (t: Task) => void
  onKill?: (w: Worker) => void
  onMarkDone?: (t: Task) => void
}) {
  const phases = computePhases(tasks)

  const allActiveWorkers = workers.filter(w => ['starting', 'active', 'idle'].includes(w.status))
  const allFailedWorkers = workers.filter(w => ['failed', 'killed', 'stuck'].includes(w.status))

  function workerForTask(t: Task): Worker | undefined {
    return workers
      .filter(w => w.task_id === t.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  }

  function isNextUp(t: Task): boolean {
    if (t.status !== 'queued') return false
    return t.depends_on.every(depId => tasks.find(x => x.id === depId)?.status === 'done')
  }

  if (tasks.length === 0) {
    return <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">No objectives added yet.</div>
  }

  const selectedTask = tasks.find(t => t.id === selectedId)
  const selectedWorker = selectedTask ? workerForTask(selectedTask) : undefined

  return (
    <div className="space-y-4">
      {/* Flow Diagram */}
      <div className="bg-gray-950 rounded-xl border border-gray-800 p-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">Mission Control</span>
          {allActiveWorkers.length > 0 && (
            <span className="flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded-full bg-green-900/50 border border-green-700/50">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] text-green-400 font-medium">{allActiveWorkers.length} bot{allActiveWorkers.length !== 1 ? 's' : ''} running</span>
              {onKill && (
                <button onClick={() => allActiveWorkers.forEach(w => onKill!(w))}
                  title="Kill all active bots"
                  className="ml-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-red-400/70 hover:text-red-400 text-[11px] leading-none hover:bg-red-900/40">
                  ×
                </button>
              )}
            </span>
          )}
          {allFailedWorkers.length > 0 && (
            <span className="flex items-center gap-1.5 ml-1 px-2 py-0.5 rounded-full bg-red-900/50 border border-red-700/50">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-[10px] text-red-400 font-medium">{allFailedWorkers.length} bot{allFailedWorkers.length !== 1 ? 's' : ''} failed</span>
            </span>
          )}
          <span className="ml-auto text-[10px] text-gray-500">{tasks.filter(t => t.status === 'done').length}/{tasks.length} complete</span>
        </div>
        <div className="flex items-start gap-2 overflow-x-auto pb-2">
          {phases.map((phase, phaseIdx) => (
            <div key={phase.depth} className="flex items-start gap-2 flex-shrink-0">
              <div className="w-44">
                <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2 text-center">
                  Phase {phaseIdx + 1}
                  {phaseIdx === 0 && <span className="ml-1 text-yellow-500">▶</span>}
                </p>
                <div className="space-y-1.5">
                  {phase.tasks.map(t => {
                    const w = workerForTask(t)
                    const isActive = ['starting', 'active', 'idle'].includes(w?.status ?? '')
                    const isFailed = ['failed', 'killed', 'stuck'].includes(w?.status ?? '')
                    const isSelected = t.id === selectedId
                    const nextUp = isNextUp(t)

                    return (
                      <div key={t.id} className={`rounded-lg border-2 transition-all ${
                          isSelected
                            ? 'border-yellow-400 bg-gray-800 shadow-lg shadow-yellow-900/20'
                            : isActive
                            ? 'border-green-500 bg-gray-900'
                            : isFailed
                            ? 'border-red-600/70 bg-red-950/40'
                            : t.status === 'done'
                            ? 'border-green-800/50 bg-gray-900/40 opacity-50'
                            : t.status === 'blocked'
                            ? 'border-red-700 bg-gray-900'
                            : nextUp
                            ? 'border-yellow-700 bg-gray-900'
                            : 'border-gray-700 bg-gray-900'
                        }`}>
                        <button onClick={() => onSelectId(t.id)} className="w-full text-left p-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            {isActive
                              ? <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
                              : isFailed
                              ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                              : <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[t.status]}`} />
                            }
                            <span className="text-[11px] font-semibold text-gray-200 leading-tight line-clamp-2 flex-1">{t.title}</span>
                          </div>
                          <div className="flex items-center gap-1 pl-3">
                            <span className={`text-[9px] px-1 rounded font-bold ${
                              t.status === 'done'        ? 'bg-green-900/60 text-green-400' :
                              t.status === 'in_progress' ? 'bg-blue-900/60 text-blue-300' :
                              t.status === 'blocked'     ? 'bg-red-900/60 text-red-400' :
                              t.status === 'review'      ? 'bg-purple-900/60 text-purple-300' :
                              nextUp                     ? 'bg-yellow-900/60 text-yellow-400' :
                                                           'bg-gray-800 text-gray-500'
                            }`}>{nextUp ? 'next up' : STATUS_LABELS[t.status]}</span>
                          </div>
                          {isActive && w && (
                            <p className="pl-3 mt-0.5 text-[9px] text-green-500 font-mono">⏱ {taskDuration(w)}</p>
                          )}
                        </button>
                        {(onEdit || onLaunch || onKill || onMarkDone || (w && (t.status === 'done' || isFailed))) && (
                          <div className="border-t border-gray-800 px-2 py-1 flex gap-1 flex-wrap">
                            {onEdit && (
                              <button onClick={() => onEdit(t)}
                                className="flex-1 flex items-center justify-center gap-1 text-[9px] text-gray-500 hover:text-yellow-400 transition-colors py-0.5">
                                <Pencil size={9} /> Edit
                              </button>
                            )}
                            {onMarkDone && (isActive || t.status === 'in_progress') && (
                              <button onClick={() => onMarkDone(t)}
                                className="flex-1 flex items-center justify-center gap-1 text-[9px] text-green-600 hover:text-green-400 transition-colors py-0.5 font-semibold">
                                <Check size={9} /> Done
                              </button>
                            )}
                            {onKill && isActive && w && (
                              <button onClick={() => onKill(w)}
                                className="flex-1 flex items-center justify-center gap-1 text-[9px] text-red-700 hover:text-red-400 transition-colors py-0.5">
                                <Square size={9} /> Kill
                              </button>
                            )}
                            {w && (t.status === 'done' || isFailed || isActive) && (
                              <button onClick={() => onSelectId(t.id)}
                                className="flex-1 flex items-center justify-center gap-1 text-[9px] text-blue-500 hover:text-blue-300 transition-colors py-0.5">
                                <Terminal size={9} /> Output
                              </button>
                            )}
                            {onLaunch && !isActive && t.status !== 'done' && (
                              <button onClick={() => onLaunch(t)}
                                className="flex-1 flex items-center justify-center gap-1 text-[9px] text-gray-500 hover:text-green-400 transition-colors py-0.5">
                                <RotateCcw size={9} /> {w?.status === 'failed' || w?.status === 'killed' ? 'Restart' : 'Launch'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {phaseIdx < phases.length - 1 && (
                <div className="flex items-center self-center pt-5">
                  <ChevronRight size={18} className="text-gray-600 flex-shrink-0" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Selected task detail panel */}
      {selectedTask && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[selectedTask.status]}`} />
              <span className="font-semibold text-gray-800 text-sm">{selectedTask.title}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                selectedTask.status === 'done'        ? 'bg-green-100 text-green-700' :
                selectedTask.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                selectedTask.status === 'blocked'     ? 'bg-red-100 text-red-700' :
                selectedTask.status === 'review'      ? 'bg-purple-100 text-purple-700' :
                                                        'bg-gray-100 text-gray-600'
              }`}>{STATUS_LABELS[selectedTask.status]}</span>
            </div>
            <div className="flex items-center gap-2">
              {onEdit && (
                <button onClick={() => onEdit(selectedTask)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                  <Pencil size={11} /> Edit Objective
                </button>
              )}
              {onMarkDone && (selectedTask.status === 'in_progress' || (selectedWorker && ['starting','active','idle'].includes(selectedWorker.status))) && (
                <button onClick={() => onMarkDone(selectedTask)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors">
                  <Check size={11} /> Mark Done
                </button>
              )}
              {selectedWorker && ['starting','active','idle'].includes(selectedWorker.status) && onKill && (
                <button onClick={() => onKill(selectedWorker)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                  <Square size={11} /> Kill Bot
                </button>
              )}
            </div>
          </div>

          <div className="px-4 py-3 grid grid-cols-2 gap-4">
            <div className="space-y-3">
              {selectedTask.description && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Objective Prompt</p>
                  <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{selectedTask.description}</p>
                </div>
              )}
              {selectedTask.model_hint && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Cpu size={11} />
                  <span className="font-mono">{selectedTask.model_hint}</span>
                  {selectedTask.runner_type && selectedTask.runner_type !== 'claude_code' && (
                    <span className="text-gray-400">via {selectedTask.runner_type}</span>
                  )}
                </div>
              )}
            </div>

            {selectedWorker && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Bot Worker</p>
                <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      selectedWorker.status === 'active' ? 'bg-green-400 animate-pulse' :
                      selectedWorker.status === 'done'   ? 'bg-green-600' :
                      selectedWorker.status === 'failed' ? 'bg-red-500' :
                      selectedWorker.status === 'stuck'  ? 'bg-amber-400' : 'bg-gray-400'
                    }`} />
                    <span className="text-xs font-semibold text-gray-700 capitalize">{selectedWorker.status}</span>
                    {selectedWorker.started_at && (
                      <span className="ml-auto text-[11px] text-gray-400 flex items-center gap-0.5">
                        <Clock size={9} /> {taskDuration(selectedWorker)}
                      </span>
                    )}
                  </div>
                  {selectedWorker.stream_id && (
                    <p className="text-[10px] font-mono text-gray-500 truncate">{selectedWorker.stream_id}</p>
                  )}
                  {selectedWorker.model && (
                    <p className="text-[10px] text-gray-400">{selectedWorker.model.replace('claude-', '').replace('-20251001', '')}</p>
                  )}
                  {selectedWorker.pid != null && (
                    <p className="text-[10px] font-mono text-gray-400">PID {selectedWorker.pid}</p>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

// ── Dependency Graph ──────────────────────────────────────────────────────────

type TaskFlowNode = Node<{ task: Task; onEdit: (t: Task) => void }, 'task'>

function TaskFlowNodeComponent({ data }: NodeProps<TaskFlowNode>) {
  const { task, onEdit } = data
  return (
    <div onClick={() => onEdit(task)}
      style={{ background: NODE_BG[task.status], borderColor: NODE_BORDER[task.status] }}
      className="border-2 rounded-lg px-3 py-2.5 w-48 cursor-pointer hover:shadow-md transition-shadow group select-none">
      <Handle type="target" position={Position.Left} style={{ background: '#9ca3af', width: 8, height: 8, border: 'none' }} />
      <div className="flex items-start gap-1.5 mb-1.5">
        <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[task.status]}`} />
        <p className="text-xs font-semibold text-gray-800 leading-snug flex-1 truncate">{task.title}</p>
        <Pencil size={9} className="text-gray-300 group-hover:text-gray-500 flex-shrink-0 mt-0.5" />
      </div>
      <div className="pl-3.5">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium ${
          task.status === 'done' ? 'bg-green-100 text-green-700' : task.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
          task.status === 'blocked' ? 'bg-red-100 text-red-700' : task.status === 'review' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
        }`}>{STATUS_LABELS[task.status]}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#9ca3af', width: 8, height: 8, border: 'none' }} />
    </div>
  )
}
const FLOW_NODE_TYPES = { task: TaskFlowNodeComponent }

function DependencyGraph({ tasks, projectId, missionId, projectPath, onEdit, onFromLibrary }: {
  tasks: Task[]; projectId: string; missionId: string; projectPath?: string
  onEdit: (t: Task) => void; onFromLibrary: () => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const phases = useMemo(() => computePhases(tasks), [tasks])
  const stableOnEdit = useCallback(onEdit, [onEdit])

  const makeNodes = useCallback(() => tasks.map(t => {
    const pi = Math.max(0, phases.findIndex(p => p.tasks.some(pt => pt.id === t.id)))
    const ri = (phases[pi]?.tasks ?? [t]).findIndex(pt => pt.id === t.id)
    return { id: t.id, type: 'task' as const, position: { x: pi * 260, y: ri * 130 }, data: { task: t, onEdit: stableOnEdit } }
  }), [tasks, phases, stableOnEdit])

  const makeEdges = useCallback(() => tasks.flatMap(t =>
    (t.depends_on ?? []).filter(d => tasks.some(x => x.id === d)).map(dep => ({
      id: `e-${dep}-${t.id}`, source: dep, target: t.id, type: 'smoothstep',
      animated: t.status === 'in_progress',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#9ca3af' },
      style: { stroke: t.status === 'blocked' ? '#fca5a5' : '#d1d5db', strokeWidth: 1.5 },
    }))
  ), [tasks])

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>(makeNodes())
  const [edges, setEdges, onEdgesChange] = useEdgesState(makeEdges())

  useEffect(() => {
    setNodes(prev => {
      const posMap = new Map(prev.map(n => [n.id, n.position]))
      return tasks.map(t => {
        const pos = posMap.get(t.id) ?? (() => {
          const pi = Math.max(0, phases.findIndex(p => p.tasks.some(pt => pt.id === t.id)))
          const ri = (phases[pi]?.tasks ?? [t]).findIndex(pt => pt.id === t.id)
          return { x: pi * 260, y: ri * 130 }
        })()
        return { id: t.id, type: 'task' as const, position: pos, data: { task: t, onEdit: stableOnEdit } }
      })
    })
    setEdges(makeEdges())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, stableOnEdit])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Drag nodes to rearrange. Arrows show dependencies. Click to edit.</p>
        <div className="flex gap-2">
          <button onClick={onFromLibrary} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            <Library size={14} /> From Library
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-3 py-1.5 bg-yellow-400 text-gray-900 font-semibold rounded-lg text-sm hover:bg-yellow-500">
            <Plus size={14} /> Add Objective
          </button>
        </div>
      </div>
      <div className="h-[500px] rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
        {tasks.length === 0
          ? <div className="h-full flex items-center justify-center text-gray-400 text-sm">No objectives yet.</div>
          : <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              nodeTypes={FLOW_NODE_TYPES} fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.25} maxZoom={2} proOptions={{ hideAttribution: true }}>
              <Background gap={20} color="#e5e7eb" /><Controls showInteractive={false} />
            </ReactFlow>
        }
      </div>
      {showAdd && <TaskModal projectId={projectId} missionId={missionId} projectPath={projectPath} existingTasks={tasks} onClose={() => setShowAdd(false)} />}
    </div>
  )
}


// ── Launch Confirm Modal ──────────────────────────────────────────────────────

function LaunchConfirmModal({ missionId, missionName, tasks, projectPath, onClose, onLaunched }: {
  missionId: string; missionName: string; tasks: Task[]
  projectPath?: string | null; onClose: () => void; onLaunched: () => void
}) {
  const [notes, setNotes] = useState('')
  const [spawn, setSpawn] = useState(true)
  const [error, setError] = useState('')
  const startBot = useStartMissionBot()

  // Hard block: every task that doesn't have its own working_dir needs a project path.
  // Without this, the bot defaults to the hub's own directory and can overwrite hub files.
  const missingFolder = tasks.some(t => !t.working_dir?.trim() && !projectPath?.trim())

  const modelGroups = tasks.reduce<Record<string, number>>((acc, t) => {
    const key = t.model_hint || 'default'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  function taskLocation(t: Task): string {
    const mode = t.folder_mode || 'inherit'
    if (mode === 'existing' && t.working_dir) return t.working_dir
    if (mode === 'new') {
      if (t.working_dir) return projectPath ? `${projectPath}\\${t.working_dir}` : t.working_dir
      return projectPath ? `${projectPath}\\<auto>` : '<auto-named subfolder>'
    }
    if (mode === 'clone') return t.working_dir ? `clone → ${t.working_dir}` : 'clone → <auto>'
    return projectPath || 'Project folder not configured'
  }

  async function handleBegin() {
    setError('')
    try {
      await startBot.mutateAsync({
        missionId,
        notes: notes.trim() || undefined,
        spawn,
      })
      onLaunched()
    } catch (err: any) { setError(err.message ?? 'Failed') }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-950 rounded-t-xl flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Play size={14} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-white">Begin Mission?</h2>
              <p className="text-xs text-gray-400 mt-0.5">{missionName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-xl">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Summary */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">{tasks.length} objective{tasks.length !== 1 ? 's' : ''} will be deployed</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(modelGroups).map(([model, count]) => (
                  <span key={model} className="text-[11px] bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-medium">
                    {count}× {model.replace('claude-', '').replace('-20251001', '')}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <FolderOpen size={11} className="flex-shrink-0 text-gray-400" />
              {projectPath
                ? <span className="font-mono text-gray-500 truncate">{projectPath}</span>
                : <span className="italic text-amber-600">Project path not configured — set it on the project page</span>
              }
            </div>
          </div>

          {/* Objectives list */}
          <div className="space-y-2">
            {tasks.map((t, i) => (
              <div key={t.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2.5">
                <div className="flex items-start gap-3">
                  <span className="text-[11px] font-bold text-gray-400 mt-0.5 w-5 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{t.title}</p>
                    {t.description && (
                      <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{t.description}</p>
                    )}
                  </div>
                  <span className="text-[10px] font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded flex-shrink-0">
                    {(t.model_hint || 'default').replace('claude-', '').replace('-20251001', '')}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-1.5 pl-8">
                  <FolderOpen size={10} className="text-gray-400 flex-shrink-0" />
                  <span className="text-[10px] font-mono text-gray-400 truncate">{taskLocation(t)}</span>
                  {t.git_repo && (
                    <>
                      <span className="text-gray-300 mx-0.5">·</span>
                      <GitBranch size={10} className="text-gray-400 flex-shrink-0" />
                      <span className="text-[10px] font-mono text-gray-400 truncate">{t.git_repo}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Session notes <span className="text-gray-400 font-normal">(optional)</span></label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Extra context…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={spawn} onChange={e => setSpawn(e.target.checked)} className="w-4 h-4 accent-green-500" />
                <span className="text-sm text-gray-700">Spawn terminal immediately</span>
              </label>
            </div>
          </div>

          {missingFolder && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-300 rounded-lg px-4 py-3">
              <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium">
                Project folder not set. Close this modal and set the project folder on the Project page before launching.
                Without it, the bot has nowhere safe to write files.
              </p>
            </div>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleBegin} disabled={startBot.isPending || missingFolder}
            className="flex items-center gap-2 px-5 py-2 text-sm bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed">
            {startBot.isPending ? <><RefreshCw size={14} className="animate-spin" /> Starting…</> : <><Play size={14} /> Begin Mission</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Completion Panel ──────────────────────────────────────────────────────────

function WorkerResultCard({ worker }: { worker: Worker }) {
  const { data: transcript } = useWorkerTranscript(worker.id, false)
  const succeeded = worker.status === 'done'

  // Scan last 30 lines for error signals
  const lines = transcript?.lines ?? []
  const tail = lines.slice(-30).join('\n').toLowerCase()
  const hasErrors = /error|exception|traceback|failed|fatal/.test(tail)
  const confidence = succeeded && !hasErrors ? 'success' : succeeded && hasErrors ? 'warning' : 'failed'

  const CONF: Record<string, { bg: string; border: string; icon: React.ReactNode; label: string }> = {
    success: { bg: 'bg-green-50', border: 'border-green-200', icon: <CheckSquare size={13} className="text-green-600" />, label: 'Completed successfully' },
    warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: <AlertTriangle size={13} className="text-amber-600" />, label: 'Completed — check output for warnings' },
    failed:  { bg: 'bg-red-50',   border: 'border-red-200',   icon: <AlertTriangle size={13} className="text-red-500" />,   label: 'Bot exited with errors' },
  }
  const c = CONF[confidence]

  return (
    <div className={`rounded-xl border px-4 py-3 flex items-start gap-2.5 ${c.bg} ${c.border}`}>
      {c.icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{c.label}</p>
        <p className="text-[11px] text-gray-500 font-mono truncate">{worker.stream_id}</p>
        {lines.length > 0 && (
          <p className="text-[11px] text-gray-500 mt-0.5 font-mono line-clamp-2 whitespace-pre-wrap">
            {lines.slice(-3).join('\n')}
          </p>
        )}
      </div>
    </div>
  )
}

function CompletionPanel({ tasks, workers, missionId, onLaunch }: {
  tasks: Task[]
  workers: Worker[]
  missionId: string
  onLaunch: (t: Task) => void
}) {
  // Find workers that just finished (done/failed/complete)
  const finishedWorkers = workers.filter(w => ['done', 'failed', 'complete'].includes(w.status))

  // Find next tasks ready to run: queued + all depends_on are done
  const doneTasks = new Set(tasks.filter(t => t.status === 'done').map(t => t.id))
  const readyTasks = tasks.filter(t =>
    t.status === 'queued' &&
    (t.depends_on ?? []).every(d => doneTasks.has(d))
  )

  if (finishedWorkers.length === 0 && readyTasks.length === 0) return null

  return (
    <div className="space-y-3">
      {finishedWorkers.map(w => (
        <WorkerResultCard key={w.id} worker={w} />
      ))}
      {readyTasks.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
            <ArrowRight size={14} /> Ready to launch
          </p>
          {readyTasks.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-3 bg-white rounded-lg px-3 py-2 border border-green-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{t.title}</p>
                <p className="text-[11px] text-gray-400">{runnerLabel(t.runner_type)} · {t.model_hint || 'default model'}</p>
              </div>
              <button onClick={() => onLaunch(t)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 flex-shrink-0">
                <Play size={11} /> Launch →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Live Monitor ──────────────────────────────────────────────────────────────

function LiveMonitor({ workers }: { workers: Worker[] }) {
  const [open, setOpen] = useState(true)
  const active = workers.filter(w => ['starting', 'active', 'idle'].includes(w.status))
  // Show active bots first, then most recent finished bot (keep output visible after completion)
  const visible = active.length > 0
    ? workers  // all when any active
    : workers.slice(0, 1)  // just the most recent when done
  if (visible.length === 0) return null
  const isLive = active.length > 0

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-900/50 transition-colors">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
          <span className="text-xs font-bold text-gray-200 uppercase tracking-widest">
            {isLive ? 'Live Bot Output' : 'Bot Output'}
          </span>
          {isLive
            ? <span className="ml-1 text-[10px] text-green-400">{active.length} bot{active.length !== 1 ? 's' : ''} running</span>
            : <span className="ml-1 text-[10px] text-gray-500">{workers[0]?.status ?? 'done'}</span>
          }
        </div>
        {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>
      {open && (
        <div className="divide-y divide-gray-800">
          {visible.map(w => (
            <div key={w.id}>
              <div className="px-4 py-2 bg-gray-900/60 flex items-center gap-2">
                <Terminal size={11} className="text-green-400 flex-shrink-0" />
                <code className="text-xs font-mono text-green-400">{w.stream_id}</code>
                {w.pid != null && (
                  <span className="text-[10px] font-mono text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">PID {w.pid}</span>
                )}
                {w.stream_notes && <span className="text-xs text-gray-500 truncate">— {w.stream_notes}</span>}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold flex-shrink-0 ml-1 ${
                  ['starting','active','idle'].includes(w.status) ? 'bg-blue-900/60 text-blue-300' :
                  w.status === 'done' ? 'bg-green-900/60 text-green-400' : 'bg-red-900/60 text-red-400'
                }`}>{w.status}</span>
                <span className="ml-auto text-[11px] text-gray-500 flex items-center gap-1">
                  <Clock size={9} />{taskDuration(w)}
                </span>
              </div>
              <InlineTranscript worker={w} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Report View ───────────────────────────────────────────────────────────────

function ReportView({ report }: { report: MissionReport }) {
  const completion = report.total_tasks > 0 ? Math.round((report.done_tasks / report.total_tasks) * 100) : 0
  const isComplete = report.done_tasks === report.total_tasks && report.total_tasks > 0

  return (
    <div className="space-y-6 max-w-4xl">
      <div className={`rounded-2xl p-6 ${isComplete ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-xl ${isComplete ? 'bg-green-100' : 'bg-gray-100'}`}>
            {isComplete ? <Trophy size={24} className="text-green-600" /> : <FileText size={24} className="text-gray-500" />}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-black text-gray-900">{isComplete ? 'Mission Complete' : 'Mission In Progress'}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{report.mission_name}</p>
            {report.success_criteria && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{report.success_criteria}</p>}
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-gray-900">{completion}%</div>
            <div className="text-xs text-gray-400">{report.done_tasks}/{report.total_tasks} done</div>
          </div>
        </div>
        <div className="mt-4 bg-gray-200 rounded-full h-2 overflow-hidden">
          <div className={`h-full rounded-full ${isComplete ? 'bg-green-500' : 'bg-yellow-400'}`} style={{ width: `${completion}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Objectives done', value: `${report.done_tasks} / ${report.total_tasks}`, icon: <CheckSquare size={16} className="text-green-500" /> },
          { label: 'Tokens used', value: fmtTokens(report.total_tokens), icon: <Zap size={16} className="text-yellow-500" /> },
          { label: 'Bots deployed', value: String(report.total_workers), icon: <Bot size={16} className="text-blue-500" /> },
          { label: report.avg_rating ? 'Avg quality' : 'Duration', value: report.avg_rating ? `${report.avg_rating}/5 ★` : fmtDuration(report.created_at, report.updated_at), icon: report.avg_rating ? <Star size={16} className="text-amber-500" /> : <Clock size={16} className="text-gray-400" /> },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">{s.icon}{s.label}</div>
            <div className="text-xl font-black text-gray-900">{s.value}</div>
          </div>
        ))}
      </div>
      {Object.keys(report.model_stats).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><TrendingUp size={15} className="text-gray-500" />Models Used</h3>
          {Object.entries(report.model_stats).map(([model, stats]) => (
            <div key={model} className="flex items-center gap-3 text-sm">
              <code className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono">{model}</code>
              <span className="text-xs text-gray-500">{stats.tasks_completed} tasks · {fmtTokens(stats.prompt_tokens + stats.completion_tokens)} tokens · {stats.events} events</span>
            </div>
          ))}
        </div>
      )}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200"><h3 className="font-bold text-gray-800">Objectives</h3></div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
            <tr>
              <th className="px-4 py-2 text-left">Title</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Model</th>
              <th className="px-4 py-2 text-right">Tokens</th>
              <th className="px-4 py-2 text-right">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {report.tasks.map(t => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5"><p className="font-medium text-gray-800">{t.title}</p>{t.notes && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{t.notes}</p>}</td>
                <td className="px-4 py-2.5"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-2.5 text-xs font-mono text-gray-400">{t.model_hint ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500 text-right">{t.cost_tokens > 0 ? fmtTokens(t.cost_tokens) : '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-400 text-right">{t.started_at && t.completed_at ? fmtDuration(t.started_at, t.completed_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Question Card ─────────────────────────────────────────────────────────────

function QuestionCard({ q }: { q: MissionQuestion }) {
  const [reply, setReply] = useState(''); const [sent, setSent] = useState(false); const [error, setError] = useState('')
  const replyMut = useReplyToQuestion()
  async function handleSend() {
    if (!reply.trim()) return
    try { await replyMut.mutateAsync({ targetStream: q.target_stream, code: 'REPLY', message: reply.trim(), fromStream: 'hub-operator' }); setSent(true) }
    catch (err: any) { setError(err.message ?? 'Failed') }
  }
  const minutesAgo = Math.floor((Date.now() - new Date(q.sent_at).getTime()) / 60_000)
  const CODE_STYLES: Record<string, string> = { QUESTION: 'bg-blue-100 text-blue-700', BLOCKER: 'bg-red-100 text-red-700', INFO: 'bg-gray-100 text-gray-600', UPDATE: 'bg-green-100 text-green-700' }

  return (
    <div className={`bg-white border rounded-xl p-4 space-y-3 ${sent ? 'border-green-200 opacity-70' : 'border-gray-200'}`}>
      <div className="flex items-start gap-3">
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 mt-0.5 ${CODE_STYLES[q.code] ?? 'bg-gray-100 text-gray-600'}`}>{q.code}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{q.message}</p>
          <div className="flex gap-3 mt-1.5 text-[11px] text-gray-400">
            <span>from <code className="bg-gray-100 px-1 rounded">{q.from_stream}</code></span>
            <span>{minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ago`}</span>
          </div>
        </div>
      </div>
      {sent ? <p className="text-xs text-green-600 font-medium flex items-center gap-1.5"><CheckSquare size={12} /> Reply sent</p>
        : <div className="space-y-2">
            <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} placeholder="Type your reply…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end">
              <button onClick={handleSend} disabled={replyMut.isPending || !reply.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-yellow-400 text-gray-900 font-semibold rounded-lg hover:bg-yellow-500 disabled:opacity-50">
                {replyMut.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Send size={11} />} Send Reply
              </button>
            </div>
          </div>
      }
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'run' | 'pipeline' | 'bots' | 'briefing' | 'questions' | 'signal' | 'report' | 'history'
type ViewMode = 'phase' | 'graph' | 'kanban'

export default function MissionDetailPage() {
  const { id, missionId } = useParams<{ id: string; missionId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const isRunRoute = location.pathname.endsWith('/run')
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [showStartBot, setShowStartBot] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<{ task: Task; worker: Worker | null; defaultModel: string; defaultRunner: string } | null>(null)

  const { data: project } = useProject(id!)
  const { data: mission, isLoading } = useMission(missionId!)
  const { data: workers = [] } = useWorkers({ mission_id: missionId! })
  const { data: tasks = [] } = useTasks({ mission_id: missionId! })
  const { data: questions = [] } = useMissionQuestions(missionId!)
  const { data: config } = useConfig()
  const { data: report } = useMissionReport(missionId!)
  const { data: auditEntries = [] } = useAuditLog({ mission_id: missionId! })
  const killWorker = useKillWorker()
  const startBot = useStartMissionBot()
  const updateTask = useUpdateTask()
  const updateMission = useUpdateMission()
  const updateProject = useUpdateProject()
  const reviewMut = useReviewMissionPlan()
  const saveTemplateMut = useSaveTaskAsTemplate()

  const botBehaviorTemplate = config?.['bot_behavior_template']?.value ?? ''
  const hubUrl = config?.['hub_base_url']?.value || 'http://localhost:9100'
  const stage = (mission?.stage ?? 'draft') as MissionStage

  // Derive the effective project path: explicit path OR base_dir + slug(name)
  const baseDir = config?.['projects_base_dir']?.value ?? ''
  const projectSlug = (project?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const sep = baseDir.includes('/') ? '/' : '\\'
  const effectiveProjectPath = project?.project_path?.trim()
    || (baseDir && projectSlug ? `${baseDir}${sep}${projectSlug}` : '')
  const planQa = mission?.plan_qa ?? null
  const activeWorkers = workers.filter(w => ['starting', 'active', 'idle'].includes(w.status))
  const failedWorkers = workers.filter(w => ['failed', 'killed', 'stuck'].includes(w.status))
  const pendingQuestions = questions.filter(q => !q.resolved_at)

  // ── Monitor selected task (drives ConsolePanel) ──────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  // Auto-follow: only switch when a worker STARTS running (has an active/starting worker).
  // Do NOT override the user's manual selection just because a task is in_progress —
  // the task may still be in_progress even after its worker failed.
  useEffect(() => {
    if (!tasks.length) return
    const activeTaskId = workers.find(
      w => ['starting','active','idle'].includes(w.status) && w.task_id
    )?.task_id
    // First-time default: pick first task; after that, only jump if a bot goes active
    const target = activeTaskId ?? (selectedTaskId == null ? tasks[0]?.id : null)
    if (target && target !== selectedTaskId) setSelectedTaskId(target)
  }, [tasks.length, workers.map(w => w.status + w.task_id).join(',')])

  const handleEdit = useCallback((t: Task) => setEditTask(t), [])
  const handleMarkDone = useCallback((t: Task) => {
    updateTask.mutate({ id: t.id, status: 'done', completed_at: new Date().toISOString() } as any)
  }, [updateTask])
  const handleLaunchTask = useCallback((t: Task) => {
    startBot.mutate({
      missionId: missionId!,
      task_id: t.id,
      suffix: t.id.slice(-8),
      stream_id: `${missionId!.replace('m-','')}-${t.id.slice(-6)}`,
      model: t.model_hint || undefined,
      runner_type: t.runner_type || 'claude_code',
      notes: `Task: ${t.title}`,
      spawn: true,
    })
  }, [startBot, missionId])
  const handleSaveTemplate = useCallback((t: Task) => {
    saveTemplateMut.mutate({ taskId: t.id })
  }, [saveTemplateMut])

  async function handleReviewPlan() {
    reviewMut.mutate(
      { missionId: missionId!, priorAnswers: planQa?.questions ?? [] },
      { onSuccess: () => navigate(`/projects/${id}/missions/${missionId}/review`) },
    )
  }

  async function handleMarkComplete() {
    await updateMission.mutateAsync({ id: missionId!, project_id: id!, stage: 'complete', status: 'done' } as any)
  }

  if (isLoading) return <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>
  if (!mission) return (
    <div className="text-center py-8">
      <p className="text-gray-500">Mission not found.</p>
      <Link to={`/projects/${id}`} className="text-yellow-700 text-sm hover:underline mt-2 block font-medium">← Back to project</Link>
    </div>
  )

  // ── /run route: dedicated Mission Monitor page ──
  if (isRunRoute) {
    return (
      <div className="space-y-5 max-w-7xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link to="/projects" className="hover:text-yellow-600">Projects</Link>
          <ChevronRight size={12} />
          <Link to={`/projects/${id}`} className="hover:text-yellow-600">{project?.name ?? id}</Link>
          <ChevronRight size={12} />
          <Link to={`/projects/${id}/missions/${missionId}`} className="hover:text-yellow-600">{mission.name}</Link>
          <ChevronRight size={12} />
          <span className="text-gray-600">Monitor</span>
        </div>

        {/* Monitor header */}
        <div className="flex items-start gap-4">
          <div className="flex items-center gap-4 flex-1">
            <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Play size={20} className="text-white" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-blue-500 uppercase tracking-widest">Step 4 of 5</p>
              <h2 className="text-3xl font-black text-gray-900 leading-none">Monitor Mission</h2>
              <p className="text-sm text-gray-500 mt-0.5">{mission.name} — {tasks.filter(t => t.status === 'done').length}/{tasks.length} objectives complete</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {activeWorkers.length > 0 && (
              <button onClick={() => activeWorkers.forEach(w => killWorker.mutate(w.id))} disabled={killWorker.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
                <Square size={13} /> Stop All
              </button>
            )}
            <button onClick={handleMarkComplete}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600">
              <Trophy size={13} /> Mark Complete
            </button>
          </div>
        </div>

        {/* Live stats bar */}
        <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm flex-wrap">
          {/* Active bots with per-bot kill buttons */}
          {activeWorkers.length > 0
            ? <span className="flex items-center gap-2 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="font-medium text-green-700">{activeWorkers.length} bot{activeWorkers.length !== 1 ? 's' : ''} running</span>
                {activeWorkers.map(w => (
                  <button key={w.id} onClick={() => killWorker.mutate(w.id)} disabled={killWorker.isPending}
                    title={`Kill ${w.stream_id ?? w.id}${w.pid != null ? ` (PID ${w.pid})` : ''}`}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-red-500 border border-red-200 rounded hover:bg-red-50 disabled:opacity-40 font-mono">
                    <Square size={9} />Kill{w.pid != null ? ` · PID ${w.pid}` : ''}
                  </button>
                ))}
              </span>
            : <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-gray-300" />
                <span className="text-gray-500">No active bots</span>
              </span>
          }
          {/* Failed/killed bots */}
          {failedWorkers.length > 0 && (
            <span className="flex items-center gap-2 text-red-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {failedWorkers.length} bot{failedWorkers.length !== 1 ? 's' : ''} failed
            </span>
          )}
          <span className="text-gray-300">|</span>
          {(() => {
            const runningTaskIds = new Set(
              workers.filter(w => ['starting','active','idle'].includes(w.status) && w.task_id).map(w => w.task_id!)
            )
            // A task is "done" if DB says so OR its most recent worker completed successfully
            const doneWorkerTaskIds = new Set(
              workers.filter(w => w.status === 'done' && w.task_id).map(w => w.task_id!)
            )
            const doneCount = tasks.filter(t => t.status === 'done' || doneWorkerTaskIds.has(t.id)).length
            const inProgressCount = tasks.filter(t =>
              (t.status === 'in_progress' || runningTaskIds.has(t.id)) &&
              t.status !== 'done' && !doneWorkerTaskIds.has(t.id)
            ).length
            const queuedCount = tasks.filter(t =>
              t.status === 'queued' && !runningTaskIds.has(t.id) && !doneWorkerTaskIds.has(t.id)
            ).length
            const blockedCount = tasks.filter(t => t.status === 'blocked').length
            return <>
              <span className={doneCount > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>{doneCount} done</span>
              <span className="text-gray-500">{inProgressCount} in progress</span>
              <span className="text-gray-500">{queuedCount} queued</span>
              {blockedCount > 0 && <span className="text-red-600 font-medium">{blockedCount} blocked</span>}
            </>
          })()}
        </div>

        {/* Launch Next banner — shown when a task is done and next is ready */}
        {(() => {
          const doneSet = new Set([
            ...tasks.filter(t => t.status === 'done').map(t => t.id),
            ...workers.filter(w => w.status === 'done' && w.task_id).map(w => w.task_id!),
          ])
          const readyTasks = tasks.filter(t =>
            t.status === 'queued' &&
            !doneSet.has(t.id) &&
            !workers.some(w => w.task_id === t.id && ['starting','active','idle'].includes(w.status)) &&
            (t.depends_on ?? []).every(d => doneSet.has(d))
          )
          // Suppress if a mission-level bot (no task_id) already ran to completion —
          // it handled the mission holistically, so re-prompting individual tasks is wrong.
          const missionBotDone = workers.some(w => !w.task_id && w.status === 'done')
          if (readyTasks.length === 0 || activeWorkers.length > 0 || missionBotDone) return null
          return (
            <div className="bg-green-950/60 border border-green-700/50 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-green-400">
                <ArrowRight size={15} />
                <span className="text-sm font-bold">
                  {readyTasks.length === 1 ? 'Next objective ready to launch' : `${readyTasks.length} objectives ready`}
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {readyTasks.map(t => (
                  <button key={t.id} onClick={() => { handleLaunchTask(t); setSelectedTaskId(t.id) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors">
                    <Play size={11} /> Launch: {t.title.length > 40 ? t.title.slice(0, 40) + '…' : t.title}
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Mission Control */}
        <MissionControlView
          tasks={tasks}
          workers={workers}
          selectedId={selectedTaskId}
          onSelectId={setSelectedTaskId}
          onEdit={handleEdit}
          onLaunch={handleLaunchTask}
          onKill={w => killWorker.mutate(w.id)}
          onMarkDone={handleMarkDone}
        />

        {/* Always-visible console panel — tracks selected objective */}
        <ConsolePanel
          tasks={tasks}
          workers={workers}
          selectedTaskId={selectedTaskId}
          missionId={missionId!}
          projectPath={effectiveProjectPath}
          onLaunchReview={(task, worker, defaultModel, defaultRunner) => {
            setReviewTarget({ task, worker, defaultModel, defaultRunner })
          }}
        />

        {/* Mission-level bots (no task_id) — persist after completion so output stays visible */}
        {workers.some(w => !w.task_id) && (
          <LiveMonitor workers={
            [...workers.filter(w => !w.task_id)]
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          } />
        )}

        {/* Modals */}
        {editTask && (
          <TaskModal
            projectId={id!} missionId={missionId!} projectPath={effectiveProjectPath}
            existingTasks={tasks} editTask={editTask}
            onClose={() => setEditTask(null)}
          />
        )}
        {reviewTarget && (
          <ReviewModal
            task={reviewTarget.task}
            worker={reviewTarget.worker}
            missionId={missionId!}
            projectPath={effectiveProjectPath}
            onClose={() => setReviewTarget(null)}
            onLaunch={(model, runner) => {
              const t = reviewTarget.task
              const reviewPrompt = [
                `REVIEW REQUEST: ${t.title}`,
                '',
                'You are an independent code reviewer. A bot previously ran this objective:',
                t.description,
                '',
                'Your job:',
                `1. Open and inspect the project folder: ${effectiveProjectPath}`,
                '2. Look at what files were created, modified, or deleted',
                '3. Check if the requirements in the task description were actually met',
                '4. Give a clear verdict: PASS / NEEDS WORK / FAIL',
                '5. List specific issues if any',
                '',
                'Be concise and specific. Focus on whether the code actually works.',
              ].join('\n')
              startBot.mutate({
                missionId: missionId!,
                suffix: `rev-${t.id.slice(-6)}`,
                stream_id: `review-${t.id.slice(-6)}-${Date.now().toString(36)}`,
                model,
                runner_type: runner,
                notes: reviewPrompt,
                spawn: true,
              })
              setReviewTarget(null)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link to="/projects" className="hover:text-yellow-600">Projects</Link>
        <ChevronRight size={12} />
        <Link to={`/projects/${id}`} className="hover:text-yellow-600">{project?.name ?? id}</Link>
        <ChevronRight size={12} />
        <span className="text-gray-600">{mission.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-gray-900">{mission.name}</h1>
          {mission.description && <p className="text-sm text-gray-500 mt-0.5">{mission.description}</p>}
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
            <span className="flex items-center gap-1"><CheckSquare size={12} /> {tasks.length} objective{tasks.length !== 1 ? 's' : ''}</span>
            <span className="flex items-center gap-1"><Bot size={12} /> {activeWorkers.length} active</span>
            {(() => {
              const models = [...new Set(tasks.map(t => t.model_hint).filter(Boolean))]
              const display = models.length > 1 ? 'multi-model' : models[0] || mission.model_hint
              return display ? <span className="flex items-center gap-1"><Cpu size={12} /> {display}</span> : null
            })()}
            {mission.branch_prefix
              ? <span className="flex items-center gap-1"><GitBranch size={12} /> {mission.branch_prefix}*</span>
              : <span className="flex items-center gap-1 text-gray-300"><GitBranch size={12} /> no git detected</span>
            }
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={mission.status} />
          {activeWorkers.length > 0 && (
            <button onClick={() => activeWorkers.forEach(w => killWorker.mutate(w.id))} disabled={killWorker.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
              <Square size={13} /> Stop All
            </button>
          )}
          {stage === 'complete' ? null : stage === 'running' ? (
            <button onClick={handleMarkComplete}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600">
              <Trophy size={13} /> Mark Complete
            </button>
          ) : stage === 'approved' ? (
            <button onClick={() => setShowStartBot(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 animate-pulse">
              <Play size={13} /> Begin Mission
            </button>
          ) : null}
        </div>
      </div>

      {/* Stage banner */}
      {stage === 'draft' && (
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gray-800 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Pencil size={20} className="text-yellow-400" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Step 1 of 5</p>
            <h2 className="text-3xl font-black text-gray-900 leading-none">Plan Mission</h2>
            <p className="text-sm text-gray-500 mt-0.5">Add objectives and describe what each one needs to build.</p>
            {effectiveProjectPath && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-gray-400 mt-1">
                <FolderOpen size={11} className="flex-shrink-0" />
                <span className="truncate">{effectiveProjectPath}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {stage === 'review' && (
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-500 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-purple-500 uppercase tracking-widest">Step 2 of 5</p>
            <h2 className="text-3xl font-black text-gray-900 leading-none">Review Mission</h2>
            <p className="text-sm text-gray-500 mt-0.5">Write a clear prompt for each objective — click Review Objectives to start.</p>
          </div>
        </div>
      )}
      {stage === 'approved' && (
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center flex-shrink-0">
            <CheckSquare size={20} className="text-white" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-green-600 uppercase tracking-widest">Step 3 of 5</p>
            <h2 className="text-3xl font-black text-gray-900 leading-none">Pre-launch</h2>
            <p className="text-sm text-gray-500 mt-0.5">Everything checks out? Launch the mission and the bots get to work.</p>
          </div>
        </div>
      )}
      {stage === 'running' && (
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Play size={20} className="text-white" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-blue-500 uppercase tracking-widest">Step 4 of 5</p>
            <h2 className="text-3xl font-black text-gray-900 leading-none">Run Mission</h2>
            <p className="text-sm text-gray-500 mt-0.5">Bots are working — monitor progress in Mission Control.</p>
          </div>
        </div>
      )}
      {stage === 'complete' && (
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-yellow-400 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Trophy size={20} className="text-gray-900" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-yellow-600 uppercase tracking-widest">Complete</p>
            <h2 className="text-3xl font-black text-gray-900 leading-none">Mission Complete</h2>
            <p className="text-sm text-gray-500 mt-0.5">See the Report tab for a full summary of what was built.</p>
          </div>
        </div>
      )}

      {/* Stage Progress Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <StageBar stage={stage} />
        {/* Stage-specific call-to-action */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          {stage === 'draft' && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {tasks.length === 0
                  ? 'Add objectives — each one needs a title and a clear description of what to build.'
                  : `${tasks.length} objective${tasks.length !== 1 ? 's' : ''} planned. When every objective has a description, move to Review.`}
              </p>
              <button onClick={handleReviewPlan} disabled={tasks.length === 0 || reviewMut.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-500 text-white font-semibold rounded-lg hover:bg-purple-600 disabled:opacity-50">
                {reviewMut.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Review Mission →
              </button>
            </div>
          )}
          {stage === 'review' && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Review and write a prompt for each objective, then save to move to Pre-launch.
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => updateMission.mutateAsync({ id: missionId!, project_id: id!, stage: 'draft' } as any)}
                  className="px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                  ← Back to Planning
                </button>
                <button onClick={() => navigate(`/projects/${id}/missions/${missionId}/review`)}
                  className="flex items-center gap-2 px-4 py-1.5 text-sm bg-purple-500 text-white font-semibold rounded-lg hover:bg-purple-600">
                  <Sparkles size={13} /> Review Objectives →
                </button>
              </div>
            </div>
          )}
          {stage === 'approved' && (
            <PreLaunchChecklist
              tasks={tasks}
              projectId={id!}
              projectPath={effectiveProjectPath}
              onRevise={() => updateMission.mutateAsync({ id: missionId!, project_id: id!, stage: 'review' } as any)}
              onLaunch={() => setShowStartBot(true)}
              onProjectPathSet={path => updateProject.mutate({ id: id!, project_path: path } as any)}
            />
          )}
          {stage === 'running' && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-blue-700 font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                {activeWorkers.length} bot{activeWorkers.length !== 1 ? 's' : ''} running
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate(`/projects/${id}/missions/${missionId}/run`)}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600">
                  <Play size={13} /> Open Monitor →
                </button>
                <button onClick={handleMarkComplete}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600">
                  <Trophy size={13} /> Mark Complete
                </button>
              </div>
            </div>
          )}
          {stage === 'complete' && (
            <p className="text-sm text-green-700 font-medium flex items-center gap-2"><Trophy size={14} /> Mission complete — see the Report tab for a full summary.</p>
          )}
        </div>
      </div>

      {/* Stage content */}
      {(stage === 'draft' || stage === 'review') && (
        <PipelineView
          tasks={tasks} projectId={id!} missionId={missionId!}
          projectPath={effectiveProjectPath}
          onEdit={handleEdit}
          onSaveTemplate={handleSaveTemplate}
          onFromLibrary={() => setShowLibrary(true)}
          readonly={stage === 'review'}
        />
      )}
      {stage === 'approved' && (
        <PipelineView
          tasks={tasks} projectId={id!} missionId={missionId!}
          projectPath={effectiveProjectPath}
          onEdit={handleEdit}
          onSaveTemplate={handleSaveTemplate}
          onFromLibrary={() => setShowLibrary(true)}
          readonly
        />
      )}
      {(stage === 'running' || stage === 'complete') && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-6 text-center space-y-3">
          {stage === 'running'
            ? <>
                <p className="text-sm text-blue-700 font-medium">Mission is running — open the monitor to track progress.</p>
                <button onClick={() => navigate(`/projects/${id}/missions/${missionId}/run`)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 text-sm">
                  <Play size={14} /> Open Mission Monitor →
                </button>
              </>
            : <>
                <Trophy size={24} className="mx-auto text-yellow-500" />
                <p className="text-sm text-gray-700 font-medium">Mission complete.</p>
                <button onClick={() => navigate(`/projects/${id}/missions/${missionId}/run`)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 text-sm">
                  View Final Report →
                </button>
              </>
          }
        </div>
      )}

      {/* Modals */}
      {editTask && <TaskModal projectId={id!} missionId={missionId!} projectPath={effectiveProjectPath} existingTasks={tasks} editTask={editTask} onClose={() => setEditTask(null)} />}
      {showStartBot && (
        <LaunchConfirmModal
          missionId={missionId!}
          missionName={mission.name}
          tasks={tasks}
          projectPath={effectiveProjectPath}
          onClose={() => setShowStartBot(false)}
          onLaunched={() => { setShowStartBot(false); navigate(`/projects/${id}/missions/${missionId}/run`) }}
        />
      )}
      {showLibrary && (
        <TemplateLibraryModal projectId={id!} missionId={missionId!} existingTasks={tasks} onClose={() => setShowLibrary(false)} />
      )}
    </div>
  )
}
