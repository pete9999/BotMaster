import type { Project, Task, Worker, Mission, LogEntry, ConfigEntry, BotEvent, Review, ObjectiveTemplate, AuditEntry } from '../client'

function ago(ms: number) {
  return new Date(Date.now() - ms).toISOString()
}

export const PROJECTS: Project[] = [
  {
    id: 'proj-luminary',
    name: 'Luminary',
    description: 'Multi-page marketing site — hero, services, portfolio',
    tech_stack: 'React + TypeScript + Tailwind',
    status: 'active',
    project_path: 'D:\\dev\\Pete.ai.work\\Projects\\luminary',
    created_at: ago(7_200_000),
    updated_at: ago(300_000),
  },
  {
    id: 'proj-orgmylife',
    name: 'OrgMyLife',
    description: 'Personal organisation mobile app',
    tech_stack: 'React Native + Expo + TypeScript',
    status: 'paused',
    created_at: ago(86_400_000),
    updated_at: ago(3_600_000),
  },
]

export const MISSIONS: Mission[] = [
  {
    id: 'mission-lum-web',
    project_id: 'proj-luminary',
    name: 'Build initial website',
    description: 'Set up the core pages: home, services, portfolio',
    success_criteria: 'All 3 pages render correctly on mobile and desktop. Lighthouse ≥ 90.',
    tech_notes: 'React + TypeScript + Tailwind 4. No external component libraries.',
    worktree_base: 'D:\\dev\\Pete.ai.work\\Projects\\luminary',
    branch_prefix: 'feature/',
    model_hint: 'claude-sonnet-4-6',
    git_enabled: true,
    status: 'active',
    stage: 'review' as const,
    plan_qa: {
      analysis: 'Plan looks solid — 6 objectives across 3 phases. Main risk: the e2e test objective depends on all pages completing first, creating a bottleneck. Consider whether Lighthouse score targets are realistic without design assets.',
      questions: [
        { topic: 'Browser Support', question: 'Which browsers and minimum versions must be supported — is Safari 14 or IE11 in scope?', context: 'Affects CSS/JS choices, polyfills needed, and testing matrix.', answer: '' },
        { topic: 'Image Assets', question: 'Where are image/icon assets stored — already in the repo, or should the bot use placeholder images?', context: 'Missing assets will cause broken layouts and blocked commits.', answer: 'Use placeholder images from picsum.photos for now' },
        { topic: 'API Integration', question: 'Are any pages backed by live API calls, or is all data static/mocked for this mission?', context: 'Real APIs require auth tokens and error handling that add scope.', answer: '' },
        { topic: 'Design System', question: 'Is there a Figma file the bot should match exactly, or should it use reasonable defaults?', context: 'Without a spec, the bot will make visual decisions that may need rework.', answer: '' },
      ],
      reviewed_at: ago(120_000),
    },
    final_prompt: null as string | null,
    created_at: ago(7_200_000),
    updated_at: ago(300_000),
  },
]

