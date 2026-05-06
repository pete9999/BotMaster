import { useEffect, useRef, useState } from 'react'
import { useLogStream } from '../api/hooks'
import { Circle, Pause, Play, Trash2 } from 'lucide-react'
import type { LogEntry } from '../api/client'

interface Props {
  filters?: { level?: string; project_id?: string; stream_id?: string; source?: string }
  maxHeight?: string
  compact?: boolean
}

function LogLine({ e }: { e: LogEntry }) {
  const time = e.timestamp.slice(11, 19)
  const lvlClass = `log-${e.level}`
  return (
    <div className={`font-mono text-xs leading-5 whitespace-pre-wrap break-all ${lvlClass}`}>
      <span className="text-gray-600 select-none">{time} </span>
      <span className={`font-semibold uppercase w-5 inline-block ${
        e.level === 'error' ? 'text-red-400' :
        e.level === 'warn'  ? 'text-amber-400' :
        e.level === 'debug' ? 'text-gray-600' : 'text-gray-400'
      }`}>{e.level[0]}</span>
      <span className="text-gray-500"> [{e.source}] </span>
      {e.message}
    </div>
  )
}

export default function LogViewer({ filters, maxHeight = '400px', compact = false }: Props) {
  const { logs, connected, clear } = useLogStream(filters)
  const [paused, setPaused] = useState(false)
  const [displayed, setDisplayed] = useState<LogEntry[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!paused) {
      setDisplayed(logs)
      if (!compact) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, paused, compact])

  return (
    <div className="flex flex-col bg-gray-950 rounded-lg overflow-hidden border border-gray-800">
      {/* toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border-b border-gray-800">
        <Circle size={7} className={connected ? 'fill-green-400 text-green-400' : 'fill-red-400 text-red-400'} />
        <span className="text-gray-500 text-xs">{connected ? 'Live' : 'Disconnected'}</span>
        <span className="text-gray-600 text-xs ml-1">{displayed.length} entries</span>
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => setPaused(p => !p)}
            className="text-gray-500 hover:text-white p-1 rounded hover:bg-gray-700 transition-colors"
            title={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
          <button onClick={clear}
            className="text-gray-500 hover:text-red-400 p-1 rounded hover:bg-gray-700 transition-colors"
            title="Clear display">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {/* log lines */}
      <div className="overflow-y-auto p-3 space-y-0" style={{ maxHeight }}>
        {displayed.length === 0 && (
          <p className="text-gray-600 text-xs font-mono">No log entries yet…</p>
        )}
        {displayed.map(e => <LogLine key={e.id} e={e} />)}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
