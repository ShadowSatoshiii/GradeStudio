// Exemplar-based inpainting ("Entfernen"): the hole is filled with patches
// copied from the surroundings. Multi-scale PatchMatch with patch voting
// (after Barnes et al. 2009 / Wexler et al. 2007). Pure function, runs in a worker.

export interface InpaintInput {
  w: number
  h: number
  /** RGB, 0..255, length w*h*3 */
  rgb: Float32Array
  /** 1 = pixel must be filled */
  hole: Uint8Array
  /** 1 = pixel may not be copied from (e.g. lips or eyes when healing skin). */
  avoid?: Uint8Array
  /** Prefer sources as textured as the surroundings (healing one surface, e.g. lined skin). */
  matchTexture?: boolean
}

export interface InpaintResult {
  rgb: Float32Array
  /** For every pixel: source pixel (x, y) its color came from at this resolution. */
  srcX: Int32Array
  srcY: Int32Array
}

const R = 3 // patch radius → 7×7 patches

interface Level {
  w: number
  h: number
  rgb: Float32Array
  hole: Uint8Array
  avoid: Uint8Array | null
}

function downsample(l: Level): Level {
  const w = Math.max(1, l.w >> 1)
  const h = Math.max(1, l.h >> 1)
  const rgb = new Float32Array(w * h * 3)
  const hole = new Uint8Array(w * h)
  const avoid = l.avoid ? new Uint8Array(w * h) : null
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (avoid && l.avoid)
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) if (l.avoid[Math.min(l.h - 1, y * 2 + dy) * l.w + Math.min(l.w - 1, x * 2 + dx)]) avoid[y * w + x] = 1
      let n = 0
      let r = 0
      let g = 0
      let b = 0
      let any = 0
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(l.w - 1, x * 2 + dx)
          const sy = Math.min(l.h - 1, y * 2 + dy)
          const i = sy * l.w + sx
          if (l.hole[i]) {
            any = 1
            continue
          }
          r += l.rgb[i * 3]
          g += l.rgb[i * 3 + 1]
          b += l.rgb[i * 3 + 2]
          n++
        }
      const o = y * w + x
      hole[o] = any
      if (n) {
        rgb[o * 3] = r / n
        rgb[o * 3 + 1] = g / n
        rgb[o * 3 + 2] = b / n
      }
    }
  }
  return { w, h, rgb, hole, avoid }
}

/** Onion-peel fill: hole pixels take the mean of already known neighbours. */
function diffuseFill(l: Level) {
  const { w, h, rgb } = l
  const known = new Uint8Array(w * h)
  let left = 0
  for (let i = 0; i < w * h; i++) {
    known[i] = l.hole[i] ? 0 : 1
    if (!known[i]) left++
  }
  let guard = w + h
  while (left > 0 && guard-- > 0) {
    const add: number[] = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (known[i]) continue
        let n = 0
        let r = 0
        let g = 0
        let b = 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (!known[j]) continue
          r += rgb[j * 3]
          g += rgb[j * 3 + 1]
          b += rgb[j * 3 + 2]
          n++
        }
        if (n) {
          rgb[i * 3] = r / n
          rgb[i * 3 + 1] = g / n
          rgb[i * 3 + 2] = b / n
          add.push(i)
        }
      }
    for (const i of add) known[i] = 1
    left -= add.length
    if (!add.length) break
  }
}

/**
 * Onion-peel patch fill for the coarsest level: the hole is filled ring by ring
 * from the border inwards, every pixel copied from the source patch that best
 * matches its already known neighbourhood. Unlike a smooth fill this keeps
 * shadows and streaks of the surroundings, which the finer levels then refine.
 */
