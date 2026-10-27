import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import { blurPlain, createCanvas, ctx2d, scaledCopy } from './canvas'
import { colorFeat, fisher } from './classify'
import { modelUrl, visionRuntime, withDelegate } from './mediapipe'

// Person / hair / skin segmentation with MediaPipe "selfie multiclass".
// Class order of the model: background, hair, body skin, face skin, clothes, others.

export type SegKind = 'person' | 'background' | 'hair' | 'faceSkin' | 'bodySkin' | 'skin' | 'clothes'

const CLASSES: Record<Exclude<SegKind, 'background'>, number[]> = {
  person: [1, 2, 3, 4, 5],
  hair: [1],
  faceSkin: [3],
  bodySkin: [2],
  skin: [2, 3],
  clothes: [4, 5],
}

interface Segmentation {
  w: number
  h: number
  conf: Float32Array[]
}

let segmenter: Promise<ImageSegmenter> | null = null

function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenter) {
    segmenter = (async () => {
      const { vision, files } = await visionRuntime()
      return withDelegate((delegate) =>
        vision.ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: modelUrl('selfie_multiclass_256x256.tflite'), delegate },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        }),
      )
    })()
    segmenter.catch(() => (segmenter = null))
  }
  return segmenter
}

const cache = new WeakMap<HTMLCanvasElement, Promise<Segmentation>>()

function segment(canvas: HTMLCanvasElement): Promise<Segmentation> {
  let hit = cache.get(canvas)
  if (!hit) {
    hit = (async () => {
      const s = await getSegmenter()
      // The model works at 256 px; a small input keeps the six confidence
      // maps small too (at full size they would take hundreds of MB).
      const res = s.segment(scaledCopy(canvas, 512))
      const masks = res.confidenceMasks ?? []
      const out = { w: masks[0].width, h: masks[0].height, conf: masks.map((m) => m.getAsFloat32Array().slice()) }
      res.close()
      return out
    })()
    hit.catch(() => cache.delete(canvas))
    cache.set(canvas, hit)
  }
  return hit
}

// ---------- Guided filter (edge-aware mask refinement) ----------

export function boxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    let acc = 0
    const row = y * w
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  const n = (2 * r + 1) * (2 * r + 1)
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/** He et al. guided filter: snaps a soft mask to the edges of the guide image. */
function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = I.length
  const Ip = new Float32Array(n)
  const II = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i]
    II[i] = I[i] * I[i]
  }
  const mI = boxFilter(I, w, h, r)
  const mp = boxFilter(p, w, h, r)
  const mIp = boxFilter(Ip, w, h, r)
  const mII = boxFilter(II, w, h, r)
  const a = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i]
    const c = mIp[i] - mI[i] * mp[i]
    a[i] = c / (v + eps)
    b[i] = mp[i] - a[i] * mI[i]
  }
  const ma = boxFilter(a, w, h, r)
  const mb = boxFilter(b, w, h, r)
  const q = new Float32Array(n)
  for (let i = 0; i < n; i++) q[i] = Math.min(1, Math.max(0, ma[i] * I[i] + mb[i]))
  return q
}

/** Refines a white-on-transparent mask canvas against the image. Works at up to 1024 px. */
export function refineMask(image: HTMLCanvasElement, mask: HTMLCanvasElement, strength = 1): HTMLCanvasElement {
  const small = scaledCopy(image, 1024)
  const w = small.width
  const h = small.height
  const m = createCanvas(w, h)
  ctx2d(m).drawImage(mask, 0, 0, w, h)
  const md = ctx2d(m).getImageData(0, 0, w, h).data
  const id = ctx2d(small).getImageData(0, 0, w, h).data
  const I = new Float32Array(w * h)
  const p = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    I[i] = (0.299 * id[i * 4] + 0.587 * id[i * 4 + 1] + 0.114 * id[i * 4 + 2]) / 255
    p[i] = md[i * 4 + 3] / 255
  }
  const r = Math.max(2, Math.round((Math.max(w, h) / 1024) * 6 * strength))
  const q = guidedFilter(I, p, w, h, r, 0.0015)
  const out = ctx2d(m).createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    // Steeper curve: removes faint leaks while keeping a soft edge.
    const t = Math.min(1, Math.max(0, (q[i] - 0.18) / 0.64))
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255
    out.data[i * 4 + 3] = t * t * (3 - 2 * t) * 255
  }
  ctx2d(m).putImageData(out, 0, 0)
  const full = createCanvas(image.width, image.height)
  const fc = ctx2d(full)
  fc.imageSmoothingQuality = 'high'
  fc.drawImage(m, 0, 0, image.width, image.height)
  return full
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Canvas with the image colors and `weight` (0..1 per pixel) as alpha. */
function weighted(img: Uint8ClampedArray, weight: Float32Array, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(w, h)
  const ctx = ctx2d(c)
  const out = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    out.data[i * 4] = img[i * 4]
    out.data[i * 4 + 1] = img[i * 4 + 1]
    out.data[i * 4 + 2] = img[i * 4 + 2]
    out.data[i * 4 + 3] = weight[i] * 255
  }
  ctx.putImageData(out, 0, 0)
  return c
}