export const TASKS: Task[] = [
  {
    id: 'task-lum-001',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    title: 'Set up project structure and shared types',
    description: 'Initialize Vite + React + TypeScript. Define shared interfaces in src/types.ts.',
    stream_id: 'luminary-architect',
    branch: 'master',
    status: 'done',
    priority: 100,
    runner_type: 'claude_code' as string,
    model_hint: 'claude-sonnet-4-6',
    depends_on: [],
    cost_tokens: 12_400,
    created_at: ago(7_200_000),
    updated_at: ago(3_600_000),
    started_at: ago(7_200_000),
    completed_at: ago(3_600_000),
    notes: 'Shared types in src/types.ts.',
  },
  {
    id: 'task-lum-002',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    title: 'Build Nav and Footer components',
    description: 'Responsive navbar with mobile hamburger. Footer with links.',
    stream_id: 'luminary-architect',
    branch: 'master',
    status: 'done',
    priority: 90,
    runner_type: 'claude_code' as string,
    model_hint: 'claude-sonnet-4-6',
    depends_on: ['task-lum-001'],
    cost_tokens: 8_200,
    created_at: ago(7_200_000),
    updated_at: ago(1_800_000),
    started_at: ago(3_600_000),
    completed_at: ago(1_800_000),
    notes: '',
  },
  {
    id: 'task-lum-003',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    title: 'Build HomePage',
    description: 'Hero with CTA, features grid (6 items), testimonials, closing CTA banner.',
    stream_id: 'luminary-home',
    branch: 'feature/home',
    status: 'in_progress',
    priority: 80,
    runner_type: 'claude_code' as string,
    model_hint: 'claude-sonnet-4-6',
    depends_on: ['task-lum-001', 'task-lum-002'],
    cost_tokens: 4_100,
    created_at: ago(7_200_000),
    updated_at: ago(600_000),
    started_at: ago(1_800_000),
    completed_at: null,
    notes: 'Hero done. Working on features grid.',
  },
  {
    id: 'task-lum-004',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    title: 'Build ServicesPage',
    description: 'Service cards with icons, pricing tiers, FAQ accordion.',
    stream_id: null,
    branch: 'feature/services',
    status: 'queued',
    priority: 70,
    runner_type: 'claude_code' as string,
    model_hint: 'claude-haiku-4-5-20251001',
    depends_on: ['task-lum-001', 'task-lum-002'],
    cost_tokens: 0,
    created_at: ago(7_200_000),
    updated_at: ago(7_200_000),
    started_at: null,
    completed_at: null,
    notes: '',
  },
  {
    id: 'task-lum-005',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    title: 'Build PortfolioPage',
    description: 'Project gallery with category filters and modal lightbox.',
    stream_id: null,
    branch: 'feature/portfolio',
    status: 'queued',
    priority: 70,
    runner_type: 'claude_code' as string,
    model_hint: 'claude-haiku-4-5-20251001',
    depends_on: ['task-lum-001', 'task-lum-002'],
    cost_tokens: 0,
    created_at: ago(7_200_000),
    updated_at: ago(7_200_000),
    started_at: null,
    completed_at: null,
    notes: '',
  },
  {
    id: 'task-lum-006',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    title: 'Write end-to-end tests',
    description: 'Cypress tests covering navigation, rendering, and interactive elements.',
    stream_id: null,
    branch: 'test/e2e',
    status: 'blocked',
    priority: 40,
    runner_type: 'claude_code' as string,
    model_hint: null,
    depends_on: ['task-lum-003', 'task-lum-004', 'task-lum-005'],
    cost_tokens: 0,
    created_at: ago(7_200_000),
    updated_at: ago(7_200_000),
    started_at: null,
    completed_at: null,
    notes: 'Blocked: waiting for all pages to complete.',
  },
]

export const WORKERS: Worker[] = [
  {
    id: 'worker-arch',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    task_id: 'task-lum-002',
    stream_id: 'luminary-architect',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    worktree_path: 'D:\\dev\\Pete.ai.work\\Luminary',
    branch: 'master',
    git_root: 'D:\\dev\\Pete.ai.work\\Luminary',
    pid: 14832,
    spawned_by: 'manual',
    runner_type: 'claude_code' as string,
    created_at: ago(7_200_000),
    updated_at: ago(300_000),
    started_at: ago(7_200_000),
    completed_at: null,
    notes: 'Architect — owns shared components',
    stream_status: 'ok',
    stream_age: 45,
    stream_notes: 'Nav and footer done. Idle.',
    session_active: true,
  },
  {
    id: 'worker-home',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    task_id: 'task-lum-003',
    stream_id: 'luminary-home',
    status: 'active',
    model: 'claude-sonnet-4-6',
    worktree_path: 'D:\\dev\\Pete.ai.work\\Luminary.Home',
    branch: 'feature/home',
    git_root: 'D:\\dev\\Pete.ai.work\\Luminary',
    pid: 15200,
    spawned_by: 'manual',
    runner_type: 'claude_code' as string,
    created_at: ago(1_800_000),
    updated_at: ago(60_000),
    started_at: ago(1_800_000),
    completed_at: null,
    notes: '',
    stream_status: 'ok',
    stream_age: 18,
    stream_notes: 'Working on features grid component',
    session_active: true,
  },
  {
    id: 'worker-stuck',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    task_id: 'task-lum-004',
    stream_id: 'luminary-services',
    status: 'stuck',
    model: 'claude-haiku-4-5-20251001',
    worktree_path: 'D:\\dev\\Pete.ai.work\\Luminary.Services',
    branch: 'feature/services',
    git_root: 'D:\\dev\\Pete.ai.work\\Luminary',
    pid: 15801,
    spawned_by: 'manual',
    runner_type: 'claude_code' as string,
    created_at: ago(4_200_000),
    updated_at: ago(700_000),
    started_at: ago(4_200_000),
    completed_at: null,
    notes: '',
    stream_status: 'stale',
    stream_age: 712,
    stream_notes: 'Last seen: starting services card component',
    session_active: false,
  },
  {
    id: 'worker-pending',
    project_id: 'proj-luminary',
    mission_id: 'mission-lum-web',
    task_id: 'task-lum-005',
    stream_id: 'luminary-portfolio',
    status: 'pending',
    model: 'claude-haiku-4-5-20251001',
    worktree_path: 'D:\\dev\\Pete.ai.work\\Luminary.Portfolio',
    branch: 'feature/portfolio',
    git_root: 'D:\\dev\\Pete.ai.work\\Luminary',
    pid: null,
    spawned_by: 'manual',
    runner_type: 'claude_code' as string,
    created_at: ago(300_000),
    updated_at: ago(300_000),
    started_at: null,
    completed_at: null,
    notes: 'Ready to spawn',
    stream_status: undefined,
    stream_age: undefined,
    stream_notes: undefined,
    session_active: false,
  },
]

