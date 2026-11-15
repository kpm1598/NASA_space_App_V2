import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

// Globe view for the Fire Map: a realistic textured Earth (NASA Blue
// Marble) rendered with three.js, with the same harmonized hotspots the
// flat map shows plotted on the sphere surface. Colours and the
// size-grows-with-FRP language mirror frpTier()/frpRadius() in
// FireMap.jsx — the tiers below are that exact scale, bucketed so each
// tier can be one THREE.Points cloud with its own dot size.

const EARTH_TEXTURE_URL = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg'

const TIERS = [
  { key: 'unknown', color: '#94a3b8', size: 0.017, test: (frp) => frp == null },
  { key: 'low', color: '#facc15', size: 0.021, test: (frp) => frp < 5 },
  { key: 'moderate', color: '#fb923c', size: 0.029, test: (frp) => frp < 20 },
  { key: 'high', color: '#f97316', size: 0.039, test: (frp) => frp < 50 },
  { key: 'extreme', color: '#ef4444', size: 0.053, test: () => true },
]

// Dataset AOI centre (Chhattisgarh–Odisha fire belt) — the globe starts
// facing it.
const START_LON = 82.0
const START_LAT = 21.0
const SPIN_SPEED = 0.03 // rad/s, eastward drift
const TILT_MIN = -0.35
const TILT_MAX = 1.05

// Equirectangular lat/lon -> position on a three.js sphere, matching the
// Blue Marble texture's UV mapping (same convention as three-globe).
function latLonToVec3(lat, lon, radius) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

// Soft round sprite so points read as glowing dots under additive blending.
function makeDotTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  return tex
}

const ATMO_VERT = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const ATMO_FRAG = `
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
    gl_FragColor = vec4(0.35, 0.62, 1.0, 1.0) * intensity;
  }
`

