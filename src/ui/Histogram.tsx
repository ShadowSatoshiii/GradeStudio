import { useEffect, useRef } from 'react'
import { formatShutter } from '../engine/exif'
import { lib } from '../store/library'
import { ui } from '../store/ui'
import { histStore } from './DetailView'

export function HistogramView({ photoId }: { photoId: string | null }) {
  const h = histStore.use((s) => s.h)
  const clip = ui.use((s) => s.clip)
  const exif = lib.use((s) => (photoId ? s.photos[photoId]?.exif : undefined))
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(c.clientWidth * dpr)
    const H = Math.round(c.clientHeight * dpr)
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    // grid lines at quarters
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      ctx.beginPath()
      ctx.moveTo((W * i) / 4, 0)
      ctx.lineTo((W * i) / 4, H)
      ctx.stroke()
    }
    if (!h) return
    let max = 1
    for (const ch of [h.r, h.g, h.b]) for (let i = 2; i < 254; i++) max = Math.max(max, ch[i])
    const draw = (data: Uint32Array, color: string) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(0, H)
      for (let i = 0; i < 256; i++) {
        const v = Math.min(1, Math.sqrt(data[i] / max))
        ctx.lineTo((i / 255) * W, H - v * (H - 4))
      }
      ctx.lineTo(W, H)
      ctx.closePath()
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'lighter'
    draw(h.r, 'rgba(200,50,50,0.85)')
    draw(h.g, 'rgba(50,170,60,0.85)')
    draw(h.b, 'rgba(50,90,220,0.85)')
    ctx.globalCompositeOperation = 'source-over'
  }, [h])

  return (
    <>
      <div className="hist">
        <canvas ref={ref} />
        <span className={`clip low${h?.clipLow ? ' warn' : ''}${clip ? ' on' : ''}`} title="Show Clipping (J)" onClick={() => ui.set({ clip: !clip })} />
        <span className={`clip high${h?.clipHigh ? ' warn' : ''}${clip ? ' on' : ''}`} title="Show Clipping (J)" onClick={() => ui.set({ clip: !clip })} />
      </div>
      <div className="hist-info">
        <span>{exif?.iso ? `ISO ${exif.iso}` : 'ISO –'}</span>
        <span>{exif?.focalLength ? `${Math.round(exif.focalLength)} mm` : '– mm'}</span>
        <span>{exif?.fNumber ? `f/${exif.fNumber.toFixed(1)}` : 'f/–'}</span>
        <span>{formatShutter(exif?.exposureTime)}</span>
      </div>
    </>
  )
}
