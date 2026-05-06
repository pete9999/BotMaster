import { useState } from 'react'
import { useProjects } from '../api/hooks'
import LogViewer from '../components/LogViewer'

const LEVELS = ['', 'debug', 'info', 'warn', 'error']

export default function LogsPage() {
  const { data: projects = [] } = useProjects()
  const [level,     setLevel]     = useState('')
  const [projectId, setProjectId] = useState('')
  const [streamId,  setStreamId]  = useState('')
  const [source,    setSource]    = useState('')

  const filters = {
    level:      level      || undefined,
    project_id: projectId  || undefined,
    stream_id:  streamId.trim()  || undefined,
    source:     source.trim()    || undefined,
  }

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-center gap-3">
        <select value={level} onChange={e => setLevel(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
          {LEVELS.map(l => <option key={l} value={l}>{l || 'All levels'}</option>)}
        </select>
        <select value={projectId} onChange={e => setProjectId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
          <option value="">All missions</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={streamId} onChange={e => setStreamId(e.target.value)}
          placeholder="Stream ID…"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-yellow-400" />
        <input value={source} onChange={e => setSource(e.target.value)}
          placeholder="Source…"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-yellow-400" />
        {(level || projectId || streamId || source) && (
          <button onClick={() => { setLevel(''); setProjectId(''); setStreamId(''); setSource('') }}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">
            Clear filters
          </button>
        )}
      </div>
      <LogViewer filters={filters} maxHeight="calc(100vh - 220px)" />
    </div>
  )
}
