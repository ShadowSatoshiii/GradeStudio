// Rasterizes masks (brush, gradients, ranges, AI selections) into 0..1 coverage maps.
import type { Mask, MaskComp, MaskKind } from './params'

/** Long side of mask maps in pixels. */
export const MASK_SIDE = 1536

export interface MaskSource {
  w: number
  h: number
  /** OkLab per pixel (L, a, b). */
  lab: Float32Array
  /** Display luminance 0..1. */
  lum: Float32Array
  /** The image itself at mask size (for AI segmentation). */
  canvas: HTMLCanvasElement
}

const LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

export function makeMaskSource(rgba: Uint8ClampedArray, w: number, h: number): MaskSource {
  const n = w * h
  const lab = new Float32Array(n * 3)
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = LIN[rgba[i * 4]]
    const g = LIN[rgba[i * 4 + 1]]
    const b = LIN[rgba[i * 4 + 2]]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    lab[i * 3] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    lab[i * 3 + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    lab[i * 3 + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    lum[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0)
  return { w, h, lab, lum, canvas }
}

const smooth = (a: number, b: number, x: number) => {
  if (b <= a) return x >= b ? 1 : 0
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ---------- Brush (incremental) ----------

interface BrushCache {
  canvas: HTMLCanvasElement
  strokes: number
  lastPts: number
  key: string
}
const brushCache = new Map<string, BrushCache>()

function drawDabs(ctx: CanvasRenderingContext2D, pts: number[], from: number, w: number, h: number, s: { size: number; feather: number; flow: number; erase: boolean }) {
  const r = Math.max(1, s.size * Math.max(w, h))
  const inner = r * (1 - s.feather / 100) * 0.98
  const spacing = Math.max(1, r * 0.18)
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
  const alpha = Math.max(0.02, s.flow / 100)
  const dab = (x: number, y: number) => {
    const g = ctx.createRadialGradient(x, y, inner, x, y, r)
    g.addColorStop(0, `rgba(255,255,255,${alpha})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  let px = pts[Math.max(0, from - 2)] * w
  let py = pts[Math.max(0, from - 1)] * h
  if (from === 0) {
    dab(pts[0] * w, pts[1] * h)
    px = pts[0] * w
    py = pts[1] * h
    from = 2
  }
  for (let i = from; i + 1 < pts.length; i += 2) {
    const x = pts[i] * w
    const y = pts[i + 1] * h
    const d = Math.hypot(x - px, y - py)
    const steps = Math.floor(d / spacing)
    for (let k = 1; k <= steps; k++) dab(px + ((x - px) * k) / steps, py + ((y - py) * k) / steps)
    if (steps > 0) {
      px = x
      py = y
    }
  }
}

function brush(c: MaskComp, w: number, h: number): Float32Array {
  const strokes = c.strokes ?? []
  const key = `${w}x${h}`
  let cache = brushCache.get(c.id)
  const last = strokes[strokes.length - 1]
  const canAppend = cache && cache.key === key && cache.strokes === strokes.length && last && cache.lastPts <= last.pts.length
  if (!cache || !canAppend) {
    const canvas = cache?.key === key ? cache.canvas : document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.clearRect(0, 0, w, h)
    for (const s of strokes) drawDabs(ctx, s.pts, 0, w, h, s)
    cache = { canvas, strokes: strokes.length, lastPts: last?.pts.length ?? 0, key }
    brushCache.set(c.id, cache)
  } else if (last && cache.lastPts < last.pts.length) {
    drawDabs(cache.canvas.getContext('2d', { willReadFrequently: true })!, last.pts, cache.lastPts, w, h, last)
    cache.lastPts = last.pts.length
  }
  const d = cache.canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] / 255
  return out
}

// ---------- Other components ----------

function linear(c: MaskComp, w: number, h: number): Float32Array {
  const g = c.linear!
  const x1 = g.x1 * w
  const y1 = g.y1 * h
  const dx = g.x2 * w - x1
  const dy = g.y2 * h - y1
  const len2 = dx * dx + dy * dy || 1
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = ((x - x1) * dx + (y - y1) * dy) / len2
      out[y * w + x] = 1 - smooth(0, 1, t)
    }
  return out
}

function radial(c: MaskComp, w: number, h: number): Float32Array {
  const g = c.radial!
  const cx = g.cx * w
  const cy = g.cy * h
  const rx = Math.max(1, g.rx * w)
  const ry = Math.max(1, g.ry * h)
  const a = (g.angle * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const f = Math.min(1, Math.max(0, g.feather / 100))
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x - cx
      const py = y - cy
      const u = (px * cos + py * sin) / rx
      const v = (-px * sin + py * cos) / ry
      out[y * w + x] = 1 - smooth(1 - f, 1, Math.sqrt(u * u + v * v))
    }
  return out
}

function colorRange(c: MaskComp, src: MaskSource): Float32Array {
  const { samples, range } = c.color!
  const r = 0.03 + (range / 100) * 0.22
  const out = new Float32Array(src.w * src.h)
  if (!samples.length) return out
  for (let i = 0; i < out.length; i++) {
    const L = src.lab[i * 3]
    const A = src.lab[i * 3 + 1]
    const B = src.lab[i * 3 + 2]
    let best = Infinity
    for (const [sl, sa, sb] of samples) {
      const d = Math.sqrt((L - sl) * (L - sl) * 0.35 + (A - sa) * (A - sa) + (B - sb) * (B - sb))
      if (d < best) best = d
    }
    out[i] = 1 - smooth(r * 0.45, r, best)
  }
  return out
}

function lumRange(c: MaskComp, src: MaskSource): Float32Array {
  const g = c.lum!
  const lo = g.min / 100
  const hi = g.max / 100
  const sl = g.softLow / 100
  const sh = g.softHigh / 100
  const out = new Float32Array(src.w * src.h)
  for (let i = 0; i < out.length; i++) {
    const L = src.lum[i]
    out[i] = smooth(lo - sl, lo, L) * (1 - smooth(hi, hi + sh, L))
  }
  return out
}

export type AiKey = 'subject' | 'background' | 'sky' | 'person' | 'faceSkin' | 'bodySkin' | 'hair' | 'clothes'

export function aiKeyOf(c: MaskComp): AiKey | null {
  if (c.kind === 'person') return c.part && c.part !== 'person' ? c.part : 'person'
  if (c.kind === 'subject' || c.kind === 'background' || c.kind === 'sky') return c.kind
  return null
}

const AI_KINDS: MaskKind[] = ['subject', 'background', 'sky', 'person']
export const isAiKind = (k: MaskKind) => AI_KINDS.includes(k)

/** Coverage of a whole mask (components combined, inversion applied). */
export function rasterize(mask: Mask, src: MaskSource, ai: (k: AiKey) => Float32Array | undefined): Float32Array {
  const n = src.w * src.h
  let m: Float32Array | null = null
  for (const c of mask.comps) {
    let v: Float32Array
    if (c.kind === 'brush') v = brush(c, src.w, src.h)
    else if (c.kind === 'linear' && c.linear) v = linear(c, src.w, src.h)
    else if (c.kind === 'radial' && c.radial) v = radial(c, src.w, src.h)
    else if (c.kind === 'color' && c.color) v = colorRange(c, src)
    else if (c.kind === 'luminance' && c.lum) v = lumRange(c, src)
    else {
      const key = aiKeyOf(c)
      v = (key && ai(key)) || new Float32Array(n)
    }
    if (c.invert) for (let i = 0; i < n; i++) v[i] = 1 - v[i]
    if (!m) {
      m = c.mode === 'subtract' ? new Float32Array(n) : c.mode === 'intersect' ? v : v.slice()
      if (c.mode === 'subtract') continue
      continue
    }
    if (c.mode === 'add') for (let i = 0; i < n; i++) m[i] = Math.max(m[i], v[i])
    else if (c.mode === 'subtract') for (let i = 0; i < n; i++) m[i] *= 1 - v[i]
    else for (let i = 0; i < n; i++) m[i] *= v[i]
  }
  const out = m ?? new Float32Array(n)
  if (mask.invert) for (let i = 0; i < n; i++) out[i] = 1 - out[i]
  return out
}

/** Forgets cached brush rasters of components that no longer exist. */
export function pruneBrushCache(alive: Set<string>) {
  for (const id of brushCache.keys()) if (!alive.has(id)) brushCache.delete(id)
}
