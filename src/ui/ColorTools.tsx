import { useRef, useState } from 'react'
import { getEditorSmall } from '../actions'
import { autoGrayMix } from '../engine/analyze'
import { MIX_COLORS, MIX_SWATCH, S, type GradeWheel } from '../engine/params'
import { profileById } from '../engine/profiles'
import { editor, setParam } from '../store/editor'
import { PSlider, Slider } from './Slider'
import { capture } from './Menu'

// Hue (deg, HSV) of the eight mixer bands, for slider gradients.
const BAND_HUE = [0, 30, 55, 120, 180, 225, 275, 315]
const hsl = (h: number, s = 80, l = 50) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`

type MixMode = 'color' | 'hue' | 'sat' | 'lum'

function mixTrack(kind: 'hue' | 'sat' | 'lum', i: number) {
  const h = BAND_HUE[i]
  if (kind === 'hue') return `linear-gradient(90deg, ${hsl(h - 35)}, ${hsl(h)}, ${hsl(h + 35)})`
  if (kind === 'sat') return `linear-gradient(90deg, ${hsl(h, 0)}, ${hsl(h, 95)})`
  return `linear-gradient(90deg, ${hsl(h, 70, 15)}, ${hsl(h, 70, 50)}, ${hsl(h, 70, 85)})`
}

const MIX_DEF = { min: -100, max: 100, step: 1 }

function MixSlider({ kind, i, label }: { kind: 'hue' | 'sat' | 'lum'; i: number; label: string }) {
  const field = kind === 'hue' ? 'mixHue' : kind === 'sat' ? 'mixSat' : 'mixLum'
  const value = editor.use((s) => s.params[field][i])
  const name = { hue: 'Hue', sat: 'Saturation', lum: 'Luminance' }[kind]
  return (
    <Slider
      def={{ key: `${field}.${i}`, label, ...MIX_DEF }}
      value={value}
      defaultValue={0}
      track={mixTrack(kind, i)}
      onChange={(v) => setParam(`${field}.${i}`, v, `${MIX_COLORS[i]} ${name}`)}
    />
  )
}

export function ColorMixer() {
  const [mode, setMode] = useState<MixMode>('color')
  const [band, setBand] = useState(0)
  const bw = editor.use((s) => s.params.bw || !!profileById(s.params.profile).bw)
  if (bw) return <GrayMixer />
  return (
    <div>
      <div className="wb-row">
        <span className="lbl">Adjust</span>
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value as MixMode)}>
          <option value="color">Color</option>
          <option value="hue">Hue</option>
          <option value="sat">Saturation</option>
          <option value="lum">Luminance</option>
        </select>
      </div>
      {mode === 'color' ? (
        <>
          <div className="mix-swatches">
            {MIX_SWATCH.map((c, i) => (
              <button key={i} className={`swatch${band === i ? ' on' : ''}`} style={{ background: c }} title={MIX_COLORS[i]} onClick={() => setBand(i)} />
            ))}
          </div>
          <MixSlider kind="hue" i={band} label="Hue" />
          <MixSlider kind="sat" i={band} label="Saturation" />
          <MixSlider kind="lum" i={band} label="Luminance" />
        </>
      ) : (
        MIX_COLORS.map((name, i) => <MixSlider key={i} kind={mode} i={i} label={name} />)
      )}
    </div>
  )
}

function GrayMixer() {
  const small = editor.use((s) => s.photoId)
  return (
    <div>
      <div className="sub-btns" style={{ marginTop: 0, marginBottom: 6 }}>
        <button
          className="sub-btn"
          onClick={() => {
            const sm = getEditorSmall()
            if (sm) setParam('grayMix', autoGrayMix(sm), 'B&W Mix: Auto')
          }}
          disabled={!small}
        >
          Auto
        </button>
      </div>
      {MIX_COLORS.map((name, i) => (
        <GraySlider key={i} i={i} label={name} />
      ))}
    </div>
  )
}

function GraySlider({ i, label }: { i: number; label: string }) {
  const value = editor.use((s) => s.params.grayMix[i])
  const h = BAND_HUE[i]
  return (
    <Slider
      def={{ key: `grayMix.${i}`, label, ...MIX_DEF }}
      value={value}
      defaultValue={0}
      track={`linear-gradient(90deg, #111, ${hsl(h, 60, 45)}, #eee)`}
      onChange={(v) => setParam(`grayMix.${i}`, v, `B&W ${label}`)}
    />
  )
}


// ---------- Color grading ----------

type GradeKey = 'shadows' | 'midtones' | 'highlights' | 'global'
const GRADE_NAMES: Record<GradeKey, string> = { shadows: 'Shadows', midtones: 'Midtones', highlights: 'Highlights', global: 'Global' }
const GRADE_SHORT: Record<GradeKey, string> = { shadows: 'Shadows', midtones: 'Mids', highlights: 'Highs', global: 'Global' }

