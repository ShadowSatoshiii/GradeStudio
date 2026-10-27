import { clampRect, createCanvas, ctx2d, type Rect } from './canvas'
import { inpaint, type InpaintInput, type InpaintResult } from './inpaint'

// "Entfernen": removes what was painted over by filling it from the surroundings.

function runInpaint(input: InpaintInput): Promise<InpaintResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(inpaint(input))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./inpaint.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<InpaintResult>) => {
      resolve(e.data)
      worker.terminate()
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(e)
    }
    worker.postMessage(input, [input.rgb.buffer, input.hole.buffer])
  })
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[y * w + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/**
 * Seam correction: along the hole border, the difference between the
 * surroundings and the fill is measured and spread smoothly over the whole
 * hole (push-pull membrane, like a cheap Poisson blend). Returns RGB offsets.
 */
function seamCorrection(fill: Float32Array, pix: Uint8ClampedArray, hole: Uint8Array, w: number, h: number, avoid?: Uint8Array): Float32Array {
  const val = new Float32Array(w * h * 3)
  const wt = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!hole[i]) continue
      let n = 0
      const sum = [0, 0, 0]
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const q = yy * w + xx
        if (hole[q] || (avoid && avoid[q])) continue
        for (let c = 0; c < 3; c++) sum[c] += pix[q * 4 + c]
        n++
      }
      if (!n) continue
      // Border pixels that differ a lot belong to another object (the chair
      // next to the hole, a branch …): they barely count, so their colour does
      // not bleed into the fill.
      let diff = 0
      for (let c = 0; c < 3; c++) diff += Math.abs(sum[c] / n - fill[i * 3 + c])
      wt[i] = Math.exp(-((diff / 3 / 45) ** 2))
      for (let c = 0; c < 3; c++) val[i * 3 + c] = sum[c] / n - fill[i * 3 + c]
    }
  const out = pushPull(val, wt, w, h)
  for (let i = 0; i < w * h; i++) if (!hole[i]) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = 0
  return out
}

const smoothstepRange = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Typical size of fine noise (median absolute high-pass) next to the hole. */
function ringNoise(pix: Uint8ClampedArray, hole: Uint8Array, w: number, h: number): number {
  const L = (i: number) => 0.299 * pix[i * 4] + 0.587 * pix[i * 4 + 1] + 0.114 * pix[i * 4 + 2]
  const v: number[] = []
  for (let y = 1; y < h - 1; y += 1)
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x
      if (hole[i]) continue
      // Only pixels close to the hole.
      let near = false
      for (let d = 1; d <= 4 && !near; d++) near = !!(hole[i + d] || hole[i - d] || hole[i + d * w] || hole[i - d * w])
      if (!near || hole[i + 1] || hole[i - 1] || hole[i + w] || hole[i - w]) continue
      const avg = (L(i - 1) + L(i + 1) + L(i - w) + L(i + w)) / 4
      v.push(Math.abs(L(i) - avg))
    }
  if (!v.length) return 2
  v.sort((a, b) => a - b)
  return v[Math.floor(v.length / 2)] * 1.48
}

/** Mean brightness gradient in a ring of known pixels around the hole. */
export function ringTexture(pix: Uint8ClampedArray, hole: Uint8Array, w: number, h: number, quantile = 0.75): number {
  const L = (i: number) => 0.299 * pix[i * 4] + 0.587 * pix[i * 4 + 1] + 0.114 * pix[i * 4 + 2]
  const near = new Uint8Array(w * h)
  const reach = 5
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!hole[y * w + x]) continue
      for (let dy = -reach; dy <= reach; dy += 1)
        for (let dx = -reach; dx <= reach; dx += 1) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1
        }
    }
  // Strong edges matter, even if they are rare (mortar lines, branches):
  // use the mean of the strongest 10 % of gradients, not the overall mean.
  const g: number[] = []
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x
      if (!near[i] || hole[i] || hole[i + 1] || hole[i + w]) continue
      g.push(Math.abs(L(i) - L(i + 1)) + Math.abs(L(i) - L(i + w)))
    }
  if (!g.length) return 0
  g.sort((a, b) => a - b)
  return g[Math.floor(g.length * quantile)]
}

