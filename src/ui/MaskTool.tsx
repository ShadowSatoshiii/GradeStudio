import { useEffect, useRef, useState } from 'react'
import { isComputing, onAiMaskReady } from '../ai/aimasks'
import { aiKeyOf, isAiKind } from '../engine/masks'
import { LOCAL_SLIDERS, type LocalAdjust, type Mask, type MaskComp, type MaskKind, type PersonPart } from '../engine/params'
import { apply, frameToSource, sourceToFrame } from '../engine/transform'
import { editor } from '../store/editor'
import { addComp, compName, createMask, deleteComp, deleteMask, duplicateMask, maskUI, PART_NAMES, setAdj, updateComp, updateMask } from '../store/maskops'
import { ui } from '../store/ui'
import type { ViewInfo } from './DetailView'
import { IconBrush, IconClose, IconDots, IconEye, IconEyeOff, IconLinear, IconPerson, IconPlus, IconRadial, IconSky } from './Icons'
import { capture, Dropdown, type MenuItem, openContextMenu } from './Menu'
import { Slider } from './Slider'

const KIND_ICON: Partial<Record<MaskKind, React.ReactNode>> = {
  brush: <IconBrush size={15} />,
  linear: <IconLinear size={15} />,
  radial: <IconRadial size={15} />,
  sky: <IconSky size={15} />,
  person: <IconPerson size={15} />,
  subject: <IconPerson size={15} />,
}

function kindMenu(onPick: (k: MaskKind, part?: PersonPart) => void): MenuItem[] {
  return [
    { heading: 'Automatic (on-device)' },
    { label: 'Select Subject', onClick: () => onPick('subject') },
    { label: 'Select Sky', onClick: () => onPick('sky') },
    { label: 'Select Background', onClick: () => onPick('background') },
    ...(Object.keys(PART_NAMES) as PersonPart[]).map((p) => ({ label: `Person: ${PART_NAMES[p]}`, onClick: () => onPick('person', p) })),
    { sep: true },
    { heading: 'Manual' },
    { label: 'Brush', kbd: 'B', onClick: () => onPick('brush') },
    { label: 'Linear Gradient', kbd: 'L', onClick: () => onPick('linear') },
    { label: 'Radial Gradient', kbd: 'R', onClick: () => onPick('radial') },
    { sep: true },
    { heading: 'Range' },
    { label: 'Color Range', kbd: 'Shift+C', onClick: () => onPick('color') },
    { label: 'Luminance Range', kbd: 'Shift+I', onClick: () => onPick('luminance') },
  ]
}

function useAiTick() {
  const [, set] = useState(0)
  useEffect(() => onAiMaskReady(() => set((x) => x + 1)), [])
}

// ---------- Panel ----------

export function MaskPanel() {
  const photoId = editor.use((s) => s.photoId)
  const view = ui.use((s) => s.view)
  const masks = editor.use((s) => s.params.masks)
  const sel = maskUI.use((s) => s.maskId)
  const overlay = maskUI.use((s) => s.overlay)
  useAiTick()
  // Keep a valid selection.
  useEffect(() => {
    if (!masks.find((m) => m.id === sel)) maskUI.set({ maskId: masks[masks.length - 1]?.id ?? null, compId: masks[masks.length - 1]?.comps[0]?.id ?? null })
  }, [masks, sel])
  if (!(view === 'detail' || view === 'compare') || !photoId)
    return (
      <>
        <div className="panel-head">Masking</div>
        <div className="panel-empty">
          <b>Grid view</b>
          Masks are available in the detail view.
        </div>
      </>
    )
  const mask = masks.find((m) => m.id === sel)
  return (
    <>
      <div className="panel-head">
        Masking
        <span className="spacer" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 400, color: 'var(--c-text-2)', cursor: 'pointer' }} title="Show Overlay (O)">
          <input type="checkbox" checked={overlay} onChange={(e) => maskUI.set({ overlay: e.target.checked })} />
          Overlay
        </label>
      </div>
      <div className="panel-scroll">
        <div className="section-body" style={{ paddingTop: 12 }}>
          <Dropdown
            className="btn primary"
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconPlus size={14} /> Create New Mask
              </span>
            }
            items={() => kindMenu((k, p) => createMask(k, p))}
          />
          {masks.length === 0 && (
            <p style={{ color: 'var(--c-text-3)', lineHeight: 1.5, marginBottom: 0 }}>
              Masks limit an edit to part of the photo: the subject, the sky, a person or an area you paint. Subject, sky and people are detected on your device.
            </p>
          )}
        </div>
        {masks.length > 0 && (
          <div style={{ padding: '0 10px 8px' }}>
            {masks.map((m) => (
              <MaskCard key={m.id} m={m} selected={m.id === sel} />
            ))}
          </div>
        )}
        {mask && <MaskAdjust m={mask} />}
      </div>
    </>
  )
}