/**
 * Snaps a coarse mask to the real edge using colors: near the edge every pixel
 * is compared with the colors of sure inside and sure outside pixels close to
 * it, and gets the share of "inside" that its color says (a two-color
 * matting estimate). This separates single hair strands from skin or wall,
 * and the gaps in fringes or between branches. Where inside and outside have
 * similar colors the coarse mask is kept.
 */
export function colorMatte(image: HTMLCanvasElement, prior: HTMLCanvasElement, opts: { holes?: boolean; maxSide?: number } = {}): HTMLCanvasElement {
  const maxSide = opts.maxSide ?? 2560
  const s = Math.min(1, maxSide / Math.max(image.width, image.height))
  const w = Math.max(1, Math.round(image.width * s))
  const h = Math.max(1, Math.round(image.height * s))
  const ic = createCanvas(w, h)
  const icx = ctx2d(ic)
  icx.imageSmoothingQuality = 'high'
  icx.drawImage(image, 0, 0, w, h)
  const I = icx.getImageData(0, 0, w, h).data
  const pc = createCanvas(w, h)
  const pcx = ctx2d(pc)
  pcx.imageSmoothingQuality = 'high'
  pcx.drawImage(prior, 0, 0, w, h)
  const pd = pcx.getImageData(0, 0, w, h).data
  const n = w * h
  const P = new Float32Array(n)
  const wf = new Float32Array(n)
  const wb = new Float32Array(n)
  const unsure = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = pd[i * 4 + 3] / 255
    P[i] = p
    // Transparent pixels of a PNG have no color: they count for neither side.
    const own = I[i * 4 + 3] / 255
    wf[i] = smooth(0.9, 0.99, p) * own
    wb[i] = (1 - smooth(0.01, 0.1, p)) * own
    unsure[i] = p > 0.02 && p < 0.98 ? 1 : 0
  }
  const side = Math.max(w, h)
  const s1 = side * 0.01
  const s2 = side * 0.04
  const fgC = weighted(I, wf, w, h)
  const bgC = weighted(I, wb, w, h)
  const F1 = ctx2d(blurPlain(fgC, s1)).getImageData(0, 0, w, h).data
  const F2 = ctx2d(blurPlain(fgC, s2)).getImageData(0, 0, w, h).data
  const B1 = ctx2d(blurPlain(bgC, s1)).getImageData(0, 0, w, h).data
  const B2 = ctx2d(blurPlain(bgC, s2)).getImageData(0, 0, w, h).data
  // The inside often has two very different colors (dark hair and light
  // skin, a dark jacket and a white shirt): its darker and lighter parts are
  // averaged separately, and each pixel is compared with the closest one.
  const wd = new Float32Array(n)
  const wl = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const l = (0.299 * I[i * 4] + 0.587 * I[i * 4 + 1] + 0.114 * I[i * 4 + 2]) / 255
    wd[i] = wf[i] * (1 - l) ** 3
    wl[i] = wf[i] * l ** 3
  }
  const FD = ctx2d(blurPlain(weighted(I, wd, w, h), s1)).getImageData(0, 0, w, h).data
  const FL = ctx2d(blurPlain(weighted(I, wl, w, h), s1)).getImageData(0, 0, w, h).data
  // The band where the color decides: the unsure zone, widened a little.
  const bandC = weighted(I, unsure, w, h)
  const band = ctx2d(blurPlain(bandC, s1)).getImageData(0, 0, w, h).data
  const out = icx.createImageData(w, h)
  const o = out.data
  const cand = new Float32Array(9)
  for (let i = 0; i < n; i++) {
    const j = i * 4
    let a = P[i]
    const bw = smooth(0.01, 0.08, band[j + 3] / 255)
    if (bw > 0.001) {
      const kf = smooth(0.03, 0.15, F1[j + 3] / 255)
      const kb = smooth(0.03, 0.15, B1[j + 3] / 255)
      cand[0] = F2[j] + (F1[j] - F2[j]) * kf
      cand[1] = F2[j + 1] + (F1[j + 1] - F2[j + 1]) * kf
      cand[2] = F2[j + 2] + (F1[j + 2] - F2[j + 2]) * kf
      let nc = 3
      for (const X of [FD, FL]) {
        if (X[j + 3] < 8) continue
        cand[nc] = X[j]
        cand[nc + 1] = X[j + 1]
        cand[nc + 2] = X[j + 2]
        nc += 3
      }
      // Foreground color closest to this pixel.
      let best = 0
      let bestD = Infinity
      for (let k = 0; k < nc; k += 3) {
        const e0 = I[j] - cand[k]
        const e1 = I[j + 1] - cand[k + 1]
        const e2 = I[j + 2] - cand[k + 2]
        const dk = e0 * e0 + e1 * e1 + e2 * e2
        if (dk < bestD) {
          bestD = dk
          best = k
        }
      }
      const fr = cand[best]
      const fg = cand[best + 1]
      const fb = cand[best + 2]
      const br = B2[j] + (B1[j] - B2[j]) * kb
      const bg = B2[j + 1] + (B1[j + 1] - B2[j + 1]) * kb
      const bb = B2[j + 2] + (B1[j + 2] - B2[j + 2]) * kb
      const dr = (fr - br) / 255
      const dg = (fg - bg) / 255
      const db = (fb - bb) / 255
      const dd = dr * dr + dg * dg + db * db
      const proj = (((I[j] - br) / 255) * dr + ((I[j + 1] - bg) / 255) * dg + ((I[j + 2] - bb) / 255) * db) / (dd + 1e-4)
      const alpha = Math.min(1, Math.max(0, proj))
      // How well the pixel is explained as a mix of the two colors. Shine on
      // hair or leaves is brighter than both and is not a mix: keep the mask there.
      const er = I[j] / 255 - (br / 255 + alpha * dr)
      const eg = I[j + 1] / 255 - (bg / 255 + alpha * dg)
      const eb = I[j + 2] / 255 - (bb / 255 + alpha * db)
      const fit = 1 - smooth(0.1, 0.22, Math.sqrt(er * er + eg * eg + eb * eb))
      // Trust the colors only when inside and outside really differ and both were seen nearby.
      const have = smooth(0.005, 0.05, F2[j + 3] / 255) * smooth(0.005, 0.05, B2[j + 3] / 255)
      const c = smooth(0.006, 0.04, dd) * have * bw * fit
      // Colors may take away freely, but only add near the coarse edge: dark
      // eyes or brows next to dark hair must not become hair.
      const cap = a + 0.7 * smooth(0.08, 0.45, a)
      // Where the colors cannot tell (dark hair on a dark wall), a narrower
      // edge looks cleaner than a wide smoky fade.
      const tight = smooth(0.3, 0.7, a)
      a = tight + (Math.min(alpha, cap) - tight) * c
    }
    if (opts.holes && a < 0.9 && F1[j + 3] > 20) {
      // Small openings that the coarse mask missed (sky between leaves):
      // pixels close to the inside that have its color and not the outside's.
      // Only near the inside, so e.g. snow deep in a tree is not taken for sky.
      const kf = smooth(0.03, 0.15, F1[j + 3] / 255)
      const kb = smooth(0.03, 0.15, B1[j + 3] / 255)
      const e0 = (I[j] - (F2[j] + (F1[j] - F2[j]) * kf)) / 255
      const e1 = (I[j + 1] - (F2[j + 1] + (F1[j + 1] - F2[j + 1]) * kf)) / 255
      const e2 = (I[j + 2] - (F2[j + 2] + (F1[j + 2] - F2[j + 2]) * kf)) / 255
      const g0 = (I[j] - (B2[j] + (B1[j] - B2[j]) * kb)) / 255
      const g1 = (I[j + 1] - (B2[j + 1] + (B1[j + 1] - B2[j + 1]) * kb)) / 255
      const g2 = (I[j + 2] - (B2[j + 2] + (B1[j + 2] - B2[j + 2]) * kb)) / 255
      let dF = Math.sqrt(e0 * e0 + e1 * e1 + e2 * e2)
      // The inside may have lighter and darker parts (white clouds in a blue
      // sky): the closest of them counts.
      for (const X of [FD, FL]) {
        if (X[j + 3] < 8) continue
        const x0 = (I[j] - X[j]) / 255
        const x1 = (I[j + 1] - X[j + 1]) / 255
        const x2 = (I[j + 2] - X[j + 2]) / 255
        dF = Math.min(dF, Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2))
      }
      const dB = Math.sqrt(g0 * g0 + g1 * g1 + g2 * g2)
      const near = smooth(20, 90, F1[j + 3])
      const hole = (1 - smooth(0.04, 0.1, dF)) * smooth(0.12, 0.25, dB - dF) * near
      a = Math.max(a, hole)
    }
    o[j] = o[j + 1] = o[j + 2] = 255
    o[j + 3] = a * 255
  }
  // Single specks (a dark leaf taken for hair, a light spot for sky) are
  // removed with a 3×3 median near the edge; strands of 2 px and more stay.
  const src = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) src[i] = o[i * 4 + 3]
  const win = new Uint8ClampedArray(9)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (band[i * 4 + 3] < 3) continue
      let k = 0
      for (let dy = -w; dy <= w; dy += w) for (let dx = -1; dx <= 1; dx++) win[k++] = src[i + dy + dx]
      win.sort()
      o[i * 4 + 3] = win[4]
    }
  icx.putImageData(out, 0, 0)
  if (s === 1) return ic
  const full = createCanvas(image.width, image.height)
  const fc = ctx2d(full)
  fc.imageSmoothingQuality = 'high'
  fc.drawImage(ic, 0, 0, image.width, image.height)
  return full
}

