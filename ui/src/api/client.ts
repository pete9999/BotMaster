import { mockGet, mockPost, mockPatch, mockDel, MockEventSource } from './mock/index'

export const IS_MOCK =
  localStorage.getItem('factory_mock_mode') === 'true' ||
  import.meta.env.VITE_MOCK === 'true'

const BASE = import.meta.env.VITE_API_URL ?? ''

const FETCH_TIMEOUT_MS = 8000

async function _fetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
      signal: controller.signal,
      ...opts,
    })
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') throw new Error('Hub timed out — is it running on port 9100?')
    throw new Error('Cannot reach Hub — is the hub running on port 9100?')
  }
  clearTimeout(timer)
  if (!res.ok) {
    if (res.status === 502 || res.status === 504) {
      throw new Error('Hub not responding — hub may not be running on port 9100')
    }
    if (res.status === 404) {
      const err = await res.json().catch(() => ({ detail: 'Not found' }))
      throw new Error(err.detail ?? 'Not found')
    }
    if (res.status === 409) {
      const err = await res.json().catch(() => ({ detail: 'Conflict' }))
      throw new Error(err.detail ?? 'Already exists')
    }
    const err = await res.json().catch(() => ({ detail: `Server error (${res.status})` }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function get<T>(path: string): Promise<T> {
  return IS_MOCK ? mockGet<T>(path) : _fetch<T>(path)
}
export async function post<T>(path: string, body: unknown): Promise<T> {
  return IS_MOCK ? mockPost<T>(path, body) : _fetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
}
export interface ObjQuestion { topic: string; question: string; context: string; answer: string }

export async function improveTaskPrompt(taskId: string, body: { current_description?: string; steer?: string }): Promise<{ improved: string; reasoning: string }> {
  return post(`/api/tasks/${taskId}/improve-prompt`, body)
}
export async function reviewObjective(taskId: string, body: { prior_answers?: ObjQuestion[] }): Promise<{ analysis: string; questions: ObjQuestion[] }> {
  return post(`/api/tasks/${taskId}/review-objective`, body)
}
export async function patch<T>(path: string, body: unknown): Promise<T> {
  return IS_MOCK ? mockPatch<T>(path, body) : _fetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}
export async function del<T>(path: string): Promise<T> {
  return IS_MOCK ? mockDel<T>(path) : _fetch<T>(path, { method: 'DELETE' })
}

// Returned by both the real EventSource and MockEventSource
export interface EventSourceLike {
  onopen:    ((e: Event) => void) | null
  onmessage: ((e: MessageEvent) => void) | null
  onerror:   ((e: Event) => void) | null
  close(): void
}

export function createEventSource(url: string): EventSourceLike {
  return IS_MOCK ? new MockEventSource(url) : new EventSource(url)
}

export type Status      = 'ok'|'warning'|'urgent'|'stale'|'stopped'|'unknown'
export type TaskStatus  = 'queued'|'in_progress'|'blocked'|'review'|'done'
export type WorkerStatus = 'pending'|'starting'|'active'|'idle'|'stuck'|'done'|'failed'|'killed'
export type LogLevel    = 'debug'|'info'|'warn'|'error'

export type MissionStage = 'draft' | 'review' | 'approved' | 'running' | 'complete'
export interface PlanQAQuestion { topic: string; question: string; context: string; answer: string }
export interface PlanQA { analysis: string; questions: PlanQAQuestion[]; reviewed_at?: string }
export interface Mission {
  id: string; project_id: string; name: string; description: string
  success_criteria: string; tech_notes: string
  worktree_base: string; branch_prefix: string
  model_hint: string; git_enabled: boolean
  status: string; stage: MissionStage; plan_qa: PlanQA | null; final_prompt: string | null
  created_at: string; updated_at: string
  tasks?: Task[]
}
export interface Project {
  id: string; name: string; description: string; tech_stack: string
  status: string; project_path?: string; created_at: string; updated_at: string
  deleted_at?: string | null
  missions?: Mission[]
}
export interface Task {
  id: string; project_id: string; title: string; description: string
  stream_id: string|null; branch: string|null; status: TaskStatus
  priority: number; model_hint: string|null; depends_on: string[]
  cost_tokens: number; created_at: string; updated_at: string
  started_at: string|null; completed_at: string|null; notes: string
  mission_id?: string | null
  runner_type?: string
  working_dir?: string | null
  folder_mode?: string | null
  git_repo?: string | null
}
export interface Worker {
  id: string; project_id: string; task_id: string|null; stream_id: string
  status: WorkerStatus; model: string|null; worktree_path: string|null
  branch: string|null; git_root: string|null; pid: number|null
  spawned_by: string; created_at: string; updated_at: string
  started_at: string|null; completed_at: string|null; notes: string
  mission_id?: string | null
  runner_type?: string
  transcript_path?: string | null
  // enriched
  stream_status?: Status; stream_age?: number; stream_notes?: string
  session_active?: boolean; current_task_meta?: string
}
export interface WorkerTranscript {
  worker_id: string; stream_id: string; status: string
  transcript_path: string; available: boolean
  lines: string[]; total_lines: number
}
export interface LogEntry {
  id: number; timestamp: string; level: LogLevel; source: string
  project_id: string|null; task_id: string|null; stream_id: string|null
  message: string
}
export interface ConfigEntry { value: string; description: string; updated_at: string }
export interface SysStatus {
  uptime_seconds: number; active_projects: number
  workers: Record<string, number>; tasks: Record<string, number>
  log_entries: number; python_version: string; platform: string
}
export interface MissionQuestion {
  id: number; target_stream: string; from_stream: string
  code: string; message: string; status: string
  sent_at: string; resolved_at: string | null
  stream_id: string
}
export interface BotEvent {
  id: number; worker_id: string|null; task_id: string|null
  project_id: string|null; mission_id: string|null
  event_type: string; model: string|null
  prompt_tokens: number; completion_tokens: number
  content: Record<string, unknown>; created_at: string
}
export type ReviewFlag = 'exemplary'|'hallucination'|'code_error'|'incomplete'|'off_track'
export interface Review {
  id: number; task_id: string; worker_id: string|null
  project_id: string|null; mission_id: string|null; model: string|null
  rating: number; notes: string; flags: ReviewFlag[]
  reviewer: string; created_at: string; updated_at: string
}
export interface QualitySummary {
  total_reviewed: number; unreviewed_done: number; avg_rating: number|null
  by_model: Record<string, { count: number; avg_rating: number|null; flags: Record<string, number> }>
}
export type PlanReviewQuestion = PlanQAQuestion
export type PlanReview = PlanQA
export interface MissionReportTask {
  id: string; title: string; status: string; model_hint: string|null
  cost_tokens: number; started_at: string|null; completed_at: string|null
  notes: string; depends_on_count: number
}
export interface ObjectiveTemplate {
  id: string; title: string; description: string; model_hint: string
  tags: string[]; source_mission_id: string | null; source_task_id: string | null
  use_count: number; created_at: string; updated_at: string
}
export interface AuditEntry {
  id: number; timestamp: string; event_type: string; entity_type: string
  entity_id: string | null; actor: string; project_id: string | null
  mission_id: string | null; details: Record<string, unknown>
}
export interface MissionReport {
  mission_id: string; mission_name: string; project_name: string|null; tech_stack: string|null
  description: string; success_criteria: string; status: string
  created_at: string; updated_at: string
  total_tasks: number; done_tasks: number; incomplete_tasks: number
  total_tokens: number; total_workers: number; bot_events_count: number
  model_stats: Record<string, { tasks_completed: number; prompt_tokens: number; completion_tokens: number; events: number }>
  avg_rating: number|null; reviews_count: number
  quality_flags: Record<string, number>
  tasks: MissionReportTask[]
}