function patchInit(l: Level, valid: Uint8Array) {
  const { w, h, rgb, hole } = l
  const sources: number[] = []
  for (let i = 0; i < w * h; i++) if (valid[i]) sources.push(i)
  if (!sources.length) return false
  const known = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) known[i] = hole[i] ? 0 : 1
  const reach = holeReach(l)
  for (let guard = 0; guard < w + h; guard++) {
    const ring: number[] = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (known[i]) continue
        let edge = false
        for (let dy = -1; dy <= 1 && !edge; dy++)
          for (let dx = -1; dx <= 1 && !edge; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && known[yy * w + xx]) edge = true
          }
        if (edge) ring.push(i)
      }
    if (!ring.length) break
    const fill: [number, number][] = []
    for (const p of ring) {
      const px = p % w
      const py = (p - px) / w
      let best = Infinity
      let bestS = -1
      for (const s of sources) {
        const sx = s % w
        const sy = (s - sx) / w
        let d = 0
        let n = 0
        for (let dy = -R; dy <= R && d < best * 49; dy++) {
          const ty = py + dy
          if (ty < 0 || ty >= h) continue
          for (let dx = -R; dx <= R; dx++) {
            const tx = px + dx
            if (tx < 0 || tx >= w) continue
            const ti = ty * w + tx
            if (!known[ti]) continue
            const si = ((sy + dy) * w + sx + dx) * 3
            const a = rgb[ti * 3] - rgb[si]
            const b = rgb[ti * 3 + 1] - rgb[si + 1]
            const c = rgb[ti * 3 + 2] - rgb[si + 2]
            d += a * a + b * b + c * c
            n++
          }
        }
        if (!n) continue
        // Mean difference, plus a cost for sources far from the hole.
        const far = Math.max(0, Math.hypot(sx - px, sy - py) - reach)
        const score = d / n + 4 * far * far
        if (score < best) {
          best = score
          bestS = s
        }
      }
      if (bestS >= 0) fill.push([p, bestS])
    }
    for (const [p, s] of fill) {
      rgb[p * 3] = rgb[s * 3]
      rgb[p * 3 + 1] = rgb[s * 3 + 1]
      rgb[p * 3 + 2] = rgb[s * 3 + 2]
      known[p] = 1
    }
    for (const p of ring) known[p] = 1
  }
  return true
}

/** Centres whose whole patch lies inside the image and outside the hole. */
function validSources(l: Level): Uint8Array {
  const { w, h, hole, avoid } = l
  const integ = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x] || (avoid ? avoid[y * w + x] : 0)
      integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row
    }
  }
  const ok = new Uint8Array(w * h)
  for (let y = R; y < h - R; y++)
    for (let x = R; x < w - R; x++) {
      const x0 = x - R
      const y0 = y - R
      const x1 = x + R + 1
      const y1 = y + R + 1
      const s = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0]
      if (s === 0) ok[y * w + x] = 1
    }
  return ok
}

/** Size of the hole: sources closer than this count as "nearby". */
function holeReach(l: Level): number {
  let x0 = l.w
  let y0 = l.h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++) {
      if (!l.hole[y * l.w + x]) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  return x1 < 0 ? 0 : Math.max(x1 - x0, y1 - y0) * 0.8 + 2 * R
}

/**
 * `lambda` adds a cost for far-away sources, so the hole is continued with what
 * is next to it instead of distinctive things elsewhere (hair, skin, …).
 * Everything within `reach` is free: a cost that grows right from the border
 * would make whole rows copy the one source next to the hole.
 */
