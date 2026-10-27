import { blurPlain, createCanvas, ctx2d, scaledCopy } from './canvas'
import { colorFeat, fisher } from './classify'
import { boxFilter, colorMatte, refineMask, segmentMask } from './segment'

// Sky detection (heuristic, no model) and procedural replacement skies.

export interface SkyDetection {
  mask: HTMLCanvasElement
  /** Lowest sky row as a fraction of the image height. */
  horizon: number
}

/** Coarse sky (1 = sky) at a small size, found by color and flood fill from the top. */
export function coarseSky(base: HTMLCanvasElement, person?: HTMLCanvasElement | null): { sky: Uint8Array; w: number; h: number; lowest: number } | null {
  const small = scaledCopy(base, 420)
  const w = small.width
  const h = small.height
  const d = ctx2d(small).getImageData(0, 0, w, h).data
  // People are never sky: no step of the search may enter them.
  const blocked = new Uint8Array(w * h)
  if (person) {
    const pc = createCanvas(w, h)
    const pcx = ctx2d(pc)
    pcx.drawImage(person, 0, 0, w, h)
    const pd = pcx.getImageData(0, 0, w, h).data
    for (let i = 0; i < w * h; i++) blocked[i] = pd[i * 4 + 3] > 90 ? 1 : 0
  }
  const L = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]

  // Local texture: sky is smooth over a few pixels, snow or leaves on trees are not.
  const G = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      G[i] = Math.abs(L[i] - L[y * w + Math.min(w - 1, x + 1)]) + Math.abs(L[i] - L[Math.min(h - 1, y + 1) * w + x])
    }
  const texture = boxFilter(G, w, h, 2)
  // Narrow window for the flood fill, so small gaps between tree crowns stay open.
  const fine = boxFilter(G, w, h, 1)
  const candidate = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const r = d[i * 4]
      const g = d[i * 4 + 1]
      const b = d[i * 4 + 2]
      const l = L[i]
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      const grad = Math.abs(l - L[y * w + Math.min(w - 1, x + 1)]) + Math.abs(l - L[Math.min(h - 1, y + 1) * w + x])
      // Clearly blue (a grey backdrop with a slight blue cast is not sky).
      const blue = b > r + 12 && (b - r) / Math.max(1, l) > 0.08 && b >= g - 10 && l > 80
      // Dusk: deep blue to violet and pink, darker but clearly colored
      // (green lowest, which leaves out skin, wood and walls).
      const dusk = (y < h * 0.5 && l > 25 && b > r + 20 && b > g + 25) || (y < h * 0.6 && l > 60 && r > g + 40 && b > g + 30)
      const overcast = l > 165 && mx - mn < 45
      // Sunset and dusk skies are warm, but always keep some blue: a lamp-lit
      // yellow wall or a lit panel has almost none.
      const warm = y < h * 0.6 && l > 120 && r > 150 && grad < 6 && b > r * 0.22 && (mx - mn) / mx < 0.82
      candidate[i] = !blocked[i] && (blue || overcast || warm || dusk) && grad < 22 && fine[i] < (blue ? 10 : 9) ? 1 : 0
    }
  }

  // Flood fill from the top edge through smoothly changing sky pixels.
  const sky = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  for (let x = 0; x < w; x++)
    if (candidate[x]) {
      sky[x] = 1
      queue[tail++] = x
    }
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i - x) / w
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || sky[j] || !candidate[j]) continue
      const diff = Math.abs(d[i * 4] - d[j * 4]) + Math.abs(d[i * 4 + 1] - d[j * 4 + 1]) + Math.abs(d[i * 4 + 2] - d[j * 4 + 2])
      if (diff > 30) continue
      sky[j] = 1
      queue[tail++] = j
    }
  }

  let count = 0
  let lowest = 0
  for (let i = 0; i < w * h; i++)
    if (sky[i]) {
      count++
      lowest = Math.max(lowest, Math.floor(i / w))
    }
  if (count < w * h * 0.02) return null

  // Second pass: bright, smooth cloud areas that touch the sky also belong to it.
  head = tail = 0
  for (let i = 0; i < w * h; i++) if (sky[i]) queue[tail++] = i
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i - x) / w
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || sky[j] || blocked[j] || Math.floor(j / w) > lowest) continue
      const r = d[j * 4]
      const g = d[j * 4 + 1]
      const b = d[j * 4 + 2]
      // Clouds change softly from pixel to pixel; facades and snow of the same
      // brightness have edges (windows, branches).
      const step = Math.abs(d[i * 4] - r) + Math.abs(d[i * 4 + 1] - g) + Math.abs(d[i * 4 + 2] - b)
      const cloud = L[j] > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 60 && b >= r - 12 && step < 45 && fine[j] < 24
      if (!cloud) continue
      sky[j] = 1
      queue[tail++] = j
    }
  }

  // The sky continues down to the horizon in a smooth gradient (a sunset gets
  // more orange, a clear sky lighter): follow such small, smooth steps. Walls,
  // water or land start with an edge or texture and stop it.
  head = tail = 0
  for (let i = 0; i < w * h; i++) if (sky[i]) queue[tail++] = i
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i - x) / w
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || sky[j] || blocked[j] || fine[j] > 5 || L[j] < 60) continue
      const step = Math.abs(d[i * 4] - d[j * 4]) + Math.abs(d[i * 4 + 1] - d[j * 4 + 1]) + Math.abs(d[i * 4 + 2] - d[j * 4 + 2])
      if (step > 14) continue
      sky[j] = 1
      queue[tail++] = j
    }
  }
  lowest = 0
  for (let i = 0; i < w * h; i++) if (sky[i]) lowest = Math.max(lowest, Math.floor(i / w))

  // Third pass: darker, smooth cloud bands between the top edge and the sky
  // (dusk skies are often dark grey or violet at the top). From the first sky
  // pixel of each column upwards, smooth pixels are added until texture starts.
  for (let x = 0; x < w; x++) {
    let yF = -1
    for (let y = 0; y < h; y++)
      if (sky[y * w + x]) {
        yF = y
        break
      }
    if (yF <= 0 || yF > h * 0.25) continue
    for (let y = yF - 1; y >= 0; y--) {
      const i = y * w + x
      if (texture[i] > 9 || L[i] < 35 || blocked[i]) break
      sky[i] = 1
    }
  }

  // Smooth islands inside the sky (a slightly different cloud, haze) are sky
  // too; anything that reaches the left, right or bottom edge is not.
  const seen = new Uint8Array(w * h)
  const comp = new Int32Array(w * h)
  for (let start = 0; start < w * h; start++) {
    if (sky[start] || seen[start]) continue
    let n = 0
    let bottom = false
    let side = 0
    let border = 0
    let skyEdge = 0
    let tex = 0
    let lum = 0
    let satSum = 0
    head = tail = 0
    queue[tail++] = start
    seen[start] = 1
    while (head < tail) {
      const i = queue[head++]
      comp[n++] = i
      tex += texture[i]
      lum += L[i]
      satSum += Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) - Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])
      const x = i % w
      const y = (i - x) / w
      // Reaching the bottom, or a side below the upper part, means ground or a
      // building (a cloud cut off by the side of the photo is checked below).
      // A person inside is never part of the sky either.
      if (y === h - 1 || blocked[i]) bottom = true
      if ((x === 0 || x === w - 1) && y > h * 0.25) side++
      if (x === 0 || x === w - 1 || y === 0) border++
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && sky[j]) skyEdge++
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || sky[j] || seen[j]) continue
        seen[j] = 1
        queue[tail++] = j
      }
    }
    // A small white cloud inside the sky may have crisp edges, and may be cut
    // off by the side of the photo (then it is still mostly framed by sky).
    const cloudLike = lum / n > 170 && satSum / n < 45 && n < w * h * 0.004
    const edge = bottom || (side > 0 && !(cloudLike && border < skyEdge * 0.4))
    if (!edge && n < w * h * 0.01 && (tex / n < 9 || (cloudLike && tex / n < 22))) for (let k = 0; k < n; k++) sky[comp[k]] = 1
  }

  // Sky seen through gaps (between trunks, under tree crowns) is not
  // connected to the open sky. Such patches count when they are smooth and
  // have the color of the sky at about the same height.
  const bands = 12
  const bandSum = new Float32Array(bands * 4)
  for (let i = 0; i < w * h; i++) {
    if (!sky[i]) continue
    const k = Math.min(bands - 1, Math.floor((Math.floor(i / w) / h) * bands)) * 4
    bandSum[k] += d[i * 4]
    bandSum[k + 1] += d[i * 4 + 1]
    bandSum[k + 2] += d[i * 4 + 2]
    bandSum[k + 3]++
  }
  const skyColorAt = (y: number): number[] | null => {
    const b0 = Math.min(bands - 1, Math.floor((y / h) * bands))
    // Nearest band (upwards first) that has sky.
    for (let o = 0; o < bands; o++)
      for (const b of [b0 - o, b0 + o]) {
        if (b < 0 || b >= bands || bandSum[b * 4 + 3] < 20) continue
        const n = bandSum[b * 4 + 3]
        return [bandSum[b * 4] / n, bandSum[b * 4 + 1] / n, bandSum[b * 4 + 2] / n]
      }
    return null
  }
  /** Share of the pixels around a component that are clearly darker than it. */
  const inComp = new Uint8Array(w * h)
  const darkFrame = (list: Int32Array, n: number) => {
    let ml = 0
    for (let k = 0; k < n; k++) {
      inComp[list[k]] = 1
      ml += L[list[k]]
    }
    ml /= n
    let edge = 0
    let darker = 0
    for (let k = 0; k < n; k++) {
      const i = list[k]
      const x = i % w
      const y = (i - x) / w
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || inComp[j] || sky[j]) continue
        edge++
        if (L[j] < ml - 35) darker++
      }
    }
    for (let k = 0; k < n; k++) inComp[list[k]] = 0
    return edge ? darker / edge : 0
  }
  seen.fill(0)
  for (let start = 0; start < w * h; start++) {
    if (sky[start] || seen[start] || !candidate[start]) continue
    let n = 0
    let tex = 0
    let sr = 0
    let sg = 0
    let sb = 0
    let sy = 0
    head = tail = 0
    queue[tail++] = start
    seen[start] = 1
    while (head < tail) {
      const i = queue[head++]
      comp[n++] = i
      tex += fine[i]
      sr += d[i * 4]
      sg += d[i * 4 + 1]
      sb += d[i * 4 + 2]
      sy += Math.floor(i / w)
      const x = i % w
      const y = (i - x) / w
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || sky[j] || seen[j] || !candidate[j]) continue
        seen[j] = 1
        queue[tail++] = j
      }
    }
    if (n < 8 || tex / n > 9 || sy / n > lowest) continue
    const ref = skyColorAt(sy / n)
    if (!ref) continue
    const diff = Math.abs(sr / n - ref[0]) + Math.abs(sg / n - ref[1]) + Math.abs(sb / n - ref[2])
    if (diff >= 55) continue
    // Real gaps are framed by things much darker than the sky (twigs, leaves,
    // trunks, bars); a glass facade reflecting the sky is framed by more
    // facade of a similar brightness.
    if (darkFrame(comp, n) < 0.7) continue
    for (let k = 0; k < n; k++) sky[comp[k]] = 1
  }

  // A plain light wall, a studio backdrop or snow that reaches down to the
  // bottom of the photo is not sky (a blue sky may, e.g. shot from below).
  let bottom = 0
  let blue = 0
  let total = 0
  const y0 = Math.floor(h * 0.85)
  for (let i = 0; i < w * h; i++) {
    if (!sky[i]) continue
    total++
    if (i >= y0 * w) bottom++
    if (d[i * 4 + 2] > d[i * 4] + 6 && d[i * 4 + 2] >= d[i * 4 + 1] - 10) blue++
  }
  if (bottom > (h - y0) * w * 0.15 && blue < total * 0.5) return null
  // Every real sky has very smooth parts. Water with ripples, a textured wall
  // or snow can have sky colors, but almost no pixel there is that smooth.
  let smoothPx = 0
  for (let i = 0; i < w * h; i++) if (sky[i] && fine[i] < 2) smoothPx++
  if (smoothPx < total * 0.08) return null
  return { sky, w, h, lowest }
}

