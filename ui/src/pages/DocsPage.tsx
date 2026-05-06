import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '../api/client'
import {
  BookOpen, Database, Server, Monitor, Bot, ArrowRight,
  ChevronDown, ChevronRight, RefreshCw, Layers, Zap,
} from 'lucide-react'

// ── Schema fetcher ────────────────────────────────────────────────────────────

interface SchemaColumn { cid: number; name: string; type: string; notnull: boolean; default: string | null; pk: boolean }
interface SchemaTable  { name: string; sql: string; row_count: number; columns: SchemaColumn[] }
interface SchemaResult { tables: SchemaTable[]; db_path: string }

function SchemaView() {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const { data, isLoading, isError, refetch } = useQuery<SchemaResult>({
    queryKey: ['schema'],
    queryFn: () => get('/api/schema'),
    staleTime: 60_000,
  })

  function toggle(name: string) {
    setOpen(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  if (isLoading) return <div className="text-center py-12 text-gray-400 text-sm">Loading schema…</div>
  if (isError)   return <div className="text-center py-12 text-red-400 text-sm">Hub not reachable — start the hub to view the live schema.</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 font-mono">{data!.db_path}</p>
          <p className="text-xs text-gray-400 mt-0.5">{data!.tables.length} tables</p>
        </div>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {data!.tables.map(t => (
        <div key={t.name} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button onClick={() => toggle(t.name)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
            {open.has(t.name) ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
            <span className="font-mono font-semibold text-sm text-gray-800">{t.name}</span>
            <span className="text-xs text-gray-400">{t.columns.length} cols</span>
            <span className="ml-auto text-xs text-gray-400">{t.row_count.toLocaleString()} rows</span>
          </button>

          {open.has(t.name) && (
            <div className="border-t border-gray-100">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase text-gray-400">
                  <tr>
                    <th className="px-4 py-2 text-left">Column</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left">Constraints</th>
                    <th className="px-4 py-2 text-left">Default</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {t.columns.map(col => (
                    <tr key={col.cid} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono font-medium text-gray-800 flex items-center gap-1.5">
                        {col.pk && <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1 py-0.5 rounded font-bold">PK</span>}
                        {col.name}
                      </td>
                      <td className="px-4 py-2 font-mono text-blue-600">{col.type || '—'}</td>
                      <td className="px-4 py-2 text-gray-400">{col.notnull ? 'NOT NULL' : ''}</td>
                      <td className="px-4 py-2 font-mono text-gray-400">{col.default ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Architecture diagram nodes ────────────────────────────────────────────────

function Box({ title, sub, colour, icon }: { title: string; sub: string; colour: string; icon: React.ReactNode }) {
  return (
    <div className={`rounded-xl border-2 px-4 py-3 min-w-[140px] ${colour}`}>
      <div className="flex items-center gap-2 mb-1">{icon}<span className="font-bold text-sm">{title}</span></div>
      <p className="text-[11px] opacity-70 leading-snug">{sub}</p>
    </div>
  )
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1">
      <div className="w-12 h-px bg-gray-300" />
      <ArrowRight size={12} className="text-gray-400 -mt-1" />
      {label && <span className="text-[9px] text-gray-400 mt-0.5 whitespace-nowrap">{label}</span>}
    </div>
  )
}

function VArrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center my-1">
      <div className="w-px h-5 bg-gray-300" />
      <ChevronDown size={12} className="text-gray-400 -mt-1" />
      {label && <span className="text-[9px] text-gray-400">{label}</span>}
    </div>
  )
}

// ── Architecture page ─────────────────────────────────────────────────────────

function ArchView() {
  return (
    <div className="space-y-8 max-w-4xl">

      {/* Communication diagram */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-800 mb-1">System Architecture</h2>
        <p className="text-xs text-gray-400 mb-6">How the components connect and communicate</p>

        {/* Top row: UI ↔ Hub ↔ Bots */}
        <div className="flex items-center gap-0 mb-6 flex-wrap gap-y-4">
          <Box title="BotMaster UI" sub="Vite + React — port 9200" colour="border-yellow-300 bg-yellow-50"
            icon={<Monitor size={14} className="text-yellow-600" />} />
          <div className="flex flex-col items-center px-2">
            <div className="flex items-center gap-1">
              <div className="w-10 h-px bg-gray-300" />
              <span className="text-[9px] text-gray-400">REST + SSE</span>
              <div className="w-10 h-px bg-gray-300" />
            </div>
            <div className="flex gap-1 text-gray-400 text-[9px] mt-0.5">
              <span>◄──────────────►</span>
            </div>
          </div>
          <Box title="Factory Hub" sub="FastAPI + SQLite — port 9100" colour="border-blue-300 bg-blue-50"
            icon={<Server size={14} className="text-blue-600" />} />
          <div className="flex flex-col items-center px-2">
            <div className="flex items-center gap-1">
              <div className="w-10 h-px bg-gray-300" />
              <span className="text-[9px] text-gray-400">spawn / kill</span>
              <div className="w-10 h-px bg-gray-300" />
            </div>
            <div className="flex gap-1 text-gray-400 text-[9px] mt-0.5">
              <span>───────────────►</span>
            </div>
          </div>
          <Box title="Claude Code Bots" sub="Subprocess per task, PowerShell transcript" colour="border-green-300 bg-green-50"
            icon={<Bot size={14} className="text-green-600" />} />
        </div>

        {/* Bot → Hub callbacks */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 mb-6">
          <p className="text-xs font-semibold text-gray-600 mb-2">Bot → Hub callbacks (every 3 min minimum)</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              ['POST /api/streams/{id}/notes', 'Heartbeat, progress notes, completion signal'],
              ['POST /api/questions', 'Bot asks a question — waits for human/AI reply'],
              ['POST /api/workers/{id}/session-log', 'Structured log entries (info/warn/error)'],
              ['GET  /api/workers/{id}/transcript', 'Read back terminal session recording'],
            ].map(([ep, desc]) => (
              <div key={ep} className="bg-white rounded-lg border border-gray-100 px-3 py-2">
                <p className="font-mono text-[10px] text-blue-700 font-semibold">{ep}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Optional governor */}
        <div className="flex items-start gap-4">
          <Box title="Governor" sub="Python orchestrator — optional, polls hub to trigger next tasks" colour="border-purple-300 bg-purple-50"
            icon={<Zap size={14} className="text-purple-600" />} />
          <div className="flex items-center pt-3 px-2">
            <div className="w-8 h-px bg-gray-300" />
            <span className="text-[9px] text-gray-400 mx-1">polls / posts</span>
            <div className="w-8 h-px bg-gray-300" />
            <ArrowRight size={11} className="text-gray-400" />
          </div>
          <Box title="Factory Hub" sub="Reads task status, auto-starts next queued task" colour="border-blue-300 bg-blue-50"
            icon={<Server size={14} className="text-blue-600" />} />
        </div>
      </div>

      {/* Mission lifecycle */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-800 mb-1">Mission Lifecycle</h2>
        <p className="text-xs text-gray-400 mb-5">How a project flows from idea to completion</p>
        <div className="flex items-center gap-1 flex-wrap gap-y-3">
          {[
            { stage: 'Create Project', desc: 'Name + folder' },
            { stage: 'Add Mission', desc: 'Goal + success criteria' },
            { stage: 'Add Objectives', desc: 'Tasks with dependencies' },
            { stage: 'Review Plan', desc: 'AI Q&A on the plan' },
            { stage: 'Approve', desc: 'Prompt finalised' },
            { stage: 'Start Mission', desc: 'Bots spawned' },
            { stage: 'Running', desc: 'Live monitoring' },
            { stage: 'Complete', desc: 'Report + review' },
          ].map((s, i, arr) => (
            <div key={s.stage} className="flex items-center gap-1">
              <div className="bg-gray-900 text-white rounded-lg px-3 py-2 text-center min-w-[90px]">
                <p className="text-xs font-semibold leading-tight">{s.stage}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">{s.desc}</p>
              </div>
              {i < arr.length - 1 && <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {/* API surface */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-800 mb-1">Key API Endpoints</h2>
        <p className="text-xs text-gray-400 mb-4">All on <span className="font-mono">http://localhost:9100</span></p>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Projects',    ['GET /api/projects', 'POST /api/projects', 'PATCH /api/projects/{id}']],
            ['Missions',    ['GET /api/missions', 'POST /api/missions', 'POST /api/missions/{id}/review-plan']],
            ['Tasks',       ['GET /api/tasks', 'POST /api/tasks', 'PATCH /api/tasks/{id}']],
            ['Workers',     ['GET /api/workers', 'POST /api/workers/spawn', 'DELETE /api/workers/{id}']],
            ['Streams',     ['GET /api/streams', 'GET /api/streams/{id}/events (SSE)', 'POST /api/streams/{id}/notes']],
            ['Bot I/O',     ['GET /api/workers/{id}/transcript', 'POST /api/workers/{id}/session-log', 'GET /api/questions']],
            ['Config',      ['GET /api/config', 'PATCH /api/config/{key}']],
            ['Diagnostics', ['GET /api/status', 'GET /api/schema', 'GET /api/logs']],
          ].map(([group, eps]) => (
            <div key={group as string} className="bg-gray-50 rounded-lg border border-gray-100 p-3">
              <p className="text-xs font-bold text-gray-700 mb-2">{group as string}</p>
              {(eps as string[]).map(ep => (
                <p key={ep} className="font-mono text-[10px] text-blue-700 mb-0.5">{ep}</p>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* File layout */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-800 mb-1">Project Layout</h2>
        <p className="text-xs text-gray-400 mb-4">What each folder does</p>
        <pre className="text-[11px] font-mono text-gray-700 leading-relaxed bg-gray-50 rounded-lg p-4 overflow-x-auto">{`factory/
├── hub/
│   ├── main.py          ← FastAPI app, all endpoints, DB migrations
│   ├── factory.db       ← SQLite database (auto-created)
│   ├── logs/            ← PowerShell transcript files per bot session
│   └── start.ps1        ← kill-and-start script
│
├── ui/
│   ├── src/
│   │   ├── pages/       ← One file per screen (Projects, Mission, etc.)
│   │   ├── components/  ← Shared: Layout, StatusBadge, FolderBrowserInput…
│   │   ├── api/
│   │   │   ├── client.ts    ← fetch wrapper + TypeScript types
│   │   │   ├── hooks.ts     ← React Query hooks (useProjects, useTasks…)
│   │   │   └── mock/        ← Mock data for local dev without the hub
│   │   └── data/
│   │       └── projectTemplates.ts  ← 12 starter templates L1–L4
│   └── vite.config.ts
│
└── governor/
    └── governor.py      ← Optional orchestrator (polls hub, auto-starts tasks)`}</pre>
      </div>

      {/* Start commands */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-bold text-gray-800 mb-4">Running the System</h2>
        <div className="space-y-3">
          {[
            { label: 'Hub (required)', cmd: 'cd factory/hub\n.\\start.ps1' },
            { label: 'UI dev server', cmd: 'cd factory/ui\nnpm run dev' },
            { label: 'Governor (optional)', cmd: 'cd factory/governor\npython governor.py --hub http://localhost:9100' },
          ].map(({ label, cmd }) => (
            <div key={label}>
              <p className="text-xs font-semibold text-gray-600 mb-1">{label}</p>
              <pre className="bg-gray-900 text-green-400 text-xs font-mono rounded-lg px-4 py-3 overflow-x-auto">{cmd}</pre>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type DocTab = 'arch' | 'schema'

export default function DocsPage() {
  const [tab, setTab] = useState<DocTab>('arch')

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
          <BookOpen size={15} className="text-yellow-400" />
        </div>
        <div>
          <h1 className="font-bold text-gray-900">Docs</h1>
          <p className="text-xs text-gray-400">Architecture, APIs, and database schema</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => setTab('arch')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'arch' ? 'border-yellow-400 text-yellow-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Layers size={13} /> Architecture
        </button>
        <button onClick={() => setTab('schema')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'schema' ? 'border-yellow-400 text-yellow-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Database size={13} /> Database Schema
        </button>
      </div>

      {tab === 'arch'   && <ArchView />}
      {tab === 'schema' && <SchemaView />}
    </div>
  )
}
