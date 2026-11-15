import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  CircleMarker, MapContainer, Marker, Polygon, Popup, Rectangle,
  ScaleControl, TileLayer, useMap, useMapEvents,
} from 'react-leaflet'
import { api } from '../services/api'
import GlobeView from '../components/GlobeView'

const PALETTE = ['#f97316', '#38bdf8', '#a78bfa', '#34d399', '#facc15', '#fb7185', '#22d3ee', '#e879f9']
const FLAME_COUNT = 150

function clusterColor(id) {
  if (!id) return '#64748b'
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997
  return PALETTE[h % PALETTE.length]
}

// Fire radiative power tiers: the colour/size language of the map.
function frpTier(frp) {
  if (frp == null) return { label: 'intensity unknown', color: '#94a3b8' }
  if (frp < 5) return { label: 'Low intensity', color: '#facc15' }
  if (frp < 20) return { label: 'Moderate intensity', color: '#fb923c' }
  if (frp < 50) return { label: 'High intensity', color: '#f97316' }
  return { label: 'Extreme intensity', color: '#ef4444' }
}

function frpRadius(frp) {
  if (!frp) return 3.5
  return Math.min(11, 3 + Math.sqrt(frp))
}

// --- Hex-grid aggregation (the honeycomb look of the reference image) ---
// Points are projected to local kilometres, binned into pointy-top
// hexagons (~8 km across), and each cell is coloured by how many
// detections fell inside it: pale yellow -> orange -> deep red.
const KM_PER_DEG_LAT = 110.9
const KM_PER_DEG_LON = 103.6 // at ~21.5 deg N
const HEX_SIZE_KM = 4

function hexKeyFor(lat, lon) {
  const x = lon * KM_PER_DEG_LON
  const y = lat * KM_PER_DEG_LAT
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / HEX_SIZE_KM
  const r = ((2 / 3) * y) / HEX_SIZE_KM
  // cube round
  let cx = q
  let cz = r
  let cy = -cx - cz
  let rx = Math.round(cx)
  let ry = Math.round(cy)
  let rz = Math.round(cz)
  const dx = Math.abs(rx - cx)
  const dy = Math.abs(ry - cy)
  const dz = Math.abs(rz - cz)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  return { key: `${rx},${rz}`, q: rx, r: rz }
}

function hexCorners(q, r) {
  const cx = HEX_SIZE_KM * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r)
  const cy = HEX_SIZE_KM * 1.5 * r
  const pts = []
  for (let i = 0; i < 6; i++) {
    const ang = ((60 * i - 30) * Math.PI) / 180
    const px = cx + HEX_SIZE_KM * Math.cos(ang)
    const py = cy + HEX_SIZE_KM * Math.sin(ang)
    pts.push([py / KM_PER_DEG_LAT, px / KM_PER_DEG_LON])
  }
  return pts
}

function hexColor(t) {
  if (t < 0.12) return '#fef9c3'
  if (t < 0.3) return '#fde047'
  if (t < 0.5) return '#fbbf24'
  if (t < 0.7) return '#f97316'
  if (t < 0.88) return '#dc2626'
  return '#991b1b'
}

// Convex hull (Andrew's monotone chain) over [lat, lon] pairs — used to
// outline the footprint of the largest candidate cluster.
function convexHull(points) {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()]
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
  if (pts.length < 3) return null
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1])
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  return hull.length >= 3 ? hull : null
}

function flameIcon(color, size) {
  return L.divIcon({
    className: 'flame-marker',
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24">`
      + `<path d="M12 2.5c.8 3.2-2.4 4.6-2.4 7.1a2.4 2.4 0 0 0 4.8 0c0-.8-.4-1.6-.4-1.6s2.4 1.2 2.4 4A4.4 4.4 0 1 1 7.6 12C7.6 7.4 10.6 5.4 12 2.5Z" fill="${color}" stroke="#0b1020" stroke-width="0.8"/>`
      + `<path d="M12 12.4c.8.9 1.4 1.8 1.4 2.7a1.4 1.4 0 1 1-2.8 0c0-.9.6-1.8 1.4-2.7Z" fill="#fde68a"/>`
      + '</svg>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
    popupAnchor: [0, -size + 4],
  })
}

