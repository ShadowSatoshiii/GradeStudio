import { useEffect, useState } from 'react'
import { ui, useVisible } from '../store/ui'
import { DetailView } from './DetailView'

/** Full-screen slideshow of the visible photos (4 s per photo). */
export function Slideshow() {
  const photos = useVisible()
  const start = ui.use((s) => s.current)
  const [i, setI] = useState(() => Math.max(0, photos.findIndex((p) => p.id === start)))
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => undefined)
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen()
    }
  }, [])
  useEffect(() => {
    if (paused || photos.length < 2) return
    const t = setTimeout(() => setI((x) => (x + 1) % photos.length), 4000)
    return () => clearTimeout(t)
  }, [i, paused, photos.length])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (e.key === 'Escape') ui.set({ dialog: null })
      else if (e.key === 'ArrowRight') setI((x) => (x + 1) % photos.length)
      else if (e.key === 'ArrowLeft') setI((x) => (x - 1 + photos.length) % photos.length)
      else if (e.key === ' ') setPaused((p) => !p)
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [photos.length])
  const p = photos[i]
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: '#000', display: 'flex' }} onClick={() => ui.set({ dialog: null })}>
      {p && (
        <div style={{ flex: 1, display: 'flex', pointerEvents: 'none', ['--c-canvas' as string]: '#000' }}>
          <DetailView key={p.id} id={p.id} passive />
        </div>
      )}
      <div className="overlay-label" style={{ top: 'auto', bottom: 18 }}>
        {i + 1} / {photos.length} {paused ? '· paused (Space)' : ''} · Esc to exit
      </div>
    </div>
  )
}