/**
 * Push-pull interpolation: weighted values are averaged down a pyramid and
 * pulled back up, which fills every gap with a smooth, seamless blend of what
 * is known around it. `weights` are 0..1 per pixel; RGB values per pixel.
 */
function pushPull(values: Float32Array, weights: Float32Array, w: number, h: number): Float32Array {
  interface Lv {
    w: number
    h: number
    c: Float32Array
    a: Float32Array
  }
  const levels: Lv[] = [{ w, h, c: values.slice(), a: weights.slice() }]
  // Push: average known values into coarser levels.
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const f = levels[levels.length - 1]
    const W = Math.max(1, Math.ceil(f.w / 2))
    const H = Math.max(1, Math.ceil(f.h / 2))
    const c = new Float32Array(W * H * 3)
    const a = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sa = 0
        const sc = [0, 0, 0]
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const fx = x * 2 + dx
            const fy = y * 2 + dy
            if (fx >= f.w || fy >= f.h) continue
            const j = fy * f.w + fx
            sa += f.a[j]
            for (let k = 0; k < 3; k++) sc[k] += f.c[j * 3 + k] * f.a[j]
          }
        const o = y * W + x
        if (sa > 0) for (let k = 0; k < 3; k++) c[o * 3 + k] = sc[k] / sa
        a[o] = Math.min(1, sa)
      }
    levels.push({ w: W, h: H, c, a })
  }
  // Pull: fill each level from the (already filled) coarser one.
  for (let li = levels.length - 2; li >= 0; li--) {
    const f = levels[li]
    const g = levels[li + 1]
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x
        if (f.a[i] >= 1) continue
        const gx = Math.max(0, Math.min(g.w - 1.001, (x + 0.5) / 2 - 0.5))
        const gy = Math.max(0, Math.min(g.h - 1.001, (y + 0.5) / 2 - 0.5))
        const x0 = Math.floor(gx)
        const y0 = Math.floor(gy)
        const x1 = Math.min(g.w - 1, x0 + 1)
        const y1 = Math.min(g.h - 1, y0 + 1)
        const tx = gx - x0
        const ty = gy - y0
        for (let k = 0; k < 3; k++) {
          const up =
            (g.c[(y0 * g.w + x0) * 3 + k] * (1 - tx) + g.c[(y0 * g.w + x1) * 3 + k] * tx) * (1 - ty) +
            (g.c[(y1 * g.w + x0) * 3 + k] * (1 - tx) + g.c[(y1 * g.w + x1) * 3 + k] * tx) * ty
          f.c[i * 3 + k] = f.a[i] * f.c[i * 3 + k] + (1 - f.a[i]) * up
        }
      }
  }
  return levels[0].c
}

/** Smooth fill of the hole from its surroundings (no texture); `avoid` pixels do not count. */
function smoothFill(pix: Uint8ClampedArray, hole: Uint8Array, w: number, h: number, avoid?: Uint8Array): Float32Array {
  const c = new Float32Array(w * h * 3)
  const a = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (hole[i] || (avoid && avoid[i])) continue
    a[i] = 1
    for (let k = 0; k < 3; k++) c[i * 3 + k] = pix[i * 4 + k]
  }
  return pushPull(c, a, w, h)
}

/**
 * Pixels that are clearly a different surface than the ring around the hole
 * (by color, relative to brightness, and by brightness itself), grown a
 * little. Returns undefined when that would leave too little to copy from.
 */
