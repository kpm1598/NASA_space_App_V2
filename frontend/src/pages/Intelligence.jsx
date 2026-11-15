import { useEffect, useState } from 'react'
import { api } from '../services/api'

export default function Intelligence() {
  const [clusters, setClusters] = useState(null)
  const [anomalies, setAnomalies] = useState(null)
  const [insights, setInsights] = useState([])

  useEffect(() => {
    api.clusters().then((d) => setClusters(d.clusters)).catch(() => setClusters([]))
    api.anomalies().then((d) => setAnomalies(d.anomalies)).catch(() => setAnomalies([]))
    api.insights().then((d) => setInsights(d.insights)).catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <div className="hud-panel p-5 text-[15px] leading-relaxed text-slate-300">
        <div className="hud-label mb-1">Module 05 // AI/ML Analysis</div>
        <h2 className="mb-2 font-display text-[22px] font-semibold uppercase tracking-wide text-slate-100">AI/ML Intelligence Center</h2>
        <p>
          <strong>DBSCAN clustering</strong> (haversine, eps 2.5 km, min_samples 3, run per UTC day) groups
          spatially and temporally related observations into candidate activity clusters.{' '}
          <strong>Isolation Forest</strong> (contamination 0.05) scores aggregated 0.25° grid-cell days on
          observation count, FRP, sensor mix and day/night share, and flags statistically unusual ones.
          Clusters are not confirmed wildfires; anomalies are not fires and not predictions.
        </p>
      </div>

      <div className="hud-panel p-5">
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-slate-100">Insights (computed from the data)</h3>
        {insights.length === 0
          ? <p className="text-[15px] text-slate-400">No insights yet — load the dataset first.</p>
          : <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-slate-300 marker:text-orange-500">
              {insights.map((s, i) => <li key={i}>{s}</li>)}
            </ul>}
      </div>

      <div className="hud-panel p-5">
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-slate-100">
          Flagged anomalies {anomalies ? `(${anomalies.length})` : ''}
        </h3>
        {anomalies === null && <p className="text-[15px] text-slate-400">Loading…</p>}
        {anomalies && anomalies.length === 0 && <p className="text-[15px] text-slate-400">None flagged in the current dataset.</p>}
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {anomalies && anomalies.slice(0, 60).map((a) => (
            <div key={a.id} className="rounded-md border border-amber-400/20 bg-[#040a14] p-3 text-[15px]">
              <div className="font-mono text-[12.5px] font-medium tracking-wide text-amber-300">
                {a.obs_date} · grid cell {a.cell_lat.toFixed(2)}°, {a.cell_lon.toFixed(2)}° · {a.obs_count} observations
              </div>
              <p className="mt-1 text-slate-300">{a.explanation}</p>
            </div>
          ))}
        </div>
        {anomalies && anomalies.length > 60 && (
          <p className="mt-2 font-mono text-[11px] text-slate-500">Showing the 60 largest of {anomalies.length} flagged cell-days (full list is in the CSV report).</p>
        )}
      </div>

      <div className="hud-panel p-5">
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-slate-100">
          Candidate clusters {clusters ? `(${clusters.length.toLocaleString('en-IN')})` : ''}
        </h3>
        {clusters === null && <p className="text-[15px] text-slate-400">Loading…</p>}
        {clusters && clusters.length === 0 && <p className="text-[15px] text-slate-400">No clusters in the current dataset.</p>}
        {clusters && clusters.length > 0 && (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="font-mono text-[11px] uppercase tracking-[0.14em] text-cyan-200/70">
                <tr><th className="py-1 pr-3">Cluster</th><th className="pr-3">Date</th><th className="pr-3">Obs</th><th className="pr-3">MODIS</th><th className="pr-3">VIIRS</th><th className="pr-3">Mixed</th><th>Max FRP (MW)</th></tr>
              </thead>
              <tbody className="text-slate-300">
                {clusters.slice(0, 150).map((c) => (
                  <tr key={c.cluster_id} className="border-t border-cyan-400/10 hover:bg-cyan-400/5">
                    <td className="py-1 pr-3 font-mono text-xs">{c.cluster_id}</td>
                    <td className="pr-3">{c.obs_date}</td>
                    <td className="pr-3">{c.n_obs}</td>
                    <td className="pr-3">{c.n_modis}</td>
                    <td className="pr-3">{c.n_viirs}</td>
                    <td className="pr-3">{c.mixed_sensor ? 'yes' : '—'}</td>
                    <td>{c.max_frp ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {clusters.length > 150 && <p className="mt-2 font-mono text-[11px] text-slate-500">Showing the 150 largest-listed of {clusters.length.toLocaleString('en-IN')} clusters.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
