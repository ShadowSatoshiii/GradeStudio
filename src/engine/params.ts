import type { Spot } from './retouch'

// Edit parameters of a photo. Everything is non-destructive: a photo keeps its
// original file and one Params object; the renderer turns both into pixels.

export type CurvePoint = [number, number]

export interface ToneCurve {
  /** Parametric region sliders (-100..100) and split points (0..100). */
  highlights: number
  lights: number
  darks: number
  shadows: number
  split1: number
  split2: number
  split3: number
  master: CurvePoint[]
  red: CurvePoint[]
  green: CurvePoint[]
  blue: CurvePoint[]
}

export interface GradeWheel {
  hue: number // 0..360
  sat: number // 0..100
  lum: number // -100..100
}

export interface CropState {
  /** Crop rectangle in normalized coordinates of the oriented, straightened image. */
  x: number
  y: number
  w: number
  h: number
  angle: number // straighten, degrees -45..45
  aspect: string // 'free' | 'original' | 'w:h'
  rot90: number // 0..3 quarter turns clockwise
  flipH: boolean
  flipV: boolean
}

export interface Geometry {
  upright: 'off' | 'auto' | 'level' | 'vertical' | 'full'
  distortion: number
  vertical: number
  horizontal: number
  rotate: number
  aspect: number
  scale: number
  offsetX: number
  offsetY: number
  constrain: boolean
}

export type MaskKind = 'brush' | 'linear' | 'radial' | 'color' | 'luminance' | 'subject' | 'background' | 'sky' | 'person'
export type PersonPart = 'person' | 'faceSkin' | 'bodySkin' | 'hair' | 'clothes'

export interface BrushStroke {
  /** Flat list x0, y0, x1, y1, … in source coordinates (0..1). */
  pts: number[]
  /** Radius as a fraction of the long image side. */
  size: number
  feather: number // 0..100
  flow: number // 0..100
  erase: boolean
}

export interface MaskComp {
  id: string
  kind: MaskKind
  mode: 'add' | 'subtract' | 'intersect'
  invert: boolean
  strokes?: BrushStroke[]
  /** Full effect at (x1, y1), none at (x2, y2); source coordinates. */
  linear?: { x1: number; y1: number; x2: number; y2: number }
  /** Center and radii in source coordinates (radii relative to width/height), angle in degrees. */
  radial?: { cx: number; cy: number; rx: number; ry: number; angle: number; feather: number }
  /** OkLab samples and range 0..100. */
  color?: { samples: [number, number, number][]; points?: [number, number][]; range: number }
  /** Display luminance window 0..100 with soft edges. */
  lum?: { min: number; max: number; softLow: number; softHigh: number }
  part?: PersonPart
}

export interface LocalAdjust {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temp: number
  tint: number
  hue: number
  saturation: number
  texture: number
  clarity: number
  dehaze: number
  sharpness: number
  noise: number
  colorHue: number
  colorSat: number
}

export interface Mask {
  id: string
  name: string
  visible: boolean
  invert: boolean
  amount: number // 0..200
  comps: MaskComp[]
  adj: LocalAdjust
}

export const defaultLocal = (): LocalAdjust => ({
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temp: 0,
  tint: 0,
  hue: 0,
  saturation: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  sharpness: 0,
  noise: 0,
  colorHue: 0,
  colorSat: 0,
})

export interface LensBlur {
  active: boolean
  amount: number // 0..100
  /** Focus point in source coordinates; x < 0 = focus on the subject. */
  focusX: number
  focusY: number
  range: number // 0..100 depth of field
  bokeh: 'circle' | 'bubble' | 'blade' | 'ring' | 'cateye'
  boost: number // highlights boost 0..100
  catEye: number // 0..100
}

export interface PointColor {
  id: string
  /** Sampled color (OkLab). */
  lab: [number, number, number]
  hue: number
  sat: number
  lum: number
  variance: number
  range: number
}

export interface Calibration {
  shadowTint: number
  redHue: number
  redSat: number
  greenHue: number
  greenSat: number
  blueHue: number
  blueSat: number
}

