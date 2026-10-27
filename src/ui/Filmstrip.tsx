import { useEffect, useRef } from 'react'
import { ui, useVisible } from '../store/ui'
import { photoAspect, Thumb } from './Thumb'

export function Filmstrip() {
  const photos = useVisible()
  const current = ui.use((s) => s.current)
  const selection = ui.use((s) => s.selection)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.querySelector(`[data-id="${current}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])
  return (
    <div
      className="filmstrip"
      ref={ref}
      onWheel={(e) => {
        if (ref.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY
      }}
    >
      {photos.map((p) => (
        <div
          key={p.id}
          data-id={p.id}
          className={`cell${p.id === current ? ' sel' : selection.includes(p.id) ? ' cur' : ''}${p.flag === -1 ? ' rejected' : ''}`}
          style={{ width: Math.min(140, Math.max(46, photoAspect(p) * 70)) }}
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              const sel = selection.includes(p.id) ? selection.filter((x) => x !== p.id) : [...selection, p.id]
              ui.set({ selection: sel })
            } else ui.set({ current: p.id, selection: [p.id], anchor: p.id })
          }}
          title={p.name}
        >
          <Thumb photo={p} />
        </div>
      ))}
    </div>
  )
}