let _id = 1
function mklog(level: LogEntry['level'], source: string, message: string, offset: number, extra: Partial<LogEntry> = {}): LogEntry {
  return { id: _id++, timestamp: ago(offset), level, source, message, project_id: null, task_id: null, stream_id: null, ...extra }
}
const LUM = { project_id: 'proj-luminary' }

export const LOGS: LogEntry[] = [
  mklog('info',  'system',              'Factory Hub started on port 9100',                              7_200_000),
  mklog('info',  'system',              'Database initialised — 0 projects, 0 tasks, 0 workers',         7_195_000),
  mklog('info',  'luminary-architect',  'Session started. Reading CLAUDE.md…',                           7_190_000, { ...LUM, stream_id: 'luminary-architect', task_id: 'task-lum-001' }),
  mklog('info',  'luminary-architect',  'Claimed task: Set up project structure and shared types',       7_185_000, { ...LUM, stream_id: 'luminary-architect', task_id: 'task-lum-001' }),
  mklog('debug', 'luminary-architect',  'Initialising Vite + React + TypeScript + Tailwind 4',           7_150_000, { ...LUM, stream_id: 'luminary-architect' }),
  mklog('info',  'luminary-architect',  'Created src/types.ts with shared NavLink, Project interfaces',  7_100_000, { ...LUM, stream_id: 'luminary-architect' }),
  mklog('info',  'luminary-architect',  'Committed: initial project scaffold',                           7_050_000, { ...LUM, stream_id: 'luminary-architect' }),
  mklog('info',  'luminary-architect',  'Task task-lum-001 complete — posting to hub',                  3_620_000, { ...LUM, stream_id: 'luminary-architect', task_id: 'task-lum-001' }),
  mklog('info',  'luminary-architect',  'Claimed task: Build Nav and Footer components',                 3_610_000, { ...LUM, stream_id: 'luminary-architect', task_id: 'task-lum-002' }),
  mklog('debug', 'luminary-architect',  'Writing Nav.tsx — responsive with mobile hamburger',            3_500_000, { ...LUM, stream_id: 'luminary-architect' }),
  mklog('debug', 'luminary-architect',  'Writing Footer.tsx with link grid',                             3_200_000, { ...LUM, stream_id: 'luminary-architect' }),
  mklog('info',  'luminary-architect',  'Committed: add Nav and Footer components',                      1_820_000, { ...LUM, stream_id: 'luminary-architect' }),
  mklog('info',  'system',              'Worker luminary-home spawned — PID 15200',                      1_800_000, LUM),
  mklog('info',  'luminary-home',       'Session started. Reading CLAUDE.md…',                           1_795_000, { ...LUM, stream_id: 'luminary-home', task_id: 'task-lum-003' }),
  mklog('info',  'luminary-home',       'Claimed task: Build HomePage',                                  1_790_000, { ...LUM, stream_id: 'luminary-home', task_id: 'task-lum-003' }),
  mklog('debug', 'luminary-home',       'Designing Hero section layout',                                 1_700_000, { ...LUM, stream_id: 'luminary-home' }),
  mklog('info',  'luminary-home',       'Committed: add hero section with gradient + CTA button',        1_200_000, { ...LUM, stream_id: 'luminary-home' }),
  mklog('info',  'luminary-home',       'Working on features grid — 6 items with icon components',         600_000, { ...LUM, stream_id: 'luminary-home' }),
  mklog('warn',  'system',              'Worker luminary-services: no hub update for 712s — stuck',        698_000),
  mklog('warn',  'governor',            'Stuck worker detected: luminary-services (712s since last update)', 695_000),
  mklog('debug', 'system',              'Watchdog check — 2 healthy, 1 stuck, 1 pending',                  30_000),
]

