import { useState } from 'react'
import type { BrushStroke } from '../engine/params'
import { autoSource, type Spot } from '../engine/retouch'
import { apply, frameToSource, sourceToFrame } from '../engine/transform'
import { change, editor } from '../store/editor'
import { uid } from '../store/library'
import { createStore } from '../store/store'
import { ui } from '../store/ui'
import type { ViewInfo } from './DetailView'
import { capture } from './Menu'
import { Slider } from './Slider'

export const retouchUI = createStore<{ mode: 'remove' | 'heal' | 'clone'; size: number; feather: number; opacity: number; selected: string | null; showSpots: boolean }>({
  mode: 'remove',
  size: 18,
  feather: 50,
  opacity: 100,
  selected: null,
  showSpots: true,
})

const MODE_NAMES = { remove: 'Remove', heal: 'Heal', clone: 'Clone', redeye: 'Red Eye' }

const spots = () => editor.get().params.spots
function setSpots(next: Spot[], label: string, key?: string) {
  change({ ...editor.get().params, spots: next }, label, key)
}

export function deleteSelectedSpot(): boolean {
  const sel = retouchUI.get().selected
  if (!sel || !spots().find((s) => s.id === sel)) return false
  setSpots(
    spots().filter((s) => s.id !== sel),
    'Delete Retouch',
  )
  retouchUI.set({ selected: null })
  return true
}

const brushRadius = (size: number) => (size / 100) ** 1.6 * 0.2

function NotInDetail({ title }: { title: string }) {
  return (
    <>
      <div className="panel-head">{title}</div>
      <div className="panel-empty">
        <b>Grid view</b>
        This tool is available in the detail view.
      </div>
    </>
  )
}

export function RemovePanel() {
  const s = retouchUI.use((x) => x)
  const list = editor.use((x) => x.params.spots)
  const photoId = editor.use((x) => x.photoId)
  const view = ui.use((x) => x.view)
  if (!(view === 'detail' || view === 'compare') || !photoId) return <NotInDetail title="Remove" />
  const sel = list.find((x) => x.id === s.selected && x.mode !== 'redeye')
  const own = list.filter((x) => x.mode !== 'redeye')
  return (
    <>
      <div className="panel-head">
        Remove
        <span className="spacer" />
        <button className="btn quiet small" disabled={!own.length} onClick={() => setSpots(list.filter((x) => x.mode === 'redeye'), 'Delete All Retouches')}>
          Delete All
        </button>
      </div>
      <div className="panel-scroll">
        <div className="section-body" style={{ paddingTop: 12 }}>
          <div className="seg" style={{ display: 'flex' }}>
            {(['remove', 'heal', 'clone'] as const).map((m) => (
              <button key={m} className={s.mode === m ? 'on' : ''} style={{ flex: 1 }} onClick={() => retouchUI.set({ mode: m })}>
                {MODE_NAMES[m]}
              </button>
            ))}
          </div>
          <p style={{ color: 'var(--c-text-3)', fontSize: 11, lineHeight: 1.5 }}>
            {s.mode === 'remove'
              ? 'Paint over a distracting object. The area is filled from its surroundings (on-device, no AI service).'
              : s.mode === 'heal'
                ? 'Paint over a spot. Texture comes from a matching area while color and light are kept.'
                : 'Paint over a spot. Pixels are copied 1:1 from the source.'}{' '}
            Drag the dashed source to move it.
          </p>
          <Slider def={{ key: 'r.size', label: 'Size', min: 1, max: 100, step: 1 }} value={s.size} defaultValue={18} onChange={(v) => retouchUI.set({ size: v })} />
          <Slider def={{ key: 'r.feather', label: 'Feather', min: 0, max: 100, step: 1 }} value={s.feather} defaultValue={50} onChange={(v) => retouchUI.set({ feather: v })} />
          <Slider def={{ key: 'r.opacity', label: 'Opacity', min: 1, max: 100, step: 1 }} value={s.opacity} defaultValue={100} onChange={(v) => retouchUI.set({ opacity: v })} />
          <label className="wb-row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={s.showSpots} onChange={(e) => retouchUI.set({ showSpots: e.target.checked })} />
            <span>Show Retouches</span>
          </label>
        </div>
        {sel && (
          <div className="section-body" style={{ borderTop: '1px solid var(--c-line-2)', paddingTop: 10 }}>
            <div className="sub-title">Selected: {MODE_NAMES[sel.mode]}</div>
            {sel.mode !== 'remove' && (
              <Slider
                def={{ key: 'sp.op', label: 'Opacity', min: 1, max: 100, step: 1 }}
                value={sel.opacity}
                defaultValue={100}
                onChange={(v) => setSpots(list.map((x) => (x.id === sel.id ? { ...x, opacity: v } : x)), 'Opacity', `spot.${sel.id}.op`)}
              />
            )}
            <div className="sub-btns">
              {sel.mode !== 'remove' && (
                <button className="sub-btn" onClick={() => setSpots(list.map((x) => (x.id === sel.id ? { ...x, mode: x.mode === 'heal' ? 'clone' : 'heal' } : x)), 'Switch Mode')}>
                  {sel.mode === 'heal' ? 'Switch to Clone' : 'Switch to Heal'}
                </button>
              )}
              <button className="sub-btn" onClick={() => deleteSelectedSpot()}>
                Delete (Del)
              </button>
            </div>
          </div>
        )}
        <div className="panel-empty" style={{ padding: '10px 18px' }}>
          {own.length} {own.length === 1 ? 'retouch' : 'retouches'}
        </div>
      </div>
    </>
  )
}