/**
 * A plain grey, white or dark area that only borders a person (and the edges
 * of the photo) is a studio backdrop or a wall behind a portrait, not sky: a
 * real sky also borders landscape, buildings or the horizon somewhere. Clearly
 * blue skies are always kept.
 */
function isBackdrop(base: HTMLCanvasElement, sky: Uint8Array, w: number, h: number, person: HTMLCanvasElement): boolean {
  const small = scaledCopy(base, Math.max(w, h))
  const d = ctx2d(small).getImageData(0, 0, w, h).data
  let blue = 0
  let n = 0
  for (let i = 0; i < w * h; i++) {
    if (!sky[i]) continue
    n++
    const r = d[i * 4]
    const b = d[i * 4 + 2]
    const l = 0.299 * r + 0.587 * d[i * 4 + 1] + 0.114 * b
    if (b > r + 12 && (b - r) / Math.max(1, l) > 0.08) blue++
  }
  if (!n || blue > n * 0.5) return false
  const pc = createCanvas(w, h)
  const pcx = ctx2d(pc)
  pcx.drawImage(person, 0, 0, w, h)
  const pd = pcx.getImageData(0, 0, w, h).data
  // Areas next to the sky: is there landscape (a larger area that is not the
  // person)? Small specks inside the backdrop do not count.
  const comp = new Int32Array(w * h).fill(-1)
  const isLand: boolean[] = []
  const queue = new Int32Array(w * h)
  for (let st = 0; st < w * h; st++) {
    if (sky[st] || comp[st] >= 0) continue
    const id = isLand.length
    let head = 0
    let tail = 0
    let size = 0
    let pers = 0
    queue[tail++] = st
    comp[st] = id
    while (head < tail) {
      const i = queue[head++]
      size++
      if (pd[i * 4 + 3] > 100) pers++
      const x = i % w
      const y = (i - x) / w
      for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (k < 0 || sky[k] || comp[k] >= 0) continue
        comp[k] = id
        queue[tail++] = k
      }
    }
    // Landscape: big enough, and mostly not the person (the person's own
    // area may include a bit of clothing the model missed).
    isLand.push(size > w * h * 0.005 && size - pers > w * h * 0.004 && pers < size * 0.6)
  }
  // What the sky touches.
  let byPerson = 0
  let byOther = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!sky[i]) continue
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const k = ny * w + nx
        if (sky[k]) continue
        if (pd[k * 4 + 3] > 100) byPerson++
        else if (isLand[comp[k]]) byOther++
        else byPerson++
      }
    }
  return byPerson + byOther > 0 && byOther < (byPerson + byOther) * 0.2
}

