import { useEffect, useState } from 'react'
import { api } from '../services/api'

function SensorTable({ name, s }) {
  if (!s) return null
  const c = s.confidence_distribution
  return (
    <div className="hud-panel p-5">
      <h3 className="font-display text-lg font-semibold uppercase tracking-wide text-slate-100">{name}</h3>
      <dl className="mt-3 space-y-1.5 text-[15px] text-slate-400">
        <div className="flex justify-between border-b border-cyan-400/5 pb-1"><dt>Observations</dt><dd className="font-mono text-sm text-cyan-50">{s.count.toLocaleString('en-IN')}</dd></div>
        <div className="flex justify-between border-b border-cyan-400/5 pb-1"><dt>Median FRP</dt><dd className="font-mono text-sm text-cyan-50">{s.median_frp ?? '—'} MW</dd></div>
        <div className="flex justify-between border-b border-cyan-400/5 pb-1"><dt>Confidence — low</dt><dd className="font-mono text-sm text-cyan-50">{c.low.toLocaleString('en-IN')}</dd></div>
        <div className="flex justify-between border-b border-cyan-400/5 pb-1"><dt>Confidence — nominal</dt><dd className="font-mono text-sm text-cyan-50">{c.nominal.toLocaleString('en-IN')}</dd></div>
        <div className="flex justify-between"><dt>Confidence — high</dt><dd className="font-mono text-sm text-cyan-50">{c.high.toLocaleString('en-IN')}</dd></div>
      </dl>
    </div>
  )
}

export default function Harmonization() {
  const [h, setH] = useState(null)
  const [example, setExample] = useState(null)

  useEffect(() => {
    api.harmonization().then((d) => {
      setH(d)
      if (d.example_observation_id) {
        api.observation(d.example_observation_id).then(setExample).catch(() => {})
      }
    }).catch(() => setH({ sensors: {} }))
  }, [])

  if (!h) return <p className="font-mono text-sm text-slate-400">Loading harmonization stats…</p>

  return (
    <div className="space-y-6">
      <div className="hud-panel p-5 text-[15px] leading-relaxed text-slate-300">
        <div className="hud-label mb-1">Module 04 // Cross-Sensor Harmonization</div>
        <h2 className="mb-2 font-display text-[22px] font-semibold uppercase tracking-wide text-slate-100">How BLACKCAT harmonizes MODIS + VIIRS</h2>
        <p>
          MODIS (Terra/Aqua, ~1 km pixels) reports confidence as a percentage; VIIRS (Suomi NPP, 375 m
          pixels) reports it as a category (low / nominal / high). BLACKCAT maps both onto one ordinal
          scale — MODIS 0–29% → low, 30–79% → nominal, 80–100% → high; VIIRS l/n/h → low/nominal/high —
          while <strong>preserving every original field</strong> of every observation. Nothing is merged
          away or deleted: cross-sensor relationships are stored as <em>candidate links</em> (two
          observations within 1.5 km and 3 hours), and both originals remain in the database.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SensorTable name="MODIS (Terra + Aqua)" s={h.sensors?.MODIS} />
        <SensorTable name="VIIRS (Suomi NPP)" s={h.sensors?.VIIRS} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="hud-panel p-4">
          <div className="hud-label">Candidate cross-sensor links</div>
          <div className="mt-2 font-mono text-[32px] font-medium leading-none text-slate-50">{(h.candidate_links ?? 0).toLocaleString('en-IN')}</div>
        </div>
        <div className="hud-panel p-4">
          <div className="hud-label">Mixed-sensor clusters</div>
          <div className="mt-2 font-mono text-[32px] font-medium leading-none text-slate-50">{(h.mixed_sensor_clusters ?? 0).toLocaleString('en-IN')}</div>
          <div className="mt-2 text-[13px] leading-snug text-slate-500">Candidate clusters containing observations from both sensors — direct evidence the harmonized record works across instruments.</div>
        </div>
      </div>

      {example && (
        <div className="hud-panel p-5">
          <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-slate-100">One real observation: original FIRMS fields vs unified record</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="hud-label mb-1.5">Original (as delivered by NASA FIRMS)</div>
              <pre className="overflow-x-auto rounded-md border border-cyan-400/15 bg-[#040a14] p-3 font-mono text-xs text-slate-300">{JSON.stringify(example.original, null, 1)}</pre>
            </div>
            <div>
              <div className="hud-label mb-1.5">Unified BLACKCAT record</div>
              <pre className="overflow-x-auto rounded-md border border-orange-400/25 bg-[#040a14] p-3 font-mono text-xs text-slate-300">{JSON.stringify(example.unified, null, 1)}</pre>
            </div>
          </div>
          {example.candidate_links?.length > 0 && (
            <p className="mt-3 text-sm text-slate-300">
              This observation has {example.candidate_links.length} candidate cross-sensor link(s) — a
              possible co-detection by the other instrument, with both originals preserved.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
