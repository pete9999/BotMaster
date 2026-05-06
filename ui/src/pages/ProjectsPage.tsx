import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FolderKanban, Plus, RefreshCw, ChevronRight,
  RotateCcw, Play, Trash2, Zap, Users, GitBranch, CheckCircle2,
  FolderOpen, Copy, FolderPlus, Pencil,
} from 'lucide-react'
import FolderBrowserInput from '../components/FolderBrowserInput'
import { get } from '../api/client'
import {
  useProjects, useCreateProject, useCreateMission, useCreateTask, useConfig,
  useUpdateProject, useArchiveProject, useRestoreProject,
} from '../api/hooks'
import StatusBadge from '../components/StatusBadge'
import { useToast } from '../components/Toasts'
import type { Project } from '../api/client'
import { PROJECT_TEMPLATES, type ProjectTemplate } from '../data/projectTemplates'

const LEVEL_COLOURS: Record<number, string> = {
  1: 'bg-green-100 text-green-700',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-purple-100 text-purple-700',
  4: 'bg-orange-100 text-orange-700',
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({ t, selected, onSelect }: { t: ProjectTemplate; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect}
      className={`text-left w-full rounded-xl border-2 p-4 transition-all ${
        selected ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-semibold text-sm text-gray-900">{t.label}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${LEVEL_COLOURS[t.level]}`}>
          L{t.level}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-3 leading-relaxed">{t.description}</p>
      <div className="flex items-center gap-3 text-[10px] text-gray-400">
        <span className="flex items-center gap-0.5"><Users size={9} />{t.agents} bot{t.agents > 1 ? 's' : ''}</span>
        <span className="flex items-center gap-0.5"><CheckCircle2 size={9} />{t.tasks.length} tasks</span>
        <span className="flex items-center gap-0.5"><GitBranch size={9} />{t.tech_stack.split(' ')[0]}</span>
      </div>
    </button>
  )
}

// ── Create Modal ──────────────────────────────────────────────────────────────

type ModalTab = 'template' | 'blank'

function CreateModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab]               = useState<ModalTab>('template')
  const [selectedTemplate, setTpl]  = useState<ProjectTemplate | null>(null)
  const [projectName, setName]      = useState('')
  // baseNameForPath tracks ONLY user input / template selection — never modified by collision effect.
  // This prevents the cascade where "API 3" re-collides and becomes "API 3 2".
  const [baseNameForPath, setBaseName] = useState('')
  const [overridePath, setOverride] = useState('')
  const [showOverride, setShowOverride] = useState(false)
  const [error, setError]           = useState('')
  const [creating, setCreating]     = useState(false)
  const [diskExists, setDiskExists] = useState(false)
  const diskCheckTimer              = useRef<ReturnType<typeof setTimeout> | null>(null)

  const createProject = useCreateProject()
  const createMission = useCreateMission()
  const createTask    = useCreateTask()
  const addToast      = useToast()
  const navigate      = useNavigate()
  const { data: config } = useConfig()
  const { data: projects = [] } = useProjects()

  const baseDir = config?.projects_base_dir?.value ?? ''
  const sep = baseDir.includes('/') ? '/' : '\\'
  const defaultRunner = config?.['default_runner']?.value ?? 'ollama'
  const ollamaModel = config?.['ollama_default_model']?.value ?? 'qwen3-coder:latest'
  const claudeModel = config?.['default_model']?.value ?? 'claude-sonnet-4-6'
  function resolvedModel(runner: string) {
    return runner === 'ollama' ? ollamaModel : claudeModel
  }

  const effectiveName = projectName.trim() || selectedTemplate?.label || ''
  // Always derive the slug from the stable base name, not from the collision-modified display name
  const nameForSlug = baseNameForPath.trim() || selectedTemplate?.label || ''
  const slug = nameForSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const autoPath = baseDir && slug ? baseDir + sep + slug : ''

  // Normalize paths for case-insensitive, slash-agnostic comparison
  function normPath(p: string) { return p.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '') }

  function getProjectEffectivePath(p: Project): string {
    if (p.project_path) return p.project_path
    const s = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    return baseDir && s ? baseDir + sep + s : ''
  }

  const existingNorm = projects.map(getProjectEffectivePath).filter(Boolean).map(normPath)

  // Returns { path, n } — n is the collision suffix number, or null if no collision
  function findFreeSlot(base: string): { path: string; n: number | null } {
    if (!existingNorm.includes(normPath(base)) && !diskExists) return { path: base, n: null }
    let i = 2
    while (existingNorm.includes(normPath(`${base}-${i}`))) i++
    return { path: `${base}-${i}`, n: i }
  }

  // Debounce disk-existence check on autoPath (always based on original slug, not collision-modified)
  useEffect(() => {
    setDiskExists(false)
    if (!autoPath) return
    if (diskCheckTimer.current) clearTimeout(diskCheckTimer.current)
    diskCheckTimer.current = setTimeout(async () => {
      try {
        const res = await get<{ exists: boolean }>(`/api/fs/check?path=${encodeURIComponent(autoPath)}`)
        setDiskExists(res.exists)
      } catch { /* ignore */ }
    }, 300)
    return () => { if (diskCheckTimer.current) clearTimeout(diskCheckTimer.current) }
  }, [autoPath])

  const { path: suggestedPath, n: collisionN } = autoPath ? findFreeSlot(autoPath) : { path: '', n: null }
  const hasCollision = !!(autoPath && (existingNorm.includes(normPath(autoPath)) || diskExists))

  // When collision detected, update display name using baseNameForPath (not projectName).
  // Using projectName here would cause a cascade: "API 3" re-collides → "API 3 2" → etc.
  useEffect(() => {
    if (!hasCollision || !collisionN) return
    const base = baseNameForPath.trim() || selectedTemplate?.label || ''
    if (!base) return
    const suffix = ` ${collisionN}`
    if (!base.endsWith(suffix)) setName(base + suffix)
  }, [hasCollision, collisionN])

  const effectivePath = showOverride && overridePath.trim()
    ? overridePath.trim()
    : suggestedPath

  const submitDisabled = baseDir && !effectivePath

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!effectiveName) { setError('Project name is required'); return }
    if (tab === 'template' && !selectedTemplate) { setError('Pick a template or switch to Blank'); return }
    setCreating(true)
    try {
      // 1. Create project
      const proj = await createProject.mutateAsync({
        name: effectiveName,
        description: tab === 'template' ? selectedTemplate!.description : '',
        status: 'planning',
        project_path: effectivePath,
      } as any)

      // 2. If template: create mission + tasks
      if (tab === 'template' && selectedTemplate) {
        const mission = await createMission.mutateAsync({
          project_id: proj.id,
          name: selectedTemplate.mission_name,
          description: selectedTemplate.mission_description,
          success_criteria: selectedTemplate.mission_success_criteria,
          tech_notes: selectedTemplate.mission_tech_notes,
          model_hint: selectedTemplate.model_hint,
          git_enabled: true,
          branch_prefix: 'feature/',
          worktree_base: effectivePath || '',
          status: 'active',
        } as any)

        // Build tasks with actual depends_on IDs resolved after creation
        const createdTaskIds: string[] = []
        for (const t of selectedTemplate.tasks) {
          const depIds = t.depends_on_index.map(i => createdTaskIds[i]).filter(Boolean)
          const task = await createTask.mutateAsync({
            project_id: proj.id,
            mission_id: mission.id,
            title: t.title,
            description: t.description,
            priority: t.priority,
            runner_type: defaultRunner,
            model_hint: resolvedModel(defaultRunner),
            depends_on: depIds,
            status: 'queued',
          } as any)
          createdTaskIds.push(task.id)
        }

        addToast(`"${proj.name}" created with ${selectedTemplate.tasks.length} tasks`, 'success')
        onClose()
        navigate(`/projects/${proj.id}/missions/${mission.id}`)
      } else {
        addToast(`"${proj.name}" created`, 'success')
        onClose()
        navigate(`/projects/${proj.id}`)
      }
    } catch (err: any) {
      const msg = err.message ?? 'Failed to create project'
      setError(msg)
      addToast(msg)
    } finally {
      setCreating(false)
    }
  }

  const busy = creating || createProject.isPending || createMission.isPending || createTask.isPending

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-gray-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-950 rounded-t-xl flex-shrink-0">
          <div className="flex items-center gap-2">
            <FolderKanban size={16} className="text-yellow-400" />
            <h2 className="font-bold text-white">New Project</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* ── Top section: name + folder (always visible) ── */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Project name *
                </label>
                <input value={projectName}
                  onChange={e => { setName(e.target.value); setBaseName(e.target.value) }}
                  placeholder={selectedTemplate?.label || 'My Project'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
              </div>

              {/* Folder preview */}
              <div>
                {!baseDir ? (
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Set Projects Base Dir in Settings first
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {hasCollision && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        That name/folder already exists — renamed to <span className="font-semibold">{effectiveName}</span> and folder to <span className="font-mono font-semibold">{suggestedPath}</span>
                      </p>
                    )}
                    <div className="bg-gray-100 rounded-lg px-3 py-2 font-mono text-[11px] text-gray-500">
                      Will be created at: <span className="text-gray-700">{effectivePath || '—'}</span>
                    </div>
                    <button type="button" onClick={() => setShowOverride(v => !v)}
                      className="text-[11px] text-gray-400 hover:text-yellow-700 underline underline-offset-2">
                      {showOverride ? 'Use auto path' : 'Use different path'}
                    </button>
                    {showOverride && (
                      <FolderBrowserInput
                        value={overridePath}
                        onChange={setOverride}
                        placeholder={suggestedPath || 'D:\\Dev\\Projects\\my-project'}
                        inputClassName="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400 min-w-0"
                        offerCreate
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Tab bar ── */}
            <div className="flex border-b border-gray-200 -mx-6 px-6">
              <button type="button" onClick={() => setTab('template')}
                className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === 'template' ? 'border-yellow-400 text-yellow-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                <Zap size={13} /> Start from template
              </button>
              <button type="button" onClick={() => setTab('blank')}
                className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === 'blank' ? 'border-yellow-400 text-yellow-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                <Plus size={13} /> Blank project
              </button>
            </div>

            {/* Template picker */}
            {tab === 'template' && (
              <>
                <p className="text-xs text-gray-500">
                  Pick a starter — creates the project, mission, and all objectives ready for planning. Work through the full bot flow from the start.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {PROJECT_TEMPLATES.map(t => (
                    <TemplateCard key={t.id} t={t}
                      selected={selectedTemplate?.id === t.id}
                      onSelect={() => { setTpl(t); setName(t.label); setBaseName(t.label) }} />
                  ))}
                </div>
                {selectedTemplate && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800 space-y-1">
                    <p className="font-semibold">What this tests</p>
                    <p>{selectedTemplate.why}</p>
                  </div>
                )}
              </>
            )}

            {/* Blank project */}
            {tab === 'blank' && (
              <p className="text-xs text-gray-500">
                Create an empty project — then add a mission and objectives from the project page.
              </p>
            )}

          </div>

          {error && <p className="mx-6 text-sm text-red-600 bg-red-50 rounded px-3 py-2 flex-shrink-0">{error}</p>}

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={busy || !!submitDisabled}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-yellow-400 text-gray-900 font-semibold rounded-lg hover:bg-yellow-500 disabled:opacity-50">
              {busy && <RefreshCw size={14} className="animate-spin" />}
              {tab === 'template' && selectedTemplate
                ? `Create & Plan "${effectiveName || selectedTemplate.label}" →`
                : 'Create Project →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Confirm trash ─────────────────────────────────────────────────────────────

function ConfirmTrash({ project, onConfirm, onCancel }: { project: Project; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-gray-200">
        <div className="px-6 py-5 space-y-3">
          <div className="flex items-center gap-2">
            <Trash2 size={18} className="text-red-500 flex-shrink-0" />
            <h3 className="font-bold text-gray-900">Move to Trash?</h3>
          </div>
          <p className="text-sm text-gray-600">
            <span className="font-semibold">"{project.name}"</span> will be moved to Trash.
            All missions, tasks, and history are kept — nothing is deleted. Restore any time.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={onConfirm} className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700">
              <Trash2 size={13} /> Move to Trash
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Project row ───────────────────────────────────────────────────────────────

function ProjectRow({ p, onTrash }: { p: Project; onTrash: (p: Project) => void }) {
  const update   = useUpdateProject()
  const restore  = useRestoreProject()
  const addToast = useToast()
  const { data: config } = useConfig()
  const [editingPath, setEditingPath] = useState(false)
  const [pathInput, setPathInput]     = useState(p.project_path ?? '')
  const isTrashed = !!p.deleted_at
  const isPaused  = p.status === 'paused' && !isTrashed

  // Derived path when no explicit path is set
  const baseDir = config?.projects_base_dir?.value ?? ''
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const sep = baseDir.includes('/') ? '/' : '\\'
  const derivedPath = baseDir && slug ? `${baseDir}${sep}${slug}` : ''
  const displayPath = p.project_path || derivedPath

  function handleResume(e: React.MouseEvent) {
    e.preventDefault()
    update.mutate({ id: p.id, status: 'active' }, { onSuccess: () => addToast(`"${p.name}" resumed`, 'success') })
  }
  function handleRestore(e: React.MouseEvent) {
    e.preventDefault()
    restore.mutate(p.id, { onSuccess: () => addToast(`"${p.name}" restored`, 'success') })
  }
  function handleTrash(e: React.MouseEvent) {
    e.preventDefault()
    onTrash(p)
  }
  function handleSavePath(e: React.MouseEvent) {
    e.preventDefault()
    update.mutate({ id: p.id, project_path: pathInput.trim() } as any, {
      onSuccess: () => { addToast('Folder updated', 'success'); setEditingPath(false) }
    })
  }
  function startEditPath(e: React.MouseEvent) {
    e.preventDefault()
    setPathInput(p.project_path ?? '')
    setEditingPath(true)
  }
  function cancelEditPath(e: React.MouseEvent) {
    e.preventDefault()
    setEditingPath(false)
  }

  const inner = (
    <div className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border mt-0.5 ${
        isTrashed ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
      }`}>
        {isTrashed ? <Trash2 size={16} className="text-red-400" /> : <FolderKanban size={18} className="text-yellow-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm truncate ${isTrashed ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{p.name}</p>
        <p className="text-xs text-gray-400 truncate mt-0.5">{p.tech_stack || p.description || 'No briefing'}</p>

        {/* Folder row */}
        {!isTrashed && (
          editingPath ? (
            <div className="flex items-center gap-1.5 mt-1.5" onClick={e => e.preventDefault()}>
              <FolderBrowserInput
                value={pathInput}
                onChange={setPathInput}
                placeholder={derivedPath || 'D:\\Dev\\Projects\\my-project'}
                inputClassName="border border-yellow-400 rounded px-2 py-1 text-xs font-mono w-72 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
              <button onClick={handleSavePath}
                className="p-1 text-green-600 hover:text-green-700 flex-shrink-0"><CheckCircle2 size={14} /></button>
              <button onClick={cancelEditPath}
                className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">✕</button>
            </div>
          ) : (
            <div className="flex items-center gap-1 mt-1 group/path">
              <FolderOpen size={10} className="text-gray-300 flex-shrink-0" />
              {displayPath ? (
                <span className={`text-[11px] font-mono truncate max-w-sm ${p.project_path ? 'text-gray-400' : 'text-gray-300 italic'}`}>
                  {displayPath}{!p.project_path && ' (auto)'}
                </span>
              ) : (
                <span className="text-[11px] text-amber-500 italic">No folder set</span>
              )}
              <button onClick={startEditPath}
                className="opacity-0 group-hover/path:opacity-100 transition-opacity ml-1 text-gray-300 hover:text-yellow-600 flex-shrink-0" title="Set folder">
                <Pencil size={10} />
              </button>
            </div>
          )
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
        <StatusBadge status={p.status} />
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {isTrashed
            ? <button onClick={handleRestore} disabled={restore.isPending}
                className="flex items-center gap-1 text-xs bg-green-600 text-white px-2 py-1 rounded-md hover:bg-green-700 disabled:opacity-50">
                <RotateCcw size={10} /> Restore
              </button>
            : <>
                {isPaused && (
                  <button onClick={handleResume} disabled={update.isPending}
                    className="flex items-center gap-1 text-xs bg-yellow-400 text-gray-900 font-semibold px-2 py-1 rounded-md hover:bg-yellow-500 disabled:opacity-50">
                    <Play size={10} /> Resume
                  </button>
                )}
                <button onClick={handleTrash}
                  className="flex items-center gap-1 text-xs text-gray-400 border border-gray-200 px-2 py-1 rounded-md hover:bg-red-50 hover:text-red-600 hover:border-red-200">
                  <Trash2 size={10} /> Trash
                </button>
              </>
          }
        </div>
        {!isTrashed && <ChevronRight size={14} className="text-gray-300 group-hover:text-yellow-500 flex-shrink-0" />}
      </div>
    </div>
  )

  if (isTrashed) return <div className="opacity-60">{inner}</div>
  return <Link to={`/projects/${p.id}`}>{inner}</Link>
}

// ── Main page ─────────────────────────────────────────────────────────────────

const STATUS_FILTERS = ['all', 'planning', 'active', 'paused', 'done', 'archived', 'trash'] as const
type Filter = typeof STATUS_FILTERS[number]

export default function ProjectsPage() {
  const [showModal, setShowModal]         = useState(false)
  const [filter, setFilter]               = useState<Filter>('all')
  const [trashTarget, setTrashTarget]     = useState<Project | null>(null)
  const showTrash = filter === 'trash'
  const { data: projects = [], isLoading } = useProjects(showTrash)
  const archive  = useArchiveProject()
  const addToast = useToast()

  function handleConfirmTrash() {
    if (!trashTarget) return
    archive.mutate(trashTarget.id, { onSuccess: () => addToast(`"${trashTarget.name}" moved to Trash`, 'info') })
    setTrashTarget(null)
  }

  const live    = projects.filter(p => !p.deleted_at)
  const trashed = projects.filter(p => !!p.deleted_at)

  const visible: Project[] = showTrash ? trashed
    : filter === 'all' ? live
    : live.filter(p => p.status === filter)

  const counts: Record<Filter, number> = {
    all:      live.length,
    planning: live.filter(p => p.status === 'planning').length,
    active:   live.filter(p => p.status === 'active').length,
    paused:   live.filter(p => p.status === 'paused').length,
    done:     live.filter(p => p.status === 'done').length,
    archived: live.filter(p => p.status === 'archived').length,
    trash:    trashed.length,
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 flex-wrap">
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                filter === s
                  ? s === 'trash' ? 'bg-red-500 text-white' : 'bg-yellow-400 text-gray-900'
                  : s === 'trash' ? 'text-red-400 hover:text-red-600' : 'text-gray-500 hover:text-gray-900'
              }`}>
              {s === 'trash' && <Trash2 size={10} />}
              {s} {counts[s] > 0 && <span className="opacity-70">{counts[s]}</span>}
            </button>
          ))}
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-yellow-400 text-gray-900 font-semibold rounded-lg text-sm hover:bg-yellow-500">
          <Plus size={14} /> New Project
        </button>
      </div>

      {showTrash && trashed.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <Trash2 size={14} className="flex-shrink-0" />
          Projects in Trash are never permanently deleted. Restore any time.
        </div>
      )}

      {isLoading && <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>}

      {!isLoading && visible.length === 0 && (
        <div className="text-center py-16">
          {showTrash
            ? <><Trash2 size={40} className="text-gray-200 mx-auto mb-3" /><p className="text-gray-400 text-sm">Trash is empty.</p></>
            : <><FolderKanban size={40} className="text-gray-300 mx-auto mb-3" /><p className="text-gray-500 text-sm mb-3">{filter === 'all' ? 'No projects yet.' : `No ${filter} projects.`}</p></>
          }
          {filter === 'all' && (
            <button onClick={() => setShowModal(true)} className="text-yellow-700 text-sm hover:underline font-medium">
              Create your first project →
            </button>
          )}
        </div>
      )}

      {!isLoading && visible.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {visible.map(p => <ProjectRow key={p.id} p={p} onTrash={setTrashTarget} />)}
        </div>
      )}

      {trashTarget && <ConfirmTrash project={trashTarget} onConfirm={handleConfirmTrash} onCancel={() => setTrashTarget(null)} />}
      {showModal && <CreateModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
