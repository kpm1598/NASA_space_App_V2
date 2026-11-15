const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

async function get(path) {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`API ${path} returned ${r.status}`)
  return r.json()
}

export const api = {
  base: BASE,
  health: () => get('/api/health'),
  stats: () => get('/api/stats'),
  calendar: () => get('/api/calendar'),
  clusters: () => get('/api/clusters'),
  anomalies: () => get('/api/anomalies'),
  insights: () => get('/api/insights'),
  harmonization: () => get('/api/harmonization'),
  observation: (id) => get(`/api/observations/${id}`),
  observations: (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v != null))
    return get(`/api/observations?${qs}`)
  },
  ingestSample: async () => {
    const r = await fetch(`${BASE}/api/ingest/sample`, { method: 'POST' })
    if (!r.ok) throw new Error('ingest failed')
    return r.json()
  },
  reportUrl: `${BASE}/api/report.csv`,
  observationsCsvUrl: (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v != null))
    return `${BASE}/api/observations.csv?${qs}`
  },
}