export const CONFIG: Record<string, ConfigEntry> = {
  hub_port:                { value: '9100',                   description: 'Port the hub API listens on',                          updated_at: ago(7_200_000) },
  hub_base_url:            { value: 'http://localhost:9100',  description: 'Base URL workers use to call hub',                     updated_at: ago(7_200_000) },
  max_workers:             { value: '10',                     description: 'Maximum concurrent workers',                           updated_at: ago(7_200_000) },
  stuck_threshold_minutes: { value: '10',                     description: 'Minutes with no update before a worker is stuck',      updated_at: ago(7_200_000) },
  default_model:           { value: 'claude-sonnet-4-6',      description: 'Default model for new workers',                       updated_at: ago(7_200_000) },
  worker_base_path:        { value: 'D:\\dev\\Pete.ai.work', description: 'Base directory for new git worktrees',                 updated_at: ago(7_200_000) },
  auto_spawn:              { value: 'false',                  description: 'Auto-spawn workers when tasks become available',       updated_at: ago(7_200_000) },
  // ── Triage / Governor ─────────────────────────────────────────────────────
  triage_model:            { value: 'gemini-flash',           description: 'Free model for governor triage: gemini-flash | ollama:<model>',  updated_at: ago(7_200_000) },
  triage_interval:         { value: '60',                     description: 'Seconds between governor triage polls',               updated_at: ago(7_200_000) },
  triage_auto_reply:       { value: 'true',                   description: 'Governor auto-replies to answerable questions',       updated_at: ago(7_200_000) },
  triage_alert_threshold:  { value: '15',                     description: 'Minutes before escalating unanswered question to alert', updated_at: ago(7_200_000) },
  google_api_key:          { value: '',                       description: 'Google API key for Gemini Flash (free tier)',         updated_at: ago(7_200_000) },
  ntfy_topic:              { value: '',                       description: 'ntfy.sh topic for push alerts (e.g. botmaster-pete)', updated_at: ago(7_200_000) },
  openrouter_api_key:      { value: '',                       description: 'OpenRouter API key (blank to disable)',               updated_at: ago(7_200_000) },
  bot_behavior_template:   {
    value: `══════════════════════════════════════════════════════════
BOTMASTER SESSION PROTOCOL  —  read before doing any work
══════════════════════════════════════════════════════════
## 1. MANDATORY HUB REPORTING
PATCH /api/tasks/{id} status=in_progress as your FIRST action every session.
Report every significant step: PATCH /api/tasks/{id} notes="what you just did / next step"
Never go silent for more than 10 minutes — post a progress note.

## 2. TASK LIFECYCLE
queued → in_progress → review (or done)
If blocked: status=blocked + notes="reason + what you need"
Never mark done unless work is verifiably complete and tested.

## 3. QUESTION PROTOCOL
Post questions via: POST {hub_url}/api/streams/{your_stream}/inbox  code=QUESTION  message="..."
Wait for a reply before proceeding on blocked decisions.
Do NOT guess at ambiguous requirements — ask.

## 4. CODE QUALITY
Run typecheck/lint before marking done. Commit frequently with clear messages.
Write no TODOs in code — if something is left, create a new task via hub.
Follow existing patterns — read the codebase before inventing new ones.

## 5. COMPLETION CHECKLIST
Before marking done: (a) typecheck passes, (b) manual smoke test done, (c) all changes committed, (d) hub notes updated with concise summary.

## 6. COORDINATION RULES
Check depends_on before starting — wait for dependencies to complete.
Do NOT modify files owned by another stream without coordination.
Communicate blockers and conflicts immediately via hub.`,
    description: 'Bot session protocol injected at the start of every bot CLAUDE.md',
    updated_at: ago(7_200_000),
  },
}

