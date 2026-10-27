// AI selections (subject, background, sky, people and parts) computed locally and cached per photo.
import type { AiKey, MaskSource } from '../engine/masks'
import { refineMask, segmentMask, type SegKind } from './segment'
import { detectSky } from './sky'

interface Entry {
  w: number
  h: number
  data: Float32Array
}

const cache = new Map<string, Entry>()
const pending = new Map<string, Promise<Entry | null>>()
const listeners = new Set<() => void>()

export function onAiMaskReady(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function aiMask(photoId: string, key: AiKey, w: number, h: number): Float32Array | undefined {
  const e = cache.get(`${photoId}:${key}`)
  return e && e.w === w && e.h === h ? e.data : undefined
}

export function isComputing(photoId: string, key: AiKey) {
  return pending.has(`${photoId}:${key}`)
}

function alphaOf(c: HTMLCanvasElement, w: number, h: number): Float32Array {
  const t = document.createElement('canvas')
  t.width = w
  t.height = h
  const ctx = t.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(c, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] / 255
  return out
}

/** Salient foreground without people: color contrast to the border, center weighted. */
function saliency(src: MaskSource): HTMLCanvasElement {
  const { w, h, lab } = src
  // Border color model: mean of the outer 6 % ring.
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.06))
  let n = 0
  const mean = [0, 0, 0]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x >= ring && y >= ring && x < w - ring && y < h - ring) continue
      const i = (y * w + x) * 3
      mean[0] += lab[i]
      mean[1] += lab[i + 1]
      mean[2] += lab[i + 2]
      n++
    }
  for (let k = 0; k < 3; k++) mean[k] /= n
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const d = Math.hypot((lab[i * 3] - mean[0]) * 0.7, lab[i * 3 + 1] - mean[1], lab[i * 3 + 2] - mean[2])
      const cx = (x / w - 0.5) * 2
      const cy = (y / h - 0.5) * 2
      const center = Math.max(0, 1 - (cx * cx + cy * cy) * 0.55)
      const v = Math.min(1, Math.max(0, (d - 0.06) / 0.12)) * center
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255
      img.data[i * 4 + 3] = v * 255
    }
  ctx.putImageData(img, 0, 0)
  return c
}

async function compute(src: MaskSource, key: AiKey): Promise<Entry | null> {
  const { canvas, w, h } = src
  if (key === 'sky') {
    const s = await detectSky(canvas)
    return { w, h, data: s ? alphaOf(s.mask, w, h) : new Float32Array(w * h) }
  }
  if (key === 'subject') {
    const person = alphaOf(await segmentMask(canvas, 'person'), w, h)
    let sum = 0
    for (let i = 0; i < person.length; i++) sum += person[i]
    // No person: fall back to a salient object in the middle.
    if (sum / person.length > 0.02) return { w, h, data: person }
    return { w, h, data: alphaOf(refineMask(canvas, saliency(src)), w, h) }
  }
  const kind: SegKind = key === 'person' ? 'person' : key === 'background' ? 'background' : key
  return { w, h, data: alphaOf(await segmentMask(canvas, kind), w, h) }
}

/** Starts (or joins) the computation of an AI mask; listeners fire when it is ready. */
export function requestAiMask(photoId: string, key: AiKey, src: MaskSource): Promise<Entry | null> {
  const k = `${photoId}:${key}`
  const hit = cache.get(k)
  if (hit && hit.w === src.w && hit.h === src.h) return Promise.resolve(hit)
  const p = pending.get(k)
  if (p) return p
  const job = compute(src, key)
    .then((e) => {
      if (e) cache.set(k, e)
      return e
    })
    .catch((err) => {
      console.warn('AI mask failed', key, err)
      return null
    })
    .finally(() => {
      pending.delete(k)
      for (const l of listeners) l()
    })
  pending.set(k, job)
  for (const l of listeners) l()
  return job
}
