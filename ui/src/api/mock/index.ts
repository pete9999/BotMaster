/**
 * In-memory mock backend.
 * Enabled when localStorage.factory_mock_mode === 'true' or VITE_MOCK=true.
 *
 * All mutations update the in-memory store so subsequent GETs reflect the change.
 * The log stream pushes entries to all MockEventSource subscribers in real time.
 * A simulator drip-feeds realistic log lines to make the dashboard feel alive.
 */
import type { Project, Task, Worker, Mission, LogEntry, ConfigEntry, SysStatus, BotEvent, Review, ReviewFlag, ObjectiveTemplate, AuditEntry } from '../client'
import * as seed from './data'

// ── Store ─────────────────────────────────────────────────────────────────────

let nextReviewId   = seed.REVIEWS.length + 1
let nextEventId    = seed.BOT_EVENTS.length + 1
let nextQuestionId = 3
let nextAuditId    = seed.AUDIT_LOG.length + 1
let nextTemplateCounter = 100

type MockQuestion = {
  id: number; target_stream: string; from_stream: string; code: string
  message: string; status: string; sent_at: string; resolved_at: string | null
  stream_id: string; mission_id: string
}

const mockQuestions: MockQuestion[] = [
  {
    id: 1, target_stream: 'luminary-home', from_stream: 'luminary-home', code: 'QUESTION',
    message: 'Should the hero section use a gradient background or solid colour? The design spec mentions "brand colours" but does not specify which gradient to use.',
    status: 'pending', sent_at: new Date(Date.now() - 5 * 60_000).toISOString(), resolved_at: null,
    stream_id: 'luminary-home', mission_id: 'mission-lum-web',
  },
  {
    id: 2, target_stream: 'luminary-architect', from_stream: 'luminary-architect', code: 'BLOCKER',
    message: 'I cannot find any API documentation for the services endpoint. Do we have a Swagger spec or should I build with mock data and document the expected shape?',
    status: 'pending', sent_at: new Date(Date.now() - 12 * 60_000).toISOString(), resolved_at: null,
    stream_id: 'luminary-architect', mission_id: 'mission-lum-web',
  },
]

const store = {
  projects:           [...seed.PROJECTS]           as Project[],
  missions:           [...seed.MISSIONS]           as Mission[],
  tasks:              [...seed.TASKS]              as Task[],
  workers:            [...seed.WORKERS]            as Worker[],
  logs:               [...seed.LOGS]               as LogEntry[],
  config:             { ...seed.CONFIG }           as Record<string, ConfigEntry>,
  bot_events:         [...seed.BOT_EVENTS]         as BotEvent[],
  reviews:            [...seed.REVIEWS]            as Review[],
  objective_templates:[...seed.OBJECTIVE_TEMPLATES] as ObjectiveTemplate[],
  audit_log:          [...seed.AUDIT_LOG]          as AuditEntry[],
  nextLogId:          seed.LOGS.length + 1,
  logSubs:            new Set<(e: LogEntry) => void>(),
  startTime:          seed.START_TIME,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10) }

function pushAudit(event_type: string, entity_type: string, entity_id: string | null = null,
                   project_id: string | null = null, mission_id: string | null = null,
                   details: Record<string, unknown> = {}) {
  store.audit_log.unshift({
    id: nextAuditId++, timestamp: new Date().toISOString(),
    event_type, entity_type, entity_id, actor: 'user',
    project_id, mission_id, details,
  })
}

function delay() { return new Promise(r => setTimeout(r, 50 + Math.random() * 80)) }

