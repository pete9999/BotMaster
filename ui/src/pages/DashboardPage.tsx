import { Link } from 'react-router-dom'
import { Bot, FolderKanban, CheckSquare, AlertTriangle, Play, Clock } from 'lucide-react'
import { useWorkers, useProjects, useTasks, useSysStatus, useSpawnWorker } from '../api/hooks'
import StatusBadge from '../components/StatusBadge'
import LogViewer from '../components/LogViewer'
import type { Worker } from '../api/client'
import { VERSION } from '../version'

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number|string; icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-black text-gray-900">{value}</p>
        <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function BotRow({ w }: { w: Worker }) {
  const spawn = useSpawnWorker()
  const age = w.stream_age != null
    ? w.stream_age < 60 ? `${w.stream_age}s` : `${Math.floor(w.stream_age / 60)}m`
    : '—'
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2.5 text-sm font-medium text-gray-900">
        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{w.stream_id}</code>
      </td>
      <td className="px-4 py-2.5"><StatusBadge status={w.status} mode="worker" /></td>
      <td className="px-4 py-2.5 text-sm text-gray-600">{w.task_id ?? '—'}</td>
      <td className="px-4 py-2.5 text-sm text-gray-500">
        <code className="text-xs">{w.model ?? '—'}</code>
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-400">{age}</td>
      <td className="px-4 py-2.5 text-xs text-gray-400 max-w-48 truncate">{w.stream_notes || '—'}</td>
      <td className="px-4 py-2.5">
        {w.status === 'pending' && (
          <button onClick={() => spawn.mutate(w.id)}
            disabled={spawn.isPending}
            className="flex items-center gap-1 text-xs bg-yellow-400 text-gray-900 font-semibold px-2.5 py-1 rounded hover:bg-yellow-500 disabled:opacity-50">
            <Play size={10} /> Deploy
          </button>
        )}
      </td>
    </tr>
  )
}

export default function DashboardPage() {
  const { data: workers = [] } = useWorkers()
  const { data: projects = [] } = useProjects()
  const { data: tasks = [] } = useTasks()
  const { data: sys } = useSysStatus()

  const activeWorkers = workers.filter(w => ['starting','active'].includes(w.status))
  const stuckWorkers  = workers.filter(w => w.status === 'stuck')
  const doneTasks     = tasks.filter(t => t.status === 'done').length
  const inProgTasks   = tasks.filter(t => t.status === 'in_progress').length

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center">
        <span className="text-xs font-mono text-gray-400">v{VERSION}</span>
      </div>
      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Deployed Bots"    value={activeWorkers.length} icon={Bot}         color="bg-green-500" />
        <StatCard label="Active Ops"       value={inProgTasks}          icon={Clock}        color="bg-blue-500" />
        <StatCard label="Ops Complete"     value={doneTasks}            icon={CheckSquare}  color="bg-yellow-500" />
        <StatCard label="Active Missions"  value={projects.filter(p => p.status === 'active').length} icon={FolderKanban} color="bg-purple-500" />
      </div>

      {stuckWorkers.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-800 text-sm">
              {stuckWorkers.length} bot{stuckWorkers.length > 1 ? 's' : ''} stuck — needs attention
            </p>
            <p className="text-amber-700 text-xs mt-0.5">
              {stuckWorkers.map(w => w.stream_id).join(', ')} — no hub update for over 10 minutes
            </p>
          </div>
          <Link to="/workers" className="ml-auto text-xs text-amber-700 underline hover:no-underline">
            View bots →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Bots table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 text-sm">All Bots</h2>
            <Link to="/workers" className="text-xs text-yellow-700 hover:underline font-medium">Manage →</Link>
          </div>
          {workers.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">
              No bots deployed yet. <Link to="/workers" className="text-yellow-700 hover:underline font-medium">Deploy one →</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2">Stream</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Op</th>
                    <th className="px-4 py-2">Model</th>
                    <th className="px-4 py-2">Age</th>
                    <th className="px-4 py-2">Notes</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {workers.map(w => <BotRow key={w.id} w={w} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Missions summary */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 text-sm">Active Missions</h2>
            <Link to="/projects" className="text-xs text-yellow-700 hover:underline font-medium">All missions →</Link>
          </div>
          {projects.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">
              No missions. <Link to="/projects" className="text-yellow-700 hover:underline font-medium">Create one →</Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {projects.slice(0, 6).map(p => (
                <Link key={p.id} to={`/projects/${p.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <FolderKanban size={14} className="text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400 truncate">{p.tech_stack}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bot Signal log tail */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-700 text-sm">Bot Signal — Live Activity</h2>
          <Link to="/logs" className="text-xs text-yellow-700 hover:underline font-medium">Full log viewer →</Link>
        </div>
        <LogViewer maxHeight="280px" />
      </div>

      {sys && (
        <p className="text-xs text-gray-400">
          hub uptime {Math.floor(sys.uptime_seconds / 60)}m · Python {sys.python_version} · {sys.platform} · {sys.log_entries.toLocaleString()} log entries
        </p>
      )}
    </div>
  )
}
