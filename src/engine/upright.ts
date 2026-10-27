// Automatic perspective correction ("Upright"): finds rotation and keystone
// values that make detected near-vertical/near-horizontal edges straight.
import type { Small } from './analyze'
import type { CropState, Geometry } from './params'
import { apply, geometryUniforms, inv, orientToSource, orientedSize } from './transform'

interface Edge {
  x: number // centered, x scaled by aspect
  y: number
  ux: number // unit direction
  uy: number
  w: number
  vertical: boolean
}

/** Edge blocks (structure tensor) of a small copy, in oriented centered coordinates. */
function edges(sm: Small, crop: CropState): { list: Edge[]; aspect: number } {
  const { w, h, lin } = sm
  const L = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) L[i] = Math.pow(0.2126 * lin[i * 3] + 0.7152 * lin[i * 3 + 1] + 0.0722 * lin[i * 3 + 2], 1 / 2.2)
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      gx[i] = (3 * (L[i - w + 1] - L[i - w - 1]) + 10 * (L[i + 1] - L[i - 1]) + 3 * (L[i + w + 1] - L[i + w - 1])) / 16
      gy[i] = (3 * (L[i + w - 1] - L[i - w - 1]) + 10 * (L[i + w] - L[i - w]) + 3 * (L[i + w + 1] - L[i - w + 1])) / 16
    }
  const [ow, oh] = orientedSize(w, h, crop.rot90)
  const aspect = ow / oh
  // source → oriented (normalized)
  const s2g = inv(orientToSource(crop))
  const list: Edge[] = []
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
      if (coh < 0.75) continue
      const theta = 0.5 * Math.atan2(2 * jxy, jxx - jyy) + Math.PI / 2 // edge direction (source px)
      // Map center and a second point into oriented space.
      const px = (bx + B / 2) / w
      const py = (by + B / 2) / h
      const qx = px + (Math.cos(theta) * 4) / w
      const qy = py + (Math.sin(theta) * 4) / h
      const [ax, ay] = apply(s2g, px, py)
      const [cx2, cy2] = apply(s2g, qx, qy)
      const X = (ax - 0.5) * aspect
      const Y = ay - 0.5
      let dx = (cx2 - 0.5) * aspect - X
      let dy = cy2 - 0.5 - Y
      const len = Math.hypot(dx, dy) || 1
      dx /= len
      dy /= len
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI
      const fromH = Math.abs(((ang + 90) % 180) - 90)
      const fromV = Math.abs(fromH - 90)
      if (fromH > 25 && fromV > 25) continue
      list.push({ x: X, y: Y, ux: dx, uy: dy, w: Math.sqrt(energy) * coh ** 4, vertical: fromV <= 25 })
    }
  return { list, aspect }
}

/** Angle (deg) of an edge after the forward warp of geometry g. */
function cost(list: Edge[], g: Geometry, aspect: number, wV: number, wH: number): number {
  const { h } = geometryUniforms(g, aspect)
  const fwd = inv(h)
  let c = 0
  for (const e of list) {
    const wgt = e.vertical ? wV : wH
    if (!wgt) continue
    const [ax, ay] = apply(fwd, e.x - e.ux * 0.01, e.y - e.uy * 0.01)
    const [bx, by] = apply(fwd, e.x + e.ux * 0.01, e.y + e.uy * 0.01)
    let a = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
    a = ((a % 180) + 180) % 180 // 0..180
    const dev = e.vertical ? a - 90 : a > 90 ? a - 180 : a
    const d2 = dev * dev
    c += e.w * wgt * (d2 < 16 ? d2 : 16 + Math.sqrt(d2 - 16)) // robust above 4°
  }
  return c
}

export type UprightMode = 'auto' | 'level' | 'vertical' | 'full'

/** Searches rotate/vertical/horizontal for an Upright mode. */
export function solveUpright(sm: Small, crop: CropState, base: Geometry, mode: UprightMode): Geometry | null {
  const { list, aspect } = edges(sm, crop)
  if (list.length < 12) return null
  const wV = mode === 'level' ? 0.5 : 1
  const wH = mode === 'vertical' ? 0.35 : mode === 'auto' ? 0.5 : 1
  const free: (keyof Geometry)[] = mode === 'level' ? ['rotate'] : mode === 'full' ? ['rotate', 'vertical', 'horizontal'] : ['rotate', 'vertical']
  const range: Record<string, [number, number]> = { rotate: [-10, 10], vertical: [-100, 100], horizontal: [-100, 100] }
  let g: Geometry = { ...base, rotate: 0, vertical: 0, horizontal: 0, upright: mode }
  for (let iter = 0; iter < 4; iter++) {
    for (const k of free) {
      const [lo, hi] = range[k]
      let best = g[k] as number
      let bestC = cost(list, g, aspect, wV, wH)
      for (const step of [k === 'rotate' ? 0.5 : 5, k === 'rotate' ? 0.1 : 1]) {
        const center = best
        const span = step === 0.5 || step === 5 ? hi - lo : step * 12
        for (let v = Math.max(lo, center - span); v <= Math.min(hi, center + span) + 1e-9; v += step) {
          const c = cost(list, { ...g, [k]: v }, aspect, wV, wH)
          if (c < bestC) {
            bestC = c
            best = v
          }
        }
      }
      g = { ...g, [k]: +best.toFixed(1) }
    }
  }
  if (mode === 'auto') {
    // Balanced: do not over-correct (keeps some natural perspective).
    g = { ...g, vertical: Math.round(g.vertical * 0.75), horizontal: Math.round(g.horizontal * 0.6) }
  }
  return g
}
