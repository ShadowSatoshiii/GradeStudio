// Built-in presets (own values) and preset application with an amount.
import { cloneParams, defaultParams, type CurvePoint, type Params } from './params'

export interface Preset {
  id: string
  name: string
  group: string
  /** Only the settings the preset changes. */
  params: Partial<Params>
  builtIn?: boolean
}

const d = defaultParams()
const g = (h: number, s: number, l = 0) => ({ hue: h, sat: s, lum: l })
const curve = (pts: CurvePoint[]) => ({ ...d.curve, master: pts })
const pts = (list: CurvePoint[]) => list

const LIST: Omit<Preset, 'builtIn'>[] = [
  // Portrait
  { id: 'p-soft', group: 'Portrait', name: 'Soft Skin', params: { texture: -22, clarity: -8, highlights: -15, shadows: 12, vibrance: 8 } },
  { id: 'p-warm', group: 'Portrait', name: 'Warm & Bright', params: { exposure: 0.2, temp: 12, highlights: -20, shadows: 18, vibrance: 10, texture: -10 } },
  { id: 'p-cool', group: 'Portrait', name: 'Cool & Clear', params: { temp: -10, tint: 4, contrast: 10, clarity: 6, vibrance: 6 } },
  { id: 'p-matte', group: 'Portrait', name: 'Matte', params: { contrast: -12, curve: curve([[0, 0.08], [0.25, 0.27], [0.75, 0.76], [1, 0.95]]), saturation: -8, texture: -8 } },
  { id: 'p-glow', group: 'Portrait', name: 'Glow', params: { exposure: 0.15, clarity: -25, highlights: 15, vibrance: 12, dehaze: -8 } },
  // Landscape
  { id: 'l-vivid', group: 'Landscape', name: 'Punchy', params: { contrast: 18, highlights: -35, shadows: 25, vibrance: 30, clarity: 15, dehaze: 10 } },
  { id: 'l-sky', group: 'Landscape', name: 'Deep Sky', params: { highlights: -45, mixLum: [0, 0, 0, 0, -10, -35, -10, 0], mixSat: [0, 0, 0, 0, 10, 20, 0, 0], dehaze: 12 } },
  { id: 'l-green', group: 'Landscape', name: 'Lush Green', params: { mixHue: [0, 0, 18, 12, 0, 0, 0, 0], mixSat: [0, 0, 10, 22, 0, 0, 0, 0], mixLum: [0, 0, 0, 8, 0, 0, 0, 0], vibrance: 15 } },
  { id: 'l-golden', group: 'Landscape', name: 'Golden Hour', params: { temp: 24, tint: 6, highlights: -25, shadows: 15, vibrance: 18, grade: { ...d.grade, highlights: g(40, 28), shadows: g(220, 10) } } },
  { id: 'l-haze', group: 'Landscape', name: 'Haze Away', params: { dehaze: 35, contrast: 8, shadows: 15, vibrance: 10 } },
  // Black & white
  { id: 'bw-classic', group: 'B&W', name: 'Classic', params: { bw: true, contrast: 18, clarity: 10, grayMix: [10, 10, 0, -5, -10, -15, 0, 0] } },
  { id: 'bw-high', group: 'B&W', name: 'High Contrast', params: { bw: true, contrast: 45, whites: 20, blacks: -25, clarity: 20 } },
  { id: 'bw-soft', group: 'B&W', name: 'Soft', params: { bw: true, contrast: -20, highlights: -20, shadows: 20, clarity: -10 } },
  { id: 'bw-sepia', group: 'B&W', name: 'Sepia', params: { bw: true, grade: { ...d.grade, global: g(35, 22) }, contrast: 8 } },
  { id: 'bw-film', group: 'B&W', name: 'Grainy Film', params: { bw: true, contrast: 22, grain: { amount: 38, size: 30, roughness: 60 }, curve: curve([[0, 0.05], [0.5, 0.5], [1, 0.97]]) } },
  // Creative
  { id: 'c-teal', group: 'Creative', name: 'Teal & Orange', params: { grade: { ...d.grade, shadows: g(190, 35), highlights: g(35, 30), balance: 10 }, contrast: 12, vibrance: 8 } },
  { id: 'c-fade', group: 'Creative', name: 'Faded', params: { curve: curve([[0, 0.12], [0.5, 0.52], [1, 0.92]]), saturation: -20, contrast: -10 } },
  { id: 'c-cross', group: 'Creative', name: 'Cross Process', params: { curve: { ...d.curve, red: pts([[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]]), blue: pts([[0, 0.1], [0.5, 0.5], [1, 0.88]]) }, vibrance: 15 } },
  { id: 'c-moody', group: 'Creative', name: 'Moody', params: { exposure: -0.3, contrast: 15, highlights: -30, saturation: -18, vignette: { ...d.vignette, amount: -30 }, grade: { ...d.grade, shadows: g(210, 18) } } },
  { id: 'c-dream', group: 'Creative', name: 'Dreamy', params: { clarity: -35, dehaze: -15, highlights: 20, temp: 8, vibrance: 10, vignette: { ...d.vignette, amount: 18, feather: 80 } } },
  // Vintage
  { id: 'v-70s', group: 'Vintage', name: '70s', params: { temp: 18, tint: 8, saturation: -10, curve: curve([[0, 0.08], [0.5, 0.52], [1, 0.94]]), grade: { ...d.grade, highlights: g(45, 22), shadows: g(160, 12) }, grain: { amount: 20, size: 35, roughness: 50 } } },
  { id: 'v-polar', group: 'Vintage', name: 'Instant Film', params: { contrast: -10, highlights: 10, saturation: -12, temp: 6, curve: curve([[0, 0.1], [0.3, 0.32], [0.7, 0.74], [1, 0.94]]), vignette: { ...d.vignette, amount: -18 } } },
  { id: 'v-chrome', group: 'Vintage', name: 'Chrome', params: { contrast: 20, saturation: -25, vibrance: 15, clarity: 10, grade: { ...d.grade, shadows: g(200, 10), highlights: g(55, 10) } } },
  // Detail
  { id: 'd-sharp', group: 'Detail', name: 'Sharp', params: { sharpen: { amount: 60, radius: 1, detail: 30, masking: 20 } } },
  { id: 'd-nr', group: 'Detail', name: 'Reduce Noise', params: { noise: { ...d.noise, luminance: 35, color: 30 } } },
  { id: 'd-vig', group: 'Detail', name: 'Vignette', params: { vignette: { ...d.vignette, amount: -35, feather: 70 } } },
]