function MaskCard({ m, selected }: { m: Mask; selected: boolean }) {
  const compSel = maskUI.use((s) => s.compId)
  const photoId = editor.use((s) => s.photoId)
  const [editing, setEditing] = useState(false)
  return (
    <div
      style={{ border: `1px solid ${selected ? 'var(--c-accent)' : 'var(--c-line)'}`, borderRadius: 6, marginBottom: 8, background: selected ? 'rgba(64,105,253,0.07)' : undefined }}
      onClick={() => !selected && maskUI.set({ maskId: m.id, compId: m.comps[0]?.id ?? null })}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 10px' }}>
        {editing ? (
          <input
            autoFocus
            defaultValue={m.name}
            style={{ flex: 1, background: 'var(--c-canvas)', border: '1px solid var(--c-accent)', borderRadius: 3, padding: '2px 5px', outline: 'none' }}
            onBlur={(e) => {
              setEditing(false)
              if (e.target.value.trim()) updateMask(m.id, (x) => ({ ...x, name: e.target.value.trim() }), 'Rename Mask')
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
            }}
          />
        ) : (
          <span style={{ flex: 1, fontWeight: 600, color: 'var(--c-strong)' }} onDoubleClick={() => setEditing(true)}>
            {m.name}
          </span>
        )}
        <button className="icon-btn" style={{ width: 24, height: 24 }} title={m.visible ? 'Hide Mask' : 'Show Mask'} onClick={(e) => (e.stopPropagation(), updateMask(m.id, (x) => ({ ...x, visible: !x.visible }), m.visible ? 'Mask Off' : 'Mask On'))}>
          {m.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}
        </button>
        <button
          className="icon-btn"
          style={{ width: 24, height: 24 }}
          title="Options"
          onClick={(e) =>
            openContextMenu(e, [
              { label: 'Rename', onClick: () => setEditing(true) },
              { label: 'Invert', checked: m.invert, onClick: () => updateMask(m.id, (x) => ({ ...x, invert: !x.invert }), 'Invert Mask') },
              { label: 'Duplicate', onClick: () => duplicateMask(m.id) },
              { sep: true },
              { label: 'Delete Mask', onClick: () => deleteMask(m.id) },
            ])
          }
        >
          <IconDots size={15} />
        </button>
      </div>
      {selected && (
        <div style={{ padding: '0 8px 8px' }}>
          {m.comps.map((c) => {
            const k = aiKeyOf(c)
            const busy = k && photoId ? isComputing(photoId, k) : false
            return (
              <div
                key={c.id}
                onClick={(e) => (e.stopPropagation(), maskUI.set({ compId: c.id }))}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 4, background: compSel === c.id ? 'var(--c-panel-3)' : undefined, cursor: 'default' }}
              >
                <span style={{ width: 16, textAlign: 'center', color: c.mode === 'subtract' ? '#ff8080' : c.mode === 'intersect' ? '#ffd27a' : '#8fb0ff', fontWeight: 700 }} title={c.mode === 'subtract' ? 'Subtracted' : c.mode === 'intersect' ? 'Intersected' : 'Added'}>
                  {c.mode === 'subtract' ? '−' : c.mode === 'intersect' ? '∩' : '+'}
                </span>
                <span style={{ color: 'var(--c-text-3)' }}>{KIND_ICON[c.kind]}</span>
                <span style={{ flex: 1 }}>
                  {compName(c)}
                  {c.invert ? ' (inverted)' : ''}
                </span>
                {busy && <span style={{ color: 'var(--c-accent-2)', fontSize: 11 }}>detecting …</span>}
                <button className="icon-btn" style={{ width: 22, height: 22, fontSize: 11 }} title="Invert Component" onClick={(e) => (e.stopPropagation(), updateComp(m.id, c.id, (x) => ({ ...x, invert: !x.invert }), 'Invert Component'))}>
                  ⇄
                </button>
                <button className="icon-btn" style={{ width: 22, height: 22 }} title="Delete Component" onClick={(e) => (e.stopPropagation(), deleteComp(m.id, c.id))}>
                  <IconClose size={11} />
                </button>
              </div>
            )
          })}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
            <Dropdown className="sub-btn" label="Add" items={() => kindMenu((k, p) => addComp(k, 'add', p))} />
            <Dropdown className="sub-btn" label="Subtract" items={() => kindMenu((k, p) => addComp(k, 'subtract', p))} />
            <Dropdown className="sub-btn" label="Intersect" items={() => kindMenu((k, p) => addComp(k, 'intersect', p))} />
          </div>
        </div>
      )}
    </div>
  )
}

