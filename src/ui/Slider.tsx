import { useRef, useState } from 'react'
import { defaultAt, getAt, type Params, type SliderDef } from '../engine/params'
import { editor, setParam } from '../store/editor'
import { capture } from './Menu'

export function fmt(v: number, def: Pick<SliderDef, 'min' | 'precision'>) {
  const p = def.precision ?? 0
  const s = v.toFixed(p)
  return def.min < 0 && v > 0 ? '+' + s : s === '-0' ? '0' : s
}

interface Props {
  def: SliderDef
  value: number
  defaultValue: number
  onChange: (v: number) => void
  label?: string
  disabled?: boolean
  track?: string
}

export function Slider({ def, value, defaultValue, onChange, label, disabled, track }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const range = def.max - def.min
  const pct = ((value - def.min) / range) * 100
  const zeroPct = ((Math.min(def.max, Math.max(def.min, defaultValue)) - def.min) / range) * 100
  const bipolar = def.min < 0 && def.max > 0

  const quant = (v: number) => {
    const q = Math.round(v / def.step) * def.step
    return Math.min(def.max, Math.max(def.min, +q.toFixed(def.precision ?? 0)))
  }
  const fromX = (x: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return quant(def.min + ((x - r.left) / r.width) * range)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.detail > 1) return
    const el = e.currentTarget as HTMLElement
    capture(el, e.pointerId)
    setDrag(true)
    // Clicking on the thumb does not jump; clicking the track jumps there.
    const r = trackRef.current!.getBoundingClientRect()
    const thumbX = r.left + (pct / 100) * r.width
    const startX = e.clientX
    const startV = value
    const onThumb = Math.abs(e.clientX - thumbX) < 8
    if (!onThumb) onChange(fromX(e.clientX))
    const move = (ev: PointerEvent) => {
      if (onThumb) {
        const fine = ev.shiftKey ? 0.2 : 1
        onChange(quant(startV + ((ev.clientX - startX) / r.width) * range * fine))
      } else onChange(fromX(ev.clientX))
    }
    const up = () => {
      setDrag(false)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const commitText = () => {
    if (text === null) return
    const v = parseFloat(text.replace(',', '.'))
    if (Number.isFinite(v)) onChange(quant(v))
    setText(null)
  }

  const changed = Math.abs(value - defaultValue) > 1e-9
  return (
    <div className={`sl${drag ? ' drag' : ''}${changed ? ' changed' : ''}${disabled ? ' disabled' : ''}`}>
      <div className="sl-top">
        <span className="sl-label" onDoubleClick={() => onChange(defaultValue)} title="Double-click: reset">
          {label ?? def.label}
        </span>
        <input
          className="sl-val"
          value={text ?? fmt(value, def)}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => {
            setText(fmt(value, def).replace('+', ''))
            requestAnimationFrame(() => e.target.select())
          }}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') {
              setText(null)
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const d = (e.key === 'ArrowUp' ? 1 : -1) * def.step * (e.shiftKey ? 10 : 1) * (def.precision === 2 ? 10 : 1)
              const v = quant(value + d)
              onChange(v)
              setText(fmt(v, def).replace('+', ''))
            }
            e.stopPropagation()
          }}
          aria-label={label ?? def.label}
        />
      </div>
      <div className="sl-track" ref={trackRef} onPointerDown={onPointerDown} onDoubleClick={() => onChange(defaultValue)}>
        <div className={`sl-line${track ?? def.track ? ' grad' : ''}`} style={track ?? def.track ? { background: track ?? def.track } : undefined} />
        {bipolar && !(track ?? def.track) && <div className="sl-zero" style={{ left: `${zeroPct}%` }} />}
        {!(track ?? def.track) && changed && (
          <div className="sl-fill" style={{ left: `${Math.min(pct, zeroPct)}%`, width: `${Math.abs(pct - zeroPct)}%` }} />
        )}
        <div className="sl-thumb" style={{ left: `${pct}%` }} />
      </div>
    </div>
  )
}

/** A slider bound to a Params path in the editor store. */
export function PSlider({ def, label, disabled, track }: { def: SliderDef; label?: string; disabled?: boolean; track?: string }) {
  const value = editor.use((s) => getAt(s.params, def.key) as number)
  return (
    <Slider
      def={def}
      label={label}
      value={value}
      defaultValue={defaultAt(def.key) as number}
      disabled={disabled}
      track={track}
      onChange={(v) => setParam(def.key, v, label ?? def.label)}
    />
  )
}

/** Re-renders when params change; handy for derived displays. */
export function useParams(): Params {
  return editor.use((s) => s.params)
}