export function RedEyePanel() {
  const list = editor.use((x) => x.params.spots)
  const sel = retouchUI.use((x) => x.selected)
  const photoId = editor.use((x) => x.photoId)
  const view = ui.use((x) => x.view)
  if (!(view === 'detail' || view === 'compare') || !photoId) return <NotInDetail title="Red Eye" />
  const eyes = list.filter((x) => x.mode === 'redeye')
  const cur = eyes.find((x) => x.id === sel)
  const setEye = (patch: Partial<NonNullable<Spot['eye']>>, label: string, k: string) =>
    cur && setSpots(list.map((x) => (x.id === cur.id ? { ...x, eye: { ...x.eye!, ...patch } } : x)), label, `eye.${cur.id}.${k}`)
  return (
    <>
      <div className="panel-head">
        Red Eye
        <span className="spacer" />
        <button className="btn quiet small" disabled={!eyes.length} onClick={() => setSpots(list.filter((x) => x.mode !== 'redeye'), 'Delete Red Eye Corrections')}>
          Delete All
        </button>
      </div>
      <div className="panel-scroll">
        <div className="section-body" style={{ paddingTop: 12 }}>
          <p style={{ color: 'var(--c-text-3)', fontSize: 11, lineHeight: 1.5, marginTop: 0 }}>Drag from the center of an eye (or click it) to fix red pupils.</p>
          {cur ? (
            <>
              <Slider def={{ key: 'e.p', label: 'Pupil Size', min: 0, max: 100, step: 1 }} value={cur.eye!.pupil} defaultValue={50} onChange={(v) => setEye({ pupil: v }, 'Pupil Size', 'p')} />
              <Slider def={{ key: 'e.d', label: 'Darken', min: 0, max: 100, step: 1 }} value={cur.eye!.darken} defaultValue={50} onChange={(v) => setEye({ darken: v }, 'Darken', 'd')} />
              <div className="sub-btns">
                <button className="sub-btn" onClick={() => deleteSelectedSpot()}>
                  Delete Eye (Del)
                </button>
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--c-text-3)' }}>{eyes.length ? 'Click an eye to edit it.' : 'No corrections yet.'}</div>
          )}
        </div>
      </div>
    </>
  )
}