function CompOptions({ m, c }: { m: Mask; c: MaskComp }) {
  const brush = maskUI.use((s) => s.brush)
  const setBrush = (patch: Partial<typeof brush>) => maskUI.set((s) => ({ brush: { ...s.brush, ...patch } }))
  if (c.kind === 'brush')
    return (
      <>
        <div className="sub-title">Brush</div>
        <div className="seg" style={{ display: 'flex', margin: '6px 0' }}>
          <button className={!brush.erase ? 'on' : ''} style={{ flex: 1 }} onClick={() => setBrush({ erase: false })}>
            Paint
          </button>
          <button className={brush.erase ? 'on' : ''} style={{ flex: 1 }} onClick={() => setBrush({ erase: true })} title="Eraser (or hold Alt)">
            Eraser
          </button>
        </div>
        <Slider def={{ key: 'b.size', label: 'Size', min: 1, max: 100, step: 1 }} value={brush.size} defaultValue={22} onChange={(v) => setBrush({ size: v })} />
        <Slider def={{ key: 'b.feather', label: 'Feather', min: 0, max: 100, step: 1 }} value={brush.feather} defaultValue={60} onChange={(v) => setBrush({ feather: v })} />
        <Slider def={{ key: 'b.flow', label: 'Flow', min: 1, max: 100, step: 1 }} value={brush.flow} defaultValue={100} onChange={(v) => setBrush({ flow: v })} />
        <p style={{ color: 'var(--c-text-3)', fontSize: 11, margin: '6px 0 0' }}>Paint over the photo. Hold Alt to erase. [ and ] change the size.</p>
      </>
    )
  if (c.kind === 'radial')
    return (
      <>
        <div className="sub-title">Radial Gradient</div>
        {c.radial ? (
          <Slider
            def={{ key: 'r.f', label: 'Feather', min: 0, max: 100, step: 1 }}
            value={c.radial.feather}
            defaultValue={50}
            onChange={(v) => updateComp(m.id, c.id, (x) => ({ ...x, radial: { ...x.radial!, feather: v } }), 'Radial Gradient', `rad.${c.id}`)}
          />
        ) : (
          <p style={{ color: 'var(--c-text-3)', fontSize: 11 }}>Drag on the photo to set the center and size.</p>
        )}
      </>
    )
  if (c.kind === 'linear')
    return <p style={{ color: 'var(--c-text-3)', fontSize: 11, marginTop: 4 }}>{c.linear ? 'Drag the points to adjust it; the middle point moves the whole gradient.' : 'Drag on the photo from start (full effect) to end (no effect).'}</p>
  if (c.kind === 'color')
    return (
      <>
        <div className="sub-title">Color Range</div>
        <Slider
          def={{ key: 'c.r', label: 'Tolerance', min: 0, max: 100, step: 1 }}
          value={c.color!.range}
          defaultValue={40}
          onChange={(v) => updateComp(m.id, c.id, (x) => ({ ...x, color: { ...x.color!, range: v } }), 'Color Range', `col.${c.id}`)}
        />
        <p style={{ color: 'var(--c-text-3)', fontSize: 11, margin: '6px 0 0' }}>
          {c.color!.samples.length ? `${c.color!.samples.length} color sample(s). Shift + click adds more.` : 'Click a color in the photo.'}
        </p>
      </>
    )
  if (c.kind === 'luminance') {
    const l = c.lum!
    const set = (patch: Partial<typeof l>, k: string) => updateComp(m.id, c.id, (x) => ({ ...x, lum: { ...x.lum!, ...patch } }), 'Luminance Range', `lum.${c.id}.${k}`)
    return (
      <>
        <div className="sub-title">Luminance Range</div>
        <Slider def={{ key: 'l.min', label: 'From', min: 0, max: 100, step: 1 }} value={l.min} defaultValue={50} track="linear-gradient(90deg,#000,#fff)" onChange={(v) => set({ min: Math.min(v, l.max) }, 'min')} />
        <Slider def={{ key: 'l.max', label: 'To', min: 0, max: 100, step: 1 }} value={l.max} defaultValue={100} track="linear-gradient(90deg,#000,#fff)" onChange={(v) => set({ max: Math.max(v, l.min) }, 'max')} />
        <Slider def={{ key: 'l.sl', label: 'Soft (dark)', min: 0, max: 50, step: 1 }} value={l.softLow} defaultValue={15} onChange={(v) => set({ softLow: v }, 'sl')} />
        <Slider def={{ key: 'l.sh', label: 'Soft (light)', min: 0, max: 50, step: 1 }} value={l.softHigh} defaultValue={0} onChange={(v) => set({ softHigh: v }, 'sh')} />
        <p style={{ color: 'var(--c-text-3)', fontSize: 11, margin: '6px 0 0' }}>Click the photo to pick the brightness at that point.</p>
      </>
    )
  }
  if (isAiKind(c.kind)) return <p style={{ color: 'var(--c-text-3)', fontSize: 11, marginTop: 4 }}>Detected on your device. Refine the selection with Subtract or a brush.</p>
  return null
}

