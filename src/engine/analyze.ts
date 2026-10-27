// CPU analysis on a small copy of the photo: haze map, auto tone, auto white balance.
import { LUMA, neutralize, srgbToLinear, wbGains } from './color'
import type { Params } from './params'

export interface Small {
  w: number
  h: number
  /** Linear RGB, 3 floats per pixel. */
  lin: Float32Array
  alpha: Uint8ClampedArray
}

const LIN = new Float32Array(256).map((_, i) => srgbToLinear(i / 255))

export function smallCopy(src: CanvasImageSource, w: number, h: number, maxSide = 320): Small {
  const s = Math.min(1, maxSide / Math.max(w, h))
  const sw = Math.max(1, Math.round(w * s))
  const sh = Math.max(1, Math.round(h * s))
  const c = document.createElement('canvas')
  c.width = sw
  c.height = sh
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, sw, sh)
  const d = ctx.getImageData(0, 0, sw, sh).data
  const lin = new Float32Array(sw * sh * 3)
  const alpha = new Uint8ClampedArray(sw * sh)
  for (let i = 0, j = 0; i < sw * sh; i++, j += 4) {
    lin[i * 3] = LIN[d[j]]
    lin[i * 3 + 1] = LIN[d[j + 1]]
    lin[i * 3 + 2] = LIN[d[j + 2]]
    alpha[i] = d[j + 3]
  }
  return { w: sw, h: sh, lin, alpha }
}

/** Dark-channel haze estimate: per-pixel haze density (0..255) and atmospheric light. */
export function hazeMap(sm: Small): { data: Uint8Array; w: number; h: number; atmos: [number, number, number] } {
  const { w, h, lin } = sm
  const n = w * h
  const dark = new Float32Array(n)
  for (let i = 0; i < n; i++) dark[i] = Math.min(lin[i * 3], lin[i * 3 + 1], lin[i * 3 + 2])
  // Atmospheric light: mean color of the brightest 0.5% in the dark channel.
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => dark[b] - dark[a])
  const top = idx.slice(0, Math.max(1, Math.floor(n * 0.005)))
  const A: [number, number, number] = [0, 0, 0]
  for (const i of top) {
    A[0] += lin[i * 3]
    A[1] += lin[i * 3 + 1]
    A[2] += lin[i * 3 + 2]
  }
  for (let c = 0; c < 3; c++) A[c] = Math.max(0.05, Math.min(1, A[c] / top.length))
  // Normalized dark channel with local minimum filter.
  const norm = new Float32Array(n)
  for (let i = 0; i < n; i++) norm[i] = Math.min(lin[i * 3] / A[0], lin[i * 3 + 1] / A[1], lin[i * 3 + 2] / A[2])
  const r = Math.max(2, Math.round(Math.max(w, h) / 64))
  const minF = minFilter(norm, w, h, r)
  const blurred = boxBlur(minF, w, h, r * 2)
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) data[i] = Math.round(Math.min(1, Math.max(0, blurred[i])) * 255)
  return { data, w, h, atmos: A }
}

function minFilter(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(a.length)
  const out = new Float32Array(a.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = Infinity
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.min(m, a[y * w + k])
      tmp[y * w + x] = m
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = Infinity
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.min(m, tmp[k * w + x])
      out[y * w + x] = m
    }
  return out
}

function boxBlur(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(a.length)
  const out = new Float32Array(a.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let c = 0
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++, c++) s += a[y * w + k]
      tmp[y * w + x] = s / c
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let c = 0
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++, c++) s += tmp[k * w + x]
      out[y * w + x] = s / c
    }
  return out
}