/** Hue/saturation wheel. Hue 0 (red) points right, hues run counter-clockwise. */
function Wheel({ k, size }: { k: GradeKey; size: number }) {
  const w = editor.use((s) => s.params.grade[k])
  const ref = useRef<HTMLDivElement>(null)
  const set = (next: GradeWheel, label: string) => setParam(`grade.${k}`, next, label)
  const r = size / 2
  const ang = (w.hue * Math.PI) / 180
  const kx = r + Math.cos(ang) * (w.sat / 100) * r
  const ky = r - Math.sin(ang) * (w.sat / 100) * r
  const onDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    capture(el, e.pointerId)
    const box = ref.current!.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, sat: w.sat, hue: w.hue }
    const apply = (ev: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean }) => {
      const dx = ev.clientX - (box.left + r)
      const dy = -(ev.clientY - (box.top + r))
      let hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
      let sat = Math.min(100, (Math.hypot(dx, dy) / r) * 100)
      if (ev.shiftKey) sat = start.sat // hue only
      if (ev.altKey) hue = start.hue // saturation only
      set({ ...w, hue: Math.round(hue), sat: Math.round(sat) }, `Color Grading ${GRADE_NAMES[k]}`)
    }
    apply(e as unknown as PointerEvent)
    const move = (ev: PointerEvent) => apply(ev)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div
      className="wheel"
      ref={ref}
      onPointerDown={onDown}
      onDoubleClick={() => set({ ...w, hue: 0, sat: 0 }, `Reset Color Grading ${GRADE_NAMES[k]}`)}
      title="Drag: hue and saturation · Shift: hue only · Alt: saturation only · Double-click: reset"
      style={{
        width: size,
        height: size,
        // conic-gradient runs clockwise from the top; map so red is at 3 o'clock and hues go counter-clockwise.
        background: `radial-gradient(circle, rgba(128,128,128,1) 0%, rgba(128,128,128,0) 72%), conic-gradient(from 90deg, ${Array.from({ length: 13 }, (_, i) => hsl(360 - i * 30, 85, 55)).join(',')})`,
      }}
    >
      <div className="knob" style={{ left: kx, top: ky, background: hsl(w.hue, w.sat, 55) }} />
    </div>
  )
}

function LumSlider({ k }: { k: GradeKey }) {
  const v = editor.use((s) => s.params.grade[k].lum)
  return (
    <Slider
      def={{ key: `grade.${k}.lum`, label: 'Luminance', min: -100, max: 100, step: 1 }}
      value={v}
      defaultValue={0}
      track="linear-gradient(90deg,#111,#eee)"
      onChange={(x) => setParam(`grade.${k}.lum`, x, `Color Grading ${GRADE_NAMES[k]} Luminance`)}
    />
  )
}

function HueSatSliders({ k }: { k: GradeKey }) {
  const w = editor.use((s) => s.params.grade[k])
  return (
    <>
      <Slider
        def={{ key: `grade.${k}.hue`, label: 'Hue', min: 0, max: 360, step: 1 }}
        value={w.hue}
        defaultValue={0}
        track={`linear-gradient(90deg, ${Array.from({ length: 7 }, (_, i) => hsl(i * 60, 85, 55)).join(',')})`}
        onChange={(x) => setParam(`grade.${k}.hue`, x, `Color Grading ${GRADE_NAMES[k]} Hue`)}
      />
      <Slider
        def={{ key: `grade.${k}.sat`, label: 'Saturation', min: 0, max: 100, step: 1 }}
        value={w.sat}
        defaultValue={0}
        track={`linear-gradient(90deg, #808080, ${hsl(w.hue, 90, 55)})`}
        onChange={(x) => setParam(`grade.${k}.sat`, x, `Color Grading ${GRADE_NAMES[k]} Saturation`)}
      />
    </>
  )
}

type GradeView = '3way' | GradeKey

export function ColorGrading() {
  const [view, setView] = useState<GradeView>('3way')
  return (
    <div>
      <div className="seg" style={{ display: 'flex', marginTop: 4 }}>
        {(['3way', 'shadows', 'midtones', 'highlights', 'global'] as GradeView[]).map((v) => (
          <button key={v} className={view === v ? 'on' : ''} style={{ flex: 1, padding: 0 }} onClick={() => setView(v)} title={v === '3way' ? '3-Way' : GRADE_NAMES[v as GradeKey]}>
            {v === '3way' ? '3-Way' : GRADE_SHORT[v as GradeKey]}
          </button>
        ))}
      </div>
      {view === '3way' ? (
        <>
          <div className="wheels">
            <div className="wheel-wrap" style={{ width: '100%' }}>
              Midtones
              <Wheel k="midtones" size={118} />
              <div style={{ width: 150 }}>
                <LumSlider k="midtones" />
              </div>
            </div>
            {(['shadows', 'highlights'] as GradeKey[]).map((k) => (
              <div className="wheel-wrap" key={k}>
                {GRADE_NAMES[k]}
                <Wheel k={k} size={104} />
                <div style={{ width: 128 }}>
                  <LumSlider k={k} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="wheels">
            <div className="wheel-wrap">
              {GRADE_NAMES[view]}
              <Wheel k={view} size={190} />
            </div>
          </div>
          <HueSatSliders k={view} />
          <LumSlider k={view} />
        </>
      )}
      <div style={{ height: 6 }} />
      <PSlider def={S.blending} />
      <PSlider def={S.balance} />
    </div>
  )
}
