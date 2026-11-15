import { useCallback, useEffect, useState } from 'react'
import { api } from './services/api'
import CalendarPage from './pages/CalendarPage'
import Dashboard from './pages/Dashboard'
import FireMap from './pages/FireMap'
import Harmonization from './pages/Harmonization'
import Intelligence from './pages/Intelligence'

const VIEWS = [
  ['dashboard', 'Dashboard'],
  ['map', 'Fire Map'],
  ['calendar', 'Burning Activity Calendar'],
  ['harmonization', 'Harmonization'],
  ['intelligence', 'Intelligence Center'],
]

function fmt(v) {
  return v == null ? '—' : Number(v).toLocaleString('en-IN')
}

function TelemetryRow({ label, value, accent }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{label}</span>
      <span className={`font-mono text-sm font-medium ${accent ? 'text-orange-300' : 'text-cyan-50'}`}>
        {value}
      </span>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [backendDown, setBackendDown] = useState(false)

  const refresh = useCallback(() => {
    api.stats()
      .then((s) => { setStats(s); setBackendDown(false) })
      .catch(() => setBackendDown(true))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const activeIndex = VIEWS.findIndex(([key]) => key === view)
  const activeLabel = VIEWS[activeIndex]?.[1]

  const navButton = ([key, label], i) => {
    const active = view === key
    return (
      <button key={key} onClick={() => setView(key)}
        className={`group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
          active
            ? 'bg-gradient-to-r from-orange-600/25 via-orange-500/10 to-transparent text-white'
            : 'text-slate-400 hover:bg-cyan-400/5 hover:text-slate-100'
        }`}>
        <span className={`absolute left-0 top-0 h-full w-[3px] ${active ? 'bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.9)]' : 'bg-transparent group-hover:bg-cyan-400/30'}`} />
        <span className={`font-mono text-[10px] ${active ? 'text-orange-300' : 'text-cyan-400/50'}`}>
          0{i + 1}
        </span>
        <span className="font-mono text-[11.5px] uppercase tracking-[0.18em]">{label}</span>
        {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.95)]" />}
      </button>
    )
  }

  return (
    <div className="flex min-h-screen">
      {/* ── Left telemetry sidebar ─────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col border-r border-cyan-400/10 bg-[#050a14]/90 backdrop-blur md:flex">
        <div className="border-b border-cyan-400/10 px-5 pb-4 pt-5">
          <div className="hud-label mb-1.5" style={{ letterSpacing: '0.14em' }}>Orbital Fire Watch</div>
          <div className="font-display text-[34px] font-bold leading-none tracking-wide text-slate-50">
            BLACK<span className="text-orange-500 glow-orange">CAT</span>
          </div>
          <div className="mt-2 font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.08em] text-slate-400">
            Multi-Satellite Fire Intelligence<br />MODIS + VIIRS Harmonization
          </div>
        </div>

        <div className="px-3 pb-2 pt-4">
          <div className="hud-label px-2 pb-2">Modules</div>
          <nav className="space-y-1">{VIEWS.map(navButton)}</nav>
        </div>

        <div className="mt-auto space-y-4 px-5 pb-5">
          <div className="hud-panel p-4">
            <div className="hud-label mb-3">Telemetry // Dataset</div>
            <div className="space-y-2">
              <TelemetryRow label="Total obs" value={fmt(stats?.total_observations)} accent />
              <TelemetryRow label="MODIS" value={fmt(stats?.modis)} />
              <TelemetryRow label="VIIRS" value={fmt(stats?.viirs)} />
              <TelemetryRow label="Clusters" value={fmt(stats?.clusters)} />
            </div>
            {stats?.date_from && (
              <div className="mt-3 border-t border-cyan-400/10 pt-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Window {stats.date_from} → {stats.date_to}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 border-t border-cyan-400/10 pt-3">
              <span className={`h-2 w-2 rounded-full ${
                backendDown
                  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]'
                  : stats
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                    : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]'
              }`} />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
                {backendDown ? 'Data link down' : stats ? 'Data link active' : 'Establishing link…'}
              </span>
            </div>
          </div>
          <p className="font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.16em] text-slate-600">
            Data: NASA FIRMS archive<br />MODIS (Terra/Aqua) · VIIRS (Suomi NPP)
          </p>
        </div>
      </aside>

      {/* ── Main column ────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header (sidebar is hidden below md) */}
        <header className="border-b border-cyan-400/10 bg-[#050a14]/90 px-4 py-3 md:hidden">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-display text-2xl font-bold tracking-wide text-slate-50">
              BLACK<span className="text-orange-500">CAT</span>
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
              MODIS + VIIRS · NASA FIRMS
            </div>
          </div>
          <nav className="mt-2 flex gap-1 overflow-x-auto pb-1">
            {VIEWS.map(([key, label]) => (
              <button key={key} onClick={() => setView(key)}
                className={`whitespace-nowrap rounded-md border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] ${
                  view === key
                    ? 'border-orange-400/70 bg-orange-600/90 text-white'
                    : 'border-cyan-400/15 bg-cyan-950/30 text-slate-300'
                }`}>
                {label}
              </button>
            ))}
          </nav>
        </header>

        {/* Top telemetry strip */}
        <div className="hidden items-center gap-6 border-b border-cyan-400/10 bg-[#04070f]/70 px-6 py-2.5 md:flex">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-slate-400">
            Module <span className="text-orange-300">0{activeIndex + 1}</span>
            <span className="mx-2 text-slate-600">//</span>
            <span className="text-slate-100">{activeLabel}</span>
          </span>
          <div className="ml-auto flex items-center gap-6 font-mono text-[11px] uppercase tracking-[0.16em]">
            <span className="text-slate-500">Obs <span className="ml-1 text-sm text-orange-300">{fmt(stats?.total_observations)}</span></span>
            <span className="text-slate-500">MODIS <span className="ml-1 text-sm text-red-300">{fmt(stats?.modis)}</span></span>
            <span className="text-slate-500">VIIRS <span className="ml-1 text-sm text-sky-300">{fmt(stats?.viirs)}</span></span>
            {stats?.date_from && (
              <span className="hidden text-slate-500 lg:inline">
                {stats.date_from} <span className="text-slate-600">→</span> {stats.date_to}
              </span>
            )}
          </div>
        </div>

        {backendDown && (
          <div className="border-b border-red-500/40 bg-red-950/70 px-4 py-3 text-center text-sm text-red-200">
            Backend not reachable at {api.base} — start it with{' '}
            <code className="rounded bg-slate-900 px-1 font-mono text-[13px]">uvicorn app.main:app --port 8000</code>{' '}
            from the backend folder, then reload. No data is shown because no data was loaded — nothing here is simulated.
          </div>
        )}

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-8">
          {view === 'dashboard' && <Dashboard stats={stats} refresh={refresh} />}
          {view === 'map' && <FireMap />}
          {view === 'calendar' && <CalendarPage />}
          {view === 'harmonization' && <Harmonization />}
          {view === 'intelligence' && <Intelligence />}
        </main>

        <footer className="border-t border-cyan-400/10 px-4 py-4 text-center font-mono text-[10.5px] uppercase leading-relaxed tracking-[0.14em] text-slate-500">
          Team BlackCat · NASA Space Apps Challenge 2026 · “Harmonization of MODIS and VIIRS Hot Spots” ·
          Data: NASA FIRMS · Hotspots are thermal anomalies, not confirmed wildfires
        </footer>
      </div>
    </div>
  )
}
