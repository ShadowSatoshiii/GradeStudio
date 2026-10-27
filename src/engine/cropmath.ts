// Crop rectangle helpers in frame space O (normalized to the oriented image).
import type { CropState, Geometry } from './params'
import { apply, frameToOriented, frameToSource, maxCropInside, parseAspect } from './transform'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** True if all four corners of the rect lie inside the (rotated) image. */
export function insideImage(r: Rect, c: CropState, ow: number, oh: number, eps = 1e-4): boolean {
  const m = frameToOriented({ ...c, ...r }, ow, oh)
  for (const [px, py] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ]) {
    const [gx, gy] = apply(m, px, py)
    if (gx < -eps || gy < -eps || gx > 1 + eps || gy > 1 + eps) return false
  }
  return true
}

/** Moves from `from` toward `to` as far as the rect stays inside (per axis). */
export function clampMove(from: Rect, to: Rect, c: CropState, ow: number, oh: number): Rect {
  let r = { ...from }
  for (const axis of ['x', 'y'] as const) {
    const target = { ...r, [axis]: to[axis] }
    if (insideImage(target, c, ow, oh)) {
      r = target
      continue
    }
    let lo = 0
    let hi = 1
    for (let i = 0; i < 20; i++) {
      const m = (lo + hi) / 2
      const t = { ...r, [axis]: r[axis] + (to[axis] - r[axis]) * m }
      if (insideImage(t, c, ow, oh)) lo = m
      else hi = m
    }
    r = { ...r, [axis]: r[axis] + (to[axis] - r[axis]) * lo }
  }
  return r
}

/** Interpolates between a valid rect and a wanted one, keeping the result inside. */
export function clampTo(valid: Rect, wanted: Rect, c: CropState, ow: number, oh: number): Rect {
  if (insideImage(wanted, c, ow, oh)) return wanted
  let lo = 0
  let hi = 1
  const lerp = (t: number): Rect => ({
    x: valid.x + (wanted.x - valid.x) * t,
    y: valid.y + (wanted.y - valid.y) * t,
    w: valid.w + (wanted.w - valid.w) * t,
    h: valid.h + (wanted.h - valid.h) * t,
  })
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2
    if (insideImage(lerp(m), c, ow, oh)) lo = m
    else hi = m
  }
  return lerp(lo)
}

/** Scales the rect about its center until it fits (used after straightening). */
export function fitAfterRotate(r: Rect, c: CropState, ow: number, oh: number): Rect {
  if (insideImage(r, c, ow, oh)) return r
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  let lo = 0
  let hi = 1
  const at = (s: number): Rect => ({ x: cx - (r.w * s) / 2, y: cy - (r.h * s) / 2, w: r.w * s, h: r.h * s })
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2
    if (insideImage(at(m), c, ow, oh)) lo = m
    else hi = m
  }
  // If the center itself is outside, fall back to the centered maximum.
  if (lo < 0.02) return centeredMax(c, ow, oh, (r.w * ow) / (r.h * oh))
  return at(lo)
}

/** Largest rect of `aspect` (pixel w/h) centered in the frame that fits the rotated image. */
export function centeredMax(c: CropState, ow: number, oh: number, aspect: number): Rect {
  const m = maxCropInside(c.angle, ow, oh, aspect)
  const w = Math.min(1, m.w)
  const h = Math.min(1, m.h)
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

/** Crop for a newly chosen aspect ratio (keeps the center where possible). */
export function cropForAspect(c: CropState, aspect: string, ow: number, oh: number): Rect {
  const a = parseAspect(aspect, ow, oh)
  if (a === null) return { x: c.x, y: c.y, w: c.w, h: c.h }
  const max = centeredMax(c, ow, oh, a)
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  const want = { x: cx - max.w / 2, y: cy - max.h / 2, w: max.w, h: max.h }
  return insideImage(want, c, ow, oh) ? want : clampMove(max, want, c, ow, oh)
}

export const ASPECTS: { id: string; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'free', label: 'Custom' },
  { id: '1:1', label: '1 × 1' },
  { id: '4:5', label: '4 × 5 / 8 × 10' },
  { id: '5:7', label: '5 × 7' },
  { id: '2:3', label: '2 × 3 / 4 × 6' },
  { id: '3:4', label: '3 × 4' },
  { id: '9:16', label: '9 × 16' },
  { id: '16:10', label: '16 × 10' },
  { id: '8.5:11', label: '8.5 × 11' },
]

/** Swaps an aspect "a:b" to "b:a" (landscape ↔ portrait). */
export function rotateAspect(a: string): string {
  if (!a.includes(':')) return a
  const [x, y] = a.split(':')
  return `${y}:${x}`
}

/** Orients an aspect id to match landscape/portrait of the image. */
export function orientAspect(a: string, landscape: boolean): string {
  if (!a.includes(':')) return a
  const [x, y] = a.split(':').map(Number)
  if (x === y) return a
  const isLandscape = x > y
  return isLandscape === landscape ? a : `${y}:${x}`
}

/** Like insideImage, but through the full geometry warp (sampled along the edges). */
export function insideWarped(r: Rect, c: CropState, g: Geometry, ow: number, oh: number): boolean {
  const p = { crop: { ...c, ...r }, geometry: g }
  const n = 12
  for (let i = 0; i <= n; i++) {
    const t = i / n
    for (const [x, y] of [
      [r.x + r.w * t, r.y],
      [r.x + r.w * t, r.y + r.h],
      [r.x, r.y + r.h * t],
      [r.x + r.w, r.y + r.h * t],
    ]) {
      const [sx, sy] = frameToSource(p, ow, oh, x, y)
      if (sx < -1e-4 || sy < -1e-4 || sx > 1 + 1e-4 || sy > 1 + 1e-4) return false
    }
  }
  return true
}

/** Largest crop (keeping aspect and center) without empty areas from geometry. */
export function constrainCrop(c: CropState, g: Geometry, ow: number, oh: number): Rect {
  const aspect = (c.w * ow) / (c.h * oh)
  // Start from the largest centered rect of this aspect, then shrink until inside.
  const full = centeredMax(c, ow, oh, aspect)
  const cx = 0.5
  const cy = 0.5
  let lo = 0
  let hi = 1
  const at = (s: number): Rect => ({ x: cx - (full.w * s) / 2, y: cy - (full.h * s) / 2, w: full.w * s, h: full.h * s })
  if (insideWarped(at(1), c, g, ow, oh)) return at(1)
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2
    if (insideWarped(at(m), c, g, ow, oh)) lo = m
    else hi = m
  }
  return at(Math.max(0.05, lo))
}
