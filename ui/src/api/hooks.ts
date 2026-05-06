import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { get, post, patch, del, createEventSource } from './client'
import type {
  Project, Task, Worker, Mission, LogEntry, ConfigEntry, SysStatus, EventSourceLike,
  BotEvent, Review, ReviewFlag, QualitySummary, MissionQuestion, ObjectiveTemplate, AuditEntry,
  WorkerTranscript,
} from './client'

// ── Projects ─────────────────────────────────────────────────────────────────
export const useProjects = (includeDeleted = false) =>
  useQuery({
    queryKey: ['projects', { includeDeleted }],
    queryFn: () => get<Project[]>(includeDeleted ? '/api/projects?include_deleted=true' : '/api/projects'),
    refetchInterval: 15000,
  })

export const useProject = (id: string) =>
  useQuery({ queryKey: ['project', id], queryFn: () => get<Project & { tasks: Task[]; missions: Mission[] }>(`/api/projects/${id}`), refetchInterval: 10000, enabled: !!id })

export const useCreateProject = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Project>) => post<Project>('/api/projects', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export const useUpdateProject = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Project>) =>
      patch<Project>(`/api/projects/${id}`, body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['project', vars.id] })
    },
  })
}

export const useArchiveProject = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del<Project>(`/api/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export const useRestoreProject = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<Project>(`/api/projects/${id}/restore`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

// ── Missions ──────────────────────────────────────────────────────────────────
export const useMissions = (projectId?: string) =>
  useQuery({
    queryKey: ['missions', projectId],
    queryFn: () => get<Mission[]>(`/api/missions${projectId ? '?project_id=' + projectId : ''}`),
    refetchInterval: 10000,
    enabled: !!projectId,
  })

export const useMission = (id: string) =>
  useQuery({
    queryKey: ['mission', id],
    queryFn: () => get<Mission & { tasks: Task[] }>(`/api/missions/${id}`),
    refetchInterval: 3000,
    enabled: !!id,
  })

export const useCreateMission = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Mission> & { project_id: string; name: string }) =>
      post<Mission>('/api/missions', body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['missions', vars.project_id] })
      qc.invalidateQueries({ queryKey: ['project', vars.project_id] })
    },
  })
}

export const useUpdateMission = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, project_id, ...body }: { id: string; project_id: string } & Partial<Mission>) =>
      patch<Mission>(`/api/missions/${id}`, body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['missions', vars.project_id] })
      qc.invalidateQueries({ queryKey: ['mission', vars.id] })
    },
  })
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const useTasks = (params?: { project_id?: string; status?: string; mission_id?: string }) => {
  const qs = new URLSearchParams()
  if (params?.project_id) qs.set('project_id', params.project_id)
  if (params?.status) qs.set('status', params.status)
  if (params?.mission_id) qs.set('mission_id', params.mission_id)
  const q = qs.toString()
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => get<Task[]>(`/api/tasks${q ? '?' + q : ''}`),
    refetchInterval: 3000,
  })
}

export const useNextTask = (project_id?: string) =>
  useQuery({
    queryKey: ['tasks', 'next', project_id],
    queryFn: () => get<Task|null>(`/api/tasks/next${project_id ? '?project_id=' + project_id : ''}`),
    refetchInterval: 10000,
  })

export const useCreateTask = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Task> & { project_id: string; title: string; mission_id?: string }) =>
      post<Task>('/api/tasks', body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['project', vars.project_id] })
      if (vars.mission_id) qc.invalidateQueries({ queryKey: ['mission', vars.mission_id] })
    },
  })
}

export const useUpdateTask = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Task>) =>
      patch<Task>(`/api/tasks/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

// ── Workers ──────────────────────────────────────────────────────────────────
export const useWorkers = (params?: { project_id?: string; status?: string; mission_id?: string }) => {
  const qs = new URLSearchParams()
  if (params?.project_id) qs.set('project_id', params.project_id)
  if (params?.status) qs.set('status', params.status)
  if (params?.mission_id) qs.set('mission_id', params.mission_id)
  const q = qs.toString()
  return useQuery({
    queryKey: ['workers', params],
    queryFn: () => get<Worker[]>(`/api/workers${q ? '?' + q : ''}`),
    refetchInterval: 2000,
  })
}

export const useCreateWorker = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Worker> & { project_id: string; stream_id: string }) =>
      post<Worker>('/api/workers', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers'] }),
  })
}

export const useSpawnWorker = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<{ status: string; steps: string[]; errors: string[] }>(`/api/workers/${id}/spawn`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers'] }),
  })
}