/** Canvas interaction for the remove/heal/clone and red-eye tools. */
export function RetouchOverlay({ v, redeye }: { v: ViewInfo; redeye?: boolean }) {
  const s = retouchUI.use((x) => x)
  const params = editor.use((x) => x.params)
  const [live, setLive] = useState<BrushStroke | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const r = v.renderer
  const [ow, oh] = r.orientedSize(params)
  const long = Math.max(r.fullW, r.fullH)
  const toS = (x: number, y: number) => frameToSource(params, ow, oh, ...apply(v.toFrame, x, y))
  const toC = (x: number, y: number) => apply(v.fromFrame, ...sourceToFrame(params, ow, oh, x, y))
  const [a0x, a0y] = toC(0.5, 0.5)
  const [a1x, a1y] = toC(0.5 + 1 / r.fullW, 0.5)
  const pxScale = Math.hypot(a1x - a0x, a1y - a0y)
  const radiusCss = brushRadius(s.size) * long * pxScale

  const local = (e: { clientX: number; clientY: number; currentTarget: EventTarget | null }, el?: HTMLElement) => {
    const b = (el ?? (e.currentTarget as HTMLElement)).getBoundingClientRect()
    return [e.clientX - b.left, e.clientY - b.top] as [number, number]
  }

  const hitSpot = (x: number, y: number): { spot: Spot; source: boolean } | null => {
    for (const sp of [...params.spots].reverse()) {
      if ((sp.mode === 'redeye') !== !!redeye) continue
      if (sp.mode === 'redeye' && sp.eye) {
        const [cx, cy] = toC(sp.eye.cx, sp.eye.cy)
        if (Math.hypot(cx - x, cy - y) < sp.eye.r * long * pxScale + 4) return { spot: sp, source: false }
        continue
      }
      for (const src of [false, true]) {
        if (src && sp.mode === 'remove') continue
        for (const st of sp.strokes) {
          const rr = st.size * long * pxScale + 3
          for (let i = 0; i + 1 < st.pts.length; i += 2) {
            const [cx, cy] = toC(st.pts[i] + (src ? sp.dx : 0), st.pts[i + 1] + (src ? sp.dy : 0))
            if (Math.hypot(cx - x, cy - y) < rr) return { spot: sp, source: src }
          }
        }
      }
    }
    return null
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    capture(el, e.pointerId)
    const [px, py] = local(e)
    const hit = hitSpot(px, py)
    if (hit && (hit.source || e.altKey || redeye)) {
      retouchUI.set({ selected: hit.spot.id })
      if (redeye || !hit.source) return
      // Move the source of a heal/clone spot.
      const [sx, sy] = toS(px, py)
      const start = { dx: hit.spot.dx, dy: hit.spot.dy }
      const move = (ev: PointerEvent) => {
        const [tx, ty] = toS(...local(ev, el))
        setDrag({ id: hit.spot.id, dx: start.dx + tx - sx, dy: start.dy + ty - sy })
      }
      const up = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        const [tx, ty] = toS(...local(ev, el))
        setDrag(null)
        setSpots(
          params.spots.map((x) => (x.id === hit.spot.id ? { ...x, dx: start.dx + tx - sx, dy: start.dy + ty - sy } : x)),
          'Move Source',
        )
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      return
    }
    if (hit && !e.shiftKey) {
      retouchUI.set({ selected: hit.spot.id })
      return
    }
    const [sx, sy] = toS(px, py)
    if (redeye) {
      let rr = 0.012
      const move = (ev: PointerEvent) => {
        const [tx, ty] = toS(...local(ev, el))
        rr = Math.max(0.004, Math.hypot((tx - sx) * r.fullW, (ty - sy) * r.fullH) / long)
        setLive({ pts: [sx, sy], size: rr, feather: 0, flow: 100, erase: false })
      }
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        setLive(null)
        const sp: Spot = { id: uid(), mode: 'redeye', strokes: [], dx: 0, dy: 0, opacity: 100, feather: 0, eye: { cx: sx, cy: sy, r: rr, pupil: 50, darken: 50 } }
        setSpots([...params.spots, sp], 'Red Eye')
        retouchUI.set({ selected: sp.id })
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      return
    }
    const stroke: BrushStroke = { pts: [sx, sy], size: brushRadius(s.size), feather: s.feather, flow: 100, erase: false }
    setLive(stroke)
    const move = (ev: PointerEvent) => {
      const [qx, qy] = local(ev, el)
      setCursor([qx, qy])
      const [tx, ty] = toS(qx, qy)
      stroke.pts = [...stroke.pts, tx, ty]
      setLive({ ...stroke })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setLive(null)
      const sp: Spot = { id: uid(), mode: s.mode, strokes: [stroke], dx: 0, dy: 0, opacity: s.opacity, feather: s.feather }
      if (s.mode !== 'remove') {
        const work = r.workingCanvas()
        if (work) Object.assign(sp, autoSource(work, sp))
      }
      setSpots([...params.spots, sp], MODE_NAMES[s.mode])
      retouchUI.set({ selected: sp.id })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const path = (st: BrushStroke, ox = 0, oy = 0) => {
    const pts: string[] = []
    for (let i = 0; i + 1 < st.pts.length; i += 2) pts.push(toC(st.pts[i] + ox, st.pts[i + 1] + oy).join(','))
    return pts.join(' ')
  }
  const shapes: React.ReactNode[] = []
  if (s.showSpots || redeye)
    for (const sp of params.spots) {
      if ((sp.mode === 'redeye') !== !!redeye) continue
      const selected = sp.id === s.selected
      if (sp.mode === 'redeye' && sp.eye) {
        const [cx, cy] = toC(sp.eye.cx, sp.eye.cy)
        shapes.push(<circle key={sp.id} cx={cx} cy={cy} r={sp.eye.r * long * pxScale} fill="none" stroke={selected ? '#4d8bff' : '#fff'} strokeWidth={selected ? 2 : 1.2} />)
        continue
      }
      const d = drag?.id === sp.id ? drag : sp
      for (const [i, st] of sp.strokes.entries()) {
        const w = st.size * long * pxScale * 2
        shapes.push(<polyline key={`${sp.id}d${i}`} points={path(st)} fill="none" stroke={selected ? 'rgba(77,139,255,0.9)' : 'rgba(255,255,255,0.75)'} strokeWidth={Math.max(2, w)} strokeLinecap="round" strokeLinejoin="round" opacity={selected ? 0.35 : 0.18} />)
        if (sp.mode !== 'remove' && selected) {
          shapes.push(<polyline key={`${sp.id}s${i}`} points={path(st, d.dx, d.dy)} fill="none" stroke="#fff" strokeWidth={Math.max(2, w)} strokeLinecap="round" strokeLinejoin="round" opacity={0.25} strokeDasharray="6 5" />)
          const a = toC(st.pts[0], st.pts[1])
          const b = toC(st.pts[0] + d.dx, st.pts[1] + d.dy)
          shapes.push(<line key={`${sp.id}l${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#fff" strokeWidth={1} strokeDasharray="4 4" />)
        }
      }
    }
  if (live) {
    if (redeye) {
      const [cx, cy] = toC(live.pts[0], live.pts[1])
      shapes.push(<circle key="live" cx={cx} cy={cy} r={live.size * long * pxScale} fill="none" stroke="#4d8bff" strokeWidth={2} />)
    } else shapes.push(<polyline key="live" points={path(live)} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={Math.max(2, radiusCss * 2)} strokeLinecap="round" strokeLinejoin="round" />)
  }
  return (
    <div
      style={{ position: 'absolute', inset: 0, cursor: redeye ? 'crosshair' : 'none' }}
      onPointerDown={onDown}
      onPointerMove={(e) => setCursor(local(e))}
      onPointerLeave={() => setCursor(null)}
    >
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {shapes}
        {!redeye && cursor && <circle cx={cursor[0]} cy={cursor[1]} r={radiusCss} fill="none" stroke="#fff" strokeWidth={1.2} />}
      </svg>
      {r.retouching && (
        <div className="overlay-label" style={{ top: 'auto', bottom: 14 }}>
          Calculating retouch …
        </div>
      )}
    </div>
  )
}