function solveLevel(l: Level, valid: Uint8Array, nx: Int32Array, ny: Int32Array, emIters: number, pmIters: number, seed: number, lambda: number, matchTexture = false): Float32Array | null {
  const reach = holeReach(l)
  const far = (dx: number, dy: number) => {
    const d = Math.sqrt(dx * dx + dy * dy) - reach
    return d > 0 ? lambda * d * d : 0
  }
  const { w, h, rgb, hole } = l
  let s = seed || 1
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const validList: number[] = []
  for (let i = 0; i < w * h; i++) if (valid[i]) validList.push(i)
  if (!validList.length) return null

  // Targets: every pixel whose patch touches the hole.
  const targets: number[] = []
  const isTarget = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!hole[y * w + x]) continue
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (!isTarget[j]) {
            isTarget[j] = 1
            targets.push(j)
          }
        }
    }
  const nd = new Float32Array(w * h).fill(Infinity)

  // Texture of every source patch (std of brightness) and the texture of the
  // surroundings of the hole. Sources that are much flatter than what is
  // around the hole cost extra: otherwise the search likes to settle on the
  // smoothest patch and lined or grainy areas get a flat smear.
  const lum = new Float32Array(w * h)
  const lum2 = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const v = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]
    lum[i] = hole[i] ? 0 : v
    lum2[i] = hole[i] ? 0 : v * v
  }
  const boxSum = (src: Float32Array) => {
    const tmp = new Float32Array(w * h)
    const out = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      let acc = 0
      for (let x = -R; x <= R; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc
        acc += src[y * w + Math.min(w - 1, x + R + 1)] - src[y * w + Math.max(0, x - R)]
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -R; y <= R; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc
        acc += tmp[Math.min(h - 1, y + R + 1) * w + x] - tmp[Math.max(0, y - R) * w + x]
      }
    }
    return out
  }
  const n2 = (2 * R + 1) * (2 * R + 1)
  const s1 = boxSum(lum)
  const s2 = boxSum(lum2)
  const srcTex = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) srcTex[i] = Math.sqrt(Math.max(0, s2[i] / n2 - (s1[i] / n2) ** 2))
  let texGoal = 0
  if (matchTexture) {
    // Valid sources close to the hole.
    const near: number[] = []
    const holeIdx: number[] = []
    for (let i = 0; i < w * h; i++) if (hole[i]) holeIdx.push(i)
    let hx = 0
    let hy = 0
    for (const i of holeIdx) {
      hx += i % w
      hy += Math.floor(i / w)
    }
    hx /= Math.max(1, holeIdx.length)
    hy /= Math.max(1, holeIdx.length)
    const rad = Math.sqrt(holeIdx.length / Math.PI) + 3 * R
    for (const v of validList) {
      if (Math.hypot((v % w) - hx, Math.floor(v / w) - hy) < rad * 1.5) near.push(srcTex[v])
    }
    if (near.length) {
      near.sort((a, b) => a - b)
      texGoal = near[Math.floor(near.length / 2)]
    }
  }
  const texPen = (c: number) => {
    const lack = texGoal - srcTex[c]
    return lack > 0 ? lack * lack * n2 * 3 : 0
  }

  const dist = (tx: number, ty: number, sx: number, sy: number, best: number) => {
    let d = 0
    for (let dy = -R; dy <= R; dy++) {
      const ty2 = ty + dy
      if (ty2 < 0 || ty2 >= h) continue
      for (let dx = -R; dx <= R; dx++) {
        const tx2 = tx + dx
        if (tx2 < 0 || tx2 >= w) continue
        const ti = (ty2 * w + tx2) * 3
        const si = ((sy + dy) * w + sx + dx) * 3
        const a = rgb[ti] - rgb[si]
        const b = rgb[ti + 1] - rgb[si + 1]
        const c = rgb[ti + 2] - rgb[si + 2]
        d += a * a + b * b + c * c
      }
      if (d >= best) return d
    }
    return d
  }

  // Initialise: keep a valid (e.g. upsampled) guess, otherwise random.
  for (const t of targets) {
    const cur = ny[t] * w + nx[t]
    if (nx[t] < 0 || !valid[cur] || cur === t) {
      const v = validList[Math.floor(rnd() * validList.length)]
      nx[t] = v % w
      ny[t] = (v - (v % w)) / w
    }
  }

  const accR = new Float32Array(w * h)
  const accG = new Float32Array(w * h)
  const accB = new Float32Array(w * h)
  const accW = new Float32Array(w * h)
  const maxR = Math.max(w, h)

  // How many targets copy from each source. Reusing one source for many
  // targets costs extra, otherwise everything collapses onto the single
  // flattest patch and the fill turns into a flat smear.
  const usage = new Float32Array(w * h)
  for (const t of targets) usage[ny[t] * w + nx[t]]++
  let occ = 0

  const tryCandidate = (t: number, tx: number, ty: number, cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return
    const c = cy * w + cx
    const cur = ny[t] * w + nx[t]
    if (c === cur || !valid[c]) return
    const pen = far(cx - tx, cy - ty) + occ * usage[c] + texPen(c)
    if (pen >= nd[t]) return
    const d = dist(tx, ty, cx, cy, nd[t] - pen) + pen
    if (d < nd[t]) {
      usage[cur]--
      usage[c]++
      nd[t] = d
      nx[t] = cx
      ny[t] = cy
    }
  }

  const raw = new Float32Array(targets.length)
  for (let em = 0; em < emIters; em++) {
    targets.forEach((t, k) => {
      const tx = t % w
      raw[k] = dist(tx, (t - tx) / w, nx[t], ny[t], Infinity)
    })
    occ = raw.slice().sort()[Math.floor(raw.length / 2)] * 0.05 + 1
    targets.forEach((t, k) => {
      const tx = t % w
      const ty = (t - tx) / w
      nd[t] = raw[k] + far(nx[t] - tx, ny[t] - ty) + occ * (usage[ny[t] * w + nx[t]] - 1) + texPen(ny[t] * w + nx[t])
    })
    for (let it = 0; it < pmIters; it++) {
      const fwd = it % 2 === 0
      for (let k = 0; k < targets.length; k++) {
        const t = targets[fwd ? k : targets.length - 1 - k]
        const tx = t % w
        const ty = (t - tx) / w
        const step = fwd ? -1 : 1
        // Propagation from the left/right and top/bottom neighbour.
        for (const n of [ty * w + tx + step, (ty + step) * w + tx]) {
          if (n < 0 || n >= w * h || !isTarget[n]) continue
          tryCandidate(t, tx, ty, nx[n] - (n % w) + tx, ny[n] - Math.floor(n / w) + ty)
        }
        // Random search around the current best, shrinking radius.
        for (let rad = maxR; rad >= 1; rad >>= 1) {
          tryCandidate(t, tx, ty, Math.round(nx[t] + (rnd() * 2 - 1) * rad), Math.round(ny[t] + (rnd() * 2 - 1) * rad))
        }
      }
    }

    // Voting: each hole pixel becomes the weighted mean of all patches covering it.
    // Weights fall off quickly, so good matches win and the fill stays sharp.
    accR.fill(0)
    accG.fill(0)
    accB.fill(0)
    accW.fill(0)
    const sorted = Float32Array.from(targets, (t) => nd[t]).sort()
    const sigma = sorted[Math.floor(sorted.length * 0.5)] * 0.5 + 1
    for (const t of targets) {
      const tx = t % w
      const ty = (t - tx) / w
      const wt = Math.exp(-nd[t] / sigma)
      for (let dy = -R; dy <= R; dy++) {
        const py = ty + dy
        if (py < 0 || py >= h) continue
        for (let dx = -R; dx <= R; dx++) {
          const px = tx + dx
          if (px < 0 || px >= w) continue
          const p = py * w + px
          if (!hole[p]) continue
          const si = ((ny[t] + dy) * w + nx[t] + dx) * 3
          accR[p] += rgb[si] * wt
          accG[p] += rgb[si + 1] * wt
          accB[p] += rgb[si + 2] * wt
          accW[p] += wt
        }
      }
    }
    for (let p = 0; p < w * h; p++) {
      if (!hole[p] || accW[p] <= 0) continue
      rgb[p * 3] = accR[p] / accW[p]
      rgb[p * 3 + 1] = accG[p] / accW[p]
      rgb[p * 3 + 2] = accB[p] / accW[p]
    }
  }
  return nd
}

