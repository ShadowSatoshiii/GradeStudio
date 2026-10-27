// 1D tone functions baked into lookup tables for the renderer.
import type { CurvePoint, Params, ToneCurve } from './params'

/** Number of LUT entries; the master row spans display values 0..TONE_RANGE. */
export const LUT_SIZE = 1024
export const TONE_RANGE = 1.5

/** Monotone cubic interpolation (Fritsch–Carlson) through sorted points. */
export function makeSpline(points: CurvePoint[]): (x: number) => number {
  const pts = [...points].sort((a, b) => a[0] - b[0])
  const n = pts.length
  if (n < 2) return (x) => x
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const d: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]))
  m.push(d[0])
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2)
  m.push(d[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (i < n - 2 && x > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i]
    const t = (x - xs[i]) / h
    const t2 = t * t
    const t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Soft bump that is 1 in [a, b] and fades out over `fade` on both sides. */
const bump = (a: number, b: number, fade: number, x: number) => smooth(a - fade, a + fade * 0.5, x) * (1 - smooth(b - fade * 0.5, b + fade, x))

/** Parametric curve: four region sliders over three split points. */
export function parametric(c: ToneCurve): (x: number) => number {
  const s1 = c.split1 / 100
  const s2 = c.split2 / 100
  const s3 = c.split3 / 100
  const amt = 0.12
  return (x: number) => {
    if (x > 1) return x
    const env = Math.sin(Math.PI * Math.min(1, Math.max(0, x))) // keeps 0 and 1 fixed
    let y = x
    y += (c.shadows / 100) * amt * bump(0, s1, 0.12, x) * env * 1.6
    y += (c.darks / 100) * amt * bump(s1, s2, 0.12, x) * env
    y += (c.lights / 100) * amt * bump(s2, s3, 0.12, x) * env
    y += (c.highlights / 100) * amt * bump(s3, 1, 0.12, x) * env * 1.6
    return y
  }
}

/** Whites, blacks and contrast as one global function on display values. */
export function baseTone(p: Params): (x: number) => number {
  const b = p.blacks / 100
  const w = p.whites / 100
  const c = p.contrast / 100
  const s = c >= 0 ? 1 + c * 0.6 : 1 + c * 0.4
  const pivot = 0.46
  return (x0: number) => {
    let x = x0
    // Blacks: smooth toe, strongest at black.
    const xb = Math.min(1, Math.max(0, x))
    x += b * 0.1 * Math.pow(1 - xb, 4)
    // Whites: smooth shoulder, strongest at white; above 1 scales the overflow.
    if (x <= 1) x += w * (w > 0 ? 0.18 : 0.15) * Math.pow(Math.max(0, x), w > 0 ? 2.6 : 3.2)
    else x = 1 + w * 0.15 + (x - 1) * (1 + w * 0.5)
    // Contrast: symmetric power S-curve around mid gray (keeps 0 and 1).
    if (s !== 1) {
      if (x <= 0) x = 0
      else if (x < pivot) x = pivot * Math.pow(x / pivot, s)
      else if (x < 1) x = 1 - (1 - pivot) * Math.pow((1 - x) / (1 - pivot), s)
    }
    return x
  }
}

/**
 * Builds the tone LUT: row 0 = master (input 0..TONE_RANGE), rows 1-3 = R, G, B
 * point curves (input 0..1). Values are display-referred.
 */
export function buildToneLut(p: Params): Float32Array {
  const out = new Float32Array(LUT_SIZE * 4)
  const base = baseTone(p)
  const para = parametric(p.curve)
  const master = makeSpline(p.curve.master)
  const rgb = [makeSpline(p.curve.red), makeSpline(p.curve.green), makeSpline(p.curve.blue)]
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1)
    let x = base(t * TONE_RANGE)
    x = para(x)
    x = x <= 1 ? master(Math.max(0, x)) : master(1) + (x - 1)
    out[i] = x
    for (let c = 0; c < 3; c++) out[(c + 1) * LUT_SIZE + i] = rgb[c](t)
  }
  return out
}
