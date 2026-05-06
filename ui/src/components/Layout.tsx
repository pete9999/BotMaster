import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, FolderKanban, Bot, ScrollText, Settings, Zap, Circle, RefreshCw, AlertTriangle, BookOpen } from 'lucide-react'
import { useIsFetching } from '@tanstack/react-query'
import { useWorkers, useSysStatus } from '../api/hooks'
import { IS_MOCK } from '../api/client'
import { VERSION, BUILD_DATE } from '../version'

const nav = [
  { to: '/',         icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderKanban,    label: 'Projects' },
  { to: '/workers',  icon: Bot,             label: 'Bots' },
  { to: '/logs',     icon: ScrollText,      label: 'Bot Signal' },
  { to: '/settings', icon: Settings,        label: 'Settings' },
  { to: '/docs',     icon: BookOpen,        label: 'Docs' },
]

function Sidebar() {
  const { data: workers } = useWorkers()
  const { isError: hubOffline } = useSysStatus()
  const active = workers?.filter(w => ['starting','active'].includes(w.status)).length ?? 0
  const stuck  = workers?.filter(w => w.status === 'stuck').length ?? 0

  return (
    <aside className="w-56 bg-gray-950 flex flex-col flex-shrink-0 h-full border-r border-gray-800">
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-yellow-400 rounded flex items-center justify-center flex-shrink-0">
            <Zap size={14} className="text-gray-900" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-black text-white tracking-tight">BotMaster</span>
            <span className="text-yellow-400 text-xs font-bold tracking-wide">v{VERSION}</span>
          </div>
        </div>
        <p className="text-gray-500 text-xs mt-1 pl-9">Multi-bot AI coordinator</p>
      </div>

      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-yellow-400 text-gray-900 font-semibold'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`
            }>
            <Icon size={16} />
            {label}
            {label === 'Bots' && active > 0 && (
              <span className="ml-auto bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                {active}
              </span>
            )}
            {label === 'Bots' && stuck > 0 && (
              <span className="ml-auto bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {stuck} stuck
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Circle size={8} className={
              IS_MOCK ? 'fill-yellow-400 text-yellow-400'
              : hubOffline ? 'fill-red-500 text-red-500'
              : 'fill-green-400 text-green-400'
            } />
            <span className={`text-xs ${hubOffline && !IS_MOCK ? 'text-red-400' : 'text-gray-500'}`}>
              {IS_MOCK ? 'Dev mode' : hubOffline ? 'Hub offline' : 'Hub :9100'}
            </span>
          </div>
          <span className="text-gray-700 text-xs font-mono">{BUILD_DATE}</span>
        </div>
      </div>
    </aside>
  )
}

function HubOfflineBanner() {
  const { isError, fetchStatus } = useSysStatus()
  if (IS_MOCK) return null
  if (!isError) return null
  const timedOut = fetchStatus === 'idle'
  return (
    <div className="bg-red-950 border-b border-red-500/40 px-6 py-2.5 flex items-center gap-3 flex-shrink-0">
      <AlertTriangle size={14} className="text-red-400 flex-shrink-0 animate-pulse" />
      <span className="text-sm text-red-200 font-medium">
        Hub not reachable on port 9100 — {timedOut ? 'request timed out' : 'connection refused'}.
      </span>
      <span className="text-xs text-red-400 ml-auto">
        Run: <code className="font-mono bg-red-900/50 px-1 rounded">python -m uvicorn main:app --port 9100 --reload</code>
      </span>
    </div>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation()
  const isFetching = useIsFetching()

  const pageTitle = (() => {
    if (loc.pathname === '/') return 'Command Centre'
    if (/\/missions\/[^/]+\/review\/[^/]+/.test(loc.pathname)) return 'Review Objective'
    if (/\/missions\/[^/]+\/review/.test(loc.pathname)) return 'Review Mission'
    if (/\/missions\/[^/]+\/run/.test(loc.pathname)) return 'Monitor Mission'
    if (loc.pathname.startsWith('/projects')) return 'Projects'
    if (loc.pathname.startsWith('/workers')) return 'Bots'
    if (loc.pathname.startsWith('/logs')) return 'Bot Signal'
    if (loc.pathname.startsWith('/settings')) return 'Settings'
    if (loc.pathname.startsWith('/docs'))     return 'Docs'
    return 'BotMaster'
  })()

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <HubOfflineBanner />
        <header className="bg-gray-950 border-b border-gray-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <h1 className="font-bold text-white text-sm tracking-wide">{pageTitle}</h1>
          <div className="flex items-center gap-3">
            {isFetching > 0 && (
              <RefreshCw size={12} className="text-yellow-400 animate-spin" title="Refreshing data…" />
            )}
            <a href="/dashboard" target="_blank" rel="noopener noreferrer"
               className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
              Hub dashboard ↗
            </a>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6 bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  )
}