/**
 * Final pass: every hole pixel is copied from the best-matching patch that
 * covers it (no averaging), so texture stays crisp. Returns the source pixel
 * of every hole pixel.
 */
function bestPatchCopy(l: Level, nx: Int32Array, ny: Int32Array, nd: Float32Array, srcX: Int32Array, srcY: Int32Array) {
  const { w, h, rgb, hole } = l
  const best = new Float32Array(w * h).fill(Infinity)
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++) {
      const t = ty * w + tx
      if (nx[t] < 0 || !(nd[t] < Infinity)) continue
      for (let dy = -R; dy <= R; dy++) {
        const py = ty + dy
        if (py < 0 || py >= h) continue
        for (let dx = -R; dx <= R; dx++) {
          const px = tx + dx
          if (px < 0 || px >= w) continue
          const p = py * w + px
          if (!hole[p]) continue
          // Prefer the patch's centre region: its outer ring matched worst.
          const d = nd[t] * (1 + 0.04 * (dx * dx + dy * dy))
          if (d >= best[p]) continue
          best[p] = d
          srcX[p] = nx[t] + dx
          srcY[p] = ny[t] + dy
        }
      }
    }
  for (let p = 0; p < w * h; p++) {
    if (!hole[p] || best[p] === Infinity) continue
    const s = (srcY[p] * w + srcX[p]) * 3
    rgb[p * 3] = rgb[s]
    rgb[p * 3 + 1] = rgb[s + 1]
    rgb[p * 3 + 2] = rgb[s + 2]
  }
}