/**
 * Colors of the cut-out without the old background mixed in. Edge pixels are
 * a blend of foreground and the old background (`I = a·F + (1−a)·B`); with B
 * taken from sure background pixels nearby, F is solved for, so hair and
 * edges on a new background show no dark or colored fringe.
 */
export function foregroundColors(image: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const W = image.width
  const H = image.height
  const I = ctx2d(image).getImageData(0, 0, W, H)
  const A = ctx2d(mask).getImageData(0, 0, W, H).data
  // Averages are smooth, so they are computed small and scaled up.
  const s = Math.min(1, 1024 / Math.max(W, H))
  const w = Math.max(1, Math.round(W * s))
  const h = Math.max(1, Math.round(H * s))
  const small = createCanvas(w, h)
  const sc = ctx2d(small)
  sc.imageSmoothingQuality = 'high'
  sc.drawImage(image, 0, 0, w, h)
  const si = sc.getImageData(0, 0, w, h).data
  const sm = createCanvas(w, h)
  const smc = ctx2d(sm)
  smc.imageSmoothingQuality = 'high'
  smc.drawImage(mask, 0, 0, w, h)
  const sa = smc.getImageData(0, 0, w, h).data
  const wb = new Float32Array(w * h)
  const wf = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = sa[i * 4 + 3] / 255
    // Transparent pixels of a PNG have no color: they count for neither side.
    const own = si[i * 4 + 3] / 255
    wb[i] = (1 - a) ** 4 * own
    wf[i] = a ** 4 * own
  }
  const up = (c: HTMLCanvasElement) => {
    const f = createCanvas(W, H)
    const fc = ctx2d(f)
    fc.imageSmoothingQuality = 'high'
    fc.drawImage(c, 0, 0, W, H)
    return fc.getImageData(0, 0, W, H).data
  }
  const bgW = weighted(si, wb, w, h)
  const fgW = weighted(si, wf, w, h)
  const B1 = up(blurPlain(bgW, Math.max(1, w * 0.006)))
  const B2 = up(blurPlain(bgW, Math.max(1, w * 0.03)))
  const F1 = up(blurPlain(fgW, Math.max(1, w * 0.006)))
  const d = I.data
  for (let i = 0; i < d.length; i += 4) {
    const m = A[i + 3] / 255
    if (m <= 0.004 || m >= 0.996 || d[i + 3] === 0) continue
    const kb = smooth(0.02, 0.2, B1[i + 3] / 255)
    const b0 = B2[i] + (B1[i] - B2[i]) * kb
    const b1 = B2[i + 1] + (B1[i + 1] - B2[i + 1]) * kb
    const b2 = B2[i + 2] + (B1[i + 2] - B2[i + 2]) * kb
    // A pixel that looks like the foreground is treated as (almost) fully
    // foreground, even if the mask is unsure there: otherwise the solve
    // below would push it towards white.
    const fa = F1[i + 3] / 255
    let a = m
    if (fa > 0.02) {
      const dr = F1[i] - b0
      const dg = F1[i + 1] - b1
      const db = F1[i + 2] - b2
      const dd = dr * dr + dg * dg + db * db
      const proj = ((d[i] - b0) * dr + (d[i + 1] - b1) * dg + (d[i + 2] - b2) * db) / (dd + 1)
      const conf = smooth(400, 2500, dd)
      a = Math.max(m, Math.min(1, Math.max(0, proj)) * conf)
    }
    // Very faint pixels: the solve gets noisy, lean on the nearby foreground color.
    const k = Math.max(smooth(0.12, 0.55, a), 1 - smooth(0.02, 0.2, fa))
    const solve = (v: number, b: number, f: number) => {
      const raw = Math.min(255, Math.max(0, (v - (1 - a) * b) / a))
      return f + (raw - f) * k
    }
    d[i] = solve(d[i], b0, F1[i])
    d[i + 1] = solve(d[i + 1], b1, F1[i + 1])
    d[i + 2] = solve(d[i + 2], b2, F1[i + 2])
  }
  const out = createCanvas(W, H)
  ctx2d(out).putImageData(I, 0, 0)
  return out
}