/** Average color of mid-tone, not-too-saturated pixels (gray-world estimate). */
export function grayWorld(sm: Small): [number, number, number] {
  const { lin } = sm
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < lin.length; i += 3) {
    const y = LUMA[0] * lin[i] + LUMA[1] * lin[i + 1] + LUMA[2] * lin[i + 2]
    if (y < 0.03 || y > 0.85) continue
    const mx = Math.max(lin[i], lin[i + 1], lin[i + 2])
    const mn = Math.min(lin[i], lin[i + 1], lin[i + 2])
    if ((mx - mn) / mx > 0.6) continue
    r += lin[i]
    g += lin[i + 1]
    b += lin[i + 2]
    n++
  }
  if (n < 10) return [1, 1, 1]
  return [r / n, g / n, b / n]
}

export function autoWhiteBalance(sm: Small): { temp: number; tint: number } {
  const avg = grayWorld(sm)
  const res = neutralize(avg)
  // Gray world overshoots on scenes with a dominant color; keep 75% of the correction.
  return { temp: Math.round(res.temp * 0.75), tint: Math.round(res.tint * 0.75) }
}

/** Display-luminance percentile (0..1) of the small copy after white balance gains. */
function percentiles(sm: Small, gains: [number, number, number], ps: number[]): number[] {
  const hist = new Uint32Array(1024)
  let n = 0
  for (let i = 0; i < sm.lin.length; i += 3) {
    if (sm.alpha[i / 3] < 128) continue
    const y = LUMA[0] * sm.lin[i] * gains[0] + LUMA[1] * sm.lin[i + 1] * gains[1] + LUMA[2] * sm.lin[i + 2] * gains[2]
    const d = y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055
    hist[Math.min(1023, Math.max(0, Math.round(d * 1023)))]++
    n++
  }
  return ps.map((p) => {
    const target = p * n
    let acc = 0
    for (let i = 0; i < 1024; i++) {
      acc += hist[i]
      if (acc >= target) return i / 1023
    }
    return 1
  })
}

/** "Auto" settings: brings exposure, contrast and the tonal range into a balanced state. */
export function autoTone(sm: Small, p: Params): Partial<Params> {
  const gains = wbGains(p.temp, p.tint)
  const [p005, p05, p50, p95, p995] = percentiles(sm, gains, [0.005, 0.05, 0.5, 0.95, 0.995])
  // Exposure: move the median toward mid gray, but keep the bright parts (p95) below white.
  const lin = (d: number) => Math.max(0.002, (d + 0.055) / 1.055) ** 2.4
  const byMedian = Math.log2(0.18 / lin(p50)) * 0.5
  const byHighlights = Math.log2(lin(0.94) / lin(Math.max(0.05, p95))) + 0.25
  let exposure = Math.min(byMedian, Math.max(byHighlights, byMedian < 0 ? byMedian : 0))
  exposure = Math.max(-1.5, Math.min(1.2, exposure))
  const spread = p95 - p05
  const contrast = Math.round(Math.max(-30, Math.min(30, (0.62 - spread) * 60)))
  const highlights = Math.round(Math.max(-70, Math.min(0, -(p995 - 0.92) * 400 - (exposure > 0 ? exposure * 25 : 0))))
  const shadows = Math.round(Math.max(0, Math.min(60, (0.12 - p05) * 300 + (exposure < 0 ? -exposure * 20 : 0))))
  const whites = Math.round(Math.max(-40, Math.min(40, (0.97 - p995) * 120)))
  const blacks = Math.round(Math.max(-40, Math.min(30, (p005 - 0.02) * -250)))
  return {
    exposure: Math.round(exposure * 100) / 100,
    contrast,
    highlights,
    shadows,
    whites,
    blacks,
    vibrance: 18,
    saturation: 4,
  }
}

export interface Analysis {
  small: Small
  haze: ReturnType<typeof hazeMap>
}

export function analyzeFor(src: CanvasImageSource, w: number, h: number): Analysis {
  const small = smallCopy(src, w, h)
  return { small, haze: hazeMap(small) }
}

// ---------- OkLab helpers (CPU) ----------

const HC = [25, 55, 100, 140, 195, 255, 295, 335]

function oklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** Weights of the eight mixer bands for an OkLCh hue in degrees (same as the shader). */
export function hueWeights(h: number): number[] {
  const w = new Array(8).fill(0)
  for (let i = 0; i < 8; i++) {
    const a = HC[i]
    let b = HC[(i + 1) % 8]
    if (b < a) b += 360
    const x = h < a ? h + 360 : h
    if (x >= a && x < b) {
      let t = (x - a) / (b - a)
      t = t * t * (3 - 2 * t)
      w[i] = 1 - t
      w[(i + 1) % 8] = t
      break
    }
  }
  return w
}

/**
 * Automatic black & white mix: pushes the gray value of each color band away
 * from the image average, so colors that differ also differ in gray.
 */
export function autoGrayMix(sm: Small): number[] {
  const sumL = new Array(8).fill(0)
  const sumW = new Array(8).fill(0)
  let allL = 0
  let n = 0
  for (let i = 0; i < sm.lin.length; i += 3) {
    const [L, A, B] = oklab(sm.lin[i], sm.lin[i + 1], sm.lin[i + 2])
    allL += L
    n++
    const C = Math.hypot(A, B)
    if (C < 0.03) continue
    let h = (Math.atan2(B, A) * 180) / Math.PI
    if (h < 0) h += 360
    const w = hueWeights(h)
    for (let k = 0; k < 8; k++) {
      sumL[k] += w[k] * C * L
      sumW[k] += w[k] * C
    }
  }
  const mean = allL / Math.max(1, n)
  return sumW.map((w, k) => (w < 1e-3 ? 0 : Math.round(Math.max(-60, Math.min(60, (sumL[k] / w - mean) * 260)))))
}

/**
 * Estimates how much the photo is tilted from straight edges (near-horizontal
 * and near-vertical). Orientation per 8×8 block from the structure tensor,
 * weighted by edge energy and coherence. Returns the straighten angle in
 * degrees that levels the photo, or null if there are no clear lines.
 */
export function autoStraightenAngle(sm: Small): number | null {
  const { w, h, lin } = sm
  const L = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) L[i] = Math.pow(0.2126 * lin[i * 3] + 0.7152 * lin[i * 3 + 1] + 0.0722 * lin[i * 3 + 2], 1 / 2.2)
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      // Scharr kernel: much smaller angular error than Sobel.
      gx[i] = (3 * (L[i - w + 1] - L[i - w - 1]) + 10 * (L[i + 1] - L[i - 1]) + 3 * (L[i + w + 1] - L[i + w - 1])) / 16
      gy[i] = (3 * (L[i + w - 1] - L[i - w - 1]) + 10 * (L[i + w] - L[i - w]) + 3 * (L[i + w + 1] - L[i - w + 1])) / 16
    }
  const RANGE = 20
  const STEP = 0.1
  const bins = Math.round((2 * RANGE) / STEP) + 1
  const hist = new Float32Array(bins)
  let total = 0
  const B = 8
  for (let by = 1; by + B < h - 1; by += B / 2)
    for (let bx = 1; bx + B < w - 1; bx += B / 2) {
      let jxx = 0
      let jyy = 0
      let jxy = 0
      for (let y = by; y < by + B; y++)
        for (let x = bx; x < bx + B; x++) {
          const i = y * w + x
          jxx += gx[i] * gx[i]
          jyy += gy[i] * gy[i]
          jxy += gx[i] * gy[i]
        }
      const energy = jxx + jyy
      if (energy < 0.03) continue
      const coh = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / energy
      if (coh < 0.7) continue
      // Dominant gradient direction; the edge runs perpendicular to it.
      let a = (0.5 * Math.atan2(2 * jxy, jxx - jyy) * 180) / Math.PI + 90
      while (a > 90) a -= 180
      while (a <= -90) a += 180
      let dev: number
      if (Math.abs(a) <= RANGE) dev = a
      else if (Math.abs(Math.abs(a) - 90) <= RANGE) dev = a > 0 ? a - 90 : a + 90
      else continue
      const wgt = Math.sqrt(energy) * coh ** 4
      hist[Math.round((dev + RANGE) / STEP)] += wgt
      total += wgt
    }
  if (total < 1) return null
  const k = 6 // smoothing radius in bins (0.6°)
  const smooth = new Float32Array(bins)
  for (let i = 0; i < bins; i++) {
    let s = 0
    for (let d = -k; d <= k; d++) s += (hist[Math.min(bins - 1, Math.max(0, i + d))] || 0) * Math.exp(-(d * d) / (2 * (k / 2) ** 2))
    smooth[i] = s
  }
  let best = 0
  for (let i = 0; i < bins; i++) if (smooth[i] > smooth[best]) best = i
  const l = smooth[Math.max(0, best - 1)]
  const c = smooth[best]
  const r = smooth[Math.min(bins - 1, best + 1)]
  const den = l - 2 * c + r
  const off = den !== 0 ? (l - r) / (2 * den) : 0
  const dev = (best + off) * STEP - RANGE
  // The peak must stand out, otherwise there is no reliable line structure.
  if (c < (total / bins) * 4) return null
  if (Math.abs(dev) < 0.1) return 0
  return -dev
}