export async function detectSky(base: HTMLCanvasElement): Promise<SkyDetection | null> {
  // People in front of the sky are never sky.
  let person: HTMLCanvasElement | null = null
  try {
    person = await segmentMask(base, 'person', false)
    // Only where a person is likely: the model's faint "maybe" everywhere
    // else would otherwise thin out the whole sky.
    const pc = ctx2d(person)
    const pi = pc.getImageData(0, 0, person.width, person.height)
    for (let i = 3; i < pi.data.length; i += 4) {
      const t = Math.min(1, Math.max(0, (pi.data[i] / 255 - 0.3) / 0.4))
      pi.data[i] = t * t * (3 - 2 * t) * 255
    }
    pc.putImageData(pi, 0, 0)
  } catch {
    // Segmentation unavailable: colors only.
    person = null
  }
  const coarse = coarseSky(base, person)
  if (!coarse) return null
  const { sky, w, h, lowest } = coarse
  const m = createCanvas(w, h)
  const mc = ctx2d(m)
  const img = mc.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = sky[i] * 255
  }
  mc.putImageData(img, 0, 0)
  const up = createCanvas(base.width, base.height)
  const uc = ctx2d(up)
  uc.imageSmoothingQuality = 'high'
  uc.drawImage(m, 0, 0, base.width, base.height)
  if (person) {
    uc.globalCompositeOperation = 'destination-out'
    uc.drawImage(person, 0, 0)
    if (isBackdrop(base, sky, w, h, person)) return null
  }
  // Snap the edge to branches and leaves by color and take in the sky seen
  // through gaps in trees; the old sky color at the edges is removed later
  // when the new sky is put in.
  const soft = refineMask(base, up, 0.8)
  // Clouds have texture, which makes the edge filter unsure inside the sky:
  // everything that is clearly more sky than not counts as full sky.
  const sc = ctx2d(soft)
  const si = sc.getImageData(0, 0, soft.width, soft.height)
  for (let i = 3; i < si.data.length; i += 4) {
    const t = Math.min(1, Math.max(0, (si.data[i] / 255 - 0.04) / 0.5))
    si.data[i] = t * t * (3 - 2 * t) * 255
  }
  sc.putImageData(si, 0, 0)
  const refined = colorMatte(base, snapByColor(base, soft), { holes: true })
  // Sky that is almost sure (haze or thin clouds next to trees) becomes full
  // sky: a little old sky showing through looks like a pale halo under a new,
  // darker sky. Soft edges stay soft.
  const fc = ctx2d(refined)
  const fi = fc.getImageData(0, 0, refined.width, refined.height)
  for (let i = 3; i < fi.data.length; i += 4) {
    const t = Math.min(1, Math.max(0, (fi.data[i] / 255 - 0.03) / 0.6))
    fi.data[i] = t * t * (3 - 2 * t) * 255
  }
  fc.putImageData(fi, 0, 0)
  // Cameras sharpen photos, which leaves a light rim of 1–2 pixels around
  // trees and buildings against a bright sky. Under a darker new sky that rim
  // would glow, so the sky reaches that little bit further.
  const grown = blurPlain(refined, Math.max(0.8, Math.max(base.width, base.height) * 0.0005))
  const gc = ctx2d(grown)
  const gi = gc.getImageData(0, 0, grown.width, grown.height)
  for (let i = 3; i < gi.data.length; i += 4) gi.data[i] = Math.max(fi.data[i], Math.min(255, gi.data[i] * 1.8))
  fc.putImageData(gi, 0, 0)
  const fine = fineStructures(base, refined)
  fc.clearRect(0, 0, refined.width, refined.height)
  fc.drawImage(fine, 0, 0)
  if (person) {
    const rc = ctx2d(refined)
    rc.globalCompositeOperation = 'destination-out'
    rc.drawImage(person, 0, 0)
    rc.globalCompositeOperation = 'source-over'
  }
  return { mask: refined, horizon: Math.min(1, (lowest + 2) / h) }
}

