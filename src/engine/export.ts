// Full-resolution export of edited photos.
import { normalizeParams } from './params'
import { Renderer } from './renderer'
import { orientedSize } from './transform'
import { originalFile, type Photo } from '../store/library'

export interface ExportOptions {
  format: 'jpeg' | 'png' | 'webp'
  quality: number // 1..100
  size: 'full' | 'long' | 'short'
  pixels: number
  naming: 'original' | 'suffix' | 'sequence'
  baseName: string
  background: string
  watermark: { enabled: boolean; text: string; size: number; opacity: number; position: 'br' | 'bl' | 'tr' | 'tl' | 'c'; dark: boolean }
  sharpen: { media: 'none' | 'screen' | 'matte' | 'glossy'; level: 'low' | 'standard' | 'high' }
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: 'jpeg',
  quality: 90,
  size: 'full',
  pixels: 2048,
  naming: 'original',
  baseName: 'Photo',
  background: '#ffffff',
  watermark: { enabled: false, text: '© ', size: 4, opacity: 70, position: 'br', dark: false },
  sharpen: { media: 'none', level: 'standard' },
}

/** Output sharpening (unsharp mask on luminance) for screen or print. */
export function outputSharpen(px: Uint8ClampedArray, w: number, h: number, o: ExportOptions['sharpen']) {
  if (o.media === 'none') return
  const amount = { low: 0.35, standard: 0.6, high: 0.95 }[o.level] * (o.media === 'matte' ? 1.4 : o.media === 'glossy' ? 1.15 : 1)
  // Radius grows with the output size for print (viewed from further away).
  const radius = o.media === 'screen' ? 1 : Math.max(1, Math.round(Math.max(w, h) / 2400))
  const n = w * h
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) lum[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]
  const tmp = new Float32Array(n)
  const blur = new Float32Array(n)
  const r = radius
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let c = 0
      for (let k = -r; k <= r; k++) {
        const xx = x + k
        if (xx < 0 || xx >= w) continue
        s += lum[y * w + xx]
        c++
      }
      tmp[y * w + x] = s / c
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let c = 0
      for (let k = -r; k <= r; k++) {
        const yy = y + k
        if (yy < 0 || yy >= h) continue
        s += tmp[yy * w + x]
        c++
      }
      blur[y * w + x] = s / c
    }
  for (let i = 0; i < n; i++) {
    let d = lum[i] - blur[i]
    d = (d * 24) / (Math.abs(d) + 24) // limit halos
    const add = d * amount
    px[i * 4] += add
    px[i * 4 + 1] += add
    px[i * 4 + 2] += add
  }
}

/** Draws a text watermark (size in % of the long side). */
export function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, wm: ExportOptions['watermark']) {
  if (!wm.enabled || !wm.text.trim()) return
  const px = Math.max(8, (Math.max(w, h) * wm.size) / 100)
  ctx.save()
  ctx.font = `600 ${px}px system-ui, 'Segoe UI', sans-serif`
  ctx.globalAlpha = wm.opacity / 100
  ctx.fillStyle = wm.dark ? '#000' : '#fff'
  ctx.shadowColor = wm.dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = px * 0.15
  const m = px * 0.8
  const pos = wm.position
  ctx.textAlign = pos === 'c' ? 'center' : pos.endsWith('r') ? 'right' : 'left'
  ctx.textBaseline = pos === 'c' ? 'middle' : pos.startsWith('t') ? 'top' : 'bottom'
  const x = pos === 'c' ? w / 2 : pos.endsWith('r') ? w - m : m
  const y = pos === 'c' ? h / 2 : pos.startsWith('t') ? m : h - m
  ctx.fillText(wm.text, x, y)
  ctx.restore()
}

const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' }

/** Output size for a photo with these options. */
export function outputSize(p: Photo, o: ExportOptions): [number, number] {
  const params = normalizeParams(p.params)
  const [ow, oh] = orientedSize(p.width, p.height, params.crop.rot90)
  const cw = Math.max(1, Math.round(params.crop.w * ow))
  const ch = Math.max(1, Math.round(params.crop.h * oh))
  if (o.size === 'full') return [cw, ch]
  const ref = o.size === 'long' ? Math.max(cw, ch) : Math.min(cw, ch)
  const s = Math.min(1, o.pixels / ref)
  return [Math.max(1, Math.round(cw * s)), Math.max(1, Math.round(ch * s))]
}

export function fileName(p: Photo, o: ExportOptions, index: number): string {
  const stem = p.name.replace(/\.[^.]+$/, '')
  const ext = EXT[o.format]
  if (o.naming === 'suffix') return `${stem}-edited.${ext}`
  if (o.naming === 'sequence') return `${o.baseName}-${String(index + 1).padStart(3, '0')}.${ext}`
  return `${stem}.${ext}`
}

export async function renderPhoto(p: Photo, o: ExportOptions): Promise<Blob> {
  const blob = await originalFile(p.id)
  if (!blob) throw new Error('Original file not found')
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  const r = new Renderer(canvas)
  try {
    const params = normalizeParams(p.params)
    const [w, h] = outputSize(p, o)
    // Develop at (at least) output resolution, capped by the GPU.
    const [ow, oh] = orientedSize(p.width, p.height, params.crop.rot90)
    const need = Math.max(w / (params.crop.w * ow), h / (params.crop.h * oh)) * Math.max(p.width, p.height)
    r.setImage(bmp, bmp.width, bmp.height, Math.min(Math.max(bmp.width, bmp.height), Math.ceil(need)))
    r.photoId = p.id
    r.setParams(params)
    await r.waitForRetouch()
    await r.waitForAi()
    const px = r.readPixels(w, h)
    outputSharpen(px, w, h, o.sharpen)
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')!
    if (o.format === 'jpeg') {
      // JPEG has no transparency: composite on the background color.
      const tmp = document.createElement('canvas')
      tmp.width = w
      tmp.height = h
      tmp.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0)
      ctx.fillStyle = o.background
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(tmp, 0, 0)
    } else ctx.putImageData(new ImageData(px, w, h), 0, 0)
    drawWatermark(ctx, w, h, o.watermark)
    const res = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, `image/${o.format}`, o.quality / 100))
    if (!res) throw new Error('Encoding failed')
    return res
  } finally {
    r.dispose()
    bmp.close()
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// ---------- ZIP (store only) for multi-photo export ----------

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export async function zip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const parts: BlobPart[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  const enc = new TextEncoder()
  const used = new Set<string>()
  for (const f of files) {
    let name = f.name
    for (let i = 2; used.has(name); i++) name = f.name.replace(/(\.[^.]+)$/, ` (${i})$1`)
    used.add(name)
    const data = new Uint8Array(await f.blob.arrayBuffer())
    const nameBytes = new Uint8Array(enc.encode(name))
    const crc = crc32(data)
    const localBuf = new ArrayBuffer(30)
    const local = new DataView(localBuf)
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    parts.push(localBuf, nameBytes, data)
    const cdBuf = new ArrayBuffer(46)
    const cd = new DataView(cdBuf)
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, 0x0800, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, data.length, true)
    cd.setUint32(24, data.length, true)
    cd.setUint16(28, nameBytes.length, true)
    cd.setUint32(42, offset, true)
    const entry = new Uint8Array(46 + nameBytes.length)
    entry.set(new Uint8Array(cdBuf), 0)
    entry.set(nameBytes, 46)
    central.push(entry)
    offset += 30 + nameBytes.length + data.length
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0)
  const endBuf = new ArrayBuffer(22)
  const end = new DataView(endBuf)
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, endBuf], { type: 'application/zip' })
}