export const BUILTIN_PRESETS: Preset[] = LIST.map((p) => ({ ...p, builtIn: true }))

type Num = Record<string, unknown>

/** Interpolates numbers between `from` and `to` (recursively); other values come from `to`. */
function blend(from: unknown, to: unknown, t: number): unknown {
  if (typeof to === 'number' && typeof from === 'number') return +(from + (to - from) * t).toFixed(3)
  if (Array.isArray(to) && Array.isArray(from) && to.length === from.length && typeof to[0] === 'number') return to.map((v, i) => blend(from[i], v, t))
  if (to && typeof to === 'object' && !Array.isArray(to) && from && typeof from === 'object') {
    const out: Num = { ...(from as Num) }
    for (const k of Object.keys(to as Num)) out[k] = blend((from as Num)[k], (to as Num)[k], t)
    return out
  }
  return t > 0 ? structuredClone(to) : structuredClone(from)
}

/** Applies a preset to params with an amount (1 = 100 %, up to 2). */
export function applyPreset(base: Params, preset: Preset, amount = 1): Params {
  const out = cloneParams(base)
  for (const [k, v] of Object.entries(preset.params)) {
    // Amount scales the change relative to the defaults, like a strength slider.
    const def = (defaultParams() as unknown as Num)[k]
    ;(out as unknown as Num)[k] = blend(def, v, amount)
  }
  return out
}

/** Settings of `p` that differ from the defaults, for saving a preset. */
export function diffFromDefault(p: Params, keys: (keyof Params)[]): Partial<Params> {
  const def = defaultParams()
  const out: Partial<Params> = {}
  for (const k of keys) if (JSON.stringify(p[k]) !== JSON.stringify(def[k])) (out as Num)[k] = structuredClone(p[k])
  return out
}