/**
 * Sets the sky edge pixel by pixel. The coarse mask is found at a small size
 * and ends up to a few dozen pixels away from leaves and branches; here a
 * color classifier learns sky against landscape from sure parts of this photo
 * close to the edge, and decides every pixel near the edge.
 */
function snapByColor(base: HTMLCanvasElement, prior: HTMLCanvasElement): HTMLCanvasElement {
  const s = Math.min(1, 1280 / Math.max(base.width, base.height))
  const w = Math.max(1, Math.round(base.width * s))
  const h = Math.max(1, Math.round(base.height * s))
  const img = createCanvas(w, h)
  const ic = ctx2d(img)
  ic.imageSmoothingQuality = 'high'
  ic.drawImage(base, 0, 0, w, h)
  const I = ic.getImageData(0, 0, w, h).data
  const pm = createCanvas(w, h)
  const pc = ctx2d(pm)
  pc.imageSmoothingQuality = 'high'
  pc.drawImage(prior, 0, 0, w, h)
  const P = pc.getImageData(0, 0, w, h).data
  const side = Math.max(w, h)
  // Distance to the edge, roughly: a blur of the mask (near) and a wider one (ring).
  const near = ctx2d(blurPlain(pm, side * 0.012)).getImageData(0, 0, w, h).data
  const ring = ctx2d(blurPlain(pm, side * 0.05)).getImageData(0, 0, w, h).data
  const sky: number[][] = []
  const land: number[][] = []
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 60000)))
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4
      if (I[i + 3] < 250) continue
      const n = near[i + 3] / 255
      const r = ring[i + 3] / 255
      // Sure, but not far from the edge: these colors matter there.
      if (r <= 0.02 || r >= 0.98) continue
      if (n > 0.985 && P[i + 3] > 250) sky.push(colorFeat(I, i))
      else if (n < 0.015 && P[i + 3] < 5) land.push(colorFeat(I, i))
    }
  const cls = fisher(land, sky)
  if (!cls) return prior
  const trust = Math.min(1, Math.max(0, (cls.separation - 1.5) / 1.5))
  if (trust <= 0) return prior
  // Local texture: open sky is smooth; glass facades, windows and leaves are not.
  const L = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * I[i * 4] + 0.587 * I[i * 4 + 1] + 0.114 * I[i * 4 + 2]
  const G = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      G[i] = Math.abs(L[i] - L[y * w + Math.min(w - 1, x + 1)]) + Math.abs(L[i] - L[Math.min(h - 1, y + 1) * w + x])
    }
  const tex = boxFilter(G, w, h, 2)
  const out = pc.createImageData(w, h)
  const o = out.data
  for (let i = 0; i < w * h * 4; i += 4) {
    let a = P[i + 3] / 255
    const n = near[i + 3] / 255
    // Only near the edge; deep inside sky or landscape nothing changes.
    if (n > 0.003 && n < 0.997 && I[i + 3] > 0) {
      const sc = cls.score(colorFeat(I, i))
      // Less sky: whenever the color says landscape.
      const lessT = Math.min(1, Math.max(0, (sc - 0.35) / 0.3))
      const less = lessT * lessT * (3 - 2 * lessT)
      if (less < a) a += (less - a) * trust
      // More sky: only clearly sky-colored, smooth pixels on the sky side of
      // the edge (not a blue glass facade or a lake).
      const moreT = Math.min(1, Math.max(0, (sc - 0.75) / 0.2)) * (1 - Math.min(1, Math.max(0, (tex[i / 4] - 6) / 8))) * Math.min(1, n / 0.25)
      if (moreT > a) a += (moreT - a) * trust
    }
    o[i] = o[i + 1] = o[i + 2] = 255
    o[i + 3] = a * 255
  }
  pc.putImageData(out, 0, 0)
  if (s === 1) return pm
  const full = createCanvas(base.width, base.height)
  const fc = ctx2d(full)
  fc.imageSmoothingQuality = 'high'
  fc.drawImage(pm, 0, 0, base.width, base.height)
  return full
}

/** Canvas with the image colors and `weight` (0..1) as alpha, for weighted blurs. */
function weightedCanvas(I: Uint8ClampedArray, wgt: Float32Array, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(w, h)
  const ctx = ctx2d(c)
  const out = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    out.data[i * 4] = I[i * 4]
    out.data[i * 4 + 1] = I[i * 4 + 1]
    out.data[i * 4 + 2] = I[i * 4 + 2]
    out.data[i * 4 + 3] = wgt[i] * 255
  }
  ctx.putImageData(out, 0, 0)
  return c
}

