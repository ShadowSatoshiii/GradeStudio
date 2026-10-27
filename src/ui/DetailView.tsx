import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { setEditorSmall } from '../actions'
import { defaultParams, type Params } from '../engine/params'
import { Renderer, type Histogram } from '../engine/renderer'
import * as T from '../engine/transform'
import { editor, editPhoto } from '../store/editor'
import { lib, originalFile } from '../store/library'
import { createStore } from '../store/store'
import { ui } from '../store/ui'
import { capture } from './Menu'

export const PREVIEW_SIDE = 3072

export const histStore = createStore<{ h: Histogram | null }>({ h: null })

/** Shared view state of the editor canvas, for tool overlays (crop, masks, spots). */
export interface ViewInfo {
  renderer: Renderer
  params: Params
  /** CSS pixel size of the canvas. */
  width: number
  height: number
  /** canvas CSS px → frame O */
  toFrame: T.Mat3
  /** frame O → canvas CSS px */
  fromFrame: T.Mat3
  redraw: () => void
}

interface ViewState {
  zoom: 'fit' | 'fill' | number
  cx: number
  cy: number
}

export interface DetailProps {
  id: string
  /** Show the unedited original (left side of before/after). */
  before?: boolean
  /** Whole straightening frame instead of the crop (crop tool). */
  frameMode?: boolean
  /** Overlay drawn above the canvas, receives the view info. */
  overlay?: (v: ViewInfo) => ReactNode
  /** Disable click-to-zoom and dragging (a tool handles the pointer). */
  passive?: boolean
  label?: string
  /** Mask layer to tint red (-1 or undefined = none). */
  overlayMask?: number
}

const PAD = 18

