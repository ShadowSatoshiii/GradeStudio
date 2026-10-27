// Coordinate spaces (all normalized, y pointing down):
//   source  S: texture coordinates of the original file
//   oriented G: after quarter turns and flips (and geometry correction)
//   frame   O: the straightening frame; the image is rotated by `angle` inside it
//   crop    Q: the crop rectangle inside O, mapped to [0,1]
import type { CropState, Geometry } from './params'

export type Mat3 = [number, number, number, number, number, number, number, number, number] // row-major

export const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}

export function inv(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C || 1e-12
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ]
}

export const translate = (x: number, y: number): Mat3 => [1, 0, x, 0, 1, y, 0, 0, 1]
export const scale = (x: number, y: number): Mat3 => [x, 0, 0, 0, y, 0, 0, 0, 1]
export const rotate = (deg: number): Mat3 => {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

export function apply(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}

/** Pixel size after quarter turns. */
export function orientedSize(w: number, h: number, rot90: number): [number, number] {
  return rot90 % 2 ? [h, w] : [w, h]
}

/** Oriented G → source S (normalized). */
export function orientToSource(c: CropState): Mat3 {
  // Build S → G, then invert.
  let m: Mat3 = translate(-0.5, -0.5)
  if (c.flipH) m = mul(scale(-1, 1), m)
  if (c.flipV) m = mul(scale(1, -1), m)
  m = mul(rotate(90 * (c.rot90 % 4)), m)
  m = mul(translate(0.5, 0.5), m)
  return inv(m)
}

/** Frame O → oriented G: undo the straighten rotation about the image center. */
export function frameToOriented(c: CropState, ow: number, oh: number): Mat3 {
  return mul(scale(1 / ow, 1 / oh), mul(translate(ow / 2, oh / 2), mul(rotate(-c.angle), mul(translate(-ow / 2, -oh / 2), scale(ow, oh)))))
}

/** Crop Q → frame O. */
export function cropToFrame(c: CropState): Mat3 {
  return mul(translate(c.x, c.y), scale(c.w, c.h))
}

/** Geometry parameters as shader uniforms (inverse warp: corrected → original). */
export function geometryUniforms(g: Geometry, aspect: number) {
  const kv = (g.vertical / 100) * 0.9
  const kh = (g.horizontal / 100) * 0.9
  // Inverse homography in centered coordinates (x scaled by aspect).
  let h: Mat3 = [1, 0, 0, 0, 1, 0, kh, kv, 1]
  h = mul(rotate(-g.rotate), h)
  const ax = 1 + Math.max(-0.5, Math.min(0.5, (g.aspect / 100) * 0.5))
  h = mul(scale(1 / ax, 1), h)
  const s = g.scale / 100
  h = mul(h, scale(1 / s, 1 / s))
  h = mul(h, translate((-g.offsetX / 100) * 0.5 * aspect, (-g.offsetY / 100) * 0.5))
  const active = g.vertical !== 0 || g.horizontal !== 0 || g.rotate !== 0 || g.aspect !== 0 || g.scale !== 100 || g.offsetX !== 0 || g.offsetY !== 0 || g.distortion !== 0
  return { h, k1: (-g.distortion / 100) * 0.35, active }
}

/** The largest crop of the given aspect (w/h in pixels) that stays inside the rotated image. */
export function maxCropInside(angle: number, ow: number, oh: number, aspect: number): { w: number; h: number } {
  const a = Math.abs((angle * Math.PI) / 180)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  // Rectangle of size (W, H) with W/H = aspect centered and rotated by -a must fit in ow x oh.
  // Conditions: W cos + H sin <= ow and W sin + H cos <= oh.
  const H = Math.min(ow / (aspect * cos + sin), oh / (aspect * sin + cos))
  const W = H * aspect
  return { w: W / ow, h: H / oh }
}

export function parseAspect(a: string, ow: number, oh: number): number | null {
  if (a === 'free') return null
  if (a === 'original') return ow / oh
  const [x, y] = a.split(':').map(Number)
  if (!x || !y) return null
  return x / y
}

/** Maps a frame point O to source coordinates S (same math as the output shader). */
export function frameToSource(p: { crop: CropState; geometry: Geometry }, ow: number, oh: number, ox: number, oy: number): [number, number] {
  let [gx, gy] = apply(frameToOriented(p.crop, ow, oh), ox, oy)
  const geo = geometryUniforms(p.geometry, ow / oh)
  if (geo.active) {
    const a = ow / oh
    let cx = (gx - 0.5) * a
    let cy = gy - 0.5
    ;[cx, cy] = apply(geo.h, cx, cy)
    const k = 1 + (geo.k1 * (cx * cx + cy * cy)) / (0.25 * (a * a + 1))
    cx *= k
    cy *= k
    gx = cx / a + 0.5
    gy = cy + 0.5
  }
  return apply(orientToSource(p.crop), gx, gy)
}

/** Maps source coordinates S to frame O (inverse of frameToSource, lens distortion ignored). */
export function sourceToFrame(p: { crop: CropState; geometry: Geometry }, ow: number, oh: number, sx: number, sy: number): [number, number] {
  let [gx, gy] = apply(inv(orientToSource(p.crop)), sx, sy)
  const geo = geometryUniforms(p.geometry, ow / oh)
  if (geo.active) {
    const a = ow / oh
    const [cx, cy] = apply(inv(geo.h), (gx - 0.5) * a, gy - 0.5)
    gx = cx / a + 0.5
    gy = cy + 0.5
  }
  return apply(inv(frameToOriented(p.crop, ow, oh)), gx, gy)
}
