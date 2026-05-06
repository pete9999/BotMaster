import { useState, useEffect, useRef } from 'react'
import { FolderOpen, ChevronRight, Home, FolderPlus, RefreshCw, Check } from 'lucide-react'
import { get, post } from '../api/client'

interface BrowseResult {
  path: string
  parent: string | null
  dirs: { name: string; path: string }[]
}

function getPathParts(fullPath: string): { label: string; path: string }[] {
  const isWindows = /^[A-Za-z]:[/\\]/.test(fullPath) || fullPath.includes('\\')
  if (isWindows) {
    const parts = fullPath.replace(/\//g, '\\').split('\\').filter(Boolean)
    return parts.map((part, i) => ({
      label: part,
      path: i === 0 ? part + '\\' : parts.slice(0, i + 1).join('\\'),
    }))
  }
  const parts = fullPath.split('/').filter(Boolean)
  return parts.map((part, i) => ({
    label: part,
    path: '/' + parts.slice(0, i + 1).join('/'),
  }))
}

function joinPath(base: string, name: string): string {
  const isWindows = /^[A-Za-z]:[/\\]/.test(base) || base.includes('\\')
  const sep = isWindows ? '\\' : '/'
  return base.replace(/[/\\]+$/, '') + sep + name
}

interface Props {
  value: string
  onChange: (path: string) => void
  placeholder?: string
  inputClassName?: string
  /** If true, show "create folder" offer when typed path doesn't exist */
  offerCreate?: boolean
}

export default function FolderBrowserInput({ value, onChange, placeholder, inputClassName, offerCreate = false }: Props) {
  const [open, setOpen]       = useState(false)
  const [current, setCurrent] = useState<BrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  // New-folder creation inside the browser
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderError, setFolderError] = useState('')
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  // Existence check for typed path
  const [pathExists, setPathExists] = useState<boolean | null>(null)
  const [checkingPath, setCheckingPath] = useState(false)
  const [creating, setCreating] = useState(false)
  const [justCreated, setJustCreated] = useState(false)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce-check typed path existence when offerCreate is enabled
  useEffect(() => {
    if (!offerCreate || !value.trim()) { setPathExists(null); return }
    setJustCreated(false)
    if (checkTimer.current) clearTimeout(checkTimer.current)
    checkTimer.current = setTimeout(async () => {
      setCheckingPath(true)
      try {
        const res = await get<{ exists: boolean }>(`/api/fs/check?path=${encodeURIComponent(value.trim())}`)
        setPathExists(res.exists)
      } catch { setPathExists(null) }
      setCheckingPath(false)
    }, 500)
    return () => { if (checkTimer.current) clearTimeout(checkTimer.current) }
  }, [value, offerCreate])

  async function handleCreateTypedPath() {
    setCreating(true)
    try {
      await post('/api/fs/mkdir', { path: value.trim() })
      setPathExists(true)
      setJustCreated(true)
    } catch (e: any) {
      // show inline error — don't crash
    }
    setCreating(false)
  }

  async function navigate(path: string = '') {
    setLoading(true)
    setError('')
    setShowNewFolder(false)
    setNewFolderName('')
    setFolderError('')
    try {
      const url = path ? `/api/fs/browse?path=${encodeURIComponent(path)}` : '/api/fs/browse'
      const data = await get<BrowseResult>(url)
      setCurrent(data)
    } catch (e: any) {
      setError(e.message ?? 'Browse failed')
    }
    setLoading(false)
  }

  function handleOpen() {
    setOpen(true)
    navigate(value || '')
  }

  function handleSelect() {
    if (current?.path) onChange(current.path)
    setOpen(false)
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim() || !current?.path) return
    setCreatingFolder(true)
    setFolderError('')
    const newPath = joinPath(current.path, newFolderName.trim())
    try {
      await post('/api/fs/mkdir', { path: newPath })
      setShowNewFolder(false)
      setNewFolderName('')
      await navigate(newPath) // navigate into the newly created folder
    } catch (e: any) {
      setFolderError(e.message ?? 'Failed to create folder')
    }
    setCreatingFolder(false)
  }

  useEffect(() => {
    if (showNewFolder) setTimeout(() => newFolderInputRef.current?.focus(), 50)
  }, [showNewFolder])

  const parts = current ? getPathParts(current.path) : []

  // Existence hint for the text input
  const showExistHint = offerCreate && value.trim() && !checkingPath && pathExists === false && !justCreated
  const showCreatedBadge = offerCreate && justCreated

  return (
    <>
      <div className="flex gap-1.5 flex-col">
        <div className="flex gap-1.5">
          <input
            value={value}
            onChange={e => { onChange(e.target.value); setJustCreated(false) }}
            placeholder={placeholder}
            className={inputClassName}
          />
          <button
            type="button"
            onClick={handleOpen}
            title="Browse folders"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 hover:border-gray-400 flex-shrink-0 whitespace-nowrap"
          >
            <FolderOpen size={12} /> Browse
          </button>
        </div>

        {/* Existence hint below the input */}
        {checkingPath && (
          <p className="text-[11px] text-gray-400 flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> Checking…</p>
        )}
        {showExistHint && (
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-amber-700">Folder doesn't exist yet.</p>
            <button type="button" onClick={handleCreateTypedPath} disabled={creating}
              className="flex items-center gap-1 text-[11px] px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-800 font-semibold rounded hover:bg-amber-200 disabled:opacity-50">
              {creating ? <RefreshCw size={9} className="animate-spin" /> : <FolderPlus size={9} />}
              {creating ? 'Creating…' : 'Create folder'}
            </button>
          </div>
        )}
        {showCreatedBadge && (
          <p className="text-[11px] text-green-700 flex items-center gap-1"><Check size={10} /> Folder created</p>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-gray-200 flex flex-col max-h-[70vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <h3 className="font-semibold text-sm text-gray-900">Browse Folders</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center gap-0.5 px-3 py-2 bg-gray-50 border-b border-gray-100 overflow-x-auto flex-shrink-0 min-h-[36px]">
              <button onClick={() => navigate('')} title="Home" className="text-gray-400 hover:text-yellow-600 flex-shrink-0 p-0.5">
                <Home size={11} />
              </button>
              {parts.map((p, i) => (
                <span key={i} className="flex items-center gap-0.5 flex-shrink-0">
                  <ChevronRight size={9} className="text-gray-300" />
                  <button
                    onClick={() => navigate(p.path)}
                    className="text-xs text-gray-600 hover:text-yellow-700 max-w-[100px] truncate"
                  >
                    {p.label}
                  </button>
                </span>
              ))}
            </div>

            {/* Directory list */}
            <div className="flex-1 overflow-y-auto px-2 py-1.5 min-h-[120px]">
              {loading && (
                <p className="text-center text-xs text-gray-400 py-8">Loading…</p>
              )}
              {!loading && error && (
                <p className="text-center text-xs text-red-500 py-4">{error}</p>
              )}
              {!loading && !error && current && (
                <>
                  {current.parent && (
                    <button
                      onClick={() => navigate(current.parent!)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-50"
                    >
                      <span className="text-xs">↑</span>
                      <span className="text-xs">..</span>
                    </button>
                  )}
                  {current.dirs.map(d => (
                    <button
                      key={d.path}
                      onClick={() => navigate(d.path)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-yellow-50 text-left"
                    >
                      <FolderOpen size={13} className="text-yellow-500 flex-shrink-0" />
                      <span className="truncate">{d.name}</span>
                    </button>
                  ))}
                  {current.dirs.length === 0 && (
                    <p className="text-center text-xs text-gray-400 py-4">Empty folder</p>
                  )}
                </>
              )}
            </div>

            {/* New folder row */}
            {current && (
              <div className="px-3 py-2 border-t border-gray-100 flex-shrink-0">
                {showNewFolder ? (
                  <div className="flex items-center gap-2">
                    <FolderPlus size={13} className="text-yellow-500 flex-shrink-0" />
                    <input
                      ref={newFolderInputRef}
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName('') } }}
                      placeholder="New folder name…"
                      className="flex-1 border border-yellow-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                    <button type="button" onClick={handleCreateFolder} disabled={!newFolderName.trim() || creatingFolder}
                      className="px-2 py-1 text-xs bg-yellow-400 text-gray-900 font-semibold rounded hover:bg-yellow-500 disabled:opacity-50 flex items-center gap-1">
                      {creatingFolder ? <RefreshCw size={10} className="animate-spin" /> : <Check size={10} />}
                      {creatingFolder ? '' : 'Create'}
                    </button>
                    <button type="button" onClick={() => { setShowNewFolder(false); setNewFolderName('') }}
                      className="text-gray-400 hover:text-gray-600 text-sm leading-none">&times;</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowNewFolder(true)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-yellow-700 px-1 py-1">
                    <FolderPlus size={12} /> New folder here
                  </button>
                )}
                {folderError && <p className="text-[11px] text-red-500 mt-1">{folderError}</p>}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 flex-shrink-0">
              <p className="text-xs text-gray-500 font-mono truncate flex-1">
                {current?.path ?? 'No folder selected'}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 flex-shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSelect}
                disabled={!current?.path}
                className="px-3 py-1.5 text-xs bg-yellow-400 text-gray-900 font-semibold rounded-lg hover:bg-yellow-500 disabled:opacity-50 flex-shrink-0"
              >
                Select
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