export interface Params {
  version: 1
  profile: string
  profileAmount: number
  bw: boolean
  // Light
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  curve: ToneCurve
  // Color
  wb: 'asShot' | 'auto' | 'custom'
  temp: number
  tint: number
  vibrance: number
  saturation: number
  mixHue: number[] // 8 bands: red, orange, yellow, green, aqua, blue, purple, magenta
  mixSat: number[]
  mixLum: number[]
  grayMix: number[]
  grade: { shadows: GradeWheel; midtones: GradeWheel; highlights: GradeWheel; global: GradeWheel; blending: number; balance: number }
  // Effects
  texture: number
  clarity: number
  dehaze: number
  vignette: { amount: number; midpoint: number; roundness: number; feather: number; highlights: number }
  grain: { amount: number; size: number; roughness: number }
  // Detail
  sharpen: { amount: number; radius: number; detail: number; masking: number }
  noise: { luminance: number; detail: number; contrast: number; color: number; colorDetail: number; smoothness: number }
  // Optics
  optics: { removeCA: boolean; distortion: number; vignetting: number; defringePurple: number; defringeGreen: number }
  geometry: Geometry
  crop: CropState
  masks: Mask[]
  spots: Spot[]
  lensBlur: LensBlur
  pointColors: PointColor[]
  calibration: Calibration
}

export const MIX_COLORS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'] as const
/** Swatch colors for the color mixer UI. */
export const MIX_SWATCH = ['#e5483f', '#ee8a2e', '#e8d23b', '#4fbf4a', '#3ec6c6', '#3b6fe0', '#8a4fdc', '#d447b6']

const zero8 = () => [0, 0, 0, 0, 0, 0, 0, 0]

export const LINE: CurvePoint[] = [
  [0, 0],
  [1, 1],
]

export function defaultParams(): Params {
  return {
    version: 1,
    profile: 'color',
    profileAmount: 100,
    bw: false,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    curve: {
      highlights: 0,
      lights: 0,
      darks: 0,
      shadows: 0,
      split1: 25,
      split2: 50,
      split3: 75,
      master: LINE.map((p) => [...p] as CurvePoint),
      red: LINE.map((p) => [...p] as CurvePoint),
      green: LINE.map((p) => [...p] as CurvePoint),
      blue: LINE.map((p) => [...p] as CurvePoint),
    },
    wb: 'asShot',
    temp: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    mixHue: zero8(),
    mixSat: zero8(),
    mixLum: zero8(),
    grayMix: zero8(),
    grade: {
      shadows: { hue: 0, sat: 0, lum: 0 },
      midtones: { hue: 0, sat: 0, lum: 0 },
      highlights: { hue: 0, sat: 0, lum: 0 },
      global: { hue: 0, sat: 0, lum: 0 },
      blending: 50,
      balance: 0,
    },
    texture: 0,
    clarity: 0,
    dehaze: 0,
    vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0 },
    grain: { amount: 0, size: 25, roughness: 50 },
    sharpen: { amount: 0, radius: 1, detail: 25, masking: 0 },
    noise: { luminance: 0, detail: 50, contrast: 0, color: 0, colorDetail: 50, smoothness: 50 },
    optics: { removeCA: false, distortion: 0, vignetting: 0, defringePurple: 0, defringeGreen: 0 },
    geometry: { upright: 'off', distortion: 0, vertical: 0, horizontal: 0, rotate: 0, aspect: 0, scale: 100, offsetX: 0, offsetY: 0, constrain: false },
    crop: { x: 0, y: 0, w: 1, h: 1, angle: 0, aspect: 'original', rot90: 0, flipH: false, flipV: false },
    masks: [],
    spots: [],
    lensBlur: { active: false, amount: 50, focusX: -1, focusY: -1, range: 25, bokeh: 'circle', boost: 30, catEye: 0 },
    pointColors: [],
    calibration: { shadowTint: 0, redHue: 0, redSat: 0, greenHue: 0, greenSat: 0, blueHue: 0, blueSat: 0 },
  }
}

export function cloneParams(p: Params): Params {
  return structuredClone(p)
}

/** Fills in fields missing from older saved params. */
export function normalizeParams(p: Partial<Params> | undefined): Params {
  const d = defaultParams()
  if (!p) return d
  const out = { ...d, ...p } as Params
  for (const k of ['curve', 'grade', 'vignette', 'grain', 'sharpen', 'noise', 'optics', 'geometry', 'crop', 'lensBlur', 'calibration'] as const) {
    ;(out as unknown as Record<string, unknown>)[k] = { ...(d[k] as object), ...((p[k] as object) ?? {}) }
  }
  out.masks = (p.masks ?? []).map((m) => ({ ...m, adj: { ...defaultLocal(), ...m.adj } }))
  out.spots = p.spots ?? []
  out.pointColors = p.pointColors ?? []
  return out
}

// ---------- Slider definitions ----------

