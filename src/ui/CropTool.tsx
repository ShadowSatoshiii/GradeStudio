import { useEffect, useRef, useState } from 'react'
import * as A from '../actions'
import { ASPECTS, clampMove, clampTo, constrainCrop, cropForAspect, fitAfterRotate, orientAspect, rotateAspect, type Rect } from '../engine/cropmath'
import { defaultParams, S, type CropState } from '../engine/params'
import { apply, orientedSize, parseAspect } from '../engine/transform'
import { change, editor, setParam } from '../store/editor'
import { lib } from '../store/library'
import { ui } from '../store/ui'
import type { ViewInfo } from './DetailView'
import { IconFlipH, IconFlipV, IconReset, IconRotateLeft, IconRotateRight, IconStraighten } from './Icons'
import { Section } from './Section'
import { PSlider } from './Slider'
import { capture } from './Menu'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'rotate'

function useOriented(): [number, number] {
  const id = editor.use((s) => s.photoId)
  const rot = editor.use((s) => s.params.crop.rot90)
  const p = lib.use((s) => (id ? s.photos[id] : undefined))
  return p ? orientedSize(p.width, p.height, rot) : [1, 1]
}

function setCrop(c: CropState, label = 'Crop') {
  setParam('crop', c, label)
}

/** Overlay on the canvas in crop mode: frame, handles, grid, drag to move/resize/rotate. */
export function CropOverlay({ v }: { v: ViewInfo }) {
  const crop = editor.use((s) => s.params.crop)
  const overlay = ui.use((s) => s.cropOverlay)
  const locked = ui.use((s) => s.cropLocked)
  const tool = ui.use((s) => s.tool)
  const [ow, oh] = useOriented()
  const [drag, setDrag] = useState<Handle | null>(null)
  const [line, setLine] = useState<[number, number, number, number] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const toCss = (x: number, y: number) => apply(v.fromFrame, x, y)
  const [x0, y0] = toCss(crop.x, crop.y)
  const [x1, y1] = toCss(crop.x + crop.w, crop.y + crop.h)
  const W = x1 - x0
  const H = y1 - y0

  const hit = (px: number, py: number): Handle => {
    const t = 12
    const nearL = Math.abs(px - x0) < t
    const nearR = Math.abs(px - x1) < t
    const nearT = Math.abs(py - y0) < t
    const nearB = Math.abs(py - y1) < t
    const inX = px > x0 - t && px < x1 + t
    const inY = py > y0 - t && py < y1 + t
    if (nearT && nearL) return 'nw'
    if (nearT && nearR) return 'ne'
    if (nearB && nearL) return 'sw'
    if (nearB && nearR) return 'se'
    if (nearT && inX) return 'n'
    if (nearB && inX) return 's'
    if (nearL && inY) return 'w'
    if (nearR && inY) return 'e'
    if (px > x0 && px < x1 && py > y0 && py < y1) return 'move'
    return 'rotate'
  }

  const cursorFor = (h: Handle | null) =>
    ({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', rotate: 'alias' })[h ?? 'move']

  const [hover, setHover] = useState<Handle | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const box = ref.current!.getBoundingClientRect()
    const px = e.clientX - box.left
    const py = e.clientY - box.top
    const el = e.currentTarget as HTMLElement
    capture(el, e.pointerId)
    const start = { ...crop }
    const startRect: Rect = { x: crop.x, y: crop.y, w: crop.w, h: crop.h }
    const [sx, sy] = apply(v.toFrame, px, py)

    if (tool === 'straighten' || e.ctrlKey) {
      // Draw a line that should become horizontal (or vertical).
      const move = (ev: PointerEvent) => setLine([px, py, ev.clientX - box.left, ev.clientY - box.top])
      const up = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        setLine(null)
        const dx = ev.clientX - box.left - px
        const dy = ev.clientY - box.top - py
        if (Math.hypot(dx, dy) < 8) return
        let a = (Math.atan2(dy, dx) * 180) / Math.PI
        if (a > 90) a -= 180
        if (a < -90) a += 180
        // Steep lines are treated as verticals.
        const delta = Math.abs(a) > 45 ? (a > 0 ? a - 90 : a + 90) : a
        const angle = Math.max(-45, Math.min(45, +(start.angle - delta).toFixed(2)))
        const next = { ...start, angle }
        setCrop({ ...next, ...fitAfterRotate(startRect, next, ow, oh) }, 'Straighten')
        ui.set({ tool: null })
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      return
    }

    const h = hit(px, py)
    setDrag(h)
    const aspect = parseAspect(start.aspect, ow, oh)
    const lockAspect = locked && aspect !== null
    const cx = start.x + start.w / 2
    const cy = start.y + start.h / 2
    const a0 = Math.atan2((sy - cy) * oh, (sx - cx) * ow)

    const move = (ev: PointerEvent) => {
      const qx = ev.clientX - box.left
      const qy = ev.clientY - box.top
      const [fx, fy] = apply(v.toFrame, qx, qy)
      if (h === 'move') {
        const want = { ...startRect, x: startRect.x + (fx - sx), y: startRect.y + (fy - sy) }
        setCrop({ ...start, ...clampMove(startRect, want, start, ow, oh) })
        return
      }
      if (h === 'rotate') {
        const a1 = Math.atan2((fy - cy) * oh, (fx - cx) * ow)
        let angle = start.angle + ((a1 - a0) * 180) / Math.PI
        if (ev.shiftKey) angle = Math.round(angle)
        angle = Math.max(-45, Math.min(45, +angle.toFixed(2)))
        const next = { ...start, angle }
        setCrop({ ...next, ...fitAfterRotate(startRect, next, ow, oh) }, 'Straighten')
        return
      }
      // Resize from a handle; the opposite side stays fixed.
      let l = startRect.x
      let t = startRect.y
      let r = startRect.x + startRect.w
      let b = startRect.y + startRect.h
      if (h.includes('w')) l = Math.min(fx, r - 0.02)
      if (h.includes('e')) r = Math.max(fx, l + 0.02)
      if (h.includes('n')) t = Math.min(fy, b - 0.02)
      if (h.includes('s')) b = Math.max(fy, t + 0.02)
      if (lockAspect || ev.shiftKey) {
        const ar = lockAspect ? aspect! : (startRect.w * ow) / (startRect.h * oh)
        let w = r - l
        let hh = b - t
        if (h === 'n' || h === 's') w = (hh * oh * ar) / ow
        else if (h === 'e' || h === 'w') hh = (w * ow) / ar / oh
        else if ((w * ow) / (hh * oh) > ar) hh = (w * ow) / ar / oh
        else w = (hh * oh * ar) / ow
        if (h === 'n' || h === 's') {
          l = cx - w / 2
          r = cx + w / 2
        } else if (h === 'e' || h === 'w') {
          t = cy - hh / 2
          b = cy + hh / 2
        }
        if (h.includes('w')) l = r - w
        else if (h.includes('e')) r = l + w
        if (h.includes('n')) t = b - hh
        else if (h.includes('s')) b = t + hh
      }
      const want = { x: l, y: t, w: r - l, h: b - t }
      setCrop({ ...start, ...clampTo(startRect, want, start, ow, oh), aspect: lockAspect ? start.aspect : 'free' })
    }
    const up = () => {
      setDrag(null)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const showGrid = overlay !== 'none'
  const gridLines: [number, number, number, number][] = []
  if (showGrid) {
    const fracs = overlay === 'grid' ? [1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8] : overlay === 'golden' ? [0.382, 0.618] : overlay === 'thirds' ? [1 / 3, 2 / 3] : []
    for (const f of fracs) {
      gridLines.push([x0 + W * f, y0, x0 + W * f, y1])
      gridLines.push([x0, y0 + H * f, x1, y0 + H * f])
    }
    if (overlay === 'diagonal') {
      gridLines.push([x0, y0, x1, y1], [x1, y0, x0, y1])
    }
  }
  const hl = 14
  const corner = (x: number, y: number, dx: number, dy: number) => `M${x + dx * hl},${y} L${x},${y} L${x},${y + dy * hl}`

  return (
    <div
      ref={ref}
      style={{ position: 'absolute', inset: 0, cursor: tool === 'straighten' ? 'crosshair' : cursorFor(drag ?? hover) }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        if (drag) return
        const box = ref.current!.getBoundingClientRect()
        setHover(hit(e.clientX - box.left, e.clientY - box.top))
      }}
      onDoubleClick={() => ui.set({ panel: 'edit' })}
    >
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {gridLines.map(([a, b, c, d], i) => (
          <line key={i} x1={a} y1={b} x2={c} y2={d} stroke="rgba(255,255,255,0.55)" strokeWidth={drag ? 1 : 0.7} />
        ))}
        <rect x={x0} y={y0} width={W} height={H} fill="none" stroke="#fff" strokeWidth={1} />
        <g stroke="#fff" strokeWidth={3} fill="none">
          <path d={corner(x0, y0, 1, 1)} />
          <path d={corner(x1, y0, -1, 1)} />
          <path d={corner(x0, y1, 1, -1)} />
          <path d={corner(x1, y1, -1, -1)} />
          <path d={`M${x0 + W / 2 - 9},${y0} h18 M${x0 + W / 2 - 9},${y1} h18 M${x0},${y0 + H / 2 - 9} v18 M${x1},${y0 + H / 2 - 9} v18`} />
        </g>
        {line && <line x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke="#4d8bff" strokeWidth={2} />}
      </svg>
      {drag === 'rotate' && (
        <div className="overlay-label" style={{ top: 'auto', bottom: 14 }}>
          {crop.angle.toFixed(1)}°
        </div>
      )}
    </div>
  )
}

/** Landscape ↔ portrait for the current crop (keyboard X). */
export function rotateCropAspect(crop: CropState, ow: number, oh: number) {
  const cur = crop.aspect.includes(':') ? crop.aspect : `${Math.round(crop.w * ow)}:${Math.round(crop.h * oh)}`
  const a = rotateAspect(cur)
  const next = { ...crop, aspect: a }
  setCrop({ ...next, ...cropForAspect(next, a, ow, oh) }, 'Swap Orientation')
}

function GeometryControls() {
  const geo = editor.use((s) => s.params.geometry)
  const crop = editor.use((s) => s.params.crop)
  const [ow, oh] = useOriented()
  const [busy, setBusy] = useState(false)
  // Keep the crop free of empty corners while "Constrain Crop" is on.
  useEffect(() => {
    if (!geo.constrain) return
    const r = constrainCrop(crop, geo, ow, oh)
    if (Math.abs(r.w - crop.w) > 1e-4 || Math.abs(r.h - crop.h) > 1e-4 || Math.abs(r.x - crop.x) > 1e-4 || Math.abs(r.y - crop.y) > 1e-4) setCrop({ ...crop, ...r }, 'Constrain Crop')
  }, [geo, ow, oh, crop.angle, crop.aspect])
  const modes = [
    ['off', 'Off'],
    ['auto', 'Auto'],
    ['level', 'Level'],
    ['vertical', 'Vertical'],
    ['full', 'Full'],
  ] as const
  return (
    <>
      <div className="sub-title">Upright</div>
      <div className="seg" style={{ display: 'flex', margin: '6px 0 8px' }}>
        {modes.map(([m, l]) => (
          <button
            key={m}
            className={geo.upright === m ? 'on' : ''}
            style={{ flex: 1, padding: 0, opacity: busy ? 0.5 : 1 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await A.upright(m)
              } finally {
                setBusy(false)
              }
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <label className="wb-row" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={geo.constrain} onChange={(e) => setParam('geometry.constrain', e.target.checked, 'Constrain Crop')} />
        <span>Constrain Crop</span>
      </label>
    </>
  )
}

export function CropPanel() {
  const crop = editor.use((s) => s.params.crop)
  const locked = ui.use((s) => s.cropLocked)
  const overlay = ui.use((s) => s.cropOverlay)
  const tool = ui.use((s) => s.tool)
  const view = ui.use((s) => s.view)
  const photoId = editor.use((s) => s.photoId)
  const [ow, oh] = useOriented()
  if (!(view === 'detail' || view === 'compare') || !photoId)
    return (
      <>
        <div className="panel-head">Crop & Rotate</div>
        <div className="panel-empty">
          <b>Grid view</b>
          Cropping is available in the detail view.
        </div>
      </>
    )
  const landscape = ow >= oh
  const setAspect = (id: string) => {
    const a = orientAspect(id, (crop.w * ow) / (crop.h * oh) >= 1 || (id !== 'original' && landscape))
    const next = { ...crop, aspect: a }
    setCrop({ ...next, ...cropForAspect(next, a, ow, oh) }, 'Aspect Ratio')
  }
  const aspectValue = ASPECTS.find((x) => x.id === crop.aspect || rotateAspect(x.id) === crop.aspect)?.id ?? 'free'
  const reset = () => {
    const d = defaultParams().crop
    change({ ...editor.get().params, crop: { ...d, rot90: crop.rot90, flipH: crop.flipH, flipV: crop.flipV }, geometry: defaultParams().geometry }, 'Reset Crop')
  }
  return (
    <>
      <div className="panel-head">
        Crop & Rotate
        <span className="spacer" />
        <button className="icon-btn" title="Reset Crop" onClick={reset}>
          <IconReset size={16} />
        </button>
      </div>
      <div className="panel-scroll">
        <div className="section-body" style={{ paddingTop: 12 }}>
          <div className="wb-row">
            <span className="lbl">Aspect</span>
            <select className="select" value={aspectValue} onChange={(e) => setAspect(e.target.value)}>
              {ASPECTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sub-btns" style={{ marginTop: 4 }}>
            <button className={`sub-btn${locked ? ' on' : ''}`} onClick={() => ui.set({ cropLocked: !locked })} title="Lock Aspect Ratio (A)">
              {locked ? 'Locked' : 'Unlocked'}
            </button>
            <button
              className="sub-btn"
              title="Swap Orientation (X)"
              onClick={() => rotateCropAspect(crop, ow, oh)}
            >
              Portrait/Landscape
            </button>
          </div>
          <div style={{ height: 10 }} />
          <PSlider def={S.angle} />
          <div className="sub-btns" style={{ marginTop: 4 }}>
            <button className={`sub-btn${tool === 'straighten' ? ' on' : ''}`} onClick={() => ui.set({ tool: tool === 'straighten' ? null : 'straighten' })} title="Draw a line along the horizon (or Ctrl + drag)">
              <IconStraighten size={14} /> Straighten
            </button>
            <button className="sub-btn" onClick={() => A.autoStraighten()} title="Level the horizon automatically">
              Auto
            </button>
          </div>
          <div className="sub-title" style={{ marginTop: 16 }}>
            Rotate & Flip
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button className="icon-btn" title="Rotate Left" onClick={() => A.rotate(-1)}>
              <IconRotateLeft />
            </button>
            <button className="icon-btn" title="Rotate Right" onClick={() => A.rotate(1)}>
              <IconRotateRight />
            </button>
            <button className="icon-btn" title="Flip Horizontal" onClick={() => A.flip('h')}>
              <IconFlipH />
            </button>
            <button className="icon-btn" title="Flip Vertical" onClick={() => A.flip('v')}>
              <IconFlipV />
            </button>
          </div>
          <div className="wb-row" style={{ marginTop: 14 }}>
            <span className="lbl">Overlay</span>
            <select className="select" value={overlay} onChange={(e) => ui.set({ cropOverlay: e.target.value as typeof overlay })}>
              <option value="thirds">Rule of Thirds</option>
              <option value="grid">Grid</option>
              <option value="golden">Golden Ratio</option>
              <option value="diagonal">Diagonal</option>
              <option value="none">None</option>
            </select>
          </div>
          <div style={{ color: 'var(--c-text-3)', fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>
            Drag corners and edges to resize the crop, drag inside to move it, drag outside to rotate the photo. Hold Shift to keep the aspect ratio. Double-click or Enter: done.
          </div>
        </div>
        <Section id="geometry" title="Geometry" keys={['geometry']}>
          <GeometryControls />
          <div className="sub-title" style={{ marginTop: 12 }}>Manual Transform</div>
          <PSlider def={S.geoDistortion} />
          <PSlider def={S.geoVertical} />
          <PSlider def={S.geoHorizontal} />
          <PSlider def={S.geoRotate} />
          <PSlider def={S.geoAspect} />
          <PSlider def={S.geoScale} />
          <PSlider def={S.geoOffsetX} />
          <PSlider def={S.geoOffsetY} />
        </Section>
        <div style={{ padding: '14px 16px' }}>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => ui.set({ panel: 'edit', tool: null })}>
            Done
          </button>
        </div>
      </div>
    </>
  )
}