/** Hair mask split by color into hair and skin, with the colors around each pixel. */
export interface HairSplit {
  /** The hair mask, where the colors are sure: the share of hair in each pixel. */
  matte: HTMLCanvasElement
  /**
   * R = share of hair by color, G = how sure the colors are (0 = plain mask),
   * B = the share of hair the matte takes from the colors (R, limited near the mask).
   */
  mix: HTMLCanvasElement
  /** Local hair color. */
  hair: HTMLCanvasElement
  /** Local skin color. */
  skin: HTMLCanvasElement
}

/**
 * Skin often shows through inside the hair mask: a parting, a receding or
 * sparse hairline, fine baby hairs over the forehead. Each of these pixels is
 * a mix of hair and skin, and only its hair part should take a new hair
 * color. The mix is estimated from the colors: the local hair color (learned
 * per photo against the face skin) and the local skin color. Only where the
 * hair is clearly darker than the skin, so light blond hair next to similar
 * skin keeps the plain mask. Hair is added only in a very narrow band at the
 * hairline, so shadows on the skin next to the hair stay skin.
 */
export async function hairSplit(image: HTMLCanvasElement, hairMask: HTMLCanvasElement): Promise<HairSplit | null> {
  const skinMask = await segmentMask(image, 'faceSkin', false)
  // The model's own unsure hair (thin hair over the scalp, which the edge
  // refinement drops) may be added where the colors agree.
  const rawHair = await segmentMask(image, 'hair', false)
  const s = Math.min(1, 2048 / Math.max(image.width, image.height))
  const w = Math.max(1, Math.round(image.width * s))
  const h = Math.max(1, Math.round(image.height * s))
  const read = (c: HTMLCanvasElement) => {
    const t = createCanvas(w, h)
    const x = ctx2d(t)
    x.imageSmoothingQuality = 'high'
    x.drawImage(c, 0, 0, w, h)
    return x.getImageData(0, 0, w, h).data
  }
  const I = read(image)
  const Hm = read(hairMask)
  const Sm = read(skinMask)
  const Rm = read(rawHair)
  const n = w * h
  const isSkin = (j: number) => Sm[j + 3] > 200 && Hm[j + 3] < 10 && I[j + 3] > 250
  const isHair = (j: number) => Hm[j + 3] > 230 && I[j + 3] > 250
  const step = Math.max(1, Math.round(Math.sqrt(n / 60000)))
  const A: number[][] = []
  const B: number[][] = []
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const j = (y * w + x) * 4
      if (isSkin(j)) A.push(colorFeat(I, j))
      else if (isHair(j)) B.push(colorFeat(I, j))
    }
  const f = fisher(A, B)
  if (!f) return null
  const trust = smooth(1.5, 3, f.separation)
  if (trust < 0.01) return null
  // Hair samples: sure hair pixels weighted by how hair-like their color is,
  // so skin seen through the hair does not count as hair color.
  const wf = new Float32Array(n)
  const ws = new Float32Array(n)
  let sr = 0
  let sg = 0
  let sb = 0
  let sn = 0
  for (let i = 0; i < n; i++) {
    const j = i * 4
    if (isHair(j)) wf[i] = smooth(0.4, 0.9, f.score(colorFeat(I, j)))
    else if (isSkin(j)) {
      ws[i] = 1
      sr += I[j]
      sg += I[j + 1]
      sb += I[j + 2]
      sn++
    }
  }
  if (!sn) return null
  sr /= sn
  sg /= sn
  sb /= sn
  const side = Math.max(w, h)
  const F1 = ctx2d(blurPlain(weighted(I, wf, w, h), side * 0.015)).getImageData(0, 0, w, h).data
  const F2 = ctx2d(blurPlain(weighted(I, wf, w, h), side * 0.06)).getImageData(0, 0, w, h).data
  const S1 = ctx2d(blurPlain(weighted(I, ws, w, h), side * 0.06)).getImageData(0, 0, w, h).data
  // The mask edge often stops a few pixels short of where hair turns into
  // skin; those pixels (half hair, half skin) would stay dark between the
  // new hair and the skin. A very narrow band where hair meets face skin
  // (not the background) may take hair by color, fading out with distance.
  const hm = new Float32Array(n)
  for (let i = 0; i < n; i++) hm[i] = Hm[i * 4 + 3] / 255
  const reach = Math.max(1, Math.round(side * 0.003))
  const nearHair = boxFilter(hm, w, h, reach)
  const nearSkin = boxFilter(ws, w, h, reach)
  // The model's unsure hair is used only above and around the face (thin
  // hair over the scalp), not at the outer edge against the background.
  const aroundFace = boxFilter(ws, w, h, Math.max(1, Math.round(side * 0.03)))
  const matteC = createCanvas(w, h)
  const mixC = createCanvas(w, h)
  const hairC = createCanvas(w, h)
  const skinC = createCanvas(w, h)
  const mo = ctx2d(matteC).createImageData(w, h)
  const xo = ctx2d(mixC).createImageData(w, h)
  const ho = ctx2d(hairC).createImageData(w, h)
  const ko = ctx2d(skinC).createImageData(w, h)
  for (let i = 0; i < n; i++) {
    const j = i * 4
    const kf = smooth(0.03, 0.15, F1[j + 3] / 255)
    const fr = F2[j] + (F1[j] - F2[j]) * kf
    const fg = F2[j + 1] + (F1[j + 1] - F2[j + 1]) * kf
    const fb = F2[j + 2] + (F1[j + 2] - F2[j + 2]) * kf
    const ks = smooth(0.02, 0.1, S1[j + 3] / 255)
    const br = sr + (S1[j] - sr) * ks
    const bg = sg + (S1[j + 1] - sg) * ks
    const bb = sb + (S1[j + 2] - sb) * ks
    const m = hm[i]
    const unsure = smooth(0.15, 0.4, Rm[j + 3] / 255) * smooth(0, 0.05, aroundFace[i])
    const near = Math.max(smooth(0, 0.5, nearHair[i]) * smooth(0, 0.3, nearSkin[i]), unsure)
    let matte = m
    let alpha = 1
    let added = 1
    let c = 0
    if (m > 0 || near > 0) {
      const dr = (fr - br) / 255
      const dg = (fg - bg) / 255
      const db = (fb - bb) / 255
      const dd = dr * dr + dg * dg + db * db
      const proj = (((I[j] - br) / 255) * dr + ((I[j + 1] - bg) / 255) * dg + ((I[j + 2] - bb) / 255) * db) / (dd + 1e-4)
      alpha = Math.min(1, Math.max(0, proj))
      // Shine on hair is not a mix of hair and skin: keep it hair.
      const er = I[j] / 255 - (br / 255 + alpha * dr)
      const eg = I[j + 1] / 255 - (bg / 255 + alpha * dg)
      const eb = I[j + 2] / 255 - (bb / 255 + alpha * db)
      const fit = 1 - smooth(0.1, 0.22, Math.sqrt(er * er + eg * eg + eb * eb))
      const darker = (0.299 * (br - fr) + 0.587 * (bg - fg) + 0.114 * (bb - fb)) / 255
      c = smooth(0.01, 0.05, dd) * smooth(0.12, 0.25, darker) * smooth(0.005, 0.05, F2[j + 3] / 255) * fit * trust
      // The colors may take skin out anywhere, but add hair only at the mask
      // edge or where the model still saw some hair: elsewhere a shadow on
      // the cheek has the same dark color as hair. There the color share
      // replaces the soft mask: a half-set mask over a half-hair pixel would
      // leave a dark seam between hair and skin.
      const cap = Math.max(m + smooth(0.02, 0.3, m), near)
      added = Math.min(alpha, cap)
      matte = m + (added - m) * c
    }
    mo.data[j] = mo.data[j + 1] = mo.data[j + 2] = 255
    mo.data[j + 3] = matte * 255
    xo.data[j] = alpha * 255
    xo.data[j + 1] = c * 255
    xo.data[j + 2] = added * 255
    xo.data[j + 3] = 255
    ho.data[j] = fr
    ho.data[j + 1] = fg
    ho.data[j + 2] = fb
    ho.data[j + 3] = 255
    ko.data[j] = br
    ko.data[j + 1] = bg
    ko.data[j + 2] = bb
    ko.data[j + 3] = 255
  }
  const full = (c: HTMLCanvasElement, data: ImageData) => {
    ctx2d(c).putImageData(data, 0, 0)
    const out = createCanvas(image.width, image.height)
    const x = ctx2d(out)
    x.imageSmoothingQuality = 'high'
    x.drawImage(c, 0, 0, image.width, image.height)
    return out
  }
  return { matte: full(matteC, mo), mix: full(mixC, xo), hair: full(hairC, ho), skin: full(skinC, ko) }
}