function otherSurfaces(pix: Uint8ClampedArray, hole: Uint8Array, w: number, h: number, lined: boolean): Uint8Array | undefined {
  const ring = new Uint8Array(w * h)
  const reach = Math.max(2, Math.round(Math.min(w, h) * 0.02))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!hole[y * w + x]) continue
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (!hole[j]) ring[j] = 1
        }
    }
  const feat = (i: number) => {
    const r = pix[i * 4]
    const g = pix[i * 4 + 1]
    const b = pix[i * 4 + 2]
    const l = 0.299 * r + 0.587 * g + 0.114 * b
    return [l, ((r - g) / (l + 20)) * 100, ((g - b) / (l + 20)) * 100]
  }
  const sum = [0, 0, 0]
  const sq = [0, 0, 0]
  let n = 0
  for (let i = 0; i < w * h; i++) {
    if (!ring[i]) continue
    const f = feat(i)
    for (let k = 0; k < 3; k++) {
      sum[k] += f[k]
      sq[k] += f[k] * f[k]
    }
    n++
  }
  if (n < 10) return undefined
  const mean = sum.map((v) => v / n)
  const sd = sq.map((v, k) => Math.sqrt(Math.max(0, v / n - mean[k] * mean[k])))
  const tol = [Math.max(30, sd[0] * 3), Math.max(8, sd[1] * 3), Math.max(8, sd[2] * 3)]
  const bad = new Uint8Array(w * h)
  let free = 0
  for (let i = 0; i < w * h; i++) {
    if (hole[i]) continue
    const f = feat(i)
    // Spots and blemishes are darker than the skin around: they are not
    // copied either (healing should not move a spot somewhere else).
    // (On lined skin the darker lines are part of the texture and stay.)
    const dark = !lined && mean[0] - f[0] > Math.max(18, sd[0] * 1.3)
    if (dark || f[0] - mean[0] > tol[0] || Math.abs(f[1] - mean[1]) > tol[1] || Math.abs(f[2] - mean[2]) > tol[2]) bad[i] = 1
    else free++
  }
  // Grow by a pixel so patches do not start right at a lip edge.
  const out = bad.slice()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!bad[y * w + x]) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1
      }
    }
  return free > w * h * 0.08 ? out : undefined
}

/** The region that `vanish` reads and changes for a painted area (hole + surroundings). */
export function vanishRegion(area: Rect, W: number, H: number): Rect | null {
  const pad = Math.round(Math.max(area.w, area.h) * 1.1 + 24)
  return clampRect({ x: area.x - pad, y: area.y - pad, w: area.w + pad * 2, h: area.h + pad * 2 }, W, H)
}

/**
 * Fills the painted area of `mask` (alpha) in `work`. The search for matching
 * texture runs on a reduced copy; the final pixels are copied at full
 * resolution so the fill stays sharp. Returns the changed rectangle.
 */