export const useKillWorker = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<{ killed: boolean; message: string }>(`/api/workers/${id}/kill`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['missions'] })
    },
  })
}

export const useWorkerTranscript = (workerId: string, enabled = true) =>
  useQuery({
    queryKey: ['worker-transcript', workerId],
    queryFn: () => get<WorkerTranscript>(`/api/workers/${workerId}/transcript?tail=2000`),
    refetchInterval: enabled ? 2000 : false,
    enabled: !!workerId && enabled,
  })

// ── Logs (SSE) ────────────────────────────────────────────────────────────────
export function useLogStream(params?: {
  level?: string; project_id?: string; stream_id?: string; source?: string
}, maxEntries = 500) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSourceLike | null>(null)

  useEffect(() => {
    const qs = new URLSearchParams()
    if (params?.level) qs.set('level', params.level)
    if (params?.project_id) qs.set('project_id', params.project_id)
    if (params?.stream_id) qs.set('stream_id', params.stream_id)
    if (params?.source) qs.set('source', params.source)
    const url = `/api/logs/stream${qs.toString() ? '?' + qs.toString() : ''}`

    const es = createEventSource(url)
    esRef.current = es
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      const entry: LogEntry = JSON.parse(e.data)
      setLogs(prev => {
        const next = [...prev, entry]
        return next.length > maxEntries ? next.slice(next.length - maxEntries) : next
      })
    }
    return () => { es.close(); esRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.level, params?.project_id, params?.stream_id, params?.source])

  return { logs, connected, clear: () => setLogs([]) }
}

// ── Config ────────────────────────────────────────────────────────────────────
export const useConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => get<Record<string, ConfigEntry>>('/api/config') })

export const useUpdateConfig = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, string>) => patch<{ updated: string[] }>('/api/config', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

// ── System status ─────────────────────────────────────────────────────────────
export const useSysStatus = () =>
  useQuery({ queryKey: ['status'], queryFn: () => get<SysStatus>('/api/status'), refetchInterval: 10000 })

// ── Bot Events ────────────────────────────────────────────────────────────────
export const useBotEvents = (params?: { worker_id?: string; task_id?: string; project_id?: string; mission_id?: string; model?: string; limit?: number }) => {
  const qs = new URLSearchParams()
  if (params?.worker_id) qs.set('worker_id', params.worker_id)
  if (params?.task_id) qs.set('task_id', params.task_id)
  if (params?.project_id) qs.set('project_id', params.project_id)
  if (params?.mission_id) qs.set('mission_id', params.mission_id)
  if (params?.model) qs.set('model', params.model)
  if (params?.limit) qs.set('limit', String(params.limit))
  const q = qs.toString()
  return useQuery({
    queryKey: ['bot_events', params],
    queryFn: () => get<BotEvent[]>(`/api/bot_events${q ? '?' + q : ''}`),
    refetchInterval: 15000,
  })
}

export const useRecordBotEvent = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<BotEvent> & { event_type: string }) =>
      post<BotEvent>('/api/bot_events', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bot_events'] }),
  })
}

// ── Reviews ───────────────────────────────────────────────────────────────────
export const useReviews = (params?: { task_id?: string; project_id?: string; mission_id?: string }) => {
  const qs = new URLSearchParams()
  if (params?.task_id) qs.set('task_id', params.task_id)
  if (params?.project_id) qs.set('project_id', params.project_id)
  if (params?.mission_id) qs.set('mission_id', params.mission_id)
  const q = qs.toString()
  return useQuery({
    queryKey: ['reviews', params],
    queryFn: () => get<Review[]>(`/api/reviews${q ? '?' + q : ''}`),
    refetchInterval: 15000,
  })
}

export const useCreateReview = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { task_id: string; rating: number; notes?: string; flags?: ReviewFlag[]; model?: string; project_id?: string; mission_id?: string }) =>
      post<Review>('/api/reviews', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] })
      qc.invalidateQueries({ queryKey: ['quality_summary'] })
    },
  })
}

