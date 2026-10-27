import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createStore } from '../store/store'

export interface MenuItem {
  label?: string
  kbd?: string
  onClick?: () => void
  disabled?: boolean
  checked?: boolean
  sep?: boolean
  heading?: string
}

function Items({ items, close }: { items: MenuItem[]; close: () => void }) {
  return (
    <>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="menu-sep" />
        ) : it.heading ? (
          <div key={i} className="menu-label">
            {it.heading}
          </div>
        ) : (
          <button
            key={i}
            className="menu-item"
            disabled={it.disabled}
            onClick={() => {
              close()
              it.onClick?.()
            }}
          >
            {it.checked !== undefined && <span className="check">{it.checked ? '✓' : ''}</span>}
            <span>{it.label}</span>
            {it.kbd && <span className="kbd">{it.kbd}</span>}
          </button>
        ),
      )}
    </>
  )
}

/** Button with a drop-down menu. `items` is evaluated when the menu opens. */
export function Dropdown({ label, items, className = 'menu-btn', title, align = 'left' }: { label: ReactNode; items: () => MenuItem[]; className?: string; title?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="menu-root" ref={ref}>
      <button className={`${className}${open ? ' open' : ''}`} onClick={() => setOpen(!open)} title={title}>
        {label}
      </button>
      {open && (
        <div className="menu" style={align === 'right' ? { left: 'auto', right: 0 } : undefined}>
          <Items items={items()} close={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

const ctx = createStore<{ x: number; y: number; items: MenuItem[] | null }>({ x: 0, y: 0, items: null })

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]) {
  e.preventDefault()
  ctx.set({ x: e.clientX, y: e.clientY, items })
}

export function ContextMenuHost() {
  const s = ctx.use((s) => s)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!s.items) return
    const el = ref.current
    const w = el?.offsetWidth ?? 250
    const h = el?.offsetHeight ?? 200
    setPos({ x: Math.min(s.x, window.innerWidth - w - 8), y: Math.min(s.y, window.innerHeight - h - 8) })
    const close = () => ctx.set({ items: null })
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', close)
    }
  }, [s])
  if (!s.items) return null
  return (
    <div className="menu ctx" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <Items items={s.items} close={() => ctx.set({ items: null })} />
    </div>
  )
}

/** Pointer capture that never throws (synthetic events have no active pointer). */
export function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id)
  } catch {
    /* not an active pointer */
  }
}