export async function vanish(work: HTMLCanvasElement, mask: HTMLCanvasElement, area: Rect, opts: { sameSurface?: boolean } = {}): Promise<Rect | null> {
  const R = vanishRegion(area, work.width, work.height)
  if (!R) return null

  const s = Math.min(1, 640 / Math.max(R.w, R.h), Math.sqrt(45000 / Math.max(1, area.w * area.h)))
  const lw = Math.max(16, Math.round(R.w * s))
  const lh = Math.max(16, Math.round(R.h * s))
  const sx = lw / R.w
  const sy = lh / R.h

  const small = createCanvas(lw, lh)
  const sc = ctx2d(small)
  sc.imageSmoothingQuality = 'high'
  sc.drawImage(work, R.x, R.y, R.w, R.h, 0, 0, lw, lh)
  const smallMask = createCanvas(lw, lh)
  ctx2d(smallMask).drawImage(mask, R.x, R.y, R.w, R.h, 0, 0, lw, lh)
  const pix = sc.getImageData(0, 0, lw, lh).data
  const ma = ctx2d(smallMask).getImageData(0, 0, lw, lh).data

  const rgb = new Float32Array(lw * lh * 3)
  const hole = new Uint8Array(lw * lh)
  for (let i = 0; i < lw * lh; i++) {
    rgb[i * 3] = pix[i * 4]
    rgb[i * 3 + 1] = pix[i * 4 + 1]
    rgb[i * 3 + 2] = pix[i * 4 + 2]
    if (ma[i * 4 + 3] > 6) hole[i] = 1
  }
  // Grow the hole by one pixel so no rim of the object survives.
  const grown = hole.slice()
  for (let y = 0; y < lh; y++)
    for (let x = 0; x < lw; x++) {
      if (!hole[y * lw + x]) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < lw && yy < lh) grown[yy * lw + xx] = 1
      }
    }

  // Healing a spot: only copy from surface like the one around the spot (skin
  // from skin), never lips, eyes, brows or hair that happen to be nearby.
  const ringTex = ringTexture(pix, grown, lw, lh)
  const avoid = opts.sameSurface ? otherSurfaces(pix, grown, lw, lh, ringTex > 8) : undefined
  // The worker takes ownership of what it is sent, so it gets a copy of the hole.
  const res = await runInpaint({ w: lw, h: lh, rgb, hole: grown.slice(), avoid, matchTexture: !!opts.sameSurface })

  // Really flat surroundings (studio wall, blurred background): take tone and
  // color from a smooth fill and only the fine grain from the copied patches.
  // Anything with grain or texture (sand, grass, skin, clouds) keeps the
  // copied patches as they are.
  const smoothWeight = opts.sameSurface ? 0 : 1 - smoothstepRange(2, 4.5, ringTex)
  const adjusted = res.rgb.slice()
  // Copied detail may only be as strong as the natural noise around the hole,
  // otherwise patch borders show up as thin lines in smooth areas.
  let grainLimit = Math.max(1.5, 2 * ringNoise(pix, grown, lw, lh))
  if (opts.sameSurface) {
    // Healing: light and color come from a smooth fill of the surroundings
    // (so the spot follows the shading of the face), the copied skin only
    // gives its texture (pores, fine lines).
    const smooth = smoothFill(pix, grown, lw, lh, avoid)
    const r = Math.max(2, Math.round(Math.min(lw, lh) * 0.012))
    const low: Float32Array[] = [0, 1, 2].map((c) => {
      let ch: Float32Array = new Float32Array(lw * lh)
      for (let i = 0; i < lw * lh; i++) ch[i] = res.rgb[i * 3 + c]
      for (let p = 0; p < 2; p++) ch = boxBlur(ch, lw, lh, r)
      return ch
    })
    // Strongly lined skin (crow's feet, old skin) keeps the copied patches as
    // they are (its lines are larger than fine detail); the seam correction
    // below then matches their tone to the surroundings.
    const lined = smoothstepRange(8, 14, ringTex)
    grainLimit = Math.max(8, 3 * ringNoise(pix, grown, lw, lh))
    for (let i = 0; i < lw * lh; i++) {
      if (!grown[i]) continue
      for (let c = 0; c < 3; c++) {
        const detail = Math.max(-grainLimit, Math.min(grainLimit, res.rgb[i * 3 + c] - low[c][i]))
        const soft = smooth[i * 3 + c] + detail
        adjusted[i * 3 + c] = soft + (res.rgb[i * 3 + c] - soft) * lined
      }
    }
    grainLimit += (255 - grainLimit) * lined
  } else if (smoothWeight > 0.01) {
    const smooth = smoothFill(pix, grown, lw, lh)
    // Fine grain of the patches (small high-pass, limited so no shapes show through).
    const low: Float32Array[] = [0, 1, 2].map((c) => {
      let ch: Float32Array = new Float32Array(lw * lh)
      for (let i = 0; i < lw * lh; i++) ch[i] = res.rgb[i * 3 + c]
      for (let p = 0; p < 2; p++) ch = boxBlur(ch, lw, lh, 1)
      return ch
    })
    for (let i = 0; i < lw * lh; i++) {
      if (!grown[i]) continue
      for (let c = 0; c < 3; c++) {
        const grain = Math.max(-grainLimit, Math.min(grainLimit, res.rgb[i * 3 + c] - low[c][i]))
        const soft = smooth[i * 3 + c] + grain
        adjusted[i * 3 + c] = res.rgb[i * 3 + c] + (soft - res.rgb[i * 3 + c]) * smoothWeight
      }
    }
  }
  const seam = seamCorrection(adjusted, pix, grown, lw, lh, avoid)
  const target = new Float32Array(lw * lh * 3)
  for (let i = 0; i < target.length; i++) target[i] = adjusted[i] + seam[i]
  const at = (arr: Float32Array, fx: number, fy: number, c: number) => {
    // Bilinear sample of a low-resolution RGB field.
    const x = Math.max(0, Math.min(lw - 1.001, fx - 0.5))
    const y = Math.max(0, Math.min(lh - 1.001, fy - 0.5))
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const tx = x - x0
    const ty = y - y0
    const a = arr[(y0 * lw + x0) * 3 + c]
    const b = arr[(y0 * lw + x0 + 1) * 3 + c]
    const d = arr[((y0 + 1) * lw + x0) * 3 + c]
    const e = arr[((y0 + 1) * lw + x0 + 1) * 3 + c]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty
  }
  // How much detail of the copied pixels may come through: everything for
  // textures, only fine grain for smooth surroundings.
  const detailLimit = grainLimit + (1 - smoothWeight) * (255 - grainLimit)

  const ctx = ctx2d(work)
  const img = ctx.getImageData(R.x, R.y, R.w, R.h)
  const out = img.data
  const orig = out.slice()
  const m = ctx2d(mask).getImageData(R.x, R.y, R.w, R.h).data
  const full = s > 0.999
  for (let Y = 0; Y < R.h; Y++) {
    for (let X = 0; X < R.w; X++) {
      const i = Y * R.w + X
      const alpha = m[i * 4 + 3]
      const lx = Math.min(lw - 1, Math.floor(X * sx))
      const ly = Math.min(lh - 1, Math.floor(Y * sy))
      const li = ly * lw + lx
      if (!alpha && !grown[li]) continue
      const fx0 = X * sx
      const fy0 = Y * sy
      let r = at(res.rgb, fx0, fy0, 0)
      let g = at(res.rgb, fx0, fy0, 1)
      let b = at(res.rgb, fx0, fy0, 2)
      if (!full) {
        // Copy the matching source pixel at full resolution (keeps grain and detail).
        const fx = Math.round(X + (res.srcX[li] - lx) / sx)
        const fy = Math.round(Y + (res.srcY[li] - ly) / sy)
        if (fx >= 0 && fy >= 0 && fx < R.w && fy < R.h && m[(fy * R.w + fx) * 4 + 3] < 40) {
          const j = (fy * R.w + fx) * 4
          r = orig[j]
          g = orig[j + 1]
          b = orig[j + 2]
        }
      }
      // Detail of the copied pixel on top of the matched fill.
      const lim = detailLimit
      r = at(target, fx0, fy0, 0) + Math.max(-lim, Math.min(lim, r - at(res.rgb, fx0, fy0, 0)))
      g = at(target, fx0, fy0, 1) + Math.max(-lim, Math.min(lim, g - at(res.rgb, fx0, fy0, 1)))
      b = at(target, fx0, fy0, 2) + Math.max(-lim, Math.min(lim, b - at(res.rgb, fx0, fy0, 2)))
      const a = Math.max(Math.min(1, (alpha / 255) * 1.6), grown[li] ? 0.6 : 0)
      out[i * 4] = orig[i * 4] + (r - orig[i * 4]) * a
      out[i * 4 + 1] = orig[i * 4 + 1] + (g - orig[i * 4 + 1]) * a
      out[i * 4 + 2] = orig[i * 4 + 2] + (b - orig[i * 4 + 2]) * a
    }
  }
  ctx.putImageData(img, R.x, R.y)
  return R
}