export function DetailView({ id, before = false, frameMode = false, overlay, passive = false, label, overlayMask = -1 }: DetailProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rRef = useRef<Renderer | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<ViewState>({ zoom: 'fit', cx: 0, cy: 0 })
  const photo = lib.use((s) => s.photos[id])
  const edParams = editor.use((s) => (s.photoId === id ? (s.preview ?? s.params) : null))
  const showOriginal = ui.use((s) => s.showOriginal)
  const clip = ui.use((s) => s.clip)
  const uiZoom = ui.use((s) => s.zoom)
  const [, setTick] = useState(0)

  const params: Params = before || (showOriginal && !frameMode) ? defaultParams() : (edParams ?? photo?.params ?? defaultParams())
  // Original view keeps the photo's orientation so before/after line up.
  const shown: Params = before || showOriginal ? { ...params, crop: (edParams ?? photo?.params ?? defaultParams()).crop } : params

  useLayoutEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    try {
      rRef.current = new Renderer(canvasRef.current!)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
    return () => {
      rRef.current?.dispose()
      rRef.current = null
    }
  }, [])

  // Load the original when the photo changes.
  useEffect(() => {
    const r = rRef.current
    if (!r || !photo) return
    let alive = true
    setLoaded(null)
    if (!before && editor.get().photoId !== id) editPhoto(photo)
    void (async () => {
      const blob = await originalFile(id)
      if (!blob || !alive) return
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      if (!alive) {
        bmp.close()
        return
      }
      r.photoId = id
      r.onAsync = () => setTick((t) => t + 1)
      r.setImage(bmp, bmp.width, bmp.height, PREVIEW_SIDE)
      bmp.close()
      if (!before && r.info) setEditorSmall(id, r.info.small)
      setView({ zoom: 'fit', cx: 0, cy: 0 })
      setLoaded(id)
    })().catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [id, before])

  // Bottom bar zoom buttons (numeric zoom = device pixels per image pixel).
  useEffect(() => {
    if (before) return
    setView((v) => {
      const r = rRef.current
      if (!r?.hasImage) return v
      if (uiZoom === 'fit' || uiZoom === 'fill') return { zoom: uiZoom, cx: 0, cy: 0 }
      const [ow, oh] = r.orientedSize(shown)
      const keep = typeof v.zoom === 'number'
      return { zoom: uiZoom, cx: keep ? v.cx : (shown.crop.w * ow) / 2, cy: keep ? v.cy : (shown.crop.h * oh) / 2 }
    })
  }, [uiZoom])

  const info = useRef<ViewInfo | null>(null)
  const busyRef = useRef(false)

  // Draw.
  const histTimer = useRef(0)
  useEffect(() => {
    const r = rRef.current
    const c = canvasRef.current
    if (!r || !c || loaded !== id || !size.w) return
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(size.w * dpr)
    const H = Math.round(size.h * dpr)
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    r.setParams(shown)
    r.overlay = before ? -1 : overlayMask
    const [ow, oh] = r.orientedSize(shown)
    let m: T.Mat3
    let z: number
    if (frameMode) {
      // Whole rotated image plus margin, centered.
      const a = (Math.abs(shown.crop.angle) * Math.PI) / 180
      const bw = ow * Math.cos(a) + oh * Math.sin(a)
      const bh = ow * Math.sin(a) + oh * Math.cos(a)
      z = Math.min((size.w - 70) / bw, (size.h - 70) / bh)
      m = T.mul(T.scale(1 / ow, 1 / oh), T.mul(T.translate(ow / 2, oh / 2), T.mul(T.scale(1 / z, 1 / z), T.translate(-size.w / 2, -size.h / 2))))
    } else {
      const cw = shown.crop.w * ow
      const ch = shown.crop.h * oh
      const fit = Math.min((size.w - PAD * 2) / cw, (size.h - PAD * 2) / ch)
      const fill = Math.max(size.w / cw, size.h / ch)
      z = view.zoom === 'fit' ? fit : view.zoom === 'fill' ? fill : view.zoom / dpr
      let cx = view.zoom === 'fit' || view.zoom === 'fill' ? cw / 2 : view.cx
      let cy = view.zoom === 'fit' || view.zoom === 'fill' ? ch / 2 : view.cy
      const hw = size.w / 2 / z
      const hh = size.h / 2 / z
      cx = cw * z <= size.w ? cw / 2 : Math.min(cw - hw, Math.max(hw, cx))
      cy = ch * z <= size.h ? ch / 2 : Math.min(ch - hh, Math.max(hh, cy))
      m = T.mul(T.mul(T.translate(shown.crop.x, shown.crop.y), T.scale(1 / ow, 1 / oh)), T.mul(T.translate(cx, cy), T.mul(T.scale(1 / z, 1 / z), T.translate(-size.w / 2, -size.h / 2))))
    }
    const toCanvas = T.mul(m, T.scale(1 / dpr, 1 / dpr))
    r.render({ width: W, height: H, viewToO: toCanvas, cropMode: frameMode, clip: clip && !before, bg: [0.106, 0.106, 0.106] })
    if (r.retouching !== busyRef.current) {
      busyRef.current = r.retouching
      setTimeout(() => setTick((t) => t + 1), 0)
    }
    info.current = { renderer: r, params: shown, width: size.w, height: size.h, toFrame: m, fromFrame: T.inv(m), redraw: () => setTick((t) => t + 1) }
    if (!before) {
      clearTimeout(histTimer.current)
      histTimer.current = window.setTimeout(() => histStore.set({ h: r.histogram() }), 90)
    }
  })

  // Pointer: click toggles fit/100 %, drag pans when zoomed.
  const onPointerDown = (e: React.PointerEvent) => {
    if (passive || frameMode || e.button !== 0 || !info.current) return
    const r = rRef.current!
    const el = e.currentTarget as HTMLElement
    capture(el, e.pointerId)
    const start = { x: e.clientX, y: e.clientY }
    const v0 = view
    let moved = false
    const [ow, oh] = r.orientedSize(shown)
    const cw = shown.crop.w * ow
    const ch = shown.crop.h * oh
    const fit = Math.min((size.w - PAD * 2) / cw, (size.h - PAD * 2) / ch)
    const dpr = window.devicePixelRatio || 1
    const zNow = v0.zoom === 'fit' ? fit : v0.zoom === 'fill' ? Math.max(size.w / cw, size.h / ch) : v0.zoom / dpr
    const c0x = v0.zoom === 'fit' || v0.zoom === 'fill' ? cw / 2 : v0.cx
    const c0y = v0.zoom === 'fit' || v0.zoom === 'fill' ? ch / 2 : v0.cy
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!moved && Math.hypot(dx, dy) > 3) moved = true
      if (moved && typeof v0.zoom === 'number') setView({ zoom: v0.zoom, cx: c0x - dx / zNow, cy: c0y - dy / zNow })
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      if (moved) return
      if (typeof v0.zoom === 'number') {
        setView({ zoom: 'fit', cx: 0, cy: 0 })
        ui.set({ zoom: 'fit' })
      } else {
        // Zoom to 100 % at the clicked point.
        const rect = el.getBoundingClientRect()
        const px = ev.clientX - rect.left
        const py = ev.clientY - rect.top
        const ix = c0x + (px - size.w / 2) / zNow
        const iy = c0y + (py - size.h / 2) / zNow
        const z = 1 / dpr
        setView({ zoom: 1, cx: ix - (px - size.w / 2) / z, cy: iy - (py - size.h / 2) / z })
        ui.set({ zoom: 1 })
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const onWheel = (e: React.WheelEvent) => {
    if (frameMode || !info.current) return
    const r = rRef.current!
    const [ow, oh] = r.orientedSize(shown)
    const cw = shown.crop.w * ow
    const ch = shown.crop.h * oh
    const dpr = window.devicePixelRatio || 1
    const fit = Math.min((size.w - PAD * 2) / cw, (size.h - PAD * 2) / ch)
    const zNow = view.zoom === 'fit' ? fit : view.zoom === 'fill' ? Math.max(size.w / cw, size.h / ch) : view.zoom / dpr
    const cx = view.zoom === 'fit' || view.zoom === 'fill' ? cw / 2 : view.cx
    const cy = view.zoom === 'fit' || view.zoom === 'fill' ? ch / 2 : view.cy
    if (e.ctrlKey || e.metaKey) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const px = e.clientX - rect.left - size.w / 2
      const py = e.clientY - rect.top - size.h / 2
      const nz = Math.min(8, Math.max(fit, zNow * Math.exp(-e.deltaY * 0.0015)))
      const ix = cx + px / zNow
      const iy = cy + py / zNow
      if (nz <= fit * 1.0001) {
        setView({ zoom: 'fit', cx: 0, cy: 0 })
        ui.set({ zoom: 'fit' })
      } else setView({ zoom: nz * dpr, cx: ix - px / nz, cy: iy - py / nz })
    } else if (typeof view.zoom === 'number') {
      setView({ zoom: view.zoom, cx: cx + e.deltaX / zNow, cy: cy + e.deltaY / zNow })
    }
  }

  const zoomed = typeof view.zoom === 'number'
  return (
    <div
      className="detail"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      style={{ cursor: passive || frameMode ? undefined : zoomed ? 'grab' : 'zoom-in' }}
    >
      <canvas ref={canvasRef} />
      {(loaded !== id || !photo) && !error && <div className="spinner" />}
      {error && <div className="empty">{error}</div>}
      {label && <div className="overlay-label">{label}</div>}
      {showOriginal && !before && !frameMode && <div className="overlay-label">Original</div>}
      {busyRef.current && !overlay && <div className="overlay-label">Calculating retouch …</div>}
      {loaded === id && info.current && overlay?.(info.current)}
    </div>
  )
}