function emitLog(level: LogEntry['level'], source: string, message: string, extra: Partial<LogEntry> = {}) {
  const entry: LogEntry = {
    id: store.nextLogId++,
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    project_id: null,
    task_id: null,
    stream_id: null,
    ...extra,
  }
  store.logs.push(entry)
  store.logSubs.forEach(fn => fn(entry))
  return entry
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function mockGet<T>(path: string): Promise<T> {
  await delay()
  const [base, qs] = path.split('?') as [string, string | undefined]
  const params = new URLSearchParams(qs ?? '')

  if (base === '/api/projects') {
    const inc = params.get('include_deleted') === 'true'
    const list = inc ? store.projects : store.projects.filter(p => !p.deleted_at)
    return list as unknown as T
  }

  const projDetail = base.match(/^\/api\/projects\/([^/]+)$/)
  if (projDetail) {
    const proj = store.projects.find(p => p.id === projDetail[1])
    if (!proj) throw new Error('Project not found')
    return {
      ...proj,
      missions: store.missions.filter(m => m.project_id === proj.id),
      tasks: store.tasks.filter(t => t.project_id === proj.id),
    } as unknown as T
  }

  if (base === '/api/missions') {
    const pid = params.get('project_id')
    return (pid ? store.missions.filter(m => m.project_id === pid) : store.missions) as unknown as T
  }

  const missionDetail = base.match(/^\/api\/missions\/([^/]+)$/)
  if (missionDetail) {
    const m = store.missions.find(m => m.id === missionDetail[1])
    if (!m) throw new Error('Mission not found')
    return { ...m, tasks: store.tasks.filter(t => t.mission_id === m.id) } as unknown as T
  }

  const missionQsM = base.match(/^\/api\/missions\/([^/]+)\/questions$/)
  if (missionQsM) {
    const mid = missionQsM[1]
    return mockQuestions.filter(q => q.mission_id === mid && q.status === 'pending') as unknown as T
  }

  const missionReportG = base.match(/^\/api\/missions\/([^/]+)\/report$/)
  if (missionReportG) {
    const mid = missionReportG[1]
    const mission = store.missions.find(m => m.id === mid)
    if (!mission) throw new Error('Mission not found')
    const tasks = store.tasks.filter(t => t.mission_id === mid)
    const workers = store.workers.filter(w => (w as any).mission_id === mid)
    const events = store.bot_events.filter(e => e.mission_id === mid)
    const reviews = store.reviews.filter(r => r.mission_id === mid)
    const project = store.projects.find(p => p.id === mission.project_id)
    const done = tasks.filter(t => t.status === 'done')
    const modelStats: Record<string, { tasks_completed: number; prompt_tokens: number; completion_tokens: number; events: number }> = {}
    for (const ev of events) {
      const m = ev.model ?? 'unknown'
      if (!modelStats[m]) modelStats[m] = { tasks_completed: 0, prompt_tokens: 0, completion_tokens: 0, events: 0 }
      modelStats[m].events++
      modelStats[m].prompt_tokens += ev.prompt_tokens
      modelStats[m].completion_tokens += ev.completion_tokens
      if (ev.event_type === 'task_done') modelStats[m].tasks_completed++
    }
    const avgRating = reviews.length ? Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length * 100) / 100 : null
    const flags: Record<string, number> = {}
    for (const r of reviews) { for (const f of r.flags) { flags[f] = (flags[f] ?? 0) + 1 } }
    return {
      mission_id: mid, mission_name: mission.name,
      project_name: project?.name ?? null, tech_stack: project?.tech_stack ?? null,
      description: mission.description, success_criteria: mission.success_criteria,
      status: mission.status, created_at: mission.created_at, updated_at: mission.updated_at,
      total_tasks: tasks.length, done_tasks: done.length, incomplete_tasks: tasks.length - done.length,
      total_tokens: tasks.reduce((s, t) => s + (t.cost_tokens ?? 0), 0),
      total_workers: workers.length, bot_events_count: events.length,
      model_stats: modelStats, avg_rating: avgRating, reviews_count: reviews.length, quality_flags: flags,
      tasks: tasks.map(t => ({
        id: t.id, title: t.title, status: t.status, model_hint: t.model_hint,
        cost_tokens: t.cost_tokens ?? 0, started_at: t.started_at, completed_at: t.completed_at,
        notes: t.notes ?? '', depends_on_count: (t.depends_on ?? []).length,
      })),
    } as unknown as T
  }

  if (base === '/api/tasks/next') {
    const pid = params.get('project_id')
    const ready = store.tasks.filter(t => {
      if (t.status !== 'queued' || t.stream_id) return false
      if (pid && t.project_id !== pid) return false
      return t.depends_on.every(d => store.tasks.find(x => x.id === d)?.status === 'done')
    }).sort((a, b) => b.priority - a.priority)
    return (ready[0] ?? null) as unknown as T
  }

  if (base === '/api/tasks') {
    let list = [...store.tasks]
    const pid = params.get('project_id'); if (pid) list = list.filter(t => t.project_id === pid)
    const st  = params.get('status');     if (st)  list = list.filter(t => t.status === st)
    const mid = params.get('mission_id'); if (mid) list = list.filter(t => t.mission_id === mid)
    return list as unknown as T
  }

  if (base === '/api/workers') {
    let list = [...store.workers]
    const pid = params.get('project_id'); if (pid) list = list.filter(w => w.project_id === pid)
    const st  = params.get('status');     if (st)  list = list.filter(w => w.status === st)
    const mid = params.get('mission_id'); if (mid) list = list.filter(w => w.mission_id === mid)
    return list as unknown as T
  }

  if (base === '/api/config') return store.config as unknown as T

  if (base === '/api/bot_events') {
    let list = [...store.bot_events]
    const wid = params.get('worker_id');  if (wid)  list = list.filter(e => e.worker_id === wid)
    const tid = params.get('task_id');    if (tid)  list = list.filter(e => e.task_id === tid)
    const pid = params.get('project_id'); if (pid)  list = list.filter(e => e.project_id === pid)
    const mid = params.get('mission_id'); if (mid)  list = list.filter(e => e.mission_id === mid)
    const mod = params.get('model');      if (mod)  list = list.filter(e => e.model === mod)
    const lim = parseInt(params.get('limit') ?? '100')
    return list.slice(0, lim) as unknown as T
  }

  if (base === '/api/reviews') {
    let list = [...store.reviews]
    const tid = params.get('task_id');    if (tid) list = list.filter(r => r.task_id === tid)
    const pid = params.get('project_id'); if (pid) list = list.filter(r => r.project_id === pid)
    const mid = params.get('mission_id'); if (mid) list = list.filter(r => r.mission_id === mid)
    return list as unknown as T
  }

  if (base === '/api/quality/summary') {
    const pid = params.get('project_id')
    const reviews = pid ? store.reviews.filter(r => r.project_id === pid) : store.reviews
    const doneTasks = store.tasks.filter(t =>
      ['done', 'review'].includes(t.status) && (!pid || t.project_id === pid)
    )
    const reviewedIds = new Set(reviews.map(r => r.task_id))
    const unreviewed = doneTasks.filter(t => !reviewedIds.has(t.id)).length
    const avgRating = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 100) / 100 : null
    const byModel: Record<string, { count: number; avg_rating: number|null; flags: Record<string, number> }> = {}
    for (const r of reviews) {
      const m = r.model ?? 'unknown'
      if (!byModel[m]) byModel[m] = { count: 0, avg_rating: null, flags: {} }
      byModel[m].count++
      const prev = (byModel[m].avg_rating ?? 0) * (byModel[m].count - 1)
      byModel[m].avg_rating = Math.round(((prev + r.rating) / byModel[m].count) * 100) / 100
      for (const f of r.flags) { byModel[m].flags[f] = (byModel[m].flags[f] ?? 0) + 1 }
    }
    return { total_reviewed: reviews.length, unreviewed_done: unreviewed, avg_rating: avgRating, by_model: byModel } as unknown as T
  }

  if (base === '/api/status') {
    const wc: Record<string, number> = {}
    const tc: Record<string, number> = {}
    store.workers.forEach(w => { wc[w.status] = (wc[w.status] ?? 0) + 1 })
    store.tasks.forEach(t => { tc[t.status] = (tc[t.status] ?? 0) + 1 })
    const sys: SysStatus = {
      uptime_seconds: Math.floor((Date.now() - store.startTime) / 1000),
      active_projects: store.projects.filter(p => p.status === 'active').length,
      workers: wc,
      tasks: tc,
      log_entries: store.logs.length,
      python_version: '3.12.4 (mock)',
      platform: 'win32 (mock)',
    }
    return sys as unknown as T
  }

  if (base === '/api/objective-templates') {
    const search = params.get('search')?.toLowerCase()
    let list = [...store.objective_templates]
    if (search) list = list.filter(t => t.title.toLowerCase().includes(search) || t.description.toLowerCase().includes(search))
    return list.sort((a, b) => b.use_count - a.use_count) as unknown as T
  }

  if (base === '/api/audit-log') {
    let list = [...store.audit_log]
    const pid = params.get('project_id'); if (pid) list = list.filter(e => e.project_id === pid)
    const mid = params.get('mission_id'); if (mid) list = list.filter(e => e.mission_id === mid)
    const et  = params.get('entity_type'); if (et) list = list.filter(e => e.entity_type === et)
    const lim = parseInt(params.get('limit') ?? '100')
    return list.slice(0, lim) as unknown as T
  }

  const transcriptM = base.match(/^\/api\/workers\/([^/]+)\/transcript$/)
  if (transcriptM) {
    const w = store.workers.find(x => x.id === transcriptM[1])
    if (!w) throw new Error('Worker not found')
    const isActive = ['active', 'starting', 'idle'].includes(w.status)
    const lines = isActive ? [
      `**********************`,
      `Windows PowerShell transcript start`,
      `Start time: ${new Date().toLocaleString()}`,
      `**********************`,
      `PS> cd D:\\dev\\Projects\\${w.stream_id}`,
      `PS> claude`,
      ``,
      `╔══════════════════════════════════════╗`,
      `║  Claude Code v1.x   stream: ${w.stream_id}`,
      `╚══════════════════════════════════════╝`,
      ``,
      `Reading CLAUDE.md...`,
      `Hub URL: http://localhost:9100`,
      `Project ID: ${w.project_id}`,
      ``,
      `Posting status → starting`,
      `✓ Hub acknowledged`,
      ``,
      `Fetching next task...`,
      `→ Task claimed: pending task for this mission`,
      ``,
      `Starting work...`,
      `  Analysing requirements`,
      `  Writing initial code structure`,
      `  Running npm run typecheck → 0 errors`,
      ``,
      `Posting status → active (working on task)`,
    ] : [
      `**********************`,
      `Windows PowerShell transcript start / end`,
      `**********************`,
      `Session completed. Worker status: ${w.status}`,
    ]
    return {
      worker_id: w.id, stream_id: w.stream_id, status: w.status,
      transcript_path: `D:\\dev\\Pete.ai.work\\factory\\hub\\logs\\${w.stream_id}.log`,
      available: true, lines, total_lines: lines.length,
    } as unknown as T
  }

  if (base === '/api/fs/browse') {
    const reqPath = params.get('path') ?? ''
    const MOCK_TREE: Record<string, { path: string; parent: string | null; dirs: { name: string; path: string }[] }> = {
      '': { path: 'D:\\dev', parent: null, dirs: [
        { name: 'Pete.ai.work', path: 'D:\\dev\\Pete.ai.work' },
        { name: 'Projects', path: 'D:\\dev\\Projects' },
        { name: 'personal', path: 'D:\\dev\\personal' },
      ]},
      'D:\\dev': { path: 'D:\\dev', parent: null, dirs: [
        { name: 'Pete.ai.work', path: 'D:\\dev\\Pete.ai.work' },
        { name: 'Projects', path: 'D:\\dev\\Projects' },
        { name: 'personal', path: 'D:\\dev\\personal' },
      ]},
      'D:\\dev\\Pete.ai.work': { path: 'D:\\dev\\Pete.ai.work', parent: 'D:\\dev', dirs: [
        { name: 'factory', path: 'D:\\dev\\Pete.ai.work\\factory' },
      ]},
      'D:\\dev\\Pete.ai.work\\factory': { path: 'D:\\dev\\Pete.ai.work\\factory', parent: 'D:\\dev\\Pete.ai.work', dirs: [
        { name: 'governor', path: 'D:\\dev\\Pete.ai.work\\factory\\governor' },
        { name: 'hub', path: 'D:\\dev\\Pete.ai.work\\factory\\hub' },
        { name: 'ui', path: 'D:\\dev\\Pete.ai.work\\factory\\ui' },
      ]},
      'D:\\dev\\Projects': { path: 'D:\\dev\\Projects', parent: 'D:\\dev', dirs: [
        { name: 'hello-api', path: 'D:\\dev\\Projects\\hello-api' },
        { name: 'portfolio-site', path: 'D:\\dev\\Projects\\portfolio-site' },
      ]},
    }
    const result = MOCK_TREE[reqPath] ?? MOCK_TREE['']
    return result as unknown as T
  }

  throw new Error(`Mock: unhandled GET ${path}`)
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function mockPost<T>(path: string, body: unknown): Promise<T> {
  await delay()
  const b = body as Record<string, unknown>

  if (path === '/api/projects') {
    const proj: Project = {
      id: 'proj-' + uid(), name: String(b.name ?? ''), description: String(b.description ?? ''),
      tech_stack: String(b.tech_stack ?? ''), status: String(b.status ?? 'active'),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    store.projects.push(proj)
    emitLog('info', 'system', `Project created: ${proj.name}`)
    return proj as unknown as T
  }

  const restoreM = path.match(/^\/api\/projects\/([^/]+)\/restore$/)
  if (restoreM) {
    const proj = store.projects.find(p => p.id === restoreM[1])
    if (!proj) throw new Error('Project not found')
    proj.deleted_at = null
    proj.status = 'active'
    proj.updated_at = new Date().toISOString()
    return proj as unknown as T
  }

  if (path === '/api/missions') {
    const m: Mission = {
      id: 'mission-' + uid(), project_id: String(b.project_id), name: String(b.name),
      description: String(b.description ?? ''),
      success_criteria: String(b.success_criteria ?? ''),
      tech_notes: String(b.tech_notes ?? ''),
      worktree_base: String(b.worktree_base ?? ''),
      branch_prefix: String(b.branch_prefix ?? 'feature/'),
      model_hint: String(b.model_hint ?? ''),
      git_enabled: b.git_enabled !== false,
      status: String(b.status ?? 'active'),
      stage: 'draft' as const,
      plan_qa: null,
      final_prompt: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    store.missions.push(m)
    emitLog('info', 'system', `Mission created: ${m.name}`, { project_id: m.project_id })
    pushAudit('mission_created', 'mission', m.id, m.project_id, m.id, { name: m.name })
    return m as unknown as T
  }

  if (path === '/api/tasks') {
    const task: Task = {
      id: 'task-' + uid(), project_id: String(b.project_id), title: String(b.title),
      description: String(b.description ?? ''), stream_id: null,
      branch: b.branch ? String(b.branch) : null, status: 'queued',
      priority: Number(b.priority ?? 50),
      runner_type: b.runner_type ? String(b.runner_type) : 'claude_code',
      model_hint: b.model_hint ? String(b.model_hint) : null,
      depends_on: (b.depends_on as string[]) ?? [],
      cost_tokens: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      started_at: null, completed_at: null, notes: '',
      mission_id: b.mission_id ? String(b.mission_id) : null,
      working_dir: b.working_dir ? String(b.working_dir) : null,
      folder_mode: b.folder_mode ? String(b.folder_mode) : 'inherit',
    }
    store.tasks.push(task)
    emitLog('info', 'system', `Task created: "${task.title}"`, { project_id: task.project_id })
    pushAudit('task_created', 'task', task.id, task.project_id, task.mission_id ?? null, { title: task.title })
    return task as unknown as T
  }

  if (path === '/api/workers') {
    const worker: Worker = {
      id: 'worker-' + uid(), project_id: String(b.project_id),
      task_id: b.task_id ? String(b.task_id) : null, stream_id: String(b.stream_id),
      status: 'pending', model: b.model ? String(b.model) : 'claude-sonnet-4-6',
      worktree_path: b.worktree_path ? String(b.worktree_path) : null,
      branch: b.branch ? String(b.branch) : null, git_root: null, pid: null,
      spawned_by: 'manual', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      started_at: null, completed_at: null, notes: String(b.notes ?? ''),
    }
    store.workers.push(worker)
    emitLog('info', 'system', `Worker created: ${worker.stream_id}`, { project_id: worker.project_id })
    return worker as unknown as T
  }

  const spawnM = path.match(/^\/api\/workers\/([^/]+)\/spawn$/)
  if (spawnM) {
    const w = store.workers.find(x => x.id === spawnM[1])
    if (!w) throw new Error('Worker not found')
    w.status = 'starting'
    w.started_at = new Date().toISOString()
    w.pid = Math.floor(10_000 + Math.random() * 50_000)
    emitLog('info', 'system', `Worker ${w.stream_id} spawning — PID ${w.pid}`, { project_id: w.project_id, stream_id: w.stream_id })
    // Simulate startup sequence
    setTimeout(() => {
      if (w.status !== 'starting') return
      w.status = 'active'
      w.stream_age = 3
      w.stream_status = 'ok'
      w.stream_notes = 'Session started. Reading CLAUDE.md…'
      w.session_active = true
      emitLog('info', w.stream_id, 'Session started. Reading CLAUDE.md…', { project_id: w.project_id, stream_id: w.stream_id })
      emitLog('info', w.stream_id, 'Posted initial status to hub', { project_id: w.project_id, stream_id: w.stream_id })
    }, 3000)
    return { status: 'spawning', steps: ['git worktree add', 'write CLAUDE.md', 'open Windows Terminal'], errors: [] } as unknown as T
  }

  const killM = path.match(/^\/api\/workers\/([^/]+)\/kill$/)
  if (killM) {
    const w = store.workers.find(x => x.id === killM[1])
    if (!w) throw new Error('Worker not found')
    const was = ['active', 'starting', 'idle'].includes(w.status)
    w.status = 'killed'; w.completed_at = new Date().toISOString()
    w.pid = null; w.session_active = false
    emitLog('warn', 'system', `Worker ${w.stream_id} killed`, { project_id: w.project_id, stream_id: w.stream_id })
    return { killed: was, message: was ? 'Process terminated' : 'Worker was not running' } as unknown as T
  }

  const missionReviewM = path.match(/^\/api\/missions\/([^/]+)\/review-plan$/)
  if (missionReviewM) {
    const mid = missionReviewM[1]
    const mission = store.missions.find(m => m.id === mid)
    if (!mission) throw new Error('Mission not found')
    const tasks = store.tasks.filter(t => t.mission_id === mid)
    const priorAnswers: Array<{ question: string; answer: string }> = (b.prior_answers as any[]) ?? []
    const answeredMap = new Map(priorAnswers.filter(a => a.answer?.trim()).map(a => [a.question, a.answer]))

    const allQs = [
      { topic: 'Browser Support', question: 'Which browsers and minimum versions must be supported — is Safari 14 in scope?', context: 'Affects CSS/JS choices, polyfills needed, and testing matrix.' },
      { topic: 'Image Assets', question: 'Where are image/icon assets stored — already in the repo, or should the bot use placeholder images?', context: 'Missing assets will cause broken layouts and blocked commits.' },
      { topic: 'API Integration', question: 'Are any pages backed by live API calls, or is all data static/mocked for this mission?', context: 'Real APIs require auth tokens and error handling that add scope.' },
      { topic: 'Design System', question: 'Is there a Figma file or design spec the bot should match exactly, or should it use reasonable defaults?', context: 'Without a spec, the bot will make visual decisions that may need rework.' },
      { topic: 'Performance Target', question: 'Is there a specific Lighthouse score or page load target the bot should test against before marking done?', context: 'Determines whether bot needs to run lighthouse as part of completion checklist.' },
    ]
    // Filter out already-answered questions for re-runs
    const unanswered = allQs.filter(q => !answeredMap.has(q.question))
    const questions = unanswered.slice(0, 3).map(q => ({
      ...q, answer: answeredMap.get(q.question) ?? '',
    }))
    // Preserve answers for already-answered questions
    const preserved = allQs.filter(q => answeredMap.has(q.question)).map(q => ({
      ...q, answer: answeredMap.get(q.question)!,
    }))

    const planQa = {
      analysis: `Plan looks solid — ${tasks.length} objectives across ${Math.max(1, Math.ceil(tasks.length / 2))} phases. ${answeredMap.size > 0 ? `${answeredMap.size} clarification${answeredMap.size !== 1 ? 's' : ''} received — these have been incorporated.` : 'A few clarifications below will help the bot avoid wrong assumptions.'}`,
      questions: [...preserved, ...questions],
      reviewed_at: new Date().toISOString(),
    }
    ;(mission as any).stage = 'review'
    ;(mission as any).plan_qa = planQa
    mission.updated_at = new Date().toISOString()
    return planQa as unknown as T
  }

  const missionStartM = path.match(/^\/api\/missions\/([^/]+)\/start$/)
  if (missionStartM) {
    const missionId = missionStartM[1]
    const mission = store.missions.find(m => m.id === missionId)
    if (!mission) throw new Error('Mission not found')
    const suffix = b.suffix ? String(b.suffix) : uid()
    const streamId = `${missionId.replace('mission-', '')}-${suffix}`
    const model = b.model ? String(b.model) : (mission.model_hint || 'claude-sonnet-4-6')
    const worker: Worker = {
      id: 'worker-' + uid(), project_id: mission.project_id, mission_id: missionId,
      task_id: null, stream_id: streamId,
      status: b.spawn ? 'starting' : 'pending',
      model,
      runner_type: String(b.runner_type ?? 'claude_code'),
      worktree_path: mission.worktree_base ? `${mission.worktree_base}\\${streamId}` : null,
      branch: mission.branch_prefix ? `${mission.branch_prefix}${suffix}` : null,
      git_root: null, pid: b.spawn ? Math.floor(10_000 + Math.random() * 50_000) : null,
      spawned_by: 'mission', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      started_at: b.spawn ? new Date().toISOString() : null, completed_at: null,
      notes: b.notes ? String(b.notes) : '',
    }
    store.workers.push(worker)
    const missionToUpdate = store.missions.find(m => m.id === missionId)
    if (missionToUpdate) (missionToUpdate as any).stage = 'running'
    emitLog('info', 'system', `Mission bot deployed: ${worker.stream_id}`, { project_id: worker.project_id, stream_id: worker.stream_id })
    if (b.spawn) {
      setTimeout(() => {
        if (worker.status !== 'starting') return
        worker.status = 'active'
        worker.stream_age = 3
        worker.stream_status = 'ok'
        worker.session_active = true
        worker.stream_notes = 'Session started. Reading mission brief…'
        emitLog('info', worker.stream_id, 'Session started. Reading mission brief…', { project_id: worker.project_id, stream_id: worker.stream_id })
      }, 3000)
    }
    return worker as unknown as T
  }

  const streamInboxM = path.match(/^\/api\/streams\/([^/]+)\/inbox$/)
  if (streamInboxM) {
    const targetStream = streamInboxM[1]
    const msg = mockQuestions.find(q => q.target_stream === targetStream && q.status === 'pending')
    if (msg) { msg.status = 'resolved'; msg.resolved_at = new Date().toISOString() }
    emitLog('info', 'hub-operator', `Reply sent to ${targetStream}: ${String(b.message ?? '').slice(0, 60)}`, { stream_id: targetStream })
    return {} as unknown as T
  }

  if (path === '/api/ai/suggest-mission') {
    const { project_name, tech_stack, mission_name, description, success_criteria } = b as Record<string, string>
    const briefing = [
      `- Stack: ${tech_stack || 'as per project'}`,
      `- Goal: ${mission_name || 'see mission brief'}`,
      `- Follow existing patterns — check src/components before creating new`,
      `- TypeScript strict mode — no \`any\`, use explicit types`,
      `- Commit frequently with clear messages (feat/fix/chore prefix)`,
      ...(success_criteria ? [`- Done when: ${success_criteria.split('\n')[0]}`] : []),
      `- Watch out: run \`npm run typecheck\` after each major change`,
    ].join('\n')
    return { briefing } as unknown as T
  }

  if (path === '/api/bot_events') {
    const ev: BotEvent = {
      id: nextEventId++,
      worker_id: b.worker_id ? String(b.worker_id) : null,
      task_id: b.task_id ? String(b.task_id) : null,
      project_id: b.project_id ? String(b.project_id) : null,
      mission_id: b.mission_id ? String(b.mission_id) : null,
      event_type: String(b.event_type),
      model: b.model ? String(b.model) : null,
      prompt_tokens: Number(b.prompt_tokens ?? 0),
      completion_tokens: Number(b.completion_tokens ?? 0),
      content: (b.content as Record<string, unknown>) ?? {},
      created_at: new Date().toISOString(),
    }
    store.bot_events.unshift(ev)
    return ev as unknown as T
  }

  if (path === '/api/reviews') {
    const task = store.tasks.find(t => t.id === String(b.task_id))
    if (!task) throw new Error('Task not found')
    const rating = Number(b.rating)
    if (!rating || rating < 1 || rating > 5) throw new Error('rating must be 1-5')
    const rev: Review = {
      id: nextReviewId++,
      task_id: task.id,
      worker_id: b.worker_id ? String(b.worker_id) : task.stream_id,
      project_id: (b.project_id ? String(b.project_id) : task.project_id) ?? null,
      mission_id: (b.mission_id ? String(b.mission_id) : task.mission_id) ?? null,
      model: (b.model ? String(b.model) : task.model_hint) ?? null,
      rating,
      notes: b.notes ? String(b.notes) : '',
      flags: (b.flags as ReviewFlag[]) ?? [],
      reviewer: b.reviewer ? String(b.reviewer) : 'user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    store.reviews.push(rev)
    emitLog('info', 'quality', `Review submitted for task ${task.id}: ${rating}/5`, { project_id: task.project_id, task_id: task.id })
    return rev as unknown as T
  }

  if (path === '/api/objective-templates') {
    const tmpl: ObjectiveTemplate = {
      id: `tmpl-${nextTemplateCounter++}`, title: String(b.title ?? ''),
      description: String(b.description ?? ''), model_hint: String(b.model_hint ?? ''),
      tags: (b.tags as string[]) ?? [], source_mission_id: null, source_task_id: null,
      use_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    store.objective_templates.unshift(tmpl)
    pushAudit('template_created', 'objective_template', tmpl.id, null, null, { title: tmpl.title })
    return tmpl as unknown as T
  }

  const saveAsTemplateM = path.match(/^\/api\/tasks\/([^/]+)\/save-as-template$/)
  if (saveAsTemplateM) {
    const task = store.tasks.find(t => t.id === saveAsTemplateM[1])
    if (!task) throw new Error('Task not found')
    const existing = store.objective_templates.find(t => t.source_task_id === task.id)
    if (existing) return existing as unknown as T
    const tmpl: ObjectiveTemplate = {
      id: `tmpl-${nextTemplateCounter++}`, title: task.title,
      description: task.description ?? '', model_hint: task.model_hint ?? '',
      tags: (b.tags as string[]) ?? [], source_mission_id: task.mission_id ?? null,
      source_task_id: task.id, use_count: 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    store.objective_templates.unshift(tmpl)
    pushAudit('template_saved', 'objective_template', tmpl.id, task.project_id, task.mission_id ?? null,
              { title: task.title, task_id: task.id })
    return tmpl as unknown as T
  }

  const recordTemplateUseM = path.match(/^\/api\/objective-templates\/([^/]+)\/use$/)
  if (recordTemplateUseM) {
    const tmpl = store.objective_templates.find(t => t.id === recordTemplateUseM[1])
    if (!tmpl) throw new Error('Template not found')
    tmpl.use_count++
    return tmpl as unknown as T
  }

  throw new Error(`Mock: unhandled POST ${path}`)
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function mockPatch<T>(path: string, body: unknown): Promise<T> {
  await delay()
  const b = body as Record<string, unknown>

  const projM = path.match(/^\/api\/projects\/([^/]+)$/)
  if (projM) {
    const proj = store.projects.find(p => p.id === projM[1])
    if (!proj) throw new Error('Project not found')
    Object.assign(proj, b, { updated_at: new Date().toISOString() })
    return proj as unknown as T
  }

  const missionM = path.match(/^\/api\/missions\/([^/]+)$/)
  if (missionM) {
    const m = store.missions.find(m => m.id === missionM[1])
    if (!m) throw new Error('Mission not found')
    const oldStage = (m as any).stage
    const { plan_qa, final_prompt, ...rest } = b
    Object.assign(m, rest, { updated_at: new Date().toISOString() })
    if (plan_qa !== undefined) (m as any).plan_qa = plan_qa
    if (final_prompt !== undefined) (m as any).final_prompt = final_prompt
    if (b.stage && b.stage !== oldStage) {
      pushAudit('stage_changed', 'mission', m.id, m.project_id, m.id, { from: oldStage, to: b.stage })
    }
    return m as unknown as T
  }

  const taskM = path.match(/^\/api\/tasks\/([^/]+)$/)
  if (taskM) {
    const task = store.tasks.find(t => t.id === taskM[1])
    if (!task) throw new Error('Task not found')
    const oldStatus = task.status
    Object.assign(task, b, { updated_at: new Date().toISOString() })
    if (b.status && b.status !== oldStatus) {
      emitLog('info', 'system', `Task "${task.title}": ${oldStatus} → ${b.status}`, { project_id: task.project_id, task_id: task.id })
      if (b.status === 'done') task.completed_at = new Date().toISOString()
      if (b.status === 'in_progress' && !task.started_at) task.started_at = new Date().toISOString()
    }
    return task as unknown as T
  }

  const reviewM = path.match(/^\/api\/reviews\/(\d+)$/)
  if (reviewM) {
    const rev = store.reviews.find(r => r.id === parseInt(reviewM[1]))
    if (!rev) throw new Error('Review not found')
    if (b.rating !== undefined) rev.rating = Number(b.rating)
    if (b.notes !== undefined) rev.notes = String(b.notes)
    if (b.flags !== undefined) rev.flags = b.flags as ReviewFlag[]
    if (b.reviewer !== undefined) rev.reviewer = String(b.reviewer)
    rev.updated_at = new Date().toISOString()
    return rev as unknown as T
  }

  if (path === '/api/config') {
    const updated: string[] = []
    for (const [k, v] of Object.entries(b)) {
      if (store.config[k]) {
        store.config[k] = { ...store.config[k], value: String(v), updated_at: new Date().toISOString() }
        updated.push(k)
      }
    }
    return { updated } as unknown as T
  }

  throw new Error(`Mock: unhandled PATCH ${path}`)
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function mockDel<T>(path: string): Promise<T> {
  await delay()
  const projM = path.match(/^\/api\/projects\/([^/]+)$/)
  if (projM) {
    const proj = store.projects.find(p => p.id === projM[1])
    if (!proj) throw new Error('Project not found')
    proj.deleted_at = new Date().toISOString()
    proj.status = 'archived'
    proj.updated_at = new Date().toISOString()
    return proj as unknown as T
  }
  return {} as T
}

// ── MockEventSource ───────────────────────────────────────────────────────────

export class MockEventSource {
  onopen:    ((e: Event) => void) | null        = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror:   ((e: Event) => void) | null        = null

  private sub: ((entry: LogEntry) => void) | null = null

  constructor(_url: string) {
    // Signal connected
    setTimeout(() => this.onopen?.(new Event('open')), 80)

    // Replay recent history for new connections
    const recent = store.logs.slice(-50)
    recent.forEach((entry, i) => {
      setTimeout(() => {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(entry) }))
      }, 90 + i * 8)
    })

    // Subscribe to live stream
    this.sub = (entry) => {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(entry) }))
    }
    store.logSubs.add(this.sub)
  }

  close() {
    if (this.sub) { store.logSubs.delete(this.sub); this.sub = null }
  }
}

// ── Simulator ─────────────────────────────────────────────────────────────────

type SimGroup = { source: string; level: LogEntry['level']; messages: string[]; project_id?: string; stream_id?: string }

const SIM: SimGroup[] = [
  {
    source: 'luminary-home', level: 'info', project_id: 'proj-luminary', stream_id: 'luminary-home',
    messages: [
      'Analysing component structure…',
      'Writing responsive Tailwind classes for features grid',
      'Adding hover animations to feature cards',
      'TypeScript check — 0 errors',
      'Posting status update to hub',
      'Committed: add features grid to HomePage',
      'Starting on testimonials section',
      'Writing TestimonialCard component',
      'Pulled latest from master — no conflicts',
    ],
  },
  {
    source: 'luminary-architect', level: 'debug', project_id: 'proj-luminary', stream_id: 'luminary-architect',
    messages: [
      'Checking hub for pending messages…',
      'Dependency graph up to date',
      'Session idle — all architect tasks complete',
      'Monitoring worker progress on hub',
    ],
  },
  {
    source: 'system', level: 'debug',
    messages: [
      'Watchdog: all non-stuck workers healthy',
      'SSE clients: 1 connected',
      'Heartbeat from luminary-home received (age: 12s)',
      'Query cache refreshed',
    ],
  },
  {
    source: 'governor', level: 'info',
    messages: [
      'Checking for stuck workers… 1 found: luminary-services (712s)',
      'Next ready task: task-lum-004 (ServicesPage) — assign a worker to spawn',
      'Next ready task: task-lum-005 (PortfolioPage) — assign a worker to spawn',
    ],
  },
]

function startSimulator() {
  let tick = 0

  function step() {
    const group = SIM[tick % SIM.length]
    const msg   = group.messages[Math.floor(Math.random() * group.messages.length)]
    emitLog(group.level, group.source, msg, {
      project_id: group.project_id ?? null,
      stream_id:  group.stream_id  ?? null,
    })

    // Slowly wind down stream_age on active workers to show freshness
    store.workers.forEach(w => {
      if (w.session_active && w.stream_age != null && w.stream_age > 0) {
        w.stream_age = Math.max(0, w.stream_age - Math.floor(Math.random() * 8))
      }
    })

    tick++
    setTimeout(step, 2_000 + Math.random() * 3_000)
  }

  setTimeout(step, 1_500)
}

export function isMockMode() {
  return localStorage.getItem('factory_mock_mode') === 'true' || import.meta.env.VITE_MOCK === 'true'
}

export function enableMock()  { localStorage.setItem('factory_mock_mode', 'true');  window.location.reload() }
export function disableMock() { localStorage.removeItem('factory_mock_mode');       window.location.reload() }

// TODO: Training simulation mode — drip-feed scripted log events to walk through a full mission lifecycle.
// Defer until core UI is solid. Re-enable startSimulator() here when building that feature.
if (import.meta.env.VITE_MOCK_SIM === 'true') startSimulator()
