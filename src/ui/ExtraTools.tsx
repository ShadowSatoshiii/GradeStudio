import { useState } from 'react'
import { linToOklab, srgbToLinear } from '../engine/color'
import { S, type PointColor } from '../engine/params'
import { apply, frameToSource } from '../engine/transform'
import { change, editor, setParam } from '../store/editor'
import { uid } from '../store/library'
import { ui } from '../store/ui'
import type { ViewInfo } from './DetailView'
import { IconPicker } from './Icons'
import { PSlider, Slider } from './Slider'

const BOKEH = [
  ['circle', 'Circle'],
  ['bubble', 'Bubble'],
  ['blade', '5 Blades'],
  ['ring', 'Ring'],
  ['cateye', 'Cat Eye'],
] as const

export function LensBlurControls() {
  const lb = editor.use((s) => s.params.lensBlur)
  const tool = ui.use((s) => s.tool)
  return (
    <>
      <label className="wb-row" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={lb.active} onChange={(e) => setParam('lensBlur.active', e.target.checked, 'Lens Blur')} />
        <span>Enable</span>
      </label>
      <div style={{ opacity: lb.active ? 1 : 0.45, pointerEvents: lb.active ? undefined : 'none' }}>
        <PSlider def={S.lbAmount} />
        <div className="wb-row">
          <span className="lbl">Bokeh</span>
          <select className="select" value={lb.bokeh} onChange={(e) => setParam('lensBlur.bokeh', e.target.value, 'Bokeh')}>
            {BOKEH.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <PSlider def={S.lbBoost} />
        {lb.bokeh === 'cateye' && <PSlider def={S.lbCatEye} />}
        <div className="sub-title" style={{ marginTop: 12 }}>
          Focus
        </div>
        <div className="sub-btns" style={{ marginTop: 4 }}>
          <button className={`sub-btn${lb.focusX < 0 ? ' on' : ''}`} onClick={() => change({ ...editor.get().params, lensBlur: { ...lb, focusX: -1, focusY: -1 } }, 'Focus: Subject')}>
            Subject
          </button>
          <button className={`sub-btn${tool === 'focus' ? ' on' : ''}`} onClick={() => ui.set({ tool: tool === 'focus' ? null : 'focus' })} title="Click the spot that should stay sharp">
            <IconPicker size={13} /> Pick Point
          </button>
        </div>
        <PSlider def={S.lbRange} />
        <p style={{ color: 'var(--c-text-3)', fontSize: 11, lineHeight: 1.45, margin: '6px 0 0' }}>Depth is estimated on your device (subject in front, background farther away toward the top).</p>
      </div>
    </>
  )
}

const PC_SLIDERS: { k: keyof PointColor; label: string; track?: string }[] = [
  { k: 'hue', label: 'Hue Shift' },
  { k: 'sat', label: 'Saturation Shift', track: 'linear-gradient(90deg,#8a8a8a,#e0503c)' },
  { k: 'lum', label: 'Luminance Shift', track: 'linear-gradient(90deg,#111,#eee)' },
  { k: 'variance', label: 'Variance' },
  { k: 'range', label: 'Range' },
]

function labToCss([L, a, b]: [number, number, number]) {
  // OkLab → linear → sRGB for the swatch.
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  const to = (c: number) => Math.round(Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)) * 255)
  return `rgb(${rgb.map(to).join(',')})`
}

export function PointColorControls() {
  const list = editor.use((s) => s.params.pointColors)
  const tool = ui.use((s) => s.tool)
  const [sel, setSel] = useState<string | null>(null)
  const cur = list.find((x) => x.id === sel) ?? list[list.length - 1]
  const set = (k: keyof PointColor, v: number) => change({ ...editor.get().params, pointColors: list.map((x) => (x.id === cur!.id ? { ...x, [k]: v } : x)) }, 'Point Color', `pc.${cur!.id}.${k}`)
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 8px' }}>
        <button className={`icon-btn${tool === 'pointcolor' ? ' active' : ''}`} title="Sample a color from the photo" onClick={() => ui.set({ tool: tool === 'pointcolor' ? null : 'pointcolor' })} disabled={list.length >= 8}>
          <IconPicker size={16} />
        </button>
        {list.map((x) => (
          <button key={x.id} className={`swatch${cur?.id === x.id ? ' on' : ''}`} style={{ background: labToCss(x.lab) }} onClick={() => setSel(x.id)} title="Select point color" />
        ))}
        {!list.length && <span style={{ color: 'var(--c-text-3)', fontSize: 11 }}>Choose the picker, then click a color in the photo.</span>}
      </div>
      {cur && (
        <>
          {PC_SLIDERS.map(({ k, label, track }) => (
            <Slider key={k} def={{ key: `pc.${k}`, label, min: k === 'range' ? 0 : -100, max: 100, step: 1 }} value={cur[k] as number} defaultValue={k === 'range' ? 50 : 0} track={track} onChange={(v) => set(k, v)} />
          ))}
          <div className="sub-btns">
            <button
              className="sub-btn"
              onClick={() => {
                change({ ...editor.get().params, pointColors: list.filter((x) => x.id !== cur.id) }, 'Delete Point Color')
                setSel(null)
              }}
            >
              Remove Color
            </button>
          </div>
        </>
      )}
    </>
  )
}

export function CalibrationControls() {
  return (
    <>
      <PSlider def={S.calShadow} />
      <PSlider def={S.calRedHue} />
      <PSlider def={S.calRedSat} />
      <PSlider def={S.calGreenHue} />
      <PSlider def={S.calGreenSat} />
      <PSlider def={S.calBlueHue} />
      <PSlider def={S.calBlueSat} />
    </>
  )
}

/** Click on the photo for the focus point (lens blur) or to sample a point color. */
export function PointPicker({ v, kind }: { v: ViewInfo; kind: 'focus' | 'pointcolor' }) {
  return (
    <div
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
      onClick={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const [ox, oy] = apply(v.toFrame, e.clientX - rect.left, e.clientY - rect.top)
        const [ow, oh] = v.renderer.orientedSize(v.params)
        const [sx, sy] = frameToSource(v.params, ow, oh, ox, oy)
        if (sx < 0 || sy < 0 || sx > 1 || sy > 1) return
        const p = editor.get().params
        if (kind === 'focus') {
          change({ ...p, lensBlur: { ...p.lensBlur, focusX: sx, focusY: sy } }, 'Focus Point')
        } else {
          const src = v.renderer.maskSource()
          const x = Math.round(sx * (src.w - 1))
          const y = Math.round(sy * (src.h - 1))
          // Average 5×5 pixels of the canvas copy (sRGB) for a stable sample.
          const d = src.canvas.getContext('2d', { willReadFrequently: true })!.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data
          const acc = [0, 0, 0]
          for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) acc[k] += srgbToLinear(d[i + k] / 255)
          const n = d.length / 4
          const lab = linToOklab(acc[0] / n, acc[1] / n, acc[2] / n)
          const pc: PointColor = { id: uid(), lab, hue: 0, sat: 0, lum: 0, variance: 0, range: 50 }
          change({ ...p, pointColors: [...p.pointColors, pc] }, 'Add Point Color')
        }
        ui.set({ tool: null })
      }}
    />
  )
}