export function inpaint(input: InpaintInput): InpaintResult {
  // Build the pyramid (finest first).
  const levels: Level[] = [{ w: input.w, h: input.h, rgb: new Float32Array(input.rgb), hole: new Uint8Array(input.hole), avoid: input.avoid ? new Uint8Array(input.avoid) : null }]
  while (levels.length < 7) {
    const l = levels[levels.length - 1]
    if (Math.min(l.w, l.h) < 4 * (2 * R + 1)) break
    levels.push(downsample(l))
  }

  let nx: Int32Array | null = null
  let ny: Int32Array | null = null
  let nd: Float32Array | null = null
  let prev: Level | null = null
  for (let li = levels.length - 1; li >= 0; li--) {
    const l = levels[li]
    const n = l.w * l.h
    if (!prev) {
      if (!patchInit(l, validSources(l))) diffuseFill(l)
    } else {
      // Upsample the previous estimate into the hole of this level.
      for (let y = 0; y < l.h; y++)
        for (let x = 0; x < l.w; x++) {
          const i = y * l.w + x
          if (!l.hole[i]) continue
          const j = Math.min(prev.h - 1, y >> 1) * prev.w + Math.min(prev.w - 1, x >> 1)
          l.rgb[i * 3] = prev.rgb[j * 3]
          l.rgb[i * 3 + 1] = prev.rgb[j * 3 + 1]
          l.rgb[i * 3 + 2] = prev.rgb[j * 3 + 2]
        }
    }
    const fx = new Int32Array(n).fill(-1)
    const fy = new Int32Array(n).fill(-1)
    if (prev && nx && ny) {
      for (let y = 0; y < l.h; y++)
        for (let x = 0; x < l.w; x++) {
          const j = Math.min(prev.h - 1, y >> 1) * prev.w + Math.min(prev.w - 1, x >> 1)
          if (nx[j] < 0) continue
          fx[y * l.w + x] = Math.min(l.w - 1, nx[j] * 2 + (x & 1))
          fy[y * l.w + x] = Math.min(l.h - 1, ny[j] * 2 + (y & 1))
        }
      // Start this level with real pixels of this resolution, copied along the
      // upsampled match field. Starting from the blurry coarse colours would
      // make every target look flat and pull all matches to flat sources.
      for (let i = 0; i < n; i++) {
        if (!l.hole[i] || fx[i] < 0) continue
        const s = fy[i] * l.w + fx[i]
        if (l.hole[s]) continue
        l.rgb[i * 3] = l.rgb[s * 3]
        l.rgb[i * 3 + 1] = l.rgb[s * 3 + 1]
        l.rgb[i * 3 + 2] = l.rgb[s * 3 + 2]
      }
    }
    const finest = li === 0
    // Distances shrink by 2 per level, so the penalty grows by 4 to stay comparable.
    nd = solveLevel(l, validSources(l), fx, fy, finest ? 3 : 6, finest ? 2 : 3, 97 + li * 31, 1.5 * Math.pow(4, li), !!input.matchTexture)
    nx = fx
    ny = fy
    prev = l
  }

  const top = levels[0]
  const srcX = new Int32Array(top.w * top.h)
  const srcY = new Int32Array(top.w * top.h)
  for (let i = 0; i < top.w * top.h; i++) {
    srcX[i] = i % top.w
    srcY[i] = Math.floor(i / top.w)
  }
  if (nx && ny && nd) bestPatchCopy(top, nx, ny, nd, srcX, srcY)
  return { rgb: top.rgb, srcX, srcY }
}
