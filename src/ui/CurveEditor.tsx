import { useEffect, useRef, useState } from 'react'
import { makeSpline, parametric } from '../engine/curve'
import type { CurvePoint, ToneCurve } from '../engine/params'
import { editor, setParam } from '../store/editor'
import { histStore } from './DetailView'
import { PSlider } from './Slider'
import { capture } from './Menu'

type Mode = 'parametric' | 'master' | 'red' | 'green' | 'blue'

const MODES: { id: Mode; title: string; color: string }[] = [
  { id: 'parametric', title: 'Parametric Curve', color: 'conic-gradient(#888 0 25%, #555 0 50%, #888 0 75%, #555 0)' },
  { id: 'master', title: 'Point Curve', color: '#e8e8e8' },
  { id: 'red', title: 'Red', color: '#e5483f' },
  { id: 'green', title: 'Green', color: '#47b84b' },
  { id: 'blue', title: 'Blue', color: '#3b7fe0' },
]

const STROKE: Record<Mode, string> = { parametric: '#e8e8e8', master: '#e8e8e8', red: '#ff5a50', green: '#5ad25e', blue: '#5a8eff' }

const PARA = {
  highlights: { key: 'curve.highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  lights: { key: 'curve.lights', label: 'Lights', min: -100, max: 100, step: 1 },
  darks: { key: 'curve.darks', label: 'Darks', min: -100, max: 100, step: 1 },
  shadows: { key: 'curve.shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
}

export function CurveEditor() {
  const [mode, setMode] = useState<Mode>('parametric')
  const curve = editor.use((s) => s.params.curve)
  const hist = histStore.use((s) => s.h)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const pts: CurvePoint[] = mode === 'parametric' ? [] : curve[mode]

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const S = Math.round(c.clientWidth * dpr)
    c.width = S
    c.height = S
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, S, S)
    // histogram
    if (hist) {
      const data = mode === 'red' ? hist.r : mode === 'green' ? hist.g : mode === 'blue' ? hist.b : hist.l
      let max = 1
      for (let i = 2; i < 254; i++) max = Math.max(max, data[i])
      ctx.fillStyle = mode === 'red' ? 'rgba(229,72,63,0.22)' : mode === 'green' ? 'rgba(71,184,75,0.22)' : mode === 'blue' ? 'rgba(59,127,224,0.25)' : 'rgba(255,255,255,0.09)'
      ctx.beginPath()
      ctx.moveTo(0, S)
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * S, S - Math.min(1, Math.sqrt(data[i] / max)) * S * 0.9)
      ctx.lineTo(S, S)
      ctx.fill()
    }
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = dpr
    for (let i = 1; i < 4; i++) {
      ctx.beginPath()
      ctx.moveTo((S * i) / 4, 0)
      ctx.lineTo((S * i) / 4, S)
      ctx.moveTo(0, (S * i) / 4)
      ctx.lineTo(S, (S * i) / 4)
      ctx.stroke()
    }
    if (mode === 'parametric') {
      // region split markers
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      for (const sp of [curve.split1, curve.split2, curve.split3]) {
        ctx.beginPath()
        ctx.moveTo((sp / 100) * S, 0)
        ctx.lineTo((sp / 100) * S, S)
        ctx.stroke()
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.moveTo(0, S)
    ctx.lineTo(S, 0)
    ctx.stroke()
    const f = mode === 'parametric' ? parametric(curve) : makeSpline(pts)
    ctx.strokeStyle = STROKE[mode]
    ctx.lineWidth = 1.6 * dpr
    ctx.beginPath()
    for (let i = 0; i <= 200; i++) {
      const x = i / 200
      const y = Math.min(1, Math.max(0, f(x)))
      if (i === 0) ctx.moveTo(x * S, (1 - y) * S)
      else ctx.lineTo(x * S, (1 - y) * S)
    }
    ctx.stroke()
    if (mode !== 'parametric') {
      pts.forEach(([x, y], i) => {
        ctx.fillStyle = i === active ? '#fff' : STROKE[mode]
        ctx.strokeStyle = '#1a1a1a'
        ctx.lineWidth = 1.5 * dpr
        ctx.beginPath()
        ctx.arc(x * S, (1 - y) * S, 4.5 * dpr, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      })
    }
  }, [curve, hist, mode, pts, active])

  const setPoints = (next: CurvePoint[]) => setParam(`curve.${mode}`, next, mode === 'master' ? 'Point Curve' : `Curve ${MODES.find((m) => m.id === mode)?.title}`)

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode === 'parametric' || e.button !== 0) return
    const box = boxRef.current!.getBoundingClientRect()
    const toXY = (ev: { clientX: number; clientY: number }): CurvePoint => [
      Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, 1 - (ev.clientY - box.top) / box.height)),
    ]
    const [x, y] = toXY(e)
    const tol = 10 / box.width
    let idx = pts.findIndex(([px, py]) => Math.abs(px - x) < tol && Math.abs(py - y) < tol * 1.6)
    const cur = pts.map((p) => [...p] as CurvePoint)
    if (idx < 0) {
      // Add a point on the curve at x.
      const yOn = makeSpline(pts)(x)
      cur.push([x, Math.abs(yOn - y) < 0.12 ? yOn : y])
      cur.sort((a, b) => a[0] - b[0])
      idx = cur.findIndex((p) => p[0] === x)
      setPoints(cur)
    }
    setActive(idx)
    const el = e.currentTarget as HTMLElement
    capture(el, e.pointerId)
    const move = (ev: PointerEvent) => {
      const outside = ev.clientY < box.top - 30 || ev.clientY > box.bottom + 30
      const [nx, ny] = toXY(ev)
      const next = cur.map((p) => [...p] as CurvePoint)
      const lo = idx > 0 ? next[idx - 1][0] + 0.01 : 0
      const hi = idx < next.length - 1 ? next[idx + 1][0] - 0.01 : 1
      const isEnd = idx === 0 || idx === next.length - 1
      if (outside && !isEnd && next.length > 2) {
        // Dragging far outside removes the point.
        setPoints(next.filter((_, i) => i !== idx))
        return
      }
      next[idx] = [Math.min(hi, Math.max(lo, nx)), ny]
      setPoints(next)
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      if (ev.clientY < box.top - 30 || ev.clientY > box.bottom + 30) setActive(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (mode === 'parametric') return
    const box = boxRef.current!.getBoundingClientRect()
    const x = (e.clientX - box.left) / box.width
    const y = 1 - (e.clientY - box.top) / box.height
    const tol = 12 / box.width
    const idx = pts.findIndex(([px, py]) => Math.abs(px - x) < tol && Math.abs(py - y) < tol * 1.6)
    if (idx > 0 && idx < pts.length - 1) setPoints(pts.filter((_, i) => i !== idx))
    setActive(null)
  }

  return (
    <div>
      <div className="chan-tabs">
        {MODES.map((m) => (
          <button key={m.id} className={`chan${mode === m.id ? ' on' : ''}`} style={{ background: m.color }} title={m.title} onClick={() => (setMode(m.id), setActive(null))} />
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--c-text-3)', alignSelf: 'center' }}>{MODES.find((m) => m.id === mode)?.title}</span>
      </div>
      <div className="curve-box" ref={boxRef} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} style={{ cursor: mode === 'parametric' ? 'default' : 'crosshair' }}>
        <canvas ref={canvasRef} />
      </div>
      {mode === 'parametric' ? (
        <>
          <SplitSliders curve={curve} />
          <PSlider def={PARA.highlights} />
          <PSlider def={PARA.lights} />
          <PSlider def={PARA.darks} />
          <PSlider def={PARA.shadows} />
        </>
      ) : (
        <div style={{ color: 'var(--c-text-3)', fontSize: 11, lineHeight: 1.45 }}>Click to add a point, drag to move it. Double-click or drag it off the graph to remove it.</div>
      )}
    </div>
  )
}

/** Three draggable split points under the parametric curve. */
function SplitSliders({ curve }: { curve: ToneCurve }) {
  const ref = useRef<HTMLDivElement>(null)
  const keys = ['split1', 'split2', 'split3'] as const
  const onDown = (k: (typeof keys)[number]) => (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    capture(el, e.pointerId)
    const box = ref.current!.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const v = Math.round(((ev.clientX - box.left) / box.width) * 100)
      const i = keys.indexOf(k)
      const lo = i > 0 ? curve[keys[i - 1]] + 5 : 5
      const hi = i < 2 ? curve[keys[i + 1]] - 5 : 95
      setParam(`curve.${k}`, Math.min(hi, Math.max(lo, v)), 'Curve: Region Split')
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div ref={ref} style={{ position: 'relative', height: 14, margin: '0 0 6px' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 6, height: 1, background: '#444' }} />
      {keys.map((k) => (
        <div
          key={k}
          onPointerDown={onDown(k)}
          onDoubleClick={() => setParam(`curve.${k}`, { split1: 25, split2: 50, split3: 75 }[k], 'Curve: Region Split')}
          title="Move the region split (double-click: reset)"
          style={{ position: 'absolute', left: `${curve[k]}%`, top: 0, width: 0, height: 0, marginLeft: -6, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '9px solid #bbb', cursor: 'ew-resize' }}
        />
      ))}
    </div>
  )
}
