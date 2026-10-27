import { useEffect, useRef, useState } from 'react'
import { orientedSize } from '../engine/transform'
import { thumbUrl, type Photo } from '../store/library'

/** Display aspect (w/h) of a photo including crop and rotation. */
export function photoAspect(p: Photo): number {
  if (!p.params) return p.width / p.height
  const [ow, oh] = orientedSize(p.width, p.height, p.params.crop.rot90)
  return (p.params.crop.w * ow) / (p.params.crop.h * oh)
}

/** Lazily loaded thumbnail image (loads when scrolled into view). */
export function Thumb({ photo }: { photo: Photo }) {
  const ref = useRef<HTMLImageElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let alive = true
    void thumbUrl(photo).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [visible, photo, photo.thumbRev])
  return <img ref={ref} src={url ?? undefined} alt="" draggable={false} style={url ? undefined : { visibility: 'hidden' }} />
}