/** Soft mask (white = selected) for a segmentation class at image size. */
export async function segmentMask(image: HTMLCanvasElement, kind: SegKind, refine = true): Promise<HTMLCanvasElement> {
  const seg = await segment(image)
  const idx = kind === 'background' ? CLASSES.person : CLASSES[kind]
  const small = createCanvas(seg.w, seg.h)
  const sc = ctx2d(small)
  const img = sc.createImageData(seg.w, seg.h)
  for (let i = 0; i < seg.w * seg.h; i++) {
    let v = 0
    for (const c of idx) v += seg.conf[c][i]
    if (kind === 'background') v = 1 - v
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = Math.min(1, Math.max(0, v)) * 255
  }
  sc.putImageData(img, 0, 0)
  const up = createCanvas(image.width, image.height)
  const uc = ctx2d(up)
  uc.imageSmoothingQuality = 'high'
  uc.drawImage(small, 0, 0, image.width, image.height)
  if (!refine) return up
  const soft = refineMask(image, up)
  // Hair and the person outline get the color-based edge as well (strands,
  // gaps); skin and clothes keep the smooth edge.
  return kind === 'hair' || kind === 'person' || kind === 'background' ? colorMatte(image, soft) : soft
}

/** Preloads the model so the first use feels quick. */
export function warmUpSegmenter() {
  getSegmenter().catch(() => undefined)
}