export const BOT_EVENTS: BotEvent[] = [
  { id: 1, worker_id: 'worker-arch', task_id: 'task-lum-001', project_id: 'proj-luminary', mission_id: 'mission-lum-web', event_type: 'task_in_progress', model: 'claude-sonnet-4-6', prompt_tokens: 3200, completion_tokens: 1800, content: {}, created_at: ago(7_185_000) },
  { id: 2, worker_id: 'worker-arch', task_id: 'task-lum-001', project_id: 'proj-luminary', mission_id: 'mission-lum-web', event_type: 'task_done',        model: 'claude-sonnet-4-6', prompt_tokens: 5800, completion_tokens: 2400, content: {}, created_at: ago(3_620_000) },
  { id: 3, worker_id: 'worker-arch', task_id: 'task-lum-002', project_id: 'proj-luminary', mission_id: 'mission-lum-web', event_type: 'task_in_progress', model: 'claude-sonnet-4-6', prompt_tokens: 2900, completion_tokens: 1600, content: {}, created_at: ago(3_610_000) },
  { id: 4, worker_id: 'worker-arch', task_id: 'task-lum-002', project_id: 'proj-luminary', mission_id: 'mission-lum-web', event_type: 'task_done',        model: 'claude-sonnet-4-6', prompt_tokens: 6100, completion_tokens: 2800, content: {}, created_at: ago(1_820_000) },
  { id: 5, worker_id: 'worker-home', task_id: 'task-lum-003', project_id: 'proj-luminary', mission_id: 'mission-lum-web', event_type: 'task_in_progress', model: 'claude-sonnet-4-6', prompt_tokens: 1800, completion_tokens: 900,  content: {}, created_at: ago(1_790_000) },
]

export const REVIEWS: Review[] = [
  {
    id: 1, task_id: 'task-lum-001', worker_id: 'worker-arch',
    project_id: 'proj-luminary', mission_id: 'mission-lum-web',
    model: 'claude-sonnet-4-6', rating: 4, notes: 'Clean setup, types well defined.',
    flags: ['exemplary'], reviewer: 'user',
    created_at: ago(3_500_000), updated_at: ago(3_500_000),
  },
]

export const START_TIME = Date.now() - 3_600_000