/** Index of the darkest pixel in a (2r+1)² window around every pixel (separable). */
function darkestIndex(L: Float32Array, w: number, h: number, r: number): Int32Array {
  const tmp = new Int32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = y * w + x
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (L[y * w + k] < L[best]) best = y * w + k
      tmp[y * w + x] = best
    }
  const out = new Int32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = tmp[y * w + x]
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        const c = tmp[k * w + x]
        if (L[c] < L[best]) best = c
      }
      out[y * w + x] = best
    }
  return out
}

/**
 * Thin things in front of the sky (bare twigs, fences, wires, cranes) are far
 * too small for the coarse search, and the sky seen between them is often
 * not connected to the open sky. Pixel by pixel:
 * - sky between twigs and bars: smooth pixels that have the color of the
 *   sky right around them become sky;
 * - twigs and bars: a pixel that is clearly darker than the sky around it,
 *   towards the dark color of the twig next to it, is not sky, by the share
 *   it is darker (so 1-pixel twigs keep their soft edges).
 */
function fineStructures(base: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const s = Math.min(1, 2560 / Math.max(base.width, base.height))
  const w = Math.max(1, Math.round(base.width * s))
  const h = Math.max(1, Math.round(base.height * s))
  const n = w * h
  const ic = createCanvas(w, h)
  const icx = ctx2d(ic)
  icx.imageSmoothingQuality = 'high'
  icx.drawImage(base, 0, 0, w, h)
  const I = icx.getImageData(0, 0, w, h).data
  const mc = createCanvas(w, h)
  const mcx = ctx2d(mc)
  mcx.imageSmoothingQuality = 'high'
  mcx.drawImage(mask, 0, 0, w, h)
  const md = mcx.getImageData(0, 0, w, h)
  const M = new Float32Array(n)
  const L = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    M[i] = md.data[i * 4 + 3] / 255
    L[i] = 0.299 * I[i * 4] + 0.587 * I[i * 4 + 1] + 0.114 * I[i * 4 + 2]
  }
  const side = Math.max(w, h)
  // Local texture (1 px), so smooth sky can be told from bars and twigs.
  const G = new Float32Array(n)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      G[i] = Math.abs(L[i] - L[y * w + Math.min(w - 1, x + 1)]) + Math.abs(L[i] - L[Math.min(h - 1, y + 1) * w + x])
    }
  const tex = boxFilter(G, w, h, 1)

  // Land vs sky colors of this photo, to make sure a "dark neighbour" is really a twig.
  const skyS: number[][] = []
  const landS: number[][] = []
  const step = Math.max(1, Math.round(Math.sqrt(n / 50000)))
  for (let i = 0; i < n; i += step) {
    if (M[i] > 0.98 && tex[i] < 4) skyS.push(colorFeat(I, i * 4))
    else if (M[i] < 0.02) landS.push(colorFeat(I, i * 4))
  }
  const cls = fisher(landS, skyS)
  const darkest = darkestIndex(L, w, h, Math.max(2, Math.round(side * 0.0016)))
  const r1 = Math.max(3, side * 0.006)

  /**
   * Sky color expected at every pixel (from the sure sky in `cur`: the
   * nearest, else further away, else the sky at that height), the local sky
   * color `S`, and the colors of the landscape around (`LA`, without pixels
   * that look exactly like the sky).
   */
  const references = (cur: Float32Array) => {
    const w0 = new Float32Array(n)
    for (let i = 0; i < n; i++) w0[i] = cur[i] > 0.9 ? 1 : 0
    const S0 = ctx2d(blurPlain(weightedCanvas(I, w0, w, h), r1)).getImageData(0, 0, w, h).data
    // Twigs inside the sky would darken the sky color: leave dark pixels out.
    const w1 = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const ls = 0.299 * S0[i * 4] + 0.587 * S0[i * 4 + 1] + 0.114 * S0[i * 4 + 2]
      w1[i] = w0[i] * (L[i] >= ls - 14 ? 1 : 0.02)
    }
    const wc = weightedCanvas(I, w1, w, h)
    const S = ctx2d(blurPlain(wc, r1)).getImageData(0, 0, w, h).data
    const SW = ctx2d(blurPlain(wc, side * 0.03)).getImageData(0, 0, w, h).data
    const SW2 = ctx2d(blurPlain(wc, side * 0.1)).getImageData(0, 0, w, h).data
    const bands = 48
    const band = new Float32Array(bands * 4)
    let lowestSky = 0
    for (let i = 0; i < n; i++) {
      if (w1[i] < 0.5) continue
      const y = Math.floor(i / w)
      lowestSky = Math.max(lowestSky, y)
      const b = Math.min(bands - 1, Math.floor((y / h) * bands)) * 4
      band[b] += I[i * 4]
      band[b + 1] += I[i * 4 + 1]
      band[b + 2] += I[i * 4 + 2]
      band[b + 3]++
    }
    const ref = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const j = i * 4
      let src: Uint8ClampedArray | null = null
      if (S[j + 3] > 40) src = S
      else if (SW[j + 3] > 20) src = SW
      else if (SW2[j + 3] > 12) src = SW2
      if (src) {
        ref[i * 3] = src[j]
        ref[i * 3 + 1] = src[j + 1]
        ref[i * 3 + 2] = src[j + 2]
        continue
      }
      const b0 = Math.min(bands - 1, Math.floor((Math.floor(i / w) / h) * bands))
      for (let o = 0; o < bands && !ref[i * 3]; o++)
        for (const b of [b0 - o, b0 + o]) {
          if (b < 0 || b >= bands || band[b * 4 + 3] < 30) continue
          const c = band[b * 4 + 3]
          ref[i * 3] = band[b * 4] / c
          ref[i * 3 + 1] = band[b * 4 + 1] / c
          ref[i * 3 + 2] = band[b * 4 + 2] / c
          break
        }
    }
    const wl = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      if (cur[i] >= 0.05) continue
      const j = i * 4
      wl[i] = Math.hypot(I[j] - ref[i * 3], I[j + 1] - ref[i * 3 + 1], I[j + 2] - ref[i * 3 + 2]) > 12 ? 1 : 0
    }
    const LA = ctx2d(blurPlain(weightedCanvas(I, wl, w, h), r1)).getImageData(0, 0, w, h).data
    return { S, SW, ref, LA, lowestSky }
  }

  // A pixel only becomes sky when it is clearly closer to the sky color than
  // to the landscape around: glass that reflects the sky, snow in a tree or
  // light hair stay landscape, the sky between twigs and bars does not.
  const skyCloser = (LA: Uint8ClampedArray, i: number, r: number, g: number, b: number, k: number) => {
    const j = i * 4
    if (LA[j + 3] < 8) return true
    const ds = Math.hypot(I[j] - r, I[j + 1] - g, I[j + 2] - b)
    const dl = Math.hypot(I[j] - LA[j], I[j + 1] - LA[j + 1], I[j + 2] - LA[j + 2])
    return ds < dl * k
  }

  const out = new Float32Array(M)
  // 1) Sky in gaps (between bars, inside twig crowns, between forks): smooth
  //    areas with the color of the sky nearby, not lower than the lowest
  //    open sky (so water and blue cars stay). Repeated a few times, so the
  //    sky color is passed on from gap to gap (e.g. down a tall fence).
  let refs = references(out)
  const cand = new Uint8Array(n)
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  for (let pass = 0; pass < 4; pass++) {
    cand.fill(0)
    seen.fill(0)
    const { ref, LA, lowestSky } = refs
    for (let i = 0; i < n; i++) {
      if (out[i] >= 0.5 || tex[i] > 10) continue
      const j = i * 4
      const r = ref[i * 3]
      const g = ref[i * 3 + 1]
      const b = ref[i * 3 + 2]
      if (!r && !g && !b) continue
      const sc = cls ? cls.score(colorFeat(I, j)) : 0.7
      if (sc < 0.6) continue
      const d2 = (I[j] - r) ** 2 + (I[j + 1] - g) ** 2 + (I[j + 2] - b) ** 2
      // Close to the sky color there; or a brighter cloud streak that is
      // clearly sky-colored.
      const near = d2 <= 30 * 30 && tex[i] <= 7
      const cloud = sc >= 0.85 && L[i] >= 0.299 * r + 0.587 * g + 0.114 * b - 10 && d2 <= 80 * 80
      if (!near && !cloud) continue
      if (!skyCloser(LA, i, r, g, b, 0.6)) continue
      cand[i] = 1
    }
    let added = 0
    for (let st = 0; st < n; st++) {
      if (!cand[st] || seen[st]) continue
      let head = 0
      let tail = 0
      let sumY = 0
      queue[tail++] = st
      seen[st] = 1
      while (head < tail) {
        const i = queue[head++]
        const x = i % w
        const y = (i - x) / w
        sumY += y
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j < 0 || seen[j] || !cand[j]) continue
          seen[j] = 1
          queue[tail++] = j
        }
      }
      if (tail < 4 || sumY / tail > lowestSky) continue
      for (let k = 0; k < tail; k++) out[queue[k]] = 1
      added += tail
    }
    if (added < n * 0.0005) break
    refs = references(out)
  }

  // 2) Twigs, bars and wires. Every pixel near sky is placed on the line
  //    between the sky color there and the darkest twig color next to it:
  //    that share is its coverage. Inside the sky this cuts twigs out; next
  //    to twigs (where the coarse mask made them far too thick) it gives the
  //    sky back. Big dark areas (a building, a trunk) are left as they are.
  const { SW, ref, LA } = refs
  const darkish = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const ls = 0.299 * ref[i * 3] + 0.587 * ref[i * 3 + 1] + 0.114 * ref[i * 3 + 2]
    darkish[i] = ls && L[i] < ls - 45 ? 1 : 0
  }
  const density = boxFilter(darkish, w, h, Math.max(3, Math.round(side * 0.0025)))
  const land = new Float32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const j = i * 4
    const sr = ref[i * 3]
    const sg = ref[i * 3 + 1]
    const sb = ref[i * 3 + 2]
    if (!sr && !sg && !sb) continue
    const ls = 0.299 * sr + 0.587 * sg + 0.114 * sb
    const di = darkest[i]
    if (ls - L[di] < 45) continue
    const dj = di * 4
    if (cls && cls.score(colorFeat(I, dj)) > 0.45) continue
    // Where on the line from sky color to twig color this pixel lies.
    const ur = sr - I[dj]
    const ug = sg - I[dj + 1]
    const ub = sb - I[dj + 2]
    const vr = sr - I[j]
    const vg = sg - I[j + 1]
    const vb = sb - I[j + 2]
    const uu = ur * ur + ug * ug + ub * ub
    const t = (vr * ur + vg * ug + vb * ub) / uu
    const er = vr - t * ur
    const eg = vg - t * ug
    const eb = vb - t * ub
    if (Math.sqrt((er * er + eg * eg + eb * eb) / uu) > 0.3) continue
    const a = Math.min(1, Math.max(0, (t - 0.12) / 0.8))
    land[i] = a
    if (1 - a > out[i]) {
      // Giving sky back: only among thin dark things, with sky right next to
      // it, and only where the pixel is a mix of sky and twig (not a surface
      // of its own, like a light wall).
      if (density[i] > 0.85 || SW[j + 3] < 20) continue
      if (cls && cls.score(colorFeat(I, j)) < 0.35) continue
      if (!skyCloser(LA, i, I[dj] + ur * (1 - a), I[dj + 1] + ug * (1 - a), I[dj + 2] + ub * (1 - a), 0.6)) continue
      out[i] = 1 - a
    }
  }
  // Single specks (noise; a bird far away stays if it has neighbours) are ignored.
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (land[i] <= 0 || out[i] < 0.5) continue
      let nb = 0
      for (const o of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) if (land[i + o] > 0.15) nb++
      if (nb === 0) continue
      out[i] = Math.min(out[i], 1 - land[i])
    }
  // Pixels that look exactly like the sky there but are only partly selected
  // (soft rims left from the coarse steps) become full sky; under a dark new
  // sky they would show as faint light lines.
  for (let i = 0; i < n; i++) {
    if (out[i] >= 1 || out[i] < 0.3 || tex[i] > 6) continue
    const j = i * 4
    const d = Math.hypot(I[j] - ref[i * 3], I[j + 1] - ref[i * 3 + 1], I[j + 2] - ref[i * 3 + 2])
    if (d > 14) continue
    if (cls && cls.score(colorFeat(I, j)) < 0.8) continue
    out[i] = 1
  }
  // Small leftover specks inside gaps are closed when the sky is all around
  // them and they are not dark.
  for (let pass = 0; pass < 3; pass++)
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (out[i] >= 0.5 || darkish[i]) continue
        let nb = 0
        for (const o of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) if (out[i + o] > 0.9) nb++
        if (nb >= 6) out[i] = 1
      }
  for (let i = 0; i < n; i++) {
    md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 255
    md.data[i * 4 + 3] = out[i] * 255
  }
  mcx.putImageData(md, 0, 0)
  if (s === 1) return mc
  const full = createCanvas(base.width, base.height)
  const fcx = ctx2d(full)
  fcx.imageSmoothingQuality = 'high'
  fcx.drawImage(mc, 0, 0, base.width, base.height)
  return full
}

