import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Plus, RefreshCw, Bot, Target, ChevronRight, FolderKanban,
  Settings, GitBranch, Eye, ArrowRight, ArrowLeft, Sparkles, AlertCircle,
  LayoutGrid, List, FolderOpen, Pencil, Check, X,
} from 'lucide-react'
import {
  useProject, useMissions, useCreateMission, useUpdateMission, useWorkers, useUpdateProject,
  useAiSuggestMission, useConfig,
} from '../api/hooks'
import StatusBadge from '../components/StatusBadge'
import LogViewer from '../components/LogViewer'
import { useToast } from '../components/Toasts'
import type { Mission, Project, MissionStage } from '../api/client'

// ── Mission Wizard ────────────────────────────────────────────────────────────

interface MissionDraft {
  name: string
  description: string
  success_criteria: string
  tech_notes: string
  worktree_base: string
  branch_prefix: string
  git_enabled: boolean
  model_hint: string
  status: string
}

type WizardMode = 'wizard' | 'manual'

const MODELS = [
  { value: '',                    label: 'System default' },
  { value: 'claude-sonnet-4-6',   label: 'Claude Sonnet 4.6 (recommended)' },
  { value: 'claude-opus-4-7',     label: 'Claude Opus 4.7 (complex tasks)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast/cheap)' },
  { value: 'gemini-flash',        label: 'Gemini Flash (free tier)' },
  { value: 'ollama',              label: 'Ollama (local)' },
]

function inputCls(extra = '') {
  return `w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 ${extra}`
}
function labelCls() { return 'block text-xs font-semibold text-gray-600 mb-1' }
function hintCls()  { return 'text-xs text-gray-400 mt-1' }

function StepDot({ n, current, label }: { n: number; current: number; label: string }) {
  const done = n < current
  const active = n === current
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
        done   ? 'bg-yellow-400 text-gray-900' :
        active ? 'bg-gray-900 text-white' :
                 'bg-gray-200 text-gray-500'
      }`}>
        {done ? '✓' : n + 1}
      </div>
      <span className={`text-[10px] font-medium whitespace-nowrap ${active ? 'text-gray-800' : 'text-gray-400'}`}>
        {label}
      </span>
    </div>
  )
}

function buildPreview(draft: MissionDraft, project: Project, projectId: string, missionId: string): string {
  const git = draft.git_enabled
    ? `Git: enabled  |  branch prefix: ${draft.branch_prefix || 'feature/'}`
    : 'Git: disabled'
  const model = draft.model_hint
    ? MODELS.find(m => m.value === draft.model_hint)?.label ?? draft.model_hint
    : 'System default'
  return [
    `# Mission: ${draft.name || '(unnamed)'}`,
    '',
    '## Goal',
    draft.description || '(no description provided)',
    '',
    '## Success Criteria',
    draft.success_criteria || '(none specified)',
    ...(draft.tech_notes ? ['', '## Tech Notes', draft.tech_notes] : []),
    '',
    '## Working Directory',
    draft.worktree_base || project.project_path || '(not specified)',
    git,
    '',
    '## Bot Configuration',
    `Model: ${model}`,
    `Project ID: ${projectId}`,
    `Mission ID: ${missionId || '(assigned on creation)'}`,
    '',
    '## Project Context',
    `${project.name}${project.tech_stack ? ' — ' + project.tech_stack : ''}`,
    project.description || '',
  ].join('\n')
}