export const OBJECTIVE_TEMPLATES: ObjectiveTemplate[] = [
  {
    id: 'tmpl-001', title: 'Set up project structure and shared types',
    description: 'Initialize the build toolchain (Vite/CRA/etc) and define shared TypeScript interfaces in src/types.ts.',
    model_hint: 'claude-sonnet-4-6', tags: ['setup', 'typescript'],
    source_mission_id: 'mission-lum-web', source_task_id: 'task-lum-001',
    use_count: 4, created_at: ago(7_200_000), updated_at: ago(7_200_000),
  },
  {
    id: 'tmpl-002', title: 'Build Nav and Footer components',
    description: 'Responsive top navigation with mobile hamburger menu and a footer with link sections.',
    model_hint: 'claude-sonnet-4-6', tags: ['frontend', 'components', 'layout'],
    source_mission_id: 'mission-lum-web', source_task_id: 'task-lum-002',
    use_count: 3, created_at: ago(7_200_000), updated_at: ago(7_200_000),
  },
  {
    id: 'tmpl-003', title: 'Build HomePage',
    description: 'Hero section with CTA button, features grid (6 items), testimonials carousel, closing CTA banner.',
    model_hint: 'claude-sonnet-4-6', tags: ['frontend', 'page', 'marketing'],
    source_mission_id: 'mission-lum-web', source_task_id: 'task-lum-003',
    use_count: 2, created_at: ago(7_200_000), updated_at: ago(7_200_000),
  },
  {
    id: 'tmpl-004', title: 'Write end-to-end tests',
    description: 'Cypress or Playwright tests covering core user journeys: navigation, page rendering, interactive elements.',
    model_hint: '', tags: ['testing', 'e2e', 'qa'],
    source_mission_id: 'mission-lum-web', source_task_id: 'task-lum-006',
    use_count: 5, created_at: ago(7_200_000), updated_at: ago(7_200_000),
  },
  {
    id: 'tmpl-005', title: 'API integration layer',
    description: 'Create typed API client with error handling, loading states, and retry logic. Export hooks for each endpoint.',
    model_hint: 'claude-sonnet-4-6', tags: ['api', 'typescript', 'frontend'],
    source_mission_id: null, source_task_id: null,
    use_count: 6, created_at: ago(86_400_000), updated_at: ago(86_400_000),
  },
  {
    id: 'tmpl-006', title: 'Database schema and migrations',
    description: 'Design and implement the SQLite/Postgres schema. Write migration files and seed data for local dev.',
    model_hint: 'claude-haiku-4-5-20251001', tags: ['backend', 'database', 'migrations'],
    source_mission_id: null, source_task_id: null,
    use_count: 7, created_at: ago(172_800_000), updated_at: ago(172_800_000),
  },
]

export const AUDIT_LOG: AuditEntry[] = [
  { id: 1, timestamp: ago(7_200_000), event_type: 'mission_created',    entity_type: 'mission',  entity_id: 'mission-lum-web', actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { name: 'Build initial website' } },
  { id: 2, timestamp: ago(7_180_000), event_type: 'task_created',       entity_type: 'task',     entity_id: 'task-lum-001',    actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { title: 'Set up project structure and shared types' } },
  { id: 3, timestamp: ago(7_170_000), event_type: 'task_created',       entity_type: 'task',     entity_id: 'task-lum-002',    actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { title: 'Build Nav and Footer components' } },
  { id: 4, timestamp: ago(7_150_000), event_type: 'task_created',       entity_type: 'task',     entity_id: 'task-lum-003',    actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { title: 'Build HomePage' } },
  { id: 5, timestamp: ago(7_100_000), event_type: 'task_created',       entity_type: 'task',     entity_id: 'task-lum-004',    actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { title: 'Build ServicesPage' } },
  { id: 6, timestamp: ago(7_050_000), event_type: 'task_created',       entity_type: 'task',     entity_id: 'task-lum-005',    actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { title: 'Build PortfolioPage' } },
  { id: 7, timestamp: ago(7_000_000), event_type: 'task_created',       entity_type: 'task',     entity_id: 'task-lum-006',    actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { title: 'Write end-to-end tests' } },
  { id: 8, timestamp: ago(300_000),   event_type: 'plan_reviewed',      entity_type: 'mission',  entity_id: 'mission-lum-web', actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { questions_count: 4, answered: 1 } },
  { id: 9, timestamp: ago(240_000),   event_type: 'stage_changed',      entity_type: 'mission',  entity_id: 'mission-lum-web', actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { from: 'draft', to: 'review' } },
  { id: 10, timestamp: ago(3_620_000), event_type: 'task_status_changed', entity_type: 'task',  entity_id: 'task-lum-001',    actor: 'bot',  project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { from: 'in_progress', to: 'done', title: 'Set up project structure and shared types' } },
  { id: 11, timestamp: ago(1_820_000), event_type: 'task_status_changed', entity_type: 'task',  entity_id: 'task-lum-002',    actor: 'bot',  project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { from: 'in_progress', to: 'done', title: 'Build Nav and Footer components' } },
  { id: 12, timestamp: ago(60_000),    event_type: 'template_saved',    entity_type: 'objective_template', entity_id: 'tmpl-001', actor: 'user', project_id: 'proj-luminary', mission_id: 'mission-lum-web', details: { title: 'Set up project structure and shared types', task_id: 'task-lum-001' } },
]