/**
 * Estimates lateral chromatic aberration: the radial scale (around the image
 * center) of red and blue that best lines up their edges with green.
 */
export function estimateCA(src: CanvasImageSource, w: number, h: number): [number, number] {
  const side = 900
  const s = Math.min(1, side / Math.max(w, h))
  const W = Math.max(8, Math.round(w * s))
  const H = Math.max(8, Math.round(h * s))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const ch = (k: number) => {
    const a = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) a[i] = d[i * 4 + k]
    return a
  }
  const R = ch(0)
  const G = ch(1)
  const B = ch(2)
  // Radial gradient of green at strong edges in the outer image area.
  const pts: { x: number; y: number; ux: number; uy: number }[] = []
  const cx = W / 2
  const cy = H / 2
  const rmax = Math.hypot(cx, cy)
  for (let y = 2; y < H - 2; y += 2)
    for (let x = 2; x < W - 2; x += 2) {
      const dx = x - cx
      const dy = y - cy
      const rr = Math.hypot(dx, dy)
      if (rr < rmax * 0.45) continue
      const i = y * W + x
      const gx = G[i + 1] - G[i - 1]
      const gy = G[i + W] - G[i - W]
      const radial = (gx * dx + gy * dy) / rr
      if (Math.abs(radial) < 40) continue
      pts.push({ x, y, ux: dx / rr, uy: dy / rr })
    }
  if (pts.length < 200) return [0, 0]
  if (pts.length > 4000) {
    const stepN = pts.length / 4000
    const thin = []
    for (let i = 0; i < pts.length; i += stepN) thin.push(pts[Math.floor(i)])
    pts.length = 0
    pts.push(...thin)
  }
  const sample = (a: Float32Array, x: number, y: number) => {
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(x)))
    const y0 = Math.max(0, Math.min(H - 2, Math.floor(y)))
    const fx = x - x0
    const fy = y - y0
    const i = y0 * W + x0
    return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + W] * (1 - fx) + a[i + W + 1] * fx) * fy
  }
  const best = (a: Float32Array) => {
    let bestK = 0
    let bestE = Infinity
    for (let k = -0.004; k <= 0.0041; k += 0.0002) {
      let e = 0
      for (const p of pts) {
        // Compare a short radial profile of the channel (scaled) with green.
        for (const t of [-1.5, 0, 1.5]) {
          const gxp = p.x + p.ux * t
          const gyp = p.y + p.uy * t
          const v = sample(a, (gxp - cx) * (1 + k) + cx, (gyp - cy) * (1 + k) + cy) - sample(G, gxp, gyp)
          e += v * v
        }
      }
      if (e < bestE) {
        bestE = e
        bestK = k
      }
    }
    return +bestK.toFixed(4)
  }
  return [best(R), best(B)]
}