/** Average color (0..1) of `c` where `mask` is set (or everywhere). */
export function meanColor(c: HTMLCanvasElement, mask?: HTMLCanvasElement): [number, number, number] {
  const s = scaledCopy(c, 128)
  const d = ctx2d(s).getImageData(0, 0, s.width, s.height).data
  let m: Uint8ClampedArray | null = null
  if (mask) {
    const ms = createCanvas(s.width, s.height)
    const mc = ctx2d(ms)
    mc.drawImage(mask, 0, 0, s.width, s.height)
    m = mc.getImageData(0, 0, s.width, s.height).data
  }
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    const wgt = m ? m[i + 3] / 255 : 1
    r += d[i] * wgt
    g += d[i + 1] * wgt
    b += d[i + 2] * wgt
    n += wgt
  }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : [0.6, 0.75, 0.9]
}

/**
 * Lets the landscape take on the light of the new sky: darker under a night
 * sky, warmer under a sunset. Gains are taken from the old and new sky colors
 * and kept moderate.
 */
export function matchLight(fg: HTMLCanvasElement, oldSky: [number, number, number], newSky: [number, number, number]): HTMLCanvasElement {
  const lum = (c: [number, number, number]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
  const lo = Math.max(0.02, lum(oldSky))
  const ln = Math.max(0.02, lum(newSky))
  const lg = Math.min(1.15, Math.max(0.5, Math.pow(ln / lo, 0.35)))
  const gains = [0, 1, 2].map((k) => {
    const chroma = Math.max(0.02, newSky[k]) / ln / (Math.max(0.02, oldSky[k]) / lo)
    return lg * Math.min(1.2, Math.max(0.82, Math.pow(chroma, 0.3)))
  })
  const out = createCanvas(fg.width, fg.height)
  const ctx = ctx2d(out)
  const img = ctx2d(fg).getImageData(0, 0, fg.width, fg.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * gains[0])
    d[i + 1] = Math.min(255, d[i + 1] * gains[1])
    d[i + 2] = Math.min(255, d[i + 2] * gains[2])
  }
  ctx.putImageData(img, 0, 0)
  return out
}