function MissionWizard({
  projectId, project, initialMission, onClose,
}: {
  projectId: string; project: Project; initialMission?: Mission; onClose: () => void
}) {
  const isEdit = !!initialMission
  const [mode, setMode] = useState<WizardMode>('wizard')
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<MissionDraft>({
    name:             initialMission?.name             ?? '',
    description:      initialMission?.description      ?? '',
    success_criteria: initialMission?.success_criteria ?? '',
    tech_notes:       initialMission?.tech_notes       ?? '',
    worktree_base:    initialMission?.worktree_base     ?? project.project_path ?? '',
    branch_prefix:    initialMission?.branch_prefix     ?? 'feature/',
    git_enabled:      initialMission?.git_enabled       ?? !!project.project_path,
    model_hint:       initialMission?.model_hint        ?? '',
    status:           initialMission?.status            ?? 'active',
  })
  const [error, setError] = useState('')
  const [aiError, setAiError] = useState('')
  const create = useCreateMission()
  const update = useUpdateMission()
  const aiSuggest = useAiSuggestMission()
  const addToast = useToast()

  const set = (k: keyof MissionDraft, v: string | boolean) =>
    setDraft(d => ({ ...d, [k]: v }))

  const STEPS = ['The Mission', 'Location & Git', 'Bot Briefing', 'Preview']

  async function handleAiSuggest() {
    setAiError('')
    try {
      const res = await aiSuggest.mutateAsync({
        project_name: project.name,
        tech_stack: project.tech_stack ?? '',
        mission_name: draft.name,
        description: draft.description,
        success_criteria: draft.success_criteria,
      })
      set('tech_notes', res.briefing)
    } catch (err: any) {
      setAiError(err.message ?? 'AI generation failed — is your API key set in Settings?')
    }
  }

  async function handleSave() {
    setError('')
    if (!draft.name.trim()) { setError('Mission name is required'); return }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: initialMission!.id, project_id: projectId, ...draft })
        addToast(`Mission "${draft.name}" updated`, 'success')
      } else {
        await create.mutateAsync({ project_id: projectId, ...draft })
        addToast(`Mission "${draft.name}" created`, 'success')
      }
      onClose()
    } catch (err: any) {
      const msg = err.message ?? 'Failed to save mission'
      setError(msg)
      addToast(msg)
    }
  }

  const isPending = create.isPending || update.isPending

  const preview = buildPreview(draft, project, projectId, initialMission?.id ?? '')

  // ── Manual mode: single form ──────────────────────────────────────────────

  const allFields = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className={labelCls()}>Mission Name *</label>
          <input value={draft.name} onChange={e => set('name', e.target.value)}
            placeholder="Build initial website" autoFocus
            className={inputCls()} />
        </div>
        <div className="col-span-2">
          <label className={labelCls()}>Goal / Description</label>
          <textarea value={draft.description} onChange={e => set('description', e.target.value)}
            rows={2} placeholder="What does this mission accomplish?"
            className={inputCls('resize-none')} />
        </div>
        <div className="col-span-2">
          <label className={labelCls()}>Success Criteria</label>
          <textarea value={draft.success_criteria} onChange={e => set('success_criteria', e.target.value)}
            rows={2} placeholder={"- All pages render on mobile\n- Lighthouse ≥ 90"}
            className={inputCls('resize-none')} />
        </div>
        <div>
          <label className={labelCls()}>Working Folder</label>
          <input value={draft.worktree_base} onChange={e => set('worktree_base', e.target.value)}
            placeholder={project.project_path ?? 'D:\\dev\\...'}
            className={inputCls()} />
        </div>
        <div>
          <label className={labelCls()}>Branch Prefix</label>
          <input value={draft.branch_prefix} onChange={e => set('branch_prefix', e.target.value)}
            placeholder="feature/" disabled={!draft.git_enabled}
            className={inputCls(draft.git_enabled ? '' : 'opacity-40')} />
        </div>
        <div className="flex items-center gap-3 col-span-2">
          <input id="git-en" type="checkbox" checked={draft.git_enabled}
            onChange={e => set('git_enabled', e.target.checked)}
            className="w-4 h-4 accent-yellow-400" />
          <label htmlFor="git-en" className="text-sm text-gray-700 font-medium cursor-pointer">Git enabled</label>
        </div>
        <div>
          <label className={labelCls()}>Preferred Model</label>
          <select value={draft.model_hint} onChange={e => set('model_hint', e.target.value)}
            className={inputCls()}>
            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls()}>Initial Status</label>
          <select value={draft.status} onChange={e => set('status', e.target.value)}
            className={inputCls()}>
            <option value="active">Active</option>
            <option value="paused">Paused — set up now, start later</option>
          </select>
        </div>
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-1">
            <label className={labelCls()}>Bot Briefing</label>
            <button type="button" onClick={handleAiSuggest} disabled={aiSuggest.isPending || !draft.name.trim()}
              className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 disabled:opacity-40 disabled:cursor-not-allowed">
              {aiSuggest.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
              Generate with AI
            </button>
          </div>
          {aiError && <p className="text-xs text-red-600 mb-1">{aiError}</p>}
          <textarea value={draft.tech_notes} onChange={e => set('tech_notes', e.target.value)}
            rows={4} placeholder={"- Stack: React + TypeScript + Tailwind 4\n- No external UI libraries\n- Follow existing patterns in src/components\n- Watch out: API requires auth header"}
            className={inputCls('resize-none font-mono text-xs')} />
          <p className={hintCls()}>Stack, patterns, constraints — what the bot reads in CLAUDE.md before starting.</p>
        </div>
      </div>
    </div>
  )

  // ── Wizard steps ─────────────────────────────────────────────────────────

  const stepContent = [
    // Step 0: The Mission
    <div key="goal" className="space-y-4">
      <div>
        <p className="text-lg font-black text-gray-900 mb-0.5">What's the mission?</p>
        <p className="text-xs text-gray-400">Define the goal and what success looks like.</p>
      </div>
      <div>
        <label className={labelCls()}>Mission Name *</label>
        <input value={draft.name} onChange={e => set('name', e.target.value)}
          placeholder="Build initial website" autoFocus
          className={inputCls()} />
      </div>
      <div>
        <label className={labelCls()}>What does this accomplish?</label>
        <textarea value={draft.description} onChange={e => set('description', e.target.value)}
          rows={3} placeholder="Describe what this mission should deliver…"
          className={inputCls('resize-none')} />
      </div>
      <div>
        <label className={labelCls()}>How will we know it's done?</label>
        <textarea value={draft.success_criteria} onChange={e => set('success_criteria', e.target.value)}
          rows={3} placeholder={"- All pages render correctly on mobile and desktop\n- Forms are accessible (ARIA labels)\n- Lighthouse score ≥ 90"}
          className={inputCls('resize-none')} />
        <p className={hintCls()}>List acceptance criteria — these go into the bot's briefing.</p>
      </div>
    </div>,

    // Step 1: Location & Git
    <div key="location" className="space-y-4">
      <div>
        <p className="text-lg font-black text-gray-900 mb-0.5">Where will bots work?</p>
        <p className="text-xs text-gray-400">Set the working folder and git configuration for this mission.</p>
      </div>
      <div>
        <label className={labelCls()}>Working folder</label>
        <input value={draft.worktree_base} onChange={e => set('worktree_base', e.target.value)}
          placeholder={project.project_path ?? 'D:\\dev\\Projects\\my-project'}
          className={inputCls('font-mono text-xs')} />
        <p className={hintCls()}>
          Base directory. Bots get sub-worktrees like <code className="bg-gray-100 px-1 rounded">{'{folder}.{bot-name}'}</code>
        </p>
      </div>
      <div className="flex items-start gap-3 bg-gray-50 rounded-lg p-3 border border-gray-200">
        <input id="git-en2" type="checkbox" checked={draft.git_enabled}
          onChange={e => set('git_enabled', e.target.checked)}
          className="w-4 h-4 accent-yellow-400 mt-0.5 flex-shrink-0" />
        <div>
          <label htmlFor="git-en2" className="text-sm text-gray-700 font-semibold cursor-pointer flex items-center gap-1.5">
            <GitBranch size={14} className="text-gray-500" /> Git enabled
          </label>
          <p className="text-xs text-gray-400 mt-0.5">
            {draft.git_enabled
              ? 'Bots will commit to feature branches and use worktrees.'
              : 'Bots will work directly in the folder without git.'}
          </p>
        </div>
      </div>
      {draft.git_enabled && (
        <div>
          <label className={labelCls()}>Branch prefix</label>
          <input value={draft.branch_prefix} onChange={e => set('branch_prefix', e.target.value)}
            placeholder="feature/"
            className={inputCls('font-mono')} />
          <p className={hintCls()}>
            Branches will be named like: <code className="bg-gray-100 px-1 rounded">{draft.branch_prefix || 'feature/'}build-homepage</code>
          </p>
        </div>
      )}
    </div>,

    // Step 2: Bot Briefing
    <div key="bot" className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-black text-gray-900 mb-0.5">Bot briefing</p>
          <p className="text-xs text-gray-400">
            This goes into CLAUDE.md — the bot reads it before starting work.
            Cover the stack, patterns to follow, what to avoid, and any gotchas.
          </p>
        </div>
        <button onClick={handleAiSuggest} disabled={aiSuggest.isPending || !draft.name.trim()}
          title={!draft.name.trim() ? 'Enter a mission name first' : 'Generate with AI'}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50
            bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100 disabled:cursor-not-allowed">
          {aiSuggest.isPending
            ? <><RefreshCw size={12} className="animate-spin" /> Generating…</>
            : <><Sparkles size={12} /> Generate with AI</>}
        </button>
      </div>

      {/* Inline prompts to guide the user */}
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3 border border-gray-100">
        <div className="font-medium text-gray-600">Your briefing should answer:</div>
        <div />
        <div>• What's the tech stack?</div>
        <div>• Any libraries to use or avoid?</div>
        <div>• Patterns / conventions to follow?</div>
        <div>• Any gotchas or known traps?</div>
        <div className="col-span-2 text-gray-400 mt-1 italic">
          Or click "Generate with AI" — it'll draft this from your goal and success criteria.
        </div>
      </div>

      {aiError && (
        <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          {aiError}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls()}>Bot briefing</label>
          {draft.tech_notes && (
            <span className="text-xs text-gray-400">{draft.tech_notes.split('\n').filter(Boolean).length} lines</span>
          )}
        </div>
        <textarea value={draft.tech_notes} onChange={e => set('tech_notes', e.target.value)}
          rows={7}
          placeholder={"- Stack: React + TypeScript + Tailwind 4\n- No external UI component libraries\n- Follow existing patterns in src/components — check before creating new\n- TypeScript strict mode, no any\n- Watch out: API calls require auth header, see src/api/client.ts"}
          className={inputCls('resize-none font-mono text-xs')} />
        <p className={hintCls()}>Use short bullet lines starting with "- ". The bot reads this verbatim.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls()}>Preferred model</label>
          <select value={draft.model_hint} onChange={e => set('model_hint', e.target.value)}
            className={inputCls()}>
            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <p className={hintCls()}>Sonnet = quality, Haiku/Flash = speed/cost, Opus = complex reasoning.</p>
        </div>
        <div>
          <label className={labelCls()}>Initial status</label>
          <select value={draft.status} onChange={e => set('status', e.target.value)}
            className={inputCls()}>
            <option value="active">Active — ready to deploy bots</option>
            <option value="paused">Paused — set up now, start later</option>
          </select>
        </div>
      </div>
    </div>,

    // Step 3: Preview
    <div key="preview" className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-black text-gray-900 mb-0.5">Bot context preview</p>
          <p className="text-xs text-gray-400">This is included in CLAUDE.md when a bot starts on this mission.</p>
        </div>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Eye size={12} /> Preview
        </span>
      </div>
      <pre className="bg-gray-950 text-gray-100 text-xs rounded-lg p-4 overflow-auto max-h-72 leading-relaxed whitespace-pre-wrap font-mono">
        {preview}
      </pre>
      <p className="text-xs text-gray-400 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
        Everything looks correct? Click <strong>Create Mission</strong> to save.
      </p>
    </div>,
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  const isLastStep = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-gray-200 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-950 rounded-t-xl flex-shrink-0">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-yellow-400" />
            <h2 className="font-bold text-white">{isEdit ? 'Edit Mission' : 'New Mission'}</h2>
          </div>
          <div className="flex items-center gap-4">
            {mode === 'wizard' ? (
              <button onClick={() => setMode('manual')}
                className="text-gray-400 hover:text-gray-200 text-xs underline underline-offset-2">
                Enter manually
              </button>
            ) : (
              <button onClick={() => { setMode('wizard'); setStep(0) }}
                className="text-gray-400 hover:text-gray-200 text-xs underline underline-offset-2">
                Use wizard
              </button>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
          </div>
        </div>

        {/* Step indicator — wizard only */}
        {mode === 'wizard' && (
          <div className="flex items-start justify-center gap-4 px-6 pt-4 flex-shrink-0">
            {STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-1">
                <StepDot n={i} current={step} label={label} />
                {i < STEPS.length - 1 && (
                  <div className={`w-10 h-px mt-[-12px] ${i < step ? 'bg-yellow-400' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {mode === 'wizard' ? stepContent[step] : allFields}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mt-3">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <div>
            {mode === 'wizard' && step > 0 && (
              <button onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 px-3 py-2 rounded-lg hover:bg-gray-100">
                <ArrowLeft size={14} /> Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            {mode === 'wizard' && !isLastStep ? (
              <button onClick={() => {
                if (step === 0 && !draft.name.trim()) { setError('Mission name is required'); return }
                setError('')
                setStep(s => s + 1)
              }}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-yellow-400 text-gray-900 font-semibold rounded-lg hover:bg-yellow-500">
                Next <ArrowRight size={14} />
              </button>
            ) : (
              <button onClick={handleSave} disabled={isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-yellow-400 text-gray-900 font-semibold rounded-lg hover:bg-yellow-500 disabled:opacity-50">
                {isPending && <RefreshCw size={14} className="animate-spin" />}
                {isEdit ? 'Save Changes' : 'Create Mission'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Mission Card ──────────────────────────────────────────────────────────────

function MissionCard({
  mission, projectId, project, onEdit,
}: {
  mission: Mission; projectId: string; project: Project; onEdit: (m: Mission) => void
}) {
  const taskCount = mission.tasks?.length ?? 0

  return (
    <div className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group">
      <Link to={`/projects/${projectId}/missions/${mission.id}`}
        className="flex items-center gap-4 flex-1 min-w-0">
        <div className="w-9 h-9 bg-yellow-50 rounded-lg flex items-center justify-center flex-shrink-0 border border-yellow-200">
          <Target size={18} className="text-yellow-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm truncate">{mission.name}</p>
          {mission.description && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{mission.description}</p>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            {taskCount > 0 && (
              <span className="text-xs text-gray-400">{taskCount} objective{taskCount !== 1 ? 's' : ''}</span>
            )}
            {mission.model_hint && (
              <span className="text-xs text-gray-300 font-mono">{mission.model_hint.replace('claude-', '')}</span>
            )}
            {mission.git_enabled && mission.branch_prefix && (
              <span className="text-xs text-gray-300 flex items-center gap-0.5">
                <GitBranch size={10} />{mission.branch_prefix}…
              </span>
            )}
          </div>
        </div>
        <StatusBadge status={mission.status} />
        <ChevronRight size={14} className="text-gray-300 group-hover:text-yellow-500 transition-colors flex-shrink-0" />
      </Link>
      <button onClick={() => onEdit(mission)}
        title="Edit mission settings"
        className="flex-shrink-0 p-1.5 text-gray-300 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors">
        <Settings size={14} />
      </button>
    </div>
  )
}

// ── Missions Kanban ───────────────────────────────────────────────────────────

const MISSION_STAGE_COLS: { key: MissionStage; label: string; sub: string; border: string; dot: string; bg: string }[] = [
  { key: 'draft',    label: 'Set Objectives',      sub: 'draft',    border: 'border-gray-200',   dot: 'bg-gray-400',   bg: 'bg-gray-50' },
  { key: 'review',   label: 'Review & AI Analysis', sub: 'review',   border: 'border-purple-200', dot: 'bg-purple-400', bg: 'bg-purple-50' },
  { key: 'approved', label: 'Approve Bot Prompt',   sub: 'approved', border: 'border-blue-200',   dot: 'bg-blue-400',   bg: 'bg-blue-50' },
  { key: 'running',  label: 'Running',              sub: 'running',  border: 'border-green-200',  dot: 'bg-green-400',  bg: 'bg-green-50' },
  { key: 'complete', label: 'Complete',             sub: 'complete', border: 'border-teal-200',   dot: 'bg-teal-400',   bg: 'bg-teal-50' },
]

function MissionsKanban({ missions, projectId, onEdit }: {
  missions: Mission[]; projectId: string; onEdit: (m: Mission) => void
}) {
  const cols: Record<string, Mission[]> = { draft: [], review: [], approved: [], running: [], complete: [] }
  for (const m of missions) {
    const s = (m.stage ?? 'draft') as string
    if (cols[s]) cols[s].push(m)
    else cols.draft.push(m)
  }

  return (
    <div className="grid grid-cols-5 gap-3">
      {MISSION_STAGE_COLS.map(col => (
        <div key={col.key} className={`rounded-xl border-2 ${col.border} ${col.bg} p-3`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${col.dot}`} />
              <span className="text-xs font-bold text-gray-700 leading-tight">{col.label}</span>
            </div>
            <span className="text-xs bg-white border border-gray-200 rounded-full px-1.5 py-0.5 text-gray-500 flex-shrink-0 ml-1">
              {cols[col.key].length}
            </span>
          </div>
          <div className="space-y-2">
            {cols[col.key].length === 0 && (
              <p className="text-[11px] text-gray-300 text-center py-2">—</p>
            )}
            {cols[col.key].map(m => (
              <Link key={m.id} to={`/projects/${projectId}/missions/${m.id}`}
                className="block bg-white rounded-lg border border-gray-200 p-2.5 hover:border-yellow-300 hover:shadow-sm transition-all group">
                <p className="text-xs font-semibold text-gray-800 leading-tight line-clamp-2">{m.name}</p>
                {m.description && (
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">{m.description}</p>
                )}
                <div className="flex items-center gap-1.5 mt-1.5">
                  {(m.tasks?.length ?? 0) > 0 && (
                    <span className="text-[10px] text-gray-400">{m.tasks!.length} obj</span>
                  )}
                  {m.model_hint && (
                    <span className="text-[10px] font-mono text-gray-300 truncate flex-1">{m.model_hint.replace('claude-', '')}</span>
                  )}
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(m) }}
                    className="ml-auto p-0.5 text-gray-200 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <Settings size={11} />
                  </button>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'missions' | 'bots' | 'logs'

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>('missions')
  const [missionView, setMissionView] = useState<'list' | 'kanban'>('list')
  const [editing, setEditing] = useState(false)
  const [editStatus, setEditStatus] = useState('')
  const [editingPath, setEditingPath] = useState(false)
  const [pathInput, setPathInput] = useState('')
  const [wizardMission, setWizardMission] = useState<Mission | null | 'new'>(null)

  const { data: project, isLoading } = useProject(id!)
  const { data: missions = [] } = useMissions(id!)
  const { data: workers = [] } = useWorkers({ project_id: id! })
  const { data: config } = useConfig()
  const updateProject = useUpdateProject()

  if (isLoading) return <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>
  if (!project) return (
    <div className="text-center py-8">
      <p className="text-gray-500">Project not found.</p>
      <Link to="/projects" className="text-yellow-700 text-sm hover:underline mt-2 block font-medium">← Back to projects</Link>
    </div>
  )

  function handleStatusChange() {
    if (!editStatus || !id) return
    updateProject.mutate({ id, status: editStatus })
    setEditing(false)
  }

  const activeWorkers = workers.filter(w => ['starting', 'active', 'idle'].includes(w.status))

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
          <Link to="/projects" className="hover:text-yellow-600">Projects</Link>
          <span>/</span>
          <span className="text-gray-600">{project.name}</span>
        </div>
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black text-gray-900">{project.name}</h1>
            {project.description && <p className="text-sm text-gray-500 mt-0.5">{project.description}</p>}
            {project.tech_stack && <p className="text-xs text-gray-400 mt-1 font-mono">{project.tech_stack}</p>}
            {/* Project path — editable inline */}
            {editingPath ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  value={pathInput}
                  onChange={e => setPathInput(e.target.value)}
                  placeholder={`e.g. ${config?.projects_base_dir?.value ?? 'D:\\Dev\\Projects'}\\${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  className="border border-yellow-400 rounded px-2 py-1 text-xs font-mono w-80 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  onKeyDown={e => {
                    if (e.key === 'Enter') { updateProject.mutate({ id: id!, project_path: pathInput.trim() } as any); setEditingPath(false) }
                    if (e.key === 'Escape') setEditingPath(false)
                  }}
                  autoFocus
                />
                <button onClick={() => { updateProject.mutate({ id: id!, project_path: pathInput.trim() } as any); setEditingPath(false) }}
                  className="p-1 text-green-600 hover:text-green-700"><Check size={14} /></button>
                <button onClick={() => setEditingPath(false)}
                  className="p-1 text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-1 group">
                {(() => {
                  const baseDir = config?.['projects_base_dir']?.value ?? ''
                  const sep = baseDir.includes('/') ? '/' : '\\'
                  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
                  const derivedPath = baseDir && slug ? `${baseDir}${sep}${slug}` : ''
                  const displayPath = project.project_path || derivedPath
                  return displayPath ? (
                    <span className="text-xs font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                      {displayPath}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">
                      <FolderOpen size={10} />
                      No project folder set — click the pencil to set one
                    </span>
                  )
                })()}
                <button onClick={() => { setPathInput(project.project_path ?? ''); setEditingPath(true) }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-gray-600" title="Edit project folder">
                  <Pencil size={11} />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {editing ? (
              <div className="flex items-center gap-2">
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
                  {['active', 'paused', 'planning', 'done'].map(s =>
                    <option key={s} value={s}>{s}</option>
                  )}
                </select>
                <button onClick={handleStatusChange}
                  className="text-xs bg-yellow-400 text-gray-900 font-semibold px-2 py-1 rounded hover:bg-yellow-500">Save</button>
                <button onClick={() => setEditing(false)}
                  className="text-xs text-gray-500 px-2 py-1 hover:text-gray-700">Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setEditing(true); setEditStatus(project.status) }}>
                <StatusBadge status={project.status} />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
          <span className="flex items-center gap-1"><Target size={12} /> {missions.length} mission{missions.length !== 1 ? 's' : ''}</span>
          <span className="flex items-center gap-1"><Bot size={12} /> {activeWorkers.length} active bots</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-0.5">
          {(['missions', 'bots', 'logs'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors ${
                tab === t
                  ? 'border-yellow-400 text-yellow-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t === 'missions' ? 'Missions' : t === 'bots' ? 'Bots' : 'Bot Signal'}
              {t === 'bots' && workers.length > 0 && (
                <span className="ml-1.5 bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{workers.length}</span>
              )}
              {t === 'missions' && missions.length > 0 && (
                <span className="ml-1.5 bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{missions.length}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'missions' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              <button onClick={() => setMissionView('list')}
                title="List view"
                className={`p-1.5 rounded-lg border transition-colors ${missionView === 'list' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-400 border-gray-200 hover:text-gray-700'}`}>
                <List size={14} />
              </button>
              <button onClick={() => setMissionView('kanban')}
                title="Kanban view"
                className={`p-1.5 rounded-lg border transition-colors ${missionView === 'kanban' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-400 border-gray-200 hover:text-gray-700'}`}>
                <LayoutGrid size={14} />
              </button>
            </div>
            <button onClick={() => setWizardMission('new')}
              className="flex items-center gap-2 px-3 py-1.5 bg-yellow-400 text-gray-900 font-semibold rounded-lg text-sm hover:bg-yellow-500 transition-colors">
              <Plus size={14} /> New Mission
            </button>
          </div>
          {missions.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
              <FolderKanban size={40} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm mb-3">No missions yet.</p>
              <button onClick={() => setWizardMission('new')}
                className="text-yellow-700 text-sm hover:underline font-medium">
                Create your first mission →
              </button>
            </div>
          ) : missionView === 'kanban' ? (
            <MissionsKanban missions={missions} projectId={id!} onEdit={m => setWizardMission(m)} />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {missions.map(m => (
                <MissionCard key={m.id} mission={m} projectId={id!} project={project}
                  onEdit={m => setWizardMission(m)} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'bots' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Link to="/workers"
              className="flex items-center gap-2 px-3 py-1.5 bg-yellow-400 text-gray-900 font-semibold rounded-lg text-sm hover:bg-yellow-500 transition-colors">
              <Plus size={14} /> Manage Bots
            </Link>
          </div>
          {workers.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
              No bots on this project. <Link to="/workers" className="text-yellow-700 hover:underline font-medium">Deploy one →</Link>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2.5">Stream</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Op</th>
                    <th className="px-4 py-2.5">Model</th>
                    <th className="px-4 py-2.5">Age</th>
                    <th className="px-4 py-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {workers.map(w => {
                    const age = w.stream_age != null
                      ? w.stream_age < 60 ? `${w.stream_age}s` : `${Math.floor(w.stream_age / 60)}m`
                      : '—'
                    return (
                      <tr key={w.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5"><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{w.stream_id}</code></td>
                        <td className="px-4 py-2.5"><StatusBadge status={w.status} mode="worker" /></td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{w.task_id ?? '—'}</td>
                        <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{w.model ?? '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-400">{age}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-400">{w.notes || w.stream_notes || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && <LogViewer filters={{ project_id: id! }} maxHeight="500px" />}

      {wizardMission !== null && (
        <MissionWizard
          projectId={id!}
          project={project}
          initialMission={wizardMission === 'new' ? undefined : wizardMission}
          onClose={() => setWizardMission(null)}
        />
      )}
    </div>
  )
}
