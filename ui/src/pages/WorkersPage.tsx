import { useState, useEffect, useRef } from 'react'
import {
  Bot, Play, Square, Plus, RefreshCw, Terminal,
  X, Clock, Activity, MessageSquare, Zap, GitBranch,
  Cpu, ChevronRight, Check, AlertTriangle, Info,
} from 'lucide-react'
import {
  useWorkers, useProjects, useTasks, useMissions,
  useCreateWorker, useSpawnWorker, useKillWorker,
  useBotEvents, useMissionQuestions, useWorkerTranscript,
} from '../api/hooks'
import StatusBadge from '../components/StatusBadge'
import LogViewer from '../components/LogViewer'
import { useToast } from '../components/Toasts'
import type { Worker, BotEvent, MissionQuestion } from '../api/client'

const MODELS = [
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-7',
  'custom',
]

type BotRole = 'architect' | 'page'

function worktreeSuggestion(projectPath: string, suffix: string): string {
  if (!projectPath || !suffix) return ''
  const sep = projectPath.includes('\\') ? '\\' : '/'
  const base = projectPath.replace(/[/\\]+$/, '')
  return base + '.' + suffix
}

function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function fmtAge(ts: string | null): string {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function fmtTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }

// ── Deploy Modal ──────────────────────────────────────────────────────────────