export interface SliderDef {
  /** Dotted path into Params, e.g. "vignette.amount". */
  key: string
  label: string
  min: number
  max: number
  step: number
  precision?: number
  /** CSS background for the track. */
  track?: string
}

export const S = {
  exposure: { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01, precision: 2 },
  contrast: { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  highlights: { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  shadows: { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  whites: { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1 },
  blacks: { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1 },
  temp: { key: 'temp', label: 'Temperature', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#3d6fd6,#d8d8d8,#e2b33c)' },
  tint: { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#3fae4a,#d8d8d8,#c94fc0)' },
  vibrance: { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#8a8a8a,#c77b5a)' },
  saturation: { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#8a8a8a,#e0503c)' },
  texture: { key: 'texture', label: 'Texture', min: -100, max: 100, step: 1 },
  clarity: { key: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1 },
  dehaze: { key: 'dehaze', label: 'Dehaze', min: -100, max: 100, step: 1 },
  vigAmount: { key: 'vignette.amount', label: 'Vignette', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#000,#eee)' },
  vigMidpoint: { key: 'vignette.midpoint', label: 'Midpoint', min: 0, max: 100, step: 1 },
  vigRoundness: { key: 'vignette.roundness', label: 'Roundness', min: -100, max: 100, step: 1 },
  vigFeather: { key: 'vignette.feather', label: 'Feather', min: 0, max: 100, step: 1 },
  vigHighlights: { key: 'vignette.highlights', label: 'Highlights', min: 0, max: 100, step: 1 },
  grainAmount: { key: 'grain.amount', label: 'Grain', min: 0, max: 100, step: 1 },
  grainSize: { key: 'grain.size', label: 'Size', min: 0, max: 100, step: 1 },
  grainRoughness: { key: 'grain.roughness', label: 'Roughness', min: 0, max: 100, step: 1 },
  sharpAmount: { key: 'sharpen.amount', label: 'Sharpening', min: 0, max: 150, step: 1 },
  sharpRadius: { key: 'sharpen.radius', label: 'Radius', min: 0.5, max: 3, step: 0.1, precision: 1 },
  sharpDetail: { key: 'sharpen.detail', label: 'Detail', min: 0, max: 100, step: 1 },
  sharpMasking: { key: 'sharpen.masking', label: 'Masking', min: 0, max: 100, step: 1 },
  nrLum: { key: 'noise.luminance', label: 'Noise Reduction', min: 0, max: 100, step: 1 },
  nrDetail: { key: 'noise.detail', label: 'Detail', min: 0, max: 100, step: 1 },
  nrContrast: { key: 'noise.contrast', label: 'Contrast', min: 0, max: 100, step: 1 },
  nrColor: { key: 'noise.color', label: 'Color Noise', min: 0, max: 100, step: 1 },
  nrColorDetail: { key: 'noise.colorDetail', label: 'Detail', min: 0, max: 100, step: 1 },
  nrSmooth: { key: 'noise.smoothness', label: 'Smoothness', min: 0, max: 100, step: 1 },
  profileAmount: { key: 'profileAmount', label: 'Amount', min: 0, max: 200, step: 1 },
  blending: { key: 'grade.blending', label: 'Blending', min: 0, max: 100, step: 1 },
  balance: { key: 'grade.balance', label: 'Balance', min: -100, max: 100, step: 1 },
  fringePurple: { key: 'optics.defringePurple', label: 'Purple', min: 0, max: 20, step: 1, track: 'linear-gradient(90deg,#666,#b04fd6)' },
  fringeGreen: { key: 'optics.defringeGreen', label: 'Green', min: 0, max: 20, step: 1, track: 'linear-gradient(90deg,#666,#4fc05a)' },
  lensDistortion: { key: 'optics.distortion', label: 'Distortion', min: -100, max: 100, step: 1 },
  lensVignetting: { key: 'optics.vignetting', label: 'Vignetting', min: -100, max: 100, step: 1 },
  lbAmount: { key: 'lensBlur.amount', label: 'Blur Amount', min: 0, max: 100, step: 1 },
  lbRange: { key: 'lensBlur.range', label: 'Focal Range', min: 0, max: 100, step: 1 },
  lbBoost: { key: 'lensBlur.boost', label: 'Boost Highlights', min: 0, max: 100, step: 1 },
  lbCatEye: { key: 'lensBlur.catEye', label: 'Cat Eye', min: 0, max: 100, step: 1 },
  calShadow: { key: 'calibration.shadowTint', label: 'Shadows Tint', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#3fae4a,#d8d8d8,#c94fc0)' },
  calRedHue: { key: 'calibration.redHue', label: 'Red Hue', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#d447b6,#e5483f,#ee8a2e)' },
  calRedSat: { key: 'calibration.redSat', label: 'Red Saturation', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#8a8a8a,#e5483f)' },
  calGreenHue: { key: 'calibration.greenHue', label: 'Green Hue', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#e8d23b,#4fbf4a,#3ec6c6)' },
  calGreenSat: { key: 'calibration.greenSat', label: 'Green Saturation', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#8a8a8a,#4fbf4a)' },
  calBlueHue: { key: 'calibration.blueHue', label: 'Blue Hue', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#3ec6c6,#3b6fe0,#8a4fdc)' },
  calBlueSat: { key: 'calibration.blueSat', label: 'Blue Saturation', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#8a8a8a,#3b6fe0)' },
  angle: { key: 'crop.angle', label: 'Straighten', min: -45, max: 45, step: 0.1, precision: 1 },
  geoDistortion: { key: 'geometry.distortion', label: 'Distortion', min: -100, max: 100, step: 1 },
  geoVertical: { key: 'geometry.vertical', label: 'Vertical', min: -100, max: 100, step: 1 },
  geoHorizontal: { key: 'geometry.horizontal', label: 'Horizontal', min: -100, max: 100, step: 1 },
  geoRotate: { key: 'geometry.rotate', label: 'Rotate', min: -10, max: 10, step: 0.1, precision: 1 },
  geoAspect: { key: 'geometry.aspect', label: 'Aspect', min: -100, max: 100, step: 1 },
  geoScale: { key: 'geometry.scale', label: 'Scale', min: 50, max: 150, step: 1 },
  geoOffsetX: { key: 'geometry.offsetX', label: 'X Offset', min: -100, max: 100, step: 0.1, precision: 1 },
  geoOffsetY: { key: 'geometry.offsetY', label: 'Y Offset', min: -100, max: 100, step: 0.1, precision: 1 },
} satisfies Record<string, SliderDef>

/** Sliders of a mask's local adjustments (keys relative to the mask's `adj`). */
export const LOCAL_SLIDERS: (SliderDef & { group: string })[] = [
  { group: 'Light', key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.01, precision: 2 },
  { group: 'Light', key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { group: 'Light', key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { group: 'Light', key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { group: 'Light', key: 'whites', label: 'Whites', min: -100, max: 100, step: 1 },
  { group: 'Light', key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1 },
  { group: 'Color', key: 'temp', label: 'Temperature', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#3d6fd6,#d8d8d8,#e2b33c)' },
  { group: 'Color', key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#3fae4a,#d8d8d8,#c94fc0)' },
  { group: 'Color', key: 'hue', label: 'Hue', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#d447b6,#e5483f,#e8d23b,#4fbf4a,#3b6fe0)' },
  { group: 'Color', key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg,#8a8a8a,#e0503c)' },
  { group: 'Effects', key: 'texture', label: 'Texture', min: -100, max: 100, step: 1 },
  { group: 'Effects', key: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1 },
  { group: 'Effects', key: 'dehaze', label: 'Dehaze', min: -100, max: 100, step: 1 },
  { group: 'Detail', key: 'sharpness', label: 'Sharpness', min: -100, max: 100, step: 1 },
  { group: 'Detail', key: 'noise', label: 'Noise', min: -100, max: 100, step: 1 },
]

/** Default value of the slider at `key`. */
export function defaultAt(key: string): unknown {
  return getAt(defaultParams(), key)
}

export function getAt(p: unknown, key: string): unknown {
  let cur = p as Record<string, unknown>
  for (const part of key.split('.')) {
    if (cur == null) return undefined
    cur = cur[part] as Record<string, unknown>
  }
  return cur
}

/** Returns a copy of `p` with `key` set to `value` (copies along the path). */
export function setAt<T>(p: T, key: string, value: unknown): T {
  const parts = key.split('.')
  const root = Array.isArray(p) ? [...(p as unknown[])] : { ...(p as object) }
  let cur = root as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]]
    const copy = Array.isArray(next) ? [...next] : { ...(next as object) }
    cur[parts[i]] = copy
    cur = copy as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
  return root as T
}

/** True if any parameter differs from its default. */
export function isEdited(p: Params): boolean {
  return JSON.stringify(p) !== JSON.stringify(defaultParams())
}

export function curveIsLinear(pts: CurvePoint[]): boolean {
  return pts.every(([x, y]) => Math.abs(x - y) < 1e-4)
}