export default function GlobeView({ points, onZoomToMap, center }) {
  const mountRef = useRef(null)
  const [webglFailed, setWebglFailed] = useState(false)
  // Mutable scene state shared between the mount effect and the points
  // effect: rotation, drag state, camera zoom, and callbacks. The globe
  // opens facing `center` when handed one (the flat map's centre, so the
  // zoom hand-off feels continuous), else the dataset AOI centre.
  const rig = useRef({
    spin: THREE.MathUtils.degToRad(-90 - (center?.lon ?? START_LON)),
    tilt: THREE.MathUtils.clamp(
      THREE.MathUtils.degToRad(center?.lat ?? START_LAT), TILT_MIN, TILT_MAX),
    dragging: false,
    lastX: 0,
    lastY: 0,
    spinVel: 0,
    lastInteraction: 0,
    dist: 0,
    distTarget: 0,
    homeDist: 0,
    pointers: new Map(),
    pinchDist: 0,
    rebuildPoints: null,
    onZoomToMap: null,
  })

  useEffect(() => {
    rig.current.onZoomToMap = onZoomToMap
  }, [onZoomToMap])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined
    const state = rig.current

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setWebglFailed(true)
      return undefined
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.domElement.style.display = 'block'
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)

    const tiltGroup = new THREE.Group()
    const spinGroup = new THREE.Group()
    tiltGroup.add(spinGroup)
    scene.add(tiltGroup)

    // Earth: dark placeholder until the Blue Marble texture arrives.
    const earthMat = new THREE.MeshPhongMaterial({ color: 0x14304d, shininess: 0 })
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), earthMat)
    spinGroup.add(earth)

    const texLoader = new THREE.TextureLoader()
    texLoader.load(
      EARTH_TEXTURE_URL,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        earthMat.map = tex
        earthMat.color.set(0xffffff)
        earthMat.needsUpdate = true
      },
      undefined,
      () => { /* keep the dark placeholder sphere if the texture fails */ },
    )

    // Atmosphere: slightly larger BackSide sphere with a fresnel glow.
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.22, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    )
    scene.add(atmosphere)

    scene.add(new THREE.AmbientLight(0xffffff, 1.35))
    const sun = new THREE.DirectionalLight(0xffffff, 0.5)
    sun.position.set(-2.5, 1.8, 2.2)
    scene.add(sun)

    // Hotspot points, rebuilt whenever the filtered observations change.
    const dotTexture = makeDotTexture()
    let pointsGroup = null
    state.rebuildPoints = (obs) => {
      if (pointsGroup) {
        spinGroup.remove(pointsGroup)
        pointsGroup.traverse((child) => {
          child.geometry?.dispose()
          child.material?.dispose()
        })
      }
      pointsGroup = new THREE.Group()
      const buckets = TIERS.map(() => [])
      for (const o of obs || []) {
        if (!Number.isFinite(o.latitude) || !Number.isFinite(o.longitude)) continue
        const tier = TIERS.find((t) => t.test(o.frp))
        buckets[TIERS.indexOf(tier)].push(latLonToVec3(o.latitude, o.longitude, 1.006))
      }
      buckets.forEach((vecs, i) => {
        if (!vecs.length) return
        const geo = new THREE.BufferGeometry().setFromPoints(vecs)
        const mat = new THREE.PointsMaterial({
          color: new THREE.Color(TIERS[i].color),
          size: TIERS[i].size,
          map: dotTexture,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
        })
        pointsGroup.add(new THREE.Points(geo, mat))
      })
      spinGroup.add(pointsGroup)
    }

    const fitCamera = () => {
      const w = mount.clientWidth || 1
      const h = mount.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
      // Fit the globe (r=1) to ~92% of the smaller viewport dimension.
      state.homeDist = 1.09 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect))
      if (!state.dist) {
        state.dist = state.homeDist
        state.distTarget = state.homeDist
      }
      state.distTarget = THREE.MathUtils.clamp(state.distTarget, state.homeDist * 0.45, state.homeDist * 1.35)
      camera.updateProjectionMatrix()
    }
    fitCamera()
    const ro = new ResizeObserver(fitCamera)
    ro.observe(mount)

    // Drag to rotate: horizontal drag spins, vertical drag tilts.
    // Scroll wheel and two-finger pinch zoom the camera; zooming in past
    // the closest stop hands control back to the flat map (Apple-Maps
    // style: globe when far out, flat map when close in).
    const el = renderer.domElement
    const minDist = () => state.homeDist * 0.45
    const maxDist = () => state.homeDist * 1.35
    // The lat/lon the globe currently faces, derived from the start
    // orientation identities (spin = -90 - lon, tilt = lat).
    const facingCentre = () => ({
      lat: THREE.MathUtils.radToDeg(state.tilt),
      lon: ((THREE.MathUtils.radToDeg(-90 - state.spin) + 540) % 360) - 180,
    })
    const onDown = (e) => {
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (state.pointers.size === 2) {
        const [a, b] = [...state.pointers.values()]
        state.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
      state.dragging = true
      state.spinVel = 0
      state.lastInteraction = performance.now()
      state.lastX = e.clientX
      state.lastY = e.clientY
      el.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e) => {
      if (state.pointers.has(e.pointerId)) {
        state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (state.pointers.size === 2) {
          const [a, b] = [...state.pointers.values()]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (state.pinchDist > 0 && d > 0) {
            const ratio = state.pinchDist / d
            if (ratio < 1 && state.distTarget <= minDist() + 1e-6) {
              state.onZoomToMap?.(facingCentre())
            } else {
              state.distTarget = THREE.MathUtils.clamp(state.distTarget * ratio, minDist(), maxDist())
            }
          }
          state.pinchDist = d
          state.lastInteraction = performance.now()
          return
        }
      }
      if (!state.dragging || state.pointers.size > 1) return
      const dx = e.clientX - state.lastX
      const dy = e.clientY - state.lastY
      state.lastX = e.clientX
      state.lastY = e.clientY
      // Grab-the-earth feel: the same pixel drag rotates less when the
      // camera is close, so the surface point under the cursor tracks it.
      const grabScale = state.homeDist ? state.dist / state.homeDist : 1
      const spinDelta = dx * 0.005 * grabScale
      state.spin += spinDelta
      state.spinVel = spinDelta * 60 // rad/s estimate, for release momentum
      state.tilt = THREE.MathUtils.clamp(state.tilt + dy * 0.0035 * grabScale, TILT_MIN, TILT_MAX)
      state.lastInteraction = performance.now()
    }
    const onUp = (e) => {
      state.pointers.delete(e.pointerId)
      if (state.pointers.size < 2) state.pinchDist = 0
      if (state.pointers.size === 0) state.dragging = false
      state.lastInteraction = performance.now()
    }
    const onWheel = (e) => {
      e.preventDefault()
      state.lastInteraction = performance.now()
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      if (delta < 0 && state.distTarget <= minDist() + 1e-6) {
        state.onZoomToMap?.(facingCentre())
        return
      }
      state.distTarget = THREE.MathUtils.clamp(state.distTarget * Math.exp(delta * 0.0012), minDist(), maxDist())
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })

    const autoRotate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = performance.now()
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!state.dragging) {
        if (Math.abs(state.spinVel) > 1e-4) {
          // Flick momentum: glide on after release, friction eases it out.
          state.spin += state.spinVel * dt
          state.spinVel *= Math.exp(-2.2 * dt)
        } else if (autoRotate && now - state.lastInteraction > 4000) {
          state.spin += SPIN_SPEED * dt
        }
      }
      spinGroup.rotation.y = state.spin
      tiltGroup.rotation.x = state.tilt
      state.dist += (state.distTarget - state.dist) * Math.min(1, dt * 7)
      camera.position.z = state.dist
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', onWheel)
      state.rebuildPoints = null
      scene.traverse((child) => {
        child.geometry?.dispose()
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          mats.forEach((m) => { m.map?.dispose(); m.dispose() })
        }
      })
      dotTexture.dispose()
      renderer.dispose()
      mount.removeChild(el)
    }
  }, [])

  useEffect(() => {
    rig.current.rebuildPoints?.(points)
  }, [points])

  const chip = 'pointer-events-none absolute z-10 rounded-sm border border-cyan-300/40 bg-[#04060d]/85 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-200'

  return (
    <div
      ref={mountRef}
      className="relative h-[72vh] w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      style={{ background: 'radial-gradient(ellipse at 50% 42%, #0b1a2e 0%, #050a14 58%, #04060d 100%)' }}
    >
      {webglFailed && (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-400">
          Globe view needs WebGL, which this browser has disabled — the flat map views still work.
        </p>
      )}
      <span className={`${chip} bottom-3 left-3`}>
        Globe · Drag to rotate · Scroll to zoom · {(points?.length ?? 0).toLocaleString('en-IN')} hotspots
      </span>
      <span className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-sm border border-cyan-300/25 bg-[#04060d]/85 px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-slate-400">
        Earth texture: NASA Blue Marble
      </span>
    </div>
  )
}
