import { useState } from 'react'
import { Save, RefreshCw, CheckCircle } from 'lucide-react'
import { useConfig, useUpdateConfig } from '../api/hooks'
import { VERSION, BUILD_DATE } from '../version'

// Keys that get a dropdown instead of a free-text input
const SELECT_OPTIONS: Record<string, { value: string; label: string; note?: string }[]> = {
  default_runner: [
    { value: 'ollama',       label: 'Ollama (local, free)',   note: '★ Recommended — runs qwen3-coder locally, no API cost' },
    { value: 'claude_code',  label: 'Claude Code',            note: 'Anthropic CLI — requires ANTHROPIC_API_KEY' },
    { value: 'aider',        label: 'Aider',                  note: 'AI pair programmer — works with many models' },
    { value: 'codex',        label: 'Codex CLI',              note: 'OpenAI Codex — requires OpenAI API key' },
  ],
  ollama_default_model: [
    { value: 'qwen3-coder:latest',  label: 'Qwen3 Coder (latest)',     note: '★ Best free local coding model — run: ollama pull qwen3-coder' },
    { value: 'qwen2.5-coder:7b',    label: 'Qwen 2.5 Coder 7B',       note: 'Lighter, faster — run: ollama pull qwen2.5-coder:7b' },
    { value: 'qwen2.5-coder:14b',   label: 'Qwen 2.5 Coder 14B',      note: 'Needs ~16 GB RAM' },
    { value: 'deepseek-coder-v2',   label: 'DeepSeek Coder V2 16B',   note: 'Strong on complex multi-file code' },
    { value: 'llama3.1:8b',         label: 'Llama 3.1 8B',            note: 'Good general purpose' },
    { value: 'codellama:13b',       label: 'Code Llama 13B',           note: 'Meta — solid general coding' },
    { value: 'phi3:mini',           label: 'Phi-3 Mini (3.8B)',        note: 'Tiny, very fast' },
    { value: 'mistral:7b',          label: 'Mistral 7B',               note: 'Balanced — code + general' },
  ],
  default_model: [
    { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',  note: 'Used when default runner is Claude Code' },
    { value: 'claude-opus-4-7',           label: 'Claude Opus 4.7',    note: 'Highest quality — most expensive' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',   note: 'Fastest and cheapest Claude option' },
  ],
}

function ConfigRow({ configKey, entry, onSave }: {
  configKey: string
  entry: { value: string; description: string; updated_at: string }
  onSave: (key: string, value: string) => Promise<void>
}) {
  const [val, setVal] = useState(entry.value)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const dirty = val !== entry.value
  const options = SELECT_OPTIONS[configKey]

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(configKey, val)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const isSecret = configKey.toLowerCase().includes('key') || configKey.toLowerCase().includes('token')
  const selectedNote = options?.find(o => o.value === val)?.note

  return (
    <div className="px-5 py-4 flex items-start gap-4">
      <div className="w-56 flex-shrink-0 pt-1">
        <code className="text-xs font-mono text-gray-700">{configKey}</code>
        <p className="text-xs text-gray-400 mt-0.5 leading-snug">{entry.description}</p>
      </div>
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {options ? (
            <select
              value={val}
              onChange={e => setVal(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400 bg-white"
            >
              {options.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            <input
              type={isSecret ? 'password' : 'text'}
              value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && dirty && handleSave()}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg disabled:opacity-40 transition-colors
              bg-yellow-400 text-gray-900 font-semibold hover:bg-yellow-500 disabled:hover:bg-yellow-400">
            {saving ? <RefreshCw size={13} className="animate-spin" />
              : saved  ? <CheckCircle size={13} />
              : <Save size={13} />}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
        {selectedNote && (
          <p className="text-[11px] text-gray-400 pl-0.5">{selectedNote}</p>
        )}
      </div>
      <p className="text-xs text-gray-300 w-28 flex-shrink-0 text-right pt-1">
        {entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : ''}
      </p>
    </div>
  )
}

export default function SettingsPage() {
  const { data: config, isLoading, refetch } = useConfig()
  const update = useUpdateConfig()
  const [globalError, setGlobalError] = useState('')

  async function handleSave(key: string, value: string) {
    setGlobalError('')
    try {
      await update.mutateAsync({ [key]: value })
      refetch()
    } catch (err: any) {
      setGlobalError(err.message ?? 'Failed to save')
    }
  }

  if (isLoading) return <div className="text-center py-12 text-gray-400 text-sm">Loading config…</div>
  if (!config)   return <div className="text-center py-12 text-gray-400 text-sm">Could not load config.</div>

  const groups: Record<string, string[]> = {}
  for (const key of Object.keys(config)) {
    const prefix = key.split('_')[0]
    groups[prefix] = groups[prefix] ?? []
    groups[prefix].push(key)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {globalError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {globalError}
        </div>
      )}

      {Object.keys(config).length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
          No configuration keys. Add them in the Hub hub backend.
        </div>
      )}

      {Object.entries(groups).map(([group, keys]) => (
        <div key={group} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{group}</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {keys.map(key => (
              <ConfigRow key={key} configKey={key} entry={config[key]} onSave={handleSave} />
            ))}
          </div>
        </div>
      ))}

      <div className="bg-gray-950 rounded-xl border border-gray-800 p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">About BotMaster</h2>
        <div className="text-sm text-gray-400 space-y-1">
          <p className="text-yellow-400 font-bold">BotMaster v{VERSION}</p>
          <p className="text-xs text-gray-500">
            Multi-bot AI coordinator · Built {BUILD_DATE}
          </p>
          <p className="text-xs text-gray-600 mt-2">
            Hub API: <code className="bg-gray-800 px-1 rounded">http://localhost:9100</code> ·
            UI: <code className="bg-gray-800 px-1 rounded">http://localhost:9200</code>
          </p>
        </div>
      </div>
    </div>
  )
}
