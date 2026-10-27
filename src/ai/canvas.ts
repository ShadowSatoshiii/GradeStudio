// Canvas helpers shared by all tools. Images are edited at a working
// resolution of at most MAX_SIDE pixels on the long side.

export const MAX_SIDE = 2048

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  return ctx
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height)
  ctx2d(c).drawImage(src, 0, 0)
  if (src.dataset.unit) c.dataset.unit = src.dataset.unit
  return c
}

/**
 * Cut-out of a larger image. It remembers the scale of the full image so
 * effects (blur radii etc.) look the same as when run on the whole picture.
 */
export function cropCanvas(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = createCanvas(r.w, r.h)
  ctx2d(c).drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  c.dataset.unit = src.dataset.unit ?? String(Math.max(src.width, src.height) / 1000)
  return c
}

export function scaledCopy(src: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height))
  const c = createCanvas(src.width * s, src.height * s)
  const ctx = ctx2d(c)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

export async function loadImage(blob: Blob, maxSide = MAX_SIDE): Promise<HTMLCanvasElement> {
  return (await loadImageWithSize(blob, maxSide)).canvas
}

/** Like loadImage, but also reports the size of the original file. */
export async function loadImageWithSize(blob: Blob, maxSide = MAX_SIDE) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const width = bmp.width
  const height = bmp.height
  const s = Math.min(1, maxSide / Math.max(width, height))
  const c = createCanvas(width * s, height * s)
  const ctx = ctx2d(c)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return { canvas: c, width, height }
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  // JPEG has no transparency: transparent parts would turn black, so they go on white.
  let src = c
  if (type === 'image/jpeg') {
    src = createCanvas(c.width, c.height)
    const ctx = ctx2d(src)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(c, 0, 0)
  }
  return new Promise((resolve, reject) => {
    src.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), type, quality)
  })
}

export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w, Math.ceil(r.x + r.w))
  const y1 = Math.min(h, Math.ceil(r.y + r.h))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

const filterSupported = (() => {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    return !!ctx && 'filter' in ctx
  } catch {
    return false
  }
})()

/** Gaussian-like blur. Edges are filled from the source so they do not fade out. */
export function blurCanvas(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height)
  const ctx = ctx2d(out)
  if (radius <= 0.3) {
    ctx.drawImage(src, 0, 0)
    return out
  }
  if (filterSupported) {
    ctx.drawImage(src, 0, 0)
    ctx.filter = `blur(${radius}px)`
    ctx.drawImage(src, 0, 0)
    ctx.filter = 'none'
    return out
  }
  ctx.drawImage(src, 0, 0)
  const data = ctx.getImageData(0, 0, out.width, out.height)
  boxBlur(data, Math.max(1, Math.round(radius * 0.6)))
  boxBlur(data, Math.max(1, Math.round(radius * 0.6)))
  boxBlur(data, Math.max(1, Math.round(radius * 0.6)))
  ctx.putImageData(data, 0, 0)
  return out
}

/**
 * Blur without edge fill. On a canvas with transparency this is a weighted
 * blur: the colors read back are the average of the opaque pixels nearby.
 */
export function blurPlain(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height)
  const ctx = ctx2d(out)
  if (filterSupported) {
    ctx.filter = `blur(${radius}px)`
    ctx.drawImage(src, 0, 0)
    ctx.filter = 'none'
    return out
  }
  ctx.drawImage(src, 0, 0)
  const data = ctx.getImageData(0, 0, out.width, out.height)
  const r = Math.max(1, Math.round(radius * 0.6))
  // Premultiply, box blur three times, un-premultiply.
  const d = data.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    d[i] *= a
    d[i + 1] *= a
    d[i + 2] *= a
  }
  boxBlur(data, r)
  boxBlur(data, r)
  boxBlur(data, r)
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    if (a > 0) {
      d[i] /= a
      d[i + 1] /= a
      d[i + 2] /= a
    }
  }
  ctx.putImageData(data, 0, 0)
  return out
}

function boxBlur(img: ImageData, r: number) {
  const { width: w, height: h, data } = img
  const tmp = new Float32Array(data.length)
  const div = 2 * r + 1
  for (let y = 0; y < h; y++) {
    for (let ch = 0; ch < 4; ch++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += data[(y * w + Math.min(w - 1, Math.max(0, k))) * 4 + ch]
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + ch] = acc / div
        const add = Math.min(w - 1, x + r + 1)
        const sub = Math.max(0, x - r)
        acc += data[(y * w + add) * 4 + ch] - data[(y * w + sub) * 4 + ch]
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let ch = 0; ch < 4; ch++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 4 + ch]
      for (let y = 0; y < h; y++) {
        data[(y * w + x) * 4 + ch] = acc / div
        const add = Math.min(h - 1, y + r + 1)
        const sub = Math.max(0, y - r)
        acc += tmp[(add * w + x) * 4 + ch] - tmp[(sub * w + x) * 4 + ch]
      }
    }
  }
}

/**
 * Gives the area `r` of `ctx` the transparency of `base` again, so effects
 * never make transparent parts of a PNG visible (no-op for opaque photos).
 */
export function keepAlpha(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, r: Rect = { x: 0, y: 0, w: base.width, h: base.height }) {
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
  ctx.restore()
}

export function getPixels(c: HTMLCanvasElement): ImageData {
  return ctx2d(c).getImageData(0, 0, c.width, c.height)
}

export function fromPixels(img: ImageData): HTMLCanvasElement {
  const c = createCanvas(img.width, img.height)
  ctx2d(c).putImageData(img, 0, 0)
  return c
}

/** Applies a per-pixel function (values 0..1) and returns a new canvas. */
export function mapPixels(
  src: HTMLCanvasElement,
  fn: (r: number, g: number, b: number, out: Float32Array, i: number) => void,
): HTMLCanvasElement {
  const img = getPixels(src)
  const d = img.data
  const o = new Float32Array(3)
  for (let i = 0; i < d.length; i += 4) {
    fn(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, o, i)
    d[i] = o[0] * 255
    d[i + 1] = o[1] * 255
    d[i + 2] = o[2] * 255
  }
  return fromPixels(img)
}

export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Waits for the next paint, or a short timeout when the tab is in the background (no paints). */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(go)
    setTimeout(go, 60)
  })
}
