import { useEffect, useState } from 'react'
import { api } from '../services/api'

function Card({ label, value, sub, glow }) {
  return (
    <div className="hud-panel p-4">
      <div className="hud-label">{label}</div>
      <div className={`mt-2 font-mono text-[32px] font-medium leading-none text-slate-50 ${glow ? 'glow-orange text-orange-200' : ''}`}>
        {value == null ? '—' : Number(value).toLocaleString('en-IN')}
      </div>
      {sub && <div className="mt-2 text-[13px] leading-snug text-slate-500">{sub}</div>}
    </div>
  )
}

export default function Dashboard({ stats, refresh }) {
  const [insights, setInsights] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.insights().then((d) => setInsights(d.insights)).catch(() => {})
  }, [stats])

  const load = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await api.ingestSample()
      setMsg(`Ingested ${r.ingested.toLocaleString('en-IN')} observations from ${r.files?.length || 0} sample file(s); ${r.links} candidate links, ${r.clusters} clusters, ${r.anomalies} anomalies computed.`)
      refresh()
    } catch {
      setMsg('Ingest failed — is the backend running?')
    } finally { setBusy(false) }
  }

  if (!stats) return <p className="font-mono text-sm text-slate-400">Loading dashboard…</p>
  const archived = (stats.provenance || '').startsWith('Archived FIRMS data')

  return (
    <div className="space-y-6">
      <div>
        <div className="hud-label mb-1">Module 01 // Mission Overview</div>
        <h2 className="font-display text-3xl font-semibold uppercase tracking-wide text-slate-50">
          Harmonized Fire Record
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-sm border px-3 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] ${archived ? 'border-emerald-400/40 bg-emerald-900/40 text-emerald-300' : 'border-amber-400/40 bg-amber-900/40 text-amber-300'}`}>
          {archived ? 'Archived FIRMS data' : 'Sample data'}
        </span>
        <span className="font-mono text-[13px] text-slate-400">
          {stats.date_from ? `${stats.date_from} → ${stats.date_to}` : 'No data loaded yet'}
        </span>
        <button onClick={load} disabled={busy}
          className="ml-auto rounded-md bg-orange-600 px-4 py-2 font-display text-[15px] font-semibold uppercase tracking-[0.16em] text-white shadow-[0_0_18px_rgba(249,115,22,0.35)] hover:bg-orange-500 disabled:opacity-50">
          {busy ? 'Ingesting…' : 'Load bundled FIRMS dataset'}
        </button>
        <a href={api.reportUrl} className="rounded-md border border-cyan-400/25 bg-cyan-950/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-cyan-100 hover:border-cyan-400/60">
          Download report (CSV)
        </a>
      </div>
      {msg && <p className="border-l-2 border-orange-500 pl-3 font-mono text-[13px] text-slate-300">{msg}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card label="Total observations" value={stats.total_observations} glow />
        <Card label="MODIS observations" value={stats.modis} sub="Terra + Aqua, ~1 km pixels" />
        <Card label="VIIRS observations" value={stats.viirs} sub="Suomi NPP, 375 m pixels" />
        <Card label="Candidate clusters" value={stats.clusters} sub="Groups of related observations — not confirmed wildfires" />
        <Card label="Mixed-sensor clusters" value={stats.mixed_sensor_clusters} sub="Clusters seen by both MODIS and VIIRS" />
        <Card label="Candidate cross-sensor links" value={stats.candidate_links} sub="Within 1.5 km and 3 hours" />
        <Card label="Anomalies flagged" value={stats.anomalies} sub="Unusual grid-cell days — not fires, not predictions" />
        <Card label="Isolated observations" value={stats.isolated_observations} sub="Not part of any candidate cluster" />
      </div>

      <div className="hud-panel p-5">
        <div className="hud-label mb-1">Analysis Feed</div>
        <h2 className="mb-3 font-display text-[22px] font-semibold uppercase tracking-wide text-slate-100">Fire Intelligence Insights</h2>
        {insights.length === 0
          ? <p className="text-[15px] text-slate-400">No insights yet — load the dataset to compute them from real statistics.</p>
          : <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-slate-300 marker:text-orange-500">
              {insights.map((s, i) => <li key={i}>{s}</li>)}
            </ul>}
        <p className="mt-4 border-t border-cyan-400/10 pt-3 font-mono text-[11px] leading-relaxed text-slate-500">
          Every number above is computed from the loaded database. Satellite hotspots are detected
          thermal anomalies, not confirmed ground-truth wildfires.
        </p>
      </div>

      <details className="hud-panel p-5">
        <summary className="cursor-pointer font-mono text-[12px] uppercase tracking-[0.16em] text-slate-200">Data provenance (full note)</summary>
        <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-400">{stats.provenance}</pre>
      </details>
    </div>
  )
}