export const SKIES = [
  { id: 'clear', label: 'Clear' },
  { id: 'clouds', label: 'Cloudy' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'bluehour', label: 'Blue Hour' },
  { id: 'pastel', label: 'Pastel' },
  { id: 'night', label: 'Starry Night' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'storm', label: 'Storm' },
] as const

export type SkyId = (typeof SKIES)[number]['id']

const GRADIENTS: Record<SkyId, string[]> = {
  clear: ['#1f5fc8', '#4f8fe0', '#9ccaf2', '#d9eefb'],
  clouds: ['#2f6ccc', '#5f9ae0', '#a9d0f2', '#e2f1fb'],
  sunset: ['#272a6b', '#7b3f8c', '#d65d7a', '#f79a58', '#ffd38a'],
  bluehour: ['#0c1a4a', '#2a3f8f', '#6f6fb8', '#c48cc1'],
  pastel: ['#9fb8ff', '#c9b8f5', '#f5c4df', '#ffe6d0'],
  night: ['#03050f', '#0b1233', '#1b2659', '#2f3a72'],
  aurora: ['#020611', '#06142e', '#0c2346', '#1b3557'],
  storm: ['#2b2f38', '#40454f', '#5b616b', '#7d828a'],
}

function rng(seed: number) {
  let s = (seed * 9301 + 49297) % 233280 || 1
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/** Fractal value noise, rendered small and scaled up. */
function cloudLayer(w: number, h: number, seed: number, color: string, density: number): HTMLCanvasElement {
  const gw = 192
  const gh = Math.max(32, Math.round((gw * h) / w))
  const rnd = rng(seed)
  const grids = [4, 8, 16, 32].map((n) => {
    const g = new Float32Array((n + 1) * (n + 1))
    for (let i = 0; i < g.length; i++) g[i] = rnd()
    return { n, g }
  })
  const c = createCanvas(gw, gh)
  const cc = ctx2d(c)
  const img = cc.createImageData(gw, gh)
  const [cr, cg, cb] = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16))
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let v = 0
      let amp = 0.5
      for (const { n, g } of grids) {
        const fx = (x / gw) * n
        const fy = (y / gh) * n
        const ix = Math.floor(fx)
        const iy = Math.floor(fy)
        const tx = fx - ix
        const ty = fy - iy
        const sx = tx * tx * (3 - 2 * tx)
        const sy = ty * ty * (3 - 2 * ty)
        const a = g[iy * (n + 1) + ix]
        const b = g[iy * (n + 1) + ix + 1]
        const c2 = g[(iy + 1) * (n + 1) + ix]
        const d2 = g[(iy + 1) * (n + 1) + ix + 1]
        v += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c2 * (1 - sx) + d2 * sx) * sy)
        amp /= 2
      }
      const alpha = Math.max(0, Math.min(1, (v - (1 - density) * 0.95) * 2.6))
      const i = (y * gw + x) * 4
      img.data[i] = cr
      img.data[i + 1] = cg
      img.data[i + 2] = cb
      img.data[i + 3] = alpha * 255
    }
  }
  cc.putImageData(img, 0, 0)
  const out = createCanvas(w, h)
  const oc = ctx2d(out)
  oc.imageSmoothingQuality = 'high'
  oc.drawImage(c, 0, 0, w, h)
  return out
}

