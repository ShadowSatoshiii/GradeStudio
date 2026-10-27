// Non-destructive retouching: remove (content-aware fill), heal, clone and red eye.
// Spots are applied in order to a copy of the photo; the renderer develops the result.
import { vanish } from '../ai/vanish'
import type { BrushStroke } from './params'

export interface Spot {
  id: string
  mode: 'remove' | 'heal' | 'clone' | 'redeye'
  /** Painted area (source coordinates). */
  strokes: BrushStroke[]
  /** Offset of the copy source (source coordinates, heal/clone). */
  dx: number
  dy: number
  opacity: number // 0..100
  feather: number // 0..100
  /** Red eye: center and radius (fraction of the long side), pupil size and darkening 0..100. */
  eye?: { cx: number; cy: number; r: number; pupil: number; darken: number }
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Bounding box of a spot's strokes in pixels (with brush radius). */
export function spotRect(s: Spot, W: number, H: number): Rect | null {
  if (s.mode === 'redeye' && s.eye) {
    const r = s.eye.r * Math.max(W, H)
    return clamp({ x: s.eye.cx * W - r, y: s.eye.cy * H - r, w: r * 2, h: r * 2 }, W, H)
  }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const st of s.strokes) {
    const r = st.size * Math.max(W, H)
    for (let i = 0; i + 1 < st.pts.length; i += 2) {
      x0 = Math.min(x0, st.pts[i] * W - r)
      y0 = Math.min(y0, st.pts[i + 1] * H - r)
      x1 = Math.max(x1, st.pts[i] * W + r)
      y1 = Math.max(y1, st.pts[i + 1] * H + r)
    }
  }
  if (!Number.isFinite(x0)) return null
  return clamp({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, W, H)
}

function clamp(r: Rect, W: number, H: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x))
  const y = Math.max(0, Math.floor(r.y))
  const x2 = Math.min(W, Math.ceil(r.x + r.w))
  const y2 = Math.min(H, Math.ceil(r.y + r.h))
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null
}

/** Alpha mask canvas of a spot's strokes (full canvas size). */
function strokeMask(s: Spot, W: number, H: number, hard = false): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  for (const st of s.strokes) {
    const r = Math.max(1, st.size * Math.max(W, H))
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#fff'
    ctx.fillStyle = '#fff'
    ctx.lineWidth = r * 2
    const feather = hard ? 0 : (s.feather / 100) * r * 0.8
    ctx.filter = feather > 0.5 ? `blur(${feather.toFixed(1)}px)` : 'none'
    ctx.lineWidth = Math.max(1, (r - feather * 0.5) * 2)
    ctx.beginPath()
    ctx.moveTo(st.pts[0] * W, st.pts[1] * H)
    for (let i = 2; i + 1 < st.pts.length; i += 2) ctx.lineTo(st.pts[i] * W, st.pts[i + 1] * H)
    if (st.pts.length <= 2) {
      ctx.arc(st.pts[0] * W, st.pts[1] * H, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    } else ctx.stroke()
  }
  ctx.filter = 'none'
  return c
}

function blurBox(src: Float32Array, w: number, h: number, r: number, ch = 3): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++)
    for (let c = 0; c < ch; c++) {
      let acc = 0
      let n = 0
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, k))
        acc += src[(y * w + xx) * ch + c]
        n++
      }
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * ch + c] = acc / n
        const add = Math.min(w - 1, x + r + 1)
        const sub = Math.max(0, x - r)
        acc += src[(y * w + add) * ch + c] - src[(y * w + sub) * ch + c]
      }
    }
  for (let x = 0; x < w; x++)
    for (let c = 0; c < ch; c++) {
      let acc = 0
      let n = 0
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, k))
        acc += tmp[(yy * w + x) * ch + c]
        n++
      }
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * ch + c] = acc / n
        const add = Math.min(h - 1, y + r + 1)
        const sub = Math.max(0, y - r)
        acc += tmp[(add * w + x) * ch + c] - tmp[(sub * w + x) * ch + c]
      }
    }
  return out
}

/** Copies (clone) or heals (copy texture, keep the target's colors and light). */
function copySpot(work: HTMLCanvasElement, s: Spot, heal: boolean) {
  const W = work.width
  const H = work.height
  const R = spotRect(s, W, H)
  if (!R) return
  const pad = Math.ceil(Math.max(R.w, R.h) * 0.6) + 4
  const B = clamp({ x: R.x - pad, y: R.y - pad, w: R.w + pad * 2, h: R.h + pad * 2 }, W, H)!
  const ox = Math.round(s.dx * W)
  const oy = Math.round(s.dy * H)
  const S = clamp({ x: B.x + ox, y: B.y + oy, w: B.w, h: B.h }, W, H)
  if (!S || S.w !== B.w || S.h !== B.h) return
  const ctx = work.getContext('2d', { willReadFrequently: true })!
  const dst = ctx.getImageData(B.x, B.y, B.w, B.h)
  const src = ctx.getImageData(S.x, S.y, S.w, S.h)
  const soft = strokeMask(s, W, H).getContext('2d')!.getImageData(B.x, B.y, B.w, B.h).data
  const n = B.w * B.h
  let off: Float32Array | null = null
  if (heal) {
    // Color/light offset between target and source, measured only OUTSIDE the
    // painted area (normalized convolution) so the blemish itself does not leak in.
    const hard = strokeMask(s, W, H, true).getContext('2d')!.getImageData(B.x, B.y, B.w, B.h).data
    const wgt = new Float32Array(n)
    const dw = new Float32Array(n * 3)
    const sw = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const w = hard[i * 4 + 3] > 8 ? 0 : 1
      wgt[i] = w
      for (let c = 0; c < 3; c++) {
        dw[i * 3 + c] = dst.data[i * 4 + c] * w
        sw[i * 3 + c] = src.data[i * 4 + c] * w
      }
    }
    const r = Math.max(3, Math.round(Math.max(R.w, R.h) * 0.45))
    const pass = (a: Float32Array, ch: number) => blurBox(blurBox(a, B.w, B.h, r, ch), B.w, B.h, r, ch)
    const bw = pass(wgt, 1)
    const bd = pass(dw, 3)
    const bs = pass(sw, 3)
    off = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const k = 1 / Math.max(1e-3, bw[i])
      for (let c = 0; c < 3; c++) off[i * 3 + c] = (bd[i * 3 + c] - bs[i * 3 + c]) * k
    }
  }
  const op = s.opacity / 100
  for (let i = 0; i < n; i++) {
    const a = (soft[i * 4 + 3] / 255) * op
    if (a <= 0) continue
    for (let c = 0; c < 3; c++) {
      let v = src.data[i * 4 + c]
      if (off) v += off[i * 3 + c]
      dst.data[i * 4 + c] = dst.data[i * 4 + c] * (1 - a) + v * a
    }
  }
  ctx.putImageData(dst, B.x, B.y)
}