function DeployModal({ onClose }: { onClose: () => void }) {
  const { data: projects = [] } = useProjects()
  const [projectId, setProjectId] = useState('')
  const [missionId, setMissionId] = useState('')
  const [botRole, setBotRole] = useState<BotRole>('architect')
  const { data: tasks = [] } = useTasks(projectId ? { project_id: projectId } : undefined)
  const { data: missions = [] } = useMissions(projectId || undefined)
  const [form, setForm] = useState({
    task_id: '', stream_id: '', worktree_path: '', branch: '', git_root: '',
    model: 'claude-sonnet-4-6', notes: '',
  })
  const [autoSpawn, setAutoSpawn] = useState(true)
  const [error, setError] = useState('')

  const create   = useCreateWorker()
  const spawn    = useSpawnWorker()
  const addToast = useToast()

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const selectedProject = projects.find(p => p.id === projectId)
  const availTasks = tasks.filter(t => ['queued', 'in_progress'].includes(t.status))

  function applyRoleDefaults(role: BotRole, proj: typeof selectedProject, streamId: string) {
    if (!proj) return
    const base = slugify(proj.name)
    if (role === 'architect') {
      setForm(f => ({
        ...f,
        stream_id: streamId || base + '-architect',
        worktree_path: proj.project_path ?? '',
        git_root: proj.project_path ?? '',
        branch: 'main',
      }))
    } else {
      const suffix = streamId.replace(/^[^-]+-?/, '') || 'bot'
      setForm(f => ({
        ...f,
        stream_id: streamId || base + '-page-1',
        git_root: proj.project_path ?? '',
        worktree_path: worktreeSuggestion(proj.project_path ?? '', suffix),
        branch: streamId ? 'feature/' + streamId : '',
      }))
    }
  }

  function handleProjectChange(pid: string) {
    setProjectId(pid)
    setMissionId('')
    const proj = projects.find(p => p.id === pid)
    applyRoleDefaults(botRole, proj, '')
    set('task_id', '')
  }

  function handleRoleChange(role: BotRole) {
    setBotRole(role)
    applyRoleDefaults(role, selectedProject, form.stream_id)
  }

  function handleStreamIdChange(val: string) {
    set('stream_id', val)
    if (botRole === 'page' && selectedProject?.project_path) {
      const suffix = val.replace(/^[^-]+-?/, '') || val
      set('worktree_path', worktreeSuggestion(selectedProject.project_path, suffix))
      if (val) set('branch', 'feature/' + val)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!projectId) { setError('Select a project'); return }
    if (!form.stream_id.trim()) { setError('Stream ID is required'); return }
    try {
      const worker = await create.mutateAsync({
        project_id: projectId,
        mission_id: missionId || undefined,
        stream_id: form.stream_id.trim(),
        task_id: form.task_id || undefined,
        worktree_path: form.worktree_path.trim() || undefined,
        branch: form.branch.trim() || undefined,
        git_root: form.git_root.trim() || undefined,
        model: form.model === 'custom' ? undefined : form.model,
        notes: form.notes.trim() || undefined,
      } as any)
      if (autoSpawn) {
        const result = await spawn.mutateAsync(worker.id)
        if (result.errors?.length) addToast(`Deploy issues: ${result.errors.join(', ')}`, 'info')
        else addToast(`Bot "${form.stream_id}" deployed`, 'success')
      } else {
        addToast(`Bot "${form.stream_id}" created`, 'success')
      }
      onClose()
    } catch (err: any) {
      const msg = err.message ?? 'Failed to deploy bot'
      setError(msg)
      addToast(msg)
    }
  }

  const hasGit = !!(selectedProject?.project_path)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-950 rounded-t-xl">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-yellow-400" />
            <h2 className="font-bold text-white">Deploy Bot</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Project *</label>
            <select value={projectId} onChange={e => handleProjectChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
              <option value="">— select project —</option>
              {projects.filter(p => p.status !== 'archived').map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {missions.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Mission <span className="text-gray-400 font-normal">(optional)</span></label>
              <select value={missionId} onChange={e => setMissionId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
                <option value="">— all missions —</option>
                {missions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Bot type</label>
            <div className="grid grid-cols-2 gap-2">
              {([['architect', 'Architect', 'Builds foundation on main branch'], ['page', 'Page / Feature bot', 'Gets its own worktree + branch']] as const).map(([role, label, hint]) => (
                <button key={role} type="button" onClick={() => handleRoleChange(role)}
                  className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    botRole === role ? 'border-yellow-400 bg-yellow-50 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  <div className="font-semibold text-xs">{label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{hint}</div>
                </button>
              ))}
            </div>
            {projectId && !hasGit && (
              <p className="text-xs text-amber-600 mt-1.5">This project has no project path set — git worktrees unavailable.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Stream ID *</label>
              <input value={form.stream_id} onChange={e => handleStreamIdChange(e.target.value)}
                placeholder={botRole === 'architect' ? 'my-site-architect' : 'my-site-home'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Model</label>
              <select value={form.model} onChange={e => set('model', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
                {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Objective (optional)</label>
            <select value={form.task_id} onChange={e => set('task_id', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              disabled={!projectId}>
              <option value="">— unassigned —</option>
              {availTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          {botRole === 'architect' ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Working directory</label>
              <input readOnly value={form.worktree_path || '(set after project is selected)'}
                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm font-mono text-gray-500 cursor-default" />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Worktree path <span className="text-gray-400 font-normal">(auto-suggested)</span></label>
                <input value={form.worktree_path} onChange={e => set('worktree_path', e.target.value)}
                  placeholder="D:\dev\...\MyProject.home"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Branch <span className="text-gray-400 font-normal">(auto-named)</span></label>
                <input value={form.branch} onChange={e => set('branch', e.target.value)}
                  placeholder="feature/home-page"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400" />
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="optional context for this bot"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={autoSpawn} onChange={e => setAutoSpawn(e.target.checked)}
              className="rounded border-gray-300 accent-yellow-500" />
            <span className="text-sm text-gray-700">Open terminal and deploy immediately</span>
          </label>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={create.isPending || spawn.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-yellow-400 text-gray-900 font-semibold rounded-lg hover:bg-yellow-500 disabled:opacity-50">
              {create.isPending || spawn.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Terminal size={14} />}
              {autoSpawn ? 'Create & Deploy' : 'Create Bot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Bot Detail Panel ──────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'console' | 'logs' | 'timeline'

function eventIcon(ev: BotEvent): React.ReactNode {
  const t = ev.event_type
  if (t.includes('done') || t.includes('complete')) return <Check size={11} className="text-green-500" />
  if (t.includes('in_progress') || t.includes('start')) return <Play size={11} className="text-blue-500" />
  if (t.includes('block'))  return <AlertTriangle size={11} className="text-red-500" />
  if (t.includes('review')) return <Info size={11} className="text-purple-500" />
  return <Activity size={11} className="text-gray-400" />
}

function eventLabel(ev: BotEvent): string {
  return ev.event_type.replace(/_/g, ' ')
}

function BotDetailPanel({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const isActive = ['starting', 'active', 'idle'].includes(worker.status)
  const [tab, setTab] = useState<DetailTab>(isActive ? 'console' : 'console')
  const spawn    = useSpawnWorker()
  const kill     = useKillWorker()
  const addToast = useToast()
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: events = [] } = useBotEvents({ worker_id: worker.id, limit: 200 })
  const { data: missionQuestions = [] } = useMissionQuestions(worker.mission_id ?? '')
  const myQuestions = missionQuestions.filter(q => q.stream_id === worker.stream_id)
  const { data: transcript, isLoading: transcriptLoading } = useWorkerTranscript(worker.id, tab === 'console')

  const totalPrompt     = events.reduce((s, e) => s + e.prompt_tokens, 0)
  const totalCompletion = events.reduce((s, e) => s + e.completion_tokens, 0)

  const canDeploy = worker.status === 'pending'
  const canKill = ['starting', 'active', 'idle'].includes(worker.status)

  useEffect(() => {
    if (tab === 'console' && isActive) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [transcript?.lines?.length, tab, isActive])

  // Merge events + questions into a single chronological timeline
  type TimelineItem =
    | { kind: 'event'; data: BotEvent; ts: string }
    | { kind: 'question'; data: MissionQuestion; ts: string }

  const timeline: TimelineItem[] = [
    ...events.map(e => ({ kind: 'event' as const, data: e, ts: e.created_at })),
    ...myQuestions.map(q => ({ kind: 'question' as const, data: q, ts: q.sent_at })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  const TABS: { key: DetailTab; label: string; badge?: number }[] = [
    { key: 'console',  label: 'Console', badge: transcript?.total_lines },
    { key: 'overview', label: 'Overview' },
    { key: 'logs',     label: 'Live Logs' },
    { key: 'timeline', label: 'Timeline', badge: timeline.length },
  ]

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full border-l border-gray-200">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gray-950 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              worker.status === 'active'   ? 'bg-green-400 animate-pulse' :
              worker.status === 'starting' ? 'bg-yellow-400 animate-pulse' :
              worker.status === 'idle'     ? 'bg-teal-400' :
              worker.status === 'stuck'    ? 'bg-red-400 animate-pulse' :
              worker.status === 'done'     ? 'bg-green-600' : 'bg-gray-500'
            }`} />
            <code className="text-yellow-300 font-mono text-sm font-bold truncate">{worker.stream_id}</code>
            <StatusBadge status={worker.status} mode="worker" />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {canDeploy && (
              <button onClick={() => spawn.mutate(worker.id, { onSuccess: r => addToast(r.errors?.length ? r.errors.join(', ') : `Deployed`, 'success') })}
                disabled={spawn.isPending}
                className="flex items-center gap-1 text-xs bg-yellow-400 text-gray-900 font-semibold px-2.5 py-1.5 rounded-lg hover:bg-yellow-500 disabled:opacity-50">
                <Play size={11} /> Deploy
              </button>
            )}
            {canKill && (
              <button onClick={() => kill.mutate(worker.id, { onSuccess: () => addToast(`Kill Boted`, 'info') })}
                disabled={kill.isPending}
                className="flex items-center gap-1 text-xs bg-red-600 text-white font-semibold px-2.5 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50">
                <Square size={11} /> Kill Bot
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-200 p-1 rounded">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key ? 'border-yellow-400 text-yellow-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Console ── */}
          {tab === 'console' && (
            <div className="h-full bg-gray-950 flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Terminal size={12} className="text-green-400" />
                  <span className="text-xs text-gray-400 font-mono">{worker.stream_id}</span>
                  {worker.notes && (
                    <span className="text-xs text-gray-600 border-l border-gray-700 pl-2">{worker.notes}</span>
                  )}
                </div>
                <span className="text-xs text-gray-600">{transcript?.total_lines ?? 0} lines</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-gray-300 leading-relaxed">
                {transcriptLoading && !transcript && (
                  <p className="text-gray-500">Loading transcript…</p>
                )}
                {transcript && !transcript.available && (
                  <p className="text-gray-500 italic">
                    {worker.status === 'pending'
                      ? 'Bot not yet deployed — no output available.'
                      : 'No console output recorded for this session.'}
                  </p>
                )}
                {transcript?.available && transcript.lines.map((line, i) => (
                  <div key={i} className={`whitespace-pre-wrap break-all ${
                    line.startsWith('****') ? 'text-yellow-400 font-semibold' :
                    line.startsWith('PS>') || line.startsWith('>') ? 'text-cyan-400' :
                    /error|Error|ERROR/.test(line) ? 'text-red-400' :
                    /✓|COMPLETED|success|Success/.test(line) ? 'text-green-400' :
                    'text-gray-300'
                  }`}>{line || ' '}</div>
                ))}
                <div ref={bottomRef} />
              </div>
              {isActive && (
                <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-2 flex-shrink-0">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-green-400 font-mono">live</span>
                </div>
              )}
            </div>
          )}

          {/* ── Overview ── */}
          {tab === 'overview' && (
            <div className="p-5 space-y-5">
              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-xs text-gray-400 mb-1"><Zap size={11} />Prompt tokens</div>
                  <div className="font-bold text-gray-900">{fmtTokens(totalPrompt)}</div>
                </div>
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-xs text-gray-400 mb-1"><Zap size={11} />Completion tokens</div>
                  <div className="font-bold text-gray-900">{fmtTokens(totalCompletion)}</div>
                </div>
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-xs text-gray-400 mb-1"><Activity size={11} />Events</div>
                  <div className="font-bold text-gray-900">{events.length}</div>
                </div>
              </div>

              {/* Meta */}
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 text-sm">
                {[
                  { label: 'Worker ID',    value: worker.id,                  mono: true },
                  { label: 'Model',        value: worker.model ?? '—',        mono: true },
                  { label: 'Runner',       value: worker.runner_type ?? 'claude_code', mono: true },
                  { label: 'PID',          value: worker.pid ? String(worker.pid) : '—' },
                  { label: 'Worktree',     value: worker.worktree_path ?? '—', mono: true, wrap: true },
                  { label: 'Branch',       value: worker.branch ?? '—',       mono: true },
                  { label: 'Task',         value: worker.task_id ?? '—',      mono: true },
                  { label: 'Mission',      value: worker.mission_id ?? '—',   mono: true },
                  { label: 'Spawned by',   value: worker.spawned_by ?? '—' },
                  { label: 'Created',      value: fmtAge(worker.created_at) },
                  { label: 'Started',      value: fmtAge(worker.started_at) },
                  { label: 'Completed',    value: fmtAge(worker.completed_at) },
                ].map(row => row.value === '—' ? null : (
                  <div key={row.label} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{row.label}</span>
                    <span className={`text-xs text-gray-800 flex-1 ${row.mono ? 'font-mono' : ''} ${row.wrap ? 'break-all' : 'truncate'}`}>
                      {row.value}
                    </span>
                  </div>
                ))}
                {worker.notes && (
                  <div className="flex items-start gap-3 px-4 py-2.5">
                    <span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">Notes</span>
                    <span className="text-xs text-gray-700 flex-1 whitespace-pre-wrap">{worker.notes}</span>
                  </div>
                )}
              </div>

              {/* Open questions */}
              {myQuestions.filter(q => !q.resolved_at).length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <MessageSquare size={11} /> Open Questions
                  </p>
                  <div className="space-y-2">
                    {myQuestions.filter(q => !q.resolved_at).map(q => (
                      <div key={q.id} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mr-2 ${
                          q.code === 'BLOCKER' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                        }`}>{q.code}</span>
                        <span className="text-gray-800">{q.message}</span>
                        <div className="text-gray-400 mt-1">{fmtAge(q.sent_at)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Live Logs ── */}
          {tab === 'logs' && (
            <div className="h-full">
              <LogViewer
                filters={{ stream_id: worker.stream_id }}
                maxHeight="calc(100vh - 120px)"
                compact
              />
            </div>
          )}

          {/* ── Timeline ── */}
          {tab === 'timeline' && (
            <div className="p-5">
              {timeline.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  <Activity size={24} className="mx-auto mb-2 opacity-40" />
                  No events yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {timeline.map((item, i) => (
                    <div key={i} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg text-xs ${
                      item.kind === 'question' ? 'bg-amber-50 border border-amber-100' : 'hover:bg-gray-50'
                    }`}>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-gray-100">
                        {item.kind === 'event'
                          ? eventIcon(item.data)
                          : <MessageSquare size={11} className="text-amber-500" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        {item.kind === 'event' ? (
                          <>
                            <p className="font-medium text-gray-800">{eventLabel(item.data)}</p>
                            <div className="flex items-center gap-3 mt-0.5 text-gray-400">
                              {item.data.model && <span className="font-mono">{item.data.model.replace('claude-', '')}</span>}
                              {(item.data.prompt_tokens + item.data.completion_tokens) > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <Zap size={9} />{fmtTokens(item.data.prompt_tokens + item.data.completion_tokens)} tok
                                </span>
                              )}
                              {item.data.task_id && <span className="font-mono truncate">{item.data.task_id}</span>}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                item.data.code === 'BLOCKER' ? 'bg-red-100 text-red-700' :
                                item.data.code === 'QUESTION' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>{item.data.code}</span>
                              {item.data.resolved_at && <span className="text-green-600 flex items-center gap-0.5"><Check size={9} />resolved</span>}
                            </div>
                            <p className="text-gray-700 whitespace-pre-wrap">{item.data.message}</p>
                          </>
                        )}
                      </div>
                      <span className="text-gray-400 flex-shrink-0 whitespace-nowrap">{fmtAge(item.ts)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Bot Row ───────────────────────────────────────────────────────────────────

function BotRow({ w, onSelect, selected }: { w: Worker; onSelect: () => void; selected: boolean }) {
  const spawn    = useSpawnWorker()
  const kill     = useKillWorker()
  const addToast = useToast()

  const age = w.stream_age != null
    ? w.stream_age < 60 ? `${w.stream_age}s` : `${Math.floor(w.stream_age / 60)}m`
    : '—'

  const canDeploy = w.status === 'pending'
  const canKill = ['starting', 'active', 'idle'].includes(w.status)

  function handleDeploy(e: React.MouseEvent) {
    e.stopPropagation()
    spawn.mutate(w.id, {
      onSuccess: (r) => {
        if (r.errors?.length) addToast(`Deploy issues: ${r.errors.join(', ')}`, 'info')
        else addToast(`Bot "${w.stream_id}" deployed`, 'success')
      },
      onError: (err: any) => addToast(err.message ?? 'Deploy failed'),
    })
  }

  function handleKill(e: React.MouseEvent) {
    e.stopPropagation()
    kill.mutate(w.id, {
      onSuccess: () => addToast(`Bot "${w.stream_id}" killed`, 'info'),
      onError: (err: any) => addToast(err.message ?? 'Kill failed'),
    })
  }

  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer transition-colors ${selected ? 'bg-yellow-50' : 'hover:bg-gray-50'}`}>
      <td className="px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">{w.stream_id}</code>
          <ChevronRight size={12} className="text-gray-300" />
        </div>
      </td>
      <td className="px-4 py-3"><StatusBadge status={w.status} mode="worker" /></td>
      <td className="px-4 py-3 text-xs text-gray-500 max-w-32 truncate">{w.task_id ?? '—'}</td>
      <td className="px-4 py-3 text-xs font-mono text-gray-500">{w.model ?? '—'}</td>
      <td className="px-4 py-3 text-xs font-mono text-gray-400 max-w-48 truncate">{w.worktree_path ?? '—'}</td>
      <td className="px-4 py-3 text-xs font-mono text-gray-400">{w.branch ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-gray-400">{w.pid ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-gray-400">{age}</td>
      <td className="px-4 py-3 text-xs text-gray-400 max-w-40 truncate">{w.notes || w.stream_notes || '—'}</td>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <div className="flex gap-1.5">
          {canDeploy && (
            <button onClick={handleDeploy} disabled={spawn.isPending}
              className="flex items-center gap-1 text-xs bg-yellow-400 text-gray-900 font-semibold px-2 py-1 rounded hover:bg-yellow-500 disabled:opacity-50">
              <Play size={10} /> Deploy
            </button>
          )}
          {canKill && (
            <button onClick={handleKill} disabled={kill.isPending}
              className="flex items-center gap-1 text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 disabled:opacity-50">
              <Square size={10} /> Kill Bot
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WorkersPage() {
  const [showModal, setShowModal]       = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const { data: workers = [], isLoading } = useWorkers(statusFilter ? { status: statusFilter } : undefined)

  const statuses = ['', 'pending', 'starting', 'active', 'idle', 'stuck', 'done', 'failed', 'killed']
  const selectedWorker = workers.find(w => w.id === selectedId) ?? null

  const counts = {
    active:  workers.filter(w => ['starting', 'active'].includes(w.status)).length,
    stuck:   workers.filter(w => w.status === 'stuck').length,
    idle:    workers.filter(w => w.status === 'idle').length,
    pending: workers.filter(w => w.status === 'pending').length,
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 text-sm flex-wrap">
          {counts.active > 0 && (
            <span className="bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium text-xs">{counts.active} deployed</span>
          )}
          {counts.stuck > 0 && (
            <span className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-medium text-xs">{counts.stuck} stuck</span>
          )}
          {counts.pending > 0 && (
            <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-medium text-xs">{counts.pending} ready to deploy</span>
          )}
          {counts.idle > 0 && (
            <span className="bg-teal-100 text-teal-700 px-2.5 py-1 rounded-full font-medium text-xs">{counts.idle} idle</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
            {statuses.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-yellow-400 text-gray-900 font-semibold rounded-lg text-sm hover:bg-yellow-500 transition-colors">
            <Plus size={14} /> Deploy Bot
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="px-5 py-12 text-center text-gray-400 text-sm">Loading…</div>
        ) : workers.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Bot size={32} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No bots deployed.</p>
            <button onClick={() => setShowModal(true)}
              className="mt-3 text-yellow-700 text-sm hover:underline font-medium">Deploy your first bot →</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2.5">Stream</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Op</th>
                  <th className="px-4 py-2.5">Model</th>
                  <th className="px-4 py-2.5">Worktree</th>
                  <th className="px-4 py-2.5">Branch</th>
                  <th className="px-4 py-2.5">PID</th>
                  <th className="px-4 py-2.5">Age</th>
                  <th className="px-4 py-2.5">Notes</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {workers.map(w => (
                  <BotRow key={w.id} w={w}
                    selected={w.id === selectedId}
                    onSelect={() => setSelectedId(id => id === w.id ? null : w.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedWorker && (
        <BotDetailPanel worker={selectedWorker} onClose={() => setSelectedId(null)} />
      )}
      {showModal && <DeployModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