/**
 * Northern lights: curtains of fine vertical rays hanging from a wavy lower
 * edge, green at the bottom and fading to violet and dark towards the top.
 */
function auroraLayer(w: number, h: number, seed: number): HTMLCanvasElement {
  const gw = 640
  const gh = Math.max(120, Math.round((gw * h) / w))
  const rnd = rng(seed + 7)
  const c = createCanvas(gw, gh)
  const cc = ctx2d(c)
  const img = cc.createImageData(gw, gh)
  const d = img.data
  // Smooth 1D noise for the rays.
  const rays = new Float32Array(gw)
  const knots = Array.from({ length: 97 }, () => rnd())
  for (let x = 0; x < gw; x++) {
    const f = (x / gw) * 96
    const i = Math.floor(f)
    const t = f - i
    const s2 = t * t * (3 - 2 * t)
    rays[x] = knots[i] + (knots[i + 1] - knots[i]) * s2
  }
  const curtains = [0, 1].map(() => ({
    base: 0.42 + rnd() * 0.18,
    a1: 0.06 + rnd() * 0.05,
    f1: 1.5 + rnd() * 1.5,
    p1: rnd() * 6.28,
    a2: 0.02 + rnd() * 0.02,
    f2: 5 + rnd() * 4,
    p2: rnd() * 6.28,
    height: 0.2 + rnd() * 0.12,
    gain: 0.75 + rnd() * 0.35,
  }))
  for (let x = 0; x < gw; x++) {
    const u = x / gw
    for (const k of curtains) {
      const yb = (k.base + k.a1 * Math.sin(u * k.f1 * 6.28 + k.p1) + k.a2 * Math.sin(u * k.f2 * 6.28 + k.p2)) * gh
      const ray = 0.35 + 0.65 * Math.pow(rays[(x * 3 + Math.round(k.p1 * 50)) % gw], 1.6)
      // Brightness along the curtain, so it does not look like a uniform band.
      const along = 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(u * 6.28 * (k.f1 * 0.7) + k.p2), 2)
      const top = k.height * gh
      for (let y = Math.max(0, Math.floor(yb - top * 1.4)); y < Math.min(gh, Math.ceil(yb + gh * 0.03)); y++) {
        let v: number
        let t: number
        if (y <= yb) {
          t = (yb - y) / top
          v = Math.exp(-t * 2.2) * Math.min(1, t * 25 + 0.2)
        } else {
          t = 0
          v = Math.exp(-(y - yb) / (gh * 0.008))
        }
        v *= ray * along * k.gain
        if (v <= 0.003) continue
        // Green at the bottom, through teal to violet at the top.
        const m = Math.min(1, t * 1.1)
        const r = 70 + (170 - 70) * m * m
        const g = 255 - (255 - 90) * m
        const b = 160 + (255 - 160) * m
        const i = (y * gw + x) * 4
        d[i] = Math.min(255, d[i] + r * v)
        d[i + 1] = Math.min(255, d[i + 1] + g * v)
        d[i + 2] = Math.min(255, d[i + 2] + b * v)
        d[i + 3] = 255
      }
    }
  }
  for (let i = 3; i < d.length; i += 4) if (!d[i]) d[i] = 255
  cc.putImageData(img, 0, 0)
  const out = createCanvas(w, h)
  const oc = ctx2d(out)
  oc.fillStyle = '#000'
  oc.fillRect(0, 0, w, h)
  oc.imageSmoothingQuality = 'high'
  oc.filter = `blur(${Math.max(1, w / 900)}px)`
  oc.drawImage(c, 0, 0, w, h)
  oc.filter = 'none'
  return out
}

export function renderSky(w: number, h: number, id: SkyId, seed: number): HTMLCanvasElement {
  const c = createCanvas(w, h)
  const ctx = ctx2d(c)
  const stops = GRADIENTS[id]
  const g = ctx.createLinearGradient(0, 0, 0, h)
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const rnd = rng(seed)
  if (id === 'clouds') ctx.drawImage(cloudLayer(w, h, seed, '#ffffff', 0.55), 0, 0)
  if (id === 'sunset' || id === 'pastel') {
    ctx.globalAlpha = 0.5
    ctx.drawImage(cloudLayer(w, h, seed, id === 'sunset' ? '#ffb38a' : '#ffffff', 0.35), 0, 0)
    ctx.globalAlpha = 1
  }
  if (id === 'storm') ctx.drawImage(cloudLayer(w, h, seed, '#23262d', 0.7), 0, 0)
  if (id === 'night' || id === 'aurora') {
    const n = Math.round((w * h) / 2500)
    for (let i = 0; i < n; i++) {
      const r = Math.pow(rnd(), 4) * Math.max(1.2, w / 900) + 0.4
      ctx.globalAlpha = 0.4 + rnd() * 0.6
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(rnd() * w, rnd() * h * 0.95, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  if (id === 'aurora') {
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.drawImage(auroraLayer(w, h, seed), 0, 0)
    ctx.restore()
  }
  return c
}