function MaskAdjust({ m }: { m: Mask }) {
  const compSel = maskUI.use((s) => s.compId)
  const c = m.comps.find((x) => x.id === compSel)
  const groups = [...new Set(LOCAL_SLIDERS.map((s) => s.group))]
  return (
    <>
      {c && (
        <div className="section-body" style={{ borderTop: '1px solid var(--c-line-2)', paddingTop: 10 }}>
          <CompOptions m={m} c={c} />
        </div>
      )}
      <div className="section-body" style={{ borderTop: '1px solid var(--c-line-2)', paddingTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="sub-title" style={{ margin: 0 }}>
            Adjustments: {m.name}
          </span>
          <button
            className="btn quiet small"
            style={{ marginLeft: 'auto' }}
            onClick={() => updateMask(m.id, (x) => ({ ...x, adj: Object.fromEntries(Object.keys(x.adj).map((k) => [k, 0])) as unknown as LocalAdjust }), 'Reset Mask Adjustments')}
          >
            Reset
          </button>
        </div>
        <Slider
          def={{ key: 'm.amount', label: 'Amount', min: 0, max: 200, step: 1 }}
          value={m.amount}
          defaultValue={100}
          onChange={(v) => updateMask(m.id, (x) => ({ ...x, amount: v }), 'Mask Amount')}
        />
        {groups.map((g) => (
          <div key={g}>
            <div className="sub-title" style={{ marginTop: 12 }}>
              {g}
            </div>
            {LOCAL_SLIDERS.filter((s) => s.group === g).map((s) => (
              <Slider key={s.key} def={s} value={m.adj[s.key as keyof LocalAdjust]} defaultValue={0} onChange={(v) => setAdj(m.id, s.key as keyof LocalAdjust, v, `${m.name}: ${s.label}`)} />
            ))}
            {g === 'Color' && <ColorizeSlider m={m} />}
          </div>
        ))}
      </div>
    </>
  )
}

function ColorizeSlider({ m }: { m: Mask }) {
  return (
    <>
      <Slider
        def={{ key: 'colorHue', label: 'Colorize Hue', min: 0, max: 360, step: 1 }}
        value={m.adj.colorHue}
        defaultValue={0}
        track="linear-gradient(90deg,hsl(0 85% 55%),hsl(60 85% 55%),hsl(120 85% 55%),hsl(180 85% 55%),hsl(240 85% 55%),hsl(300 85% 55%),hsl(360 85% 55%))"
        onChange={(v) => setAdj(m.id, 'colorHue', v, `${m.name}: Colorize`)}
      />
      <Slider
        def={{ key: 'colorSat', label: 'Colorize Amount', min: 0, max: 100, step: 1 }}
        value={m.adj.colorSat}
        defaultValue={0}
        track={`linear-gradient(90deg,#808080,hsl(${m.adj.colorHue} 85% 55%))`}
        onChange={(v) => setAdj(m.id, 'colorSat', v, `${m.name}: Colorize`)}
      />
    </>
  )
}

// ---------- Canvas overlay ----------

export function MaskOverlay({ v }: { v: ViewInfo }) {
  const masks = editor.use((s) => s.params.masks)
  const params = editor.use((s) => s.params)
  const sel = maskUI.use((s) => s.maskId)
  const compSel = maskUI.use((s) => s.compId)
  const brush = maskUI.use((s) => s.brush)
  const ref = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [alt, setAlt] = useState(false)
  const mask = masks.find((m) => m.id === sel)
  const comp = mask?.comps.find((c) => c.id === compSel)
  const r = v.renderer
  const [ow, oh] = r.orientedSize(params)
  const long = Math.max(r.fullW, r.fullH)

  useEffect(() => {
    const k = (e: KeyboardEvent) => setAlt(e.altKey)
    window.addEventListener('keydown', k)
    window.addEventListener('keyup', k)
    return () => {
      window.removeEventListener('keydown', k)
      window.removeEventListener('keyup', k)
    }
  }, [])

  const toS = (cx: number, cy: number): [number, number] => {
    const [ox, oy] = apply(v.toFrame, cx, cy)
    return frameToSource(params, ow, oh, ox, oy)
  }
  const toC = (sx: number, sy: number): [number, number] => {
    const [ox, oy] = sourceToFrame(params, ow, oh, sx, sy)
    return apply(v.fromFrame, ox, oy)
  }
  // CSS pixels per source pixel (for brush radius on screen).
  const [a0x, a0y] = toC(0.5, 0.5)
  const [a1x, a1y] = toC(0.5 + 1 / r.fullW, 0.5)
  const pxScale = Math.hypot(a1x - a0x, a1y - a0y)
  const radiusCss = (brush.size / 100) ** 1.5 * 0.25 * long * pxScale

  const local = (e: { clientX: number; clientY: number }) => {
    const b = ref.current!.getBoundingClientRect()
    return [e.clientX - b.left, e.clientY - b.top] as [number, number]
  }

  const onDown = (e: React.PointerEvent) => {
    if (!mask || !comp || e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    capture(el, e.pointerId)
    const [px, py] = local(e)
    const [sx, sy] = toS(px, py)
    let move: ((ev: PointerEvent) => void) | null = null

    if (comp.kind === 'brush') {
      const stroke = { pts: [sx, sy], size: (brush.size / 100) ** 1.5 * 0.25, feather: brush.feather, flow: brush.flow, erase: brush.erase || e.altKey }
      updateComp(mask.id, comp.id, (c) => ({ ...c, strokes: [...(c.strokes ?? []), stroke] }), stroke.erase ? 'Erase' : 'Brush', `brush.${comp.id}`)
      move = (ev) => {
        const [qx, qy] = local(ev)
        setCursor({ x: qx, y: qy })
        const [tx, ty] = toS(qx, qy)
        updateComp(
          mask.id,
          comp.id,
          (c) => {
            const strokes = [...(c.strokes ?? [])]
            const last = strokes[strokes.length - 1]
            strokes[strokes.length - 1] = { ...last, pts: [...last.pts, tx, ty] }
            return { ...c, strokes }
          },
          'Brush',
          `brush.${comp.id}`,
        )
      }
    } else if (comp.kind === 'linear') {
      const g = comp.linear
      const near = (x: number, y: number) => {
        const [cx, cy] = toC(x, y)
        return Math.hypot(cx - px, cy - py) < 12
      }
      let handle: 'p1' | 'p2' | 'mid' | 'new' = 'new'
      if (g && near(g.x1, g.y1)) handle = 'p1'
      else if (g && near(g.x2, g.y2)) handle = 'p2'
      else if (g && near((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2)) handle = 'mid'
      const start = g ? { ...g } : { x1: sx, y1: sy, x2: sx, y2: sy }
      move = (ev) => {
        const [tx, ty] = toS(...local(ev))
        let next = { ...start }
        if (handle === 'new') next = { x1: sx, y1: sy, x2: tx, y2: ty }
        else if (handle === 'p1') next = { ...start, x1: tx, y1: ty }
        else if (handle === 'p2') next = { ...start, x2: tx, y2: ty }
        else next = { x1: start.x1 + tx - sx, y1: start.y1 + ty - sy, x2: start.x2 + tx - sx, y2: start.y2 + ty - sy }
        updateComp(mask.id, comp.id, (c) => ({ ...c, linear: next }), 'Linear Gradient', `lin.${comp.id}`)
      }
    } else if (comp.kind === 'radial') {
      const g = comp.radial
      const nearPt = (x: number, y: number) => {
        const [cx, cy] = toC(x, y)
        return Math.hypot(cx - px, cy - py) < 12
      }
      let handle: 'center' | 'rx' | 'ry' | 'new' = 'new'
      if (g) {
        const a = (g.angle * Math.PI) / 180
        const ex = [g.cx + Math.cos(a) * g.rx, g.cy + (Math.sin(a) * g.rx * r.fullW) / r.fullH] as const
        const ey = [g.cx - (Math.sin(a) * g.ry * r.fullH) / r.fullW, g.cy + Math.cos(a) * g.ry] as const
        if (nearPt(g.cx, g.cy)) handle = 'center'
        else if (nearPt(ex[0], ex[1]) || nearPt(2 * g.cx - ex[0], 2 * g.cy - ex[1])) handle = 'rx'
        else if (nearPt(ey[0], ey[1]) || nearPt(2 * g.cx - ey[0], 2 * g.cy - ey[1])) handle = 'ry'
      }
      const start = g ? { ...g } : { cx: sx, cy: sy, rx: 0.01, ry: 0.01, angle: 0, feather: 50 }
      move = (ev) => {
        const [tx, ty] = toS(...local(ev))
        let next = { ...start }
        if (handle === 'new') {
          next = { ...start, cx: sx, cy: sy, rx: Math.max(0.01, Math.abs(tx - sx)), ry: Math.max(0.01, Math.abs(ty - sy)) }
          if (ev.shiftKey) next.ry = (next.rx * r.fullW) / r.fullH
        } else if (handle === 'center') next = { ...start, cx: start.cx + tx - sx, cy: start.cy + ty - sy }
        else {
          // Distance along the axis in pixels → radius in normalized units.
          const dx = (tx - start.cx) * r.fullW
          const dy = (ty - start.cy) * r.fullH
          const d = Math.hypot(dx, dy)
          if (handle === 'rx') next = { ...start, rx: Math.max(0.01, d / r.fullW), angle: ev.altKey ? start.angle : (Math.atan2(dy, dx) * 180) / Math.PI }
          else next = { ...start, ry: Math.max(0.01, d / r.fullH) }
        }
        updateComp(mask.id, comp.id, (c) => ({ ...c, radial: next }), 'Radial Gradient', `rad.${comp.id}`)
      }
    } else if (comp.kind === 'color') {
      const src = r.maskSource()
      const ix = Math.round(Math.min(1, Math.max(0, sx)) * (src.w - 1))
      const iy = Math.round(Math.min(1, Math.max(0, sy)) * (src.h - 1))
      // Average a 5×5 area for a stable sample.
      const acc = [0, 0, 0]
      let n = 0
      for (let y = iy - 2; y <= iy + 2; y++)
        for (let x = ix - 2; x <= ix + 2; x++) {
          if (x < 0 || y < 0 || x >= src.w || y >= src.h) continue
          const i = (y * src.w + x) * 3
          acc[0] += src.lab[i]
          acc[1] += src.lab[i + 1]
          acc[2] += src.lab[i + 2]
          n++
        }
      const sample: [number, number, number] = [acc[0] / n, acc[1] / n, acc[2] / n]
      updateComp(
        mask.id,
        comp.id,
        (c) => ({
          ...c,
          color: {
            ...c.color!,
            samples: e.shiftKey ? [...c.color!.samples, sample] : [sample],
            points: e.shiftKey ? [...(c.color!.points ?? []), [sx, sy]] : [[sx, sy]],
          },
        }),
        'Color Sample',
      )
    } else if (comp.kind === 'luminance') {
      const src = r.maskSource()
      const ix = Math.round(Math.min(1, Math.max(0, sx)) * (src.w - 1))
      const iy = Math.round(Math.min(1, Math.max(0, sy)) * (src.h - 1))
      const L = Math.round(src.lum[iy * src.w + ix] * 100)
      updateComp(mask.id, comp.id, (c) => ({ ...c, lum: { ...c.lum!, min: Math.max(0, L - 12), max: Math.min(100, L + 12), softLow: 12, softHigh: 12 } }), 'Luminance Sample')
    }

    if (move) {
      const mv = move
      const up = () => {
        el.removeEventListener('pointermove', mv)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', mv)
      el.addEventListener('pointerup', up)
    }
  }

  // Shapes of the selected component.
  const shapes: React.ReactNode[] = []
  if (comp?.kind === 'linear' && comp.linear) {
    const g = comp.linear
    const p1 = toC(g.x1, g.y1)
    const p2 = toC(g.x2, g.y2)
    const dx = p2[0] - p1[0]
    const dy = p2[1] - p1[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * 3000
    const ny = (dx / len) * 3000
    const line = (p: [number, number], dash: string, k: string) => <line key={k} x1={p[0] - nx} y1={p[1] - ny} x2={p[0] + nx} y2={p[1] + ny} stroke="#fff" strokeWidth={1.2} strokeDasharray={dash} opacity={0.9} />
    const mid: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
    shapes.push(line(p1, '', 'l1'), line(mid, '6 5', 'lm'), line(p2, '', 'l2'))
    shapes.push(<circle key="c1" cx={p1[0]} cy={p1[1]} r={6} fill="#fff" stroke="#222" />, <circle key="c2" cx={p2[0]} cy={p2[1]} r={6} fill="#fff" stroke="#222" />, <circle key="cm" cx={mid[0]} cy={mid[1]} r={5} fill="#4d7bff" stroke="#fff" />)
  }
  if (comp?.kind === 'radial' && comp.radial) {
    const g = comp.radial
    const a = (g.angle * Math.PI) / 180
    const pts: string[] = []
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2
      const ux = Math.cos(t) * g.rx * r.fullW
      const uy = Math.sin(t) * g.ry * r.fullH
      const X = g.cx + (ux * Math.cos(a) - uy * Math.sin(a)) / r.fullW
      const Y = g.cy + (ux * Math.sin(a) + uy * Math.cos(a)) / r.fullH
      pts.push(toC(X, Y).join(','))
    }
    shapes.push(<polyline key="e" points={pts.join(' ')} fill="none" stroke="#fff" strokeWidth={1.3} />)
    const c = toC(g.cx, g.cy)
    shapes.push(<circle key="cc" cx={c[0]} cy={c[1]} r={5} fill="#4d7bff" stroke="#fff" />)
    const ex = toC(g.cx + Math.cos(a) * g.rx, g.cy + (Math.sin(a) * g.rx * r.fullW) / r.fullH)
    const ey = toC(g.cx - (Math.sin(a) * g.ry * r.fullH) / r.fullW, g.cy + Math.cos(a) * g.ry)
    shapes.push(<circle key="ex" cx={ex[0]} cy={ex[1]} r={5} fill="#fff" stroke="#222" />, <circle key="ey" cx={ey[0]} cy={ey[1]} r={5} fill="#fff" stroke="#222" />)
  }
  if (comp?.kind === 'color')
    for (const [i, [x, y]] of (comp.color?.points ?? []).entries()) {
      const p = toC(x, y)
      shapes.push(<circle key={`cp${i}`} cx={p[0]} cy={p[1]} r={6} fill="none" stroke="#fff" strokeWidth={2} />)
    }

  const cursorStyle = comp?.kind === 'brush' ? 'none' : comp?.kind === 'color' || comp?.kind === 'luminance' ? 'crosshair' : comp ? 'crosshair' : 'default'
  return (
    <div
      ref={ref}
      style={{ position: 'absolute', inset: 0, cursor: cursorStyle }}
      onPointerDown={onDown}
      onPointerMove={(e) => comp?.kind === 'brush' && setCursor({ x: local(e)[0], y: local(e)[1] })}
      onPointerLeave={() => setCursor(null)}
    >
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {shapes}
        {comp?.kind === 'brush' && cursor && (
          <>
            <circle cx={cursor.x} cy={cursor.y} r={radiusCss} fill="none" stroke={brush.erase || alt ? '#ff8080' : '#fff'} strokeWidth={1.2} />
            <circle cx={cursor.x} cy={cursor.y} r={radiusCss * (1 - brush.feather / 100)} fill="none" stroke={brush.erase || alt ? '#ff8080' : '#fff'} strokeWidth={0.8} strokeDasharray="3 3" opacity={0.7} />
            <text x={cursor.x} y={cursor.y + 4} textAnchor="middle" fill="#fff" fontSize={12}>
              {brush.erase || alt ? '−' : '+'}
            </text>
          </>
        )}
      </svg>
      {!mask && (
        <div className="overlay-label" style={{ top: 'auto', bottom: 14 }}>
          Create a new mask in the panel on the right
        </div>
      )}
    </div>
  )
}

/** Keyboard shortcuts while masking. Returns true if handled. */
export function maskKey(e: KeyboardEvent): boolean {
  const k = e.key.toLowerCase()
  const s = maskUI.get()
  if (k === 'o' && !e.shiftKey) {
    maskUI.set({ overlay: !s.overlay })
    return true
  }
  if (e.key === '[' || e.key === ']') {
    const d = e.key === ']' ? 5 : -5
    maskUI.set({ brush: { ...s.brush, size: Math.max(1, Math.min(100, s.brush.size + d)) } })
    return true
  }
  const add = (kind: MaskKind) => (s.maskId ? addComp(kind, e.altKey ? 'subtract' : 'add') : createMask(kind))
  if (k === 'b' && !e.ctrlKey) return add('brush'), true
  if (k === 'l' && !e.ctrlKey) return add('linear'), true
  if (k === 'r' && !e.ctrlKey && !e.shiftKey) return add('radial'), true
  if (k === 'c' && e.shiftKey) return add('color'), true
  if (k === 'i' && e.shiftKey) return add('luminance'), true
  if (k === 'n') return createMask('brush'), true
  if (k === 'i' && e.ctrlKey) {
    const m = editor.get().params.masks.find((x) => x.id === s.maskId)
    if (m) updateMask(m.id, (x) => ({ ...x, invert: !x.invert }), 'Invert Mask')
    return true
  }
  return false
}