export const useUpdateReview = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<Review>) =>
      patch<Review>(`/api/reviews/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] })
      qc.invalidateQueries({ queryKey: ['quality_summary'] })
    },
  })
}

// ── Mission questions & start ─────────────────────────────────────────────────
export const useMissionQuestions = (missionId: string) =>
  useQuery({
    queryKey: ['mission_questions', missionId],
    queryFn: () => get<MissionQuestion[]>(`/api/missions/${missionId}/questions`),
    refetchInterval: 10000,
    enabled: !!missionId,
  })

export const useStartMissionBot = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { missionId: string; suffix?: string; stream_id?: string; model?: string; notes?: string; spawn?: boolean; runner_type?: string; task_id?: string }) => {
      const { missionId, ...rest } = body
      return post<Worker>(`/api/missions/${missionId}/start`, rest)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['missions'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export const useReplyToQuestion = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ targetStream, code, message, fromStream }: { targetStream: string; code: string; message: string; fromStream: string }) =>
      post<unknown>(`/api/streams/${targetStream}/inbox`, { from_stream: fromStream, code, message }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mission_questions'] })
    },
  })
}

// ── AI assist ─────────────────────────────────────────────────────────────────
export const useAiSuggestMission = () =>
  useMutation({
    mutationFn: (body: {
      project_name: string; tech_stack: string
      mission_name: string; description: string; success_criteria: string
    }) => post<{ briefing: string }>('/api/ai/suggest-mission', body),
  })

// ── Quality summary ───────────────────────────────────────────────────────────
export const useQualitySummary = (project_id?: string) =>
  useQuery({
    queryKey: ['quality_summary', project_id],
    queryFn: () => get<QualitySummary>(`/api/quality/summary${project_id ? '?project_id=' + project_id : ''}`),
    refetchInterval: 30000,
  })

// ── Mission plan review & report ──────────────────────────────────────────────
export const useReviewMissionPlan = () =>
  useMutation({
    mutationFn: ({ missionId, priorAnswers }: { missionId: string; priorAnswers?: import('./client').PlanQAQuestion[] }) =>
      post<import('./client').PlanQA>(`/api/missions/${missionId}/review-plan`, { prior_answers: priorAnswers ?? [] }),
  })

export const useImproveTaskPrompt = () =>
  useMutation({
    mutationFn: ({ taskId, current_description, steer }: { taskId: string; current_description?: string; steer?: string }) =>
      post<{ improved: string; reasoning: string }>(`/api/tasks/${taskId}/improve-prompt`, { current_description, steer }),
  })

export const useReviewObjective = () =>
  useMutation({
    mutationFn: ({ taskId, prior_answers }: { taskId: string; prior_answers?: import('./client').ObjQuestion[] }) =>
      post<{ analysis: string; questions: import('./client').ObjQuestion[] }>(`/api/tasks/${taskId}/review-objective`, { prior_answers }),
  })

export const useMissionReport = (missionId: string) =>
  useQuery({
    queryKey: ['mission_report', missionId],
    queryFn: () => get<import('./client').MissionReport>(`/api/missions/${missionId}/report`),
    enabled: !!missionId,
    refetchInterval: 30000,
  })

// ── Objective Templates ────────────────────────────────────────────────────────
export const useObjectiveTemplates = (params?: { search?: string }) => {
  const qs = new URLSearchParams()
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()
  return useQuery({
    queryKey: ['objective_templates', params],
    queryFn: () => get<ObjectiveTemplate[]>(`/api/objective-templates${q ? '?' + q : ''}`),
    refetchInterval: 60000,
  })
}

export const useCreateObjectiveTemplate = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<ObjectiveTemplate> & { title: string }) =>
      post<ObjectiveTemplate>('/api/objective-templates', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objective_templates'] }),
  })
}

export const useSaveTaskAsTemplate = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, tags }: { taskId: string; tags?: string[] }) =>
      post<ObjectiveTemplate>(`/api/tasks/${taskId}/save-as-template`, { tags: tags ?? [] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objective_templates'] }),
  })
}

export const useRecordTemplateUse = () =>
  useMutation({
    mutationFn: (templateId: string) =>
      post<ObjectiveTemplate>(`/api/objective-templates/${templateId}/use`, {}),
  })

// ── Audit Log ─────────────────────────────────────────────────────────────────
export const useAuditLog = (params?: { project_id?: string; mission_id?: string; entity_type?: string; limit?: number }) => {
  const qs = new URLSearchParams()
  if (params?.project_id)  qs.set('project_id',  params.project_id)
  if (params?.mission_id)  qs.set('mission_id',  params.mission_id)
  if (params?.entity_type) qs.set('entity_type', params.entity_type)
  if (params?.limit)       qs.set('limit',       String(params.limit))
  const q = qs.toString()
  return useQuery({
    queryKey: ['audit_log', params],
    queryFn: () => get<AuditEntry[]>(`/api/audit-log${q ? '?' + q : ''}`),
    refetchInterval: 15000,
    enabled: !!(params?.project_id || params?.mission_id),
  })
}