const BASEMAPS = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  streets: {
    label: 'Streets',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    labels: null,
  },
  dark: {
    label: 'Dark',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri — Source: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community',
    labels: null,
  },
}

// Zooming the flat map all the way out (to world level) hands over to
// the 3D globe — the Apple-Maps gesture Kasim asked for. No buttons.
function ZoomToGlobeWatcher({ onZoomOut }) {
  useMapEvents({
    zoomend(e) {
      if (e.target.getZoom() <= 3) {
        const c = e.target.getCenter()
        onZoomOut({ lat: c.lat, lon: c.lng })
      }
    },
  })
  return null
}

function FitToData({ data, appliedArea, returnCentreRef }) {
  const map = useMap()
  useEffect(() => {
    if (!data) return
    if (returnCentreRef?.current) {
      // Returning from the globe: open where the globe was facing.
      const c = returnCentreRef.current
      returnCentreRef.current = null
      map.setView([c.lat, c.lon], 5)
      return
    }
    if (appliedArea) {
      map.fitBounds(
        [[appliedArea.south, appliedArea.west], [appliedArea.north, appliedArea.east]],
        { padding: [28, 28] })
      return
    }
    if (data.observations.length) {
      const b = L.latLngBounds(data.observations.map((o) => [o.latitude, o.longitude]))
      if (b.isValid()) map.fitBounds(b, { padding: [28, 28] })
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function HotspotPopup({ o, color }) {
  const tier = frpTier(o.frp)
  return (
    <div style={{ minWidth: 190 }}>
      <span style={{
        background: color, color: '#0b1020', borderRadius: 6, padding: '1px 7px',
        fontWeight: 700, fontSize: 12,
      }}>{o.sensor}</span>{' '}
      <span style={{ fontSize: 12 }}>{o.satellite || ''}</span><br />
      <strong>{tier.label}</strong> — FRP {o.frp ?? '—'} MW<br />
      Detected: {o.observed_at} UTC<br />
      Confidence: {o.confidence_raw ?? '—'} (harmonized: {['low', 'nominal', 'high'][o.confidence_harmonized] ?? '—'})<br />
      Day/Night: {o.daynight || '—'}<br />
      Cluster: {o.cluster_id || 'isolated observation'}<br />
      Candidate cross-sensor link: {o.has_candidate_link ? 'yes' : 'no'}
    </div>
  )
}

export default function FireMap() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [showModis, setShowModis] = useState(true)
  const [showViirs, setShowViirs] = useState(true)
  const [viewMode, setViewMode] = useState('globe') // globe | hex | intensity | sensor | cluster
  const lastFlatRef = useRef('hex')
  useEffect(() => {
    if (viewMode !== 'globe') lastFlatRef.current = viewMode
  }, [viewMode])
  const [globeCentre, setGlobeCentre] = useState(null)
  const returnCentreRef = useRef(null)
  const handleGlobeZoomToMap = useCallback((centre) => {
    if (centre) returnCentreRef.current = centre
    setViewMode(lastFlatRef.current)
  }, [])
  const handleMapZoomToGlobe = useCallback((centre) => {
    if (centre) setGlobeCentre(centre)
    setViewMode('globe')
  }, [])
  const [showFootprint, setShowFootprint] = useState(true)
  const [basemap, setBasemap] = useState('satellite')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [west, setWest] = useState('')
  const [south, setSouth] = useState('')
  const [east, setEast] = useState('')
  const [north, setNorth] = useState('')
  const [areaError, setAreaError] = useState('')
  const [appliedArea, setAppliedArea] = useState(null)

  const areaParams = () => {
    // Area of interest: all four bounds or none. Returns null when the
    // input is incomplete/invalid (caller shows the message).
    const vals = [west, south, east, north]
    if (vals.every((v) => v === '')) return {}
    if (vals.some((v) => v === '' || Number.isNaN(Number(v)))) return null
    const [w, s, e, n] = vals.map(Number)
    if (!(w < e && s < n)) return null
    return { west: w, south: s, east: e, north: n }
  }

  const load = () => {
    setError('')
    const area = areaParams()
    if (area === null) {
      setAreaError('Enter all four area bounds as numbers, with west < east and south < north — or clear all four for the full dataset area.')
      return
    }
    setAreaError('')
    setAppliedArea(Object.keys(area).length ? area : null)
    api.observations({ date_from: from, date_to: to, limit: 5000, ...area })
      .then(setData)
      .catch(() => setError('Could not load observations — backend unreachable?'))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const points = useMemo(() => {
    if (!data) return []
    return data.observations.filter(
      (o) => (o.sensor === 'MODIS' ? showModis : showViirs))
  }, [data, showModis, showViirs])

  const pointColor = (o) => {
    if (viewMode === 'sensor') return o.sensor === 'MODIS' ? '#ef4444' : '#38bdf8'
    if (viewMode === 'cluster') return clusterColor(o.cluster_id)
    return frpTier(o.frp).color
  }

  // Honeycomb cells for hex view: one polygon per occupied hexagon.
  const hexes = useMemo(() => {
    if (viewMode !== 'hex') return []
    const cells = new Map()
    for (const o of points) {
      const { key, q, r } = hexKeyFor(o.latitude, o.longitude)
      let c = cells.get(key)
      if (!c) {
        c = { key, q, r, count: 0, modis: 0, viirs: 0, frpSum: 0, frpMax: 0 }
        cells.set(key, c)
      }
      c.count += 1
      if (o.sensor === 'MODIS') c.modis += 1
      else c.viirs += 1
      if (o.frp != null) {
        c.frpSum += o.frp
        if (o.frp > c.frpMax) c.frpMax = o.frp
      }
    }
    const list = [...cells.values()]
    const max = list.reduce((m, c) => Math.max(m, c.count), 0) || 1
    return list.map((c) => ({ ...c, corners: hexCorners(c.q, c.r), t: c.count / max }))
  }, [points, viewMode])

  // Footprint of the largest candidate cluster (most observations),
  // drawn like the outlined burn area in the reference image.
  const footprint = useMemo(() => {
    const byCluster = new Map()
    for (const o of points) {
      if (!o.cluster_id) continue
      if (!byCluster.has(o.cluster_id)) byCluster.set(o.cluster_id, [])
      byCluster.get(o.cluster_id).push([o.latitude, o.longitude])
    }
    let best = null
    for (const [id, pts] of byCluster) {
      if (!best || pts.length > best.pts.length) best = { id, pts }
    }
    if (!best) return null
    const hull = convexHull(best.pts)
    return hull ? { id: best.id, n: best.pts.length, hull } : null
  }, [points])

  // The strongest detections in view get real flame markers on top of the
  // glow layer, so the eye lands on the most intense burning first.
  const flames = useMemo(
    () => [...points].filter((o) => o.frp != null)
      .sort((a, b) => b.frp - a.frp).slice(0, FLAME_COUNT),
    [points])
  const flameIds = useMemo(() => new Set(flames.map((o) => o.id)), [flames])
  const maxFrp = flames.length ? flames[0].frp : null
  const base = BASEMAPS[basemap]

  const segmentBtn = (active) =>
    `rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition ${active ? 'border-orange-400/70 bg-orange-600/90 font-semibold text-white shadow-[0_0_16px_rgba(249,115,22,0.45)]' : 'border-cyan-400/15 bg-cyan-950/30 text-slate-300 hover:border-cyan-400/40 hover:text-white'}`

  return (
    <div className="space-y-4">
      <div>
        <div className="hud-label mb-1">Module 02 // Orbital Fire Map</div>
        <h2 className="font-display text-3xl font-semibold uppercase tracking-wide text-slate-50">Fire Map — where the burning is</h2>
        <p className="mt-1 max-w-4xl text-[15px] leading-snug text-slate-400">
          Real satellite imagery with the harmonized hotspots aggregated into a honeycomb
          hex grid — pale yellow cells had few detections, deep red cells the most — plus an
          outlined footprint of the largest candidate cluster. Switch views to see individual
          glowing fire points instead (bigger, brighter = stronger burning, FRP), and flame
          markers flag the {FLAME_COUNT} strongest detections in view.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <div className="hud-panel p-4">
            <h3 className="hud-label mb-2.5">Colour the map by</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setViewMode('hex')} className={segmentBtn(viewMode === 'hex')}>Hex grid</button>
              <button onClick={() => setViewMode('intensity')} className={segmentBtn(viewMode === 'intensity')}>Fire intensity</button>
              <button onClick={() => setViewMode('sensor')} className={segmentBtn(viewMode === 'sensor')}>Sensor</button>
              <button onClick={() => setViewMode('cluster')} className={segmentBtn(viewMode === 'cluster')}>Cluster</button>
              <button onClick={() => setViewMode('globe')} className={segmentBtn(viewMode === 'globe')}>Globe</button>
            </div>
            <h3 className="hud-label mb-2.5 mt-5">Base map</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(BASEMAPS).map(([key, b]) => (
                <button key={key} onClick={() => setBasemap(key)} className={segmentBtn(basemap === key)}>{b.label}</button>
              ))}
            </div>
            <div className="mt-4 space-y-1.5 text-sm">
              <p className="hud-label">Legend</p>
              {viewMode === 'hex' && (
                <>
                  <p className="text-slate-300">Each hexagon (~8 km across) groups the detections inside it:</p>
                  <p><span style={{ color: '#fef9c3' }}>⬢</span> Few detections</p>
                  <p><span style={{ color: '#fbbf24' }}>⬢</span> Moderate</p>
                  <p><span style={{ color: '#f97316' }}>⬢</span> Many</p>
                  <p><span style={{ color: '#991b1b' }}>⬢</span> Most detections in view</p>
                  <p className="text-slate-400">Click a cell for its exact counts and FRP totals.</p>
                </>
              )}
              {viewMode === 'intensity' && (
                <>
                  <p><span style={{ color: '#facc15' }}>●</span> Low — under 5 MW</p>
                  <p><span style={{ color: '#fb923c' }}>●</span> Moderate — 5 to 20 MW</p>
                  <p><span style={{ color: '#f97316' }}>●</span> High — 20 to 50 MW</p>
                  <p><span style={{ color: '#ef4444' }}>●</span> Extreme — over 50 MW, white-hot core</p>
                  <p className="text-slate-400">Point size also grows with FRP.</p>
                </>
              )}
              {viewMode === 'sensor' && (
                <>
                  <p><span className="text-red-400">●</span> MODIS (Terra/Aqua, ~1 km pixels)</p>
                  <p><span className="text-sky-400">●</span> VIIRS (Suomi NPP, 375 m pixels)</p>
                  <p className="text-slate-400">VIIRS sees many more, smaller hotspots — that difference is real, and it is preserved, not hidden.</p>
                </>
              )}
              {viewMode === 'cluster' && (
                <>
                  <p className="text-slate-300">Points sharing a colour belong to the same candidate activity cluster.</p>
                  <p><span className="text-slate-400">●</span> Grey points are isolated observations.</p>
                  <p className="text-slate-400">A cluster is a group of related detections — not one confirmed wildfire.</p>
                </>
              )}
              {viewMode === 'globe' && (
                <>
                  <p><span style={{ color: '#facc15' }}>●</span> Low — under 5 MW</p>
                  <p><span style={{ color: '#fb923c' }}>●</span> Moderate — 5 to 20 MW</p>
                  <p><span style={{ color: '#f97316' }}>●</span> High — 20 to 50 MW</p>
                  <p><span style={{ color: '#ef4444' }}>●</span> Extreme — over 50 MW</p>
                  <p className="text-slate-400">Dot size also grows with FRP. Drag the globe to rotate it — detections on the far side of the Earth are hidden until they rotate into view.</p>
                </>
              )}
              <p className="pt-1 text-slate-400">🔥 Flame = one of the {FLAME_COUNT} strongest detections currently in view.</p>
              {footprint && (
                <label className="flex items-center gap-2 pt-2 text-slate-300">
                  <input type="checkbox" className="accent-orange-500" checked={showFootprint} onChange={(e) => setShowFootprint(e.target.checked)} />
                  <span><span className="text-yellow-300">▭</span> Largest cluster footprint ({footprint.n} detections)</span>
                </label>
              )}
            </div>
          </div>

          <div className="hud-panel p-4 text-sm">
            <h3 className="hud-label mb-3">Filters</h3>
            <label className="mb-1.5 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-slate-300"><input type="checkbox" className="accent-orange-500" checked={showModis} onChange={(e) => setShowModis(e.target.checked)} /> <span className="text-red-400">●</span> MODIS</label>
            <label className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-slate-300"><input type="checkbox" className="accent-orange-500" checked={showViirs} onChange={(e) => setShowViirs(e.target.checked)} /> <span className="text-sky-400">●</span> VIIRS</label>
            <label className="mb-2 flex items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="hud-input" /></label>
            <label className="mb-3 flex items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="hud-input" /></label>
            <p className="hud-label mb-2">Area of interest (lon/lat)</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400">West <input type="number" step="0.1" value={west} onChange={(e) => setWest(e.target.value)} placeholder="80.5" className="hud-input w-20" /></label>
              <label className="flex items-center justify-between gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400">East <input type="number" step="0.1" value={east} onChange={(e) => setEast(e.target.value)} placeholder="83.5" className="hud-input w-20" /></label>
              <label className="flex items-center justify-between gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400">South <input type="number" step="0.1" value={south} onChange={(e) => setSouth(e.target.value)} placeholder="20.0" className="hud-input w-20" /></label>
              <label className="flex items-center justify-between gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400">North <input type="number" step="0.1" value={north} onChange={(e) => setNorth(e.target.value)} placeholder="23.0" className="hud-input w-20" /></label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => { setWest('80.5'); setSouth('20'); setEast('83.5'); setNorth('23') }} className="rounded-md border border-cyan-400/20 bg-cyan-950/30 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-200 hover:border-cyan-400/50">Demo AOI</button>
              <button onClick={() => { setWest(''); setSouth(''); setEast(''); setNorth(''); setAreaError('') }} className="rounded-md border border-cyan-400/20 bg-cyan-950/30 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-200 hover:border-cyan-400/50">Clear area</button>
            </div>
            {areaError && <p className="mt-2 text-red-400">{areaError}</p>}
            <button onClick={load} className="mt-3 w-full rounded-md bg-orange-600 px-3 py-2 font-display text-base font-semibold uppercase tracking-[0.18em] text-white shadow-[0_0_18px_rgba(249,115,22,0.35)] hover:bg-orange-500">Apply filters</button>
            <a href={api.observationsCsvUrl({ date_from: from, date_to: to, ...(areaParams() || {}), ...(showModis !== showViirs ? { sensor: showModis ? 'MODIS' : 'VIIRS' } : {}) })}
              className="mt-2 block rounded-md border border-cyan-400/25 bg-cyan-950/30 px-3 py-2 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-cyan-100 hover:border-cyan-400/60">
              Download matching hotspots (CSV)
            </a>
            {error && <p className="mt-2 text-red-400">{error}</p>}
          </div>
        </div>

        <div>
          {data && (
            <p className="mb-2 font-mono text-[13px] text-slate-400">
              Showing {points.length.toLocaleString('en-IN')} of {data.total_matching.toLocaleString('en-IN')} matching observations
              {viewMode === 'hex' && hexes.length > 0 && <> · grouped into <strong className="text-orange-300">{hexes.length} hex cells</strong></>}
              {maxFrp != null && <> · strongest in view: <strong className="text-orange-300">{maxFrp} MW</strong></>}
              {viewMode !== 'globe' && flames.length > 0 && <> · {flames.length} flame markers shown</>}
              {data.capped && <span className="text-amber-400"> · points are capped at {data.cap.toLocaleString('en-IN')} for browser performance — narrow the dates or area to see a period in full.</span>}
            </p>
          )}
          <div className="hud-frame overflow-hidden">
            <span className="pointer-events-none absolute left-0 top-0 z-[650] h-5 w-5 border-l-2 border-t-2 border-orange-400" />
            <span className="pointer-events-none absolute right-0 top-0 z-[650] h-5 w-5 border-r-2 border-t-2 border-orange-400" />
            <span className="pointer-events-none absolute bottom-0 left-0 z-[650] h-5 w-5 border-b-2 border-l-2 border-orange-400" />
            <span className="pointer-events-none absolute bottom-0 right-0 z-[650] h-5 w-5 border-b-2 border-r-2 border-orange-400" />
            <span className="pointer-events-none absolute left-1/2 top-3 z-[650] -translate-x-1/2 whitespace-nowrap rounded-sm border border-cyan-300/40 bg-[#04060d]/85 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-200">
              {viewMode === 'globe' ? 'Orthographic globe · Harmonized FIRMS hotspots' : 'Satellite basemap · Harmonized FIRMS hotspots'}
            </span>
            {viewMode === 'globe' ? (
              <GlobeView points={points} onZoomToMap={handleGlobeZoomToMap} center={globeCentre} />
            ) : (
            <MapContainer center={[21.5, 82.0]} zoom={7} preferCanvas style={{ height: '72vh', width: '100%' }}>
              <TileLayer key={basemap} url={base.url} attribution={base.attribution} />
              {base.labels && <TileLayer url={base.labels} attribution="© Esri" opacity={0.85} />}
              <ScaleControl position="bottomleft" />
              <FitToData data={data} appliedArea={appliedArea} returnCentreRef={returnCentreRef} />
              <ZoomToGlobeWatcher onZoomOut={handleMapZoomToGlobe} />
              {appliedArea && (
                <Rectangle
                  bounds={[[appliedArea.south, appliedArea.west], [appliedArea.north, appliedArea.east]]}
                  pathOptions={{ color: '#f97316', weight: 1.5, dashArray: '6 4', fillOpacity: 0.04 }}
                />
              )}
              {showFootprint && footprint && (
                <Polygon positions={footprint.hull}
                  pathOptions={{ color: '#facc15', weight: 2, fillColor: '#7f1d1d', fillOpacity: 0.3 }}>
                  <Popup>
                    <div style={{ minWidth: 190 }}>
                      <strong>Largest candidate cluster footprint</strong><br />
                      {footprint.n} harmonized detections in this cluster.<br />
                      The outline is the convex hull of its detection points — an
                      approximation of the affected area, not a measured burn-scar
                      perimeter (that requires burned-area products).
                    </div>
                  </Popup>
                </Polygon>
              )}
              {viewMode === 'hex' && hexes.map((c) => (
                <Polygon key={c.key} positions={c.corners}
                  pathOptions={{ color: 'rgba(255,255,255,0.25)', weight: 0.5, fillColor: hexColor(c.t), fillOpacity: 0.68 }}>
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <strong>Hex cell — {c.count} detections</strong><br />
                      MODIS: {c.modis} · VIIRS: {c.viirs}<br />
                      Total FRP: {Math.round(c.frpSum)} MW · Peak FRP: {c.frpMax} MW
                    </div>
                  </Popup>
                </Polygon>
              ))}
              {viewMode !== 'hex' && points.filter((o) => !flameIds.has(o.id)).map((o) => (
                <CircleMarker key={o.id} center={[o.latitude, o.longitude]} radius={frpRadius(o.frp)}
                  pathOptions={{
                    color: pointColor(o), fillColor: pointColor(o),
                    fillOpacity: viewMode === 'intensity' ? 0.55 : 0.7, weight: 0.4,
                  }}>
                  <Popup><HotspotPopup o={o} color={pointColor(o)} /></Popup>
                </CircleMarker>
              ))}
              {viewMode !== 'hex' && points.filter((o) => o.frp != null && o.frp >= 50).map((o) => (
                <CircleMarker key={`core-${o.id}`} center={[o.latitude, o.longitude]} radius={2}
                  pathOptions={{ color: '#fff7ed', fillColor: '#fff7ed', fillOpacity: 0.95, weight: 0 }} />
              ))}
              {flames.map((o) => (
                <Marker key={`flame-${o.id}`} position={[o.latitude, o.longitude]}
                  icon={flameIcon(pointColor(o), o.frp >= 50 ? 26 : 20)}>
                  <Popup><HotspotPopup o={o} color={pointColor(o)} /></Popup>
                </Marker>
              ))}
            </MapContainer>
            )}
          </div>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-500">
            Each detection is one satellite-observed thermal anomaly (a hotspot), not a confirmed ground-truth wildfire.
            In Hex grid view, cells aggregate the detections inside them (colour = how many, relative to the busiest cell in view).
            The yellow-outlined footprint is the convex hull of the largest candidate cluster's detections — an approximation
            of the affected area, not a measured burn-scar perimeter. FRP (fire radiative power, MW) is the satellite's
            measurement of radiative energy, so bright, dense areas are where burning was most intense, not just most frequent.
          </p>
        </div>
      </div>
    </div>
  )
}