/** Darkens red pupils inside the eye circle. */
function redEye(work: HTMLCanvasElement, s: Spot) {
  const e = s.eye
  if (!e) return
  const W = work.width
  const H = work.height
  const R = spotRect(s, W, H)
  if (!R) return
  const ctx = work.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(R.x, R.y, R.w, R.h)
  const d = img.data
  const cx = e.cx * W - R.x
  const cy = e.cy * H - R.y
  const rad = e.r * Math.max(W, H) * (0.55 + (e.pupil / 100) * 0.45)
  const dark = 0.25 + (e.darken / 100) * 0.7
  for (let y = 0; y < R.h; y++)
    for (let x = 0; x < R.w; x++) {
      const dist = Math.hypot(x - cx, y - cy) / rad
      if (dist > 1) continue
      const i = (y * R.w + x) * 4
      const r = d[i]
      const g = d[i + 1]
      const b = d[i + 2]
      const redness = (r - Math.max(g, b)) / Math.max(1, r)
      if (redness < 0.15) continue
      const k = Math.min(1, (redness - 0.15) / 0.25) * (1 - Math.max(0, (dist - 0.75) / 0.25))
      const neutral = Math.min(g, b) * (1 - dark)
      d[i] = r * (1 - k) + neutral * k
      d[i + 1] = g * (1 - k) + Math.min(g, neutral * 1.05) * k
      d[i + 2] = b * (1 - k) + Math.min(b, neutral * 1.08) * k
    }
  ctx.putImageData(img, R.x, R.y)
}

/** Finds a source offset whose surroundings match the spot's border (heal/clone). */
export function autoSource(work: HTMLCanvasElement, s: Spot): { dx: number; dy: number } {
  const W = work.width
  const H = work.height
  const R = spotRect(s, W, H)
  if (!R) return { dx: 0.05, dy: 0 }
  const pad = Math.ceil(Math.max(R.w, R.h) * 0.3) + 3
  const B = clamp({ x: R.x - pad, y: R.y - pad, w: R.w + pad * 2, h: R.h + pad * 2 }, W, H)!
  const ctx = work.getContext('2d', { willReadFrequently: true })!
  const all = ctx.getImageData(0, 0, W, H).data
  const mask = strokeMask(s, W, H, true).getContext('2d')!.getImageData(0, 0, W, H).data
  const step = Math.max(1, Math.round(Math.max(B.w, B.h) / 40))
  const ring: number[] = []
  for (let y = B.y; y < B.y + B.h; y += step)
    for (let x = B.x; x < B.x + B.w; x += step) if (mask[(y * W + x) * 4 + 3] < 10) ring.push(y * W + x)
  const size = Math.max(R.w, R.h)
  let best = { dx: size * 1.6, dy: 0 }
  let bestC = Infinity
  for (const k of [1.4, 2, 2.8, 3.8])
    for (let a = 0; a < 16; a++) {
      const ox = Math.round(Math.cos((a / 16) * Math.PI * 2) * size * k)
      const oy = Math.round(Math.sin((a / 16) * Math.PI * 2) * size * k)
      if (B.x + ox < 0 || B.y + oy < 0 || B.x + B.w + ox > W || B.y + B.h + oy > H) continue
      let c = 0
      for (const i of ring) {
        const j = i + oy * W + ox
        for (let ch = 0; ch < 3; ch++) {
          const dv = all[i * 4 + ch] - all[j * 4 + ch]
          c += dv * dv
        }
        if (mask[j * 4 + 3] > 10) c += 30000 // source must not lie in the painted area
      }
      c = c / Math.max(1, ring.length) + k * 40 // prefer nearby sources
      if (c < bestC) {
        bestC = c
        best = { dx: ox, dy: oy }
      }
    }
  return { dx: best.dx / W, dy: best.dy / H }
}

/** Applies spots (in order) to `work` in place. */
export async function applySpots(work: HTMLCanvasElement, spots: Spot[]) {
  for (const s of spots) {
    if (s.mode === 'redeye') redEye(work, s)
    else if (s.mode === 'remove') {
      const R = spotRect(s, work.width, work.height)
      if (R) await vanish(work, strokeMask(s, work.width, work.height, true), R)
    } else copySpot(work, s, s.mode === 'heal')
  }
}
