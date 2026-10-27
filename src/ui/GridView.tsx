import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as A from '../actions'
import { addToAlbum, lib, removeFromAlbum, type Photo } from '../store/library'
import { NO_FILTER, openPhoto, sourceTitle, toast, ui, useVisible, type SortKey } from '../store/ui'
import { IconEdited, IconFlagFilled, IconReject, IconStar } from './Icons'
import { Dropdown, openContextMenu, type MenuItem } from './Menu'
import { photoAspect, Thumb } from './Thumb'

export const LABEL_COLORS: Record<string, string> = { red: '#e5483f', yellow: '#e8c93b', green: '#47b84b', blue: '#3b7fe0', purple: '#9b59d0' }
export const LABEL_NAMES: Record<string, string> = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' }

const SORTS: [SortKey, string][] = [
  ['capture', 'Capture Date'],
  ['added', 'Import Date'],
  ['edited', 'Edit Date'],
  ['name', 'File Name'],
  ['rating', 'Star Rating'],
]

/** Grid navigation rows (ids per visual row), used for arrow keys. */
export let gridRows: string[][] = []

interface Group {
  key: string
  title: string
  photos: Photo[]
}

function dayTitle(t: number) {
  return new Date(t).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function Stars({ value, onSet, size = 13 }: { value: number; onSet?: (v: number) => void; size?: number }) {
  return (
    <span className="stars" onDoubleClick={(e) => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          className={`star${i <= value ? ' on' : ''}`}
          style={{ width: size + 3, height: size + 3 }}
          onClick={(e) => {
            e.stopPropagation()
            onSet?.(i === value ? 0 : i)
          }}
          title={`${i} ${i === 1 ? 'star' : 'stars'}`}
        >
          <IconStar size={size} filled={i <= value} />
        </button>
      ))}
    </span>
  )
}

export function GridView({ square }: { square: boolean }) {
  const photos = useVisible()
  const selection = ui.use((s) => s.selection)
  const current = ui.use((s) => s.current)
  const anchor = ui.use((s) => s.anchor)
  const thumbSize = ui.use((s) => s.thumbSize)
  const source = ui.use((s) => s.source)
  const sort = ui.use((s) => s.sort)
  const filter = ui.use((s) => s.filter)
  const albums = lib.use((s) => s.albums)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 28))
    ro.observe(el)
    setWidth(el.clientWidth - 28)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onAll = () => ui.set({ selection: photos.map((p) => p.id) })
    document.addEventListener('gs-select-all', onAll)
    return () => document.removeEventListener('gs-select-all', onAll)
  }, [photos])

  // Keep the current photo in view.
  useEffect(() => {
    if (!current) return
    const el = scrollRef.current?.querySelector(`[data-id="${current}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const groups: Group[] = useMemo(() => {
    if (sort.key !== 'capture' || source.kind === 'trash') return [{ key: 'all', title: '', photos }]
    const out: Group[] = []
    for (const p of photos) {
      const t = p.captureDate ?? p.addedAt
      const d = new Date(t)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const last = out[out.length - 1]
      if (last && last.key === key) last.photos.push(p)
      else out.push({ key, title: dayTitle(t), photos: [p] })
    }
    return out
  }, [photos, sort.key, source.kind])

  const layout = useMemo(() => {
    const gap = 4
    const rowsAll: string[][] = []
    const res = groups.map((g) => {
      if (square) {
        const cols = Math.max(1, Math.floor((width + gap) / (thumbSize + gap)))
        const size = (width - gap * (cols - 1)) / cols
        for (let i = 0; i < g.photos.length; i += cols) rowsAll.push(g.photos.slice(i, i + cols).map((p) => p.id))
        return { g, cols, size, rows: [] as { items: { p: Photo; w: number }[]; h: number }[] }
      }
      const rows: { items: { p: Photo; w: number }[]; h: number }[] = []
      let cur: Photo[] = []
      let sum = 0
      const flush = (last: boolean) => {
        if (!cur.length) return
        const avail = width - gap * (cur.length - 1)
        let h = avail / sum
        if (last && h > thumbSize * 1.25) h = thumbSize
        rows.push({ items: cur.map((p) => ({ p, w: photoAspect(p) * h })), h })
        rowsAll.push(cur.map((p) => p.id))
        cur = []
        sum = 0
      }
      for (const p of g.photos) {
        cur.push(p)
        sum += photoAspect(p)
        if ((width - gap * (cur.length - 1)) / sum <= thumbSize) flush(false)
      }
      flush(true)
      return { g, cols: 0, size: 0, rows }
    })
    gridRows = rowsAll
    return res
  }, [groups, width, thumbSize, square])

  const onCellClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor) {
      const ids = photos.map((p) => p.id)
      const a = ids.indexOf(anchor)
      const b = ids.indexOf(id)
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
      ui.set({ selection: e.ctrlKey || e.metaKey ? [...new Set([...selection, ...range])] : range, current: id })
    } else if (e.ctrlKey || e.metaKey) {
      const has = selection.includes(id)
      ui.set({ selection: has ? selection.filter((x) => x !== id) : [...selection, id], current: id, anchor: id })
    } else ui.set({ selection: [id], current: id, anchor: id })
  }

  const ctxItems = (id: string): MenuItem[] => {
    const sel = selection.includes(id) ? selection : [id]
    if (!selection.includes(id)) ui.set({ selection: [id], current: id, anchor: id })
    const albumItems: MenuItem[] = Object.values(albums).map((a) => ({
      label: a.name,
      onClick: async () => {
        await addToAlbum(a.id, sel)
        toast(`Added to “${a.name}”`)
      },
    }))
    if (source.kind === 'trash')
      return [
        { label: 'Restore', onClick: A.restoreSelected },
        { label: 'Delete Permanently …', onClick: () => ui.set({ dialog: 'deleteForever' }) },
      ]
    return [
      { label: 'Edit', kbd: 'E', onClick: () => (openPhoto(id), ui.set({ panel: 'edit' })) },
      { label: 'Export …', onClick: () => ui.set({ dialog: 'export' }) },
      { sep: true },
      { label: 'Copy Edit Settings', onClick: () => A.copySettings() },
      { label: 'Paste Edit Settings', disabled: !A.hasClipboard(), onClick: () => A.pasteSettings(sel) },
      { label: 'Auto Settings', onClick: () => A.autoSettings(sel) },
      { label: 'Reset Edits', onClick: () => A.resetEdits(sel) },
      { sep: true },
      { label: 'Rotate Left', onClick: () => A.rotate(-1, sel) },
      { label: 'Rotate Right', onClick: () => A.rotate(1, sel) },
      ...(albumItems.length ? [{ sep: true }, { heading: 'Add to Album' }, ...albumItems] : []),
      ...(source.kind === 'album'
        ? [
            {
              label: 'Remove from Album',
              onClick: async () => {
                await removeFromAlbum((source as { id: string }).id, sel)
                ui.set({ selection: [] })
              },
            },
          ]
        : []),
      { sep: true },
      { label: 'Delete …', kbd: 'Del', onClick: A.deleteSelected },
    ]
  }

  const cell = (p: Photo, style: React.CSSProperties) => {
    const sel = selection.includes(p.id)
    return (
      <div
        key={p.id}
        data-id={p.id}
        className={`cell${sel ? ' sel' : ''}${p.id === current && selection.length > 1 ? ' cur' : ''}${p.flag === -1 ? ' rejected' : ''}`}
        style={style}
        onClick={(e) => onCellClick(e, p.id)}
        onDoubleClick={() => openPhoto(p.id)}
        onContextMenu={(e) => openContextMenu(e, ctxItems(p.id))}
        draggable
        onDragStart={(e) => {
          const ids = selection.includes(p.id) ? selection : [p.id]
          e.dataTransfer.setData('application/x-gradestudio', JSON.stringify(ids))
          e.dataTransfer.effectAllowed = 'copy'
        }}
        title={p.name}
      >
        <Thumb photo={p} />
        {p.flag !== 0 && <span className="flag-badge">{p.flag === 1 ? <IconFlagFilled size={15} /> : <IconReject size={15} />}</span>}
        {p.editedAt && (
          <span className="edited" title="Edited">
            <IconEdited size={11} />
          </span>
        )}
        <div className={`badges${p.rating || p.label ? ' keep' : ''}`}>
          <Stars value={p.rating} onSet={(v) => A.setRating(v, [p.id])} />
          {p.label && <span className="label-dot" style={{ background: LABEL_COLORS[p.label], marginLeft: 'auto' }} />}
        </div>
      </div>
    )
  }

  const filtered = JSON.stringify(filter) !== JSON.stringify({ ...NO_FILTER, text: filter.text }) || !!filter.text
  const empty = photos.length === 0
  const total = useMemo(() => Object.values(lib.get().photos).filter((p) => !p.deletedAt).length, [photos])
  return (
    <>
      <div className="grid-head">
        <div className="grid-title">{sourceTitle(source)}</div>
        <div className="grid-sub">
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
          {selection.length > 1 ? ` · ${selection.length} selected` : ''}
        </div>
        <div className="grid-tools">
          <FilterChips />
          <Dropdown
            className="chip"
            label={<>Sort: {SORTS.find((s) => s[0] === sort.key)?.[1]}</>}
            align="right"
            items={() => [
              ...SORTS.map(([k, l]) => ({ label: l, checked: sort.key === k, onClick: () => ui.set({ sort: { key: k, desc: sort.desc } }) })),
              { sep: true },
              { label: 'Descending', checked: sort.desc, onClick: () => ui.set({ sort: { key: sort.key, desc: true } }) },
              { label: 'Ascending', checked: !sort.desc, onClick: () => ui.set({ sort: { key: sort.key, desc: false } }) },
            ]}
          />
        </div>
      </div>
      {empty ? (
        <div className="empty">
          {filtered ? (
            <>
              <h2>No matching photos</h2>
              <div>No photo matches the current filters.</div>
              <button className="btn" onClick={() => ui.set({ filter: NO_FILTER })}>
                Reset Filters
              </button>
            </>
          ) : source.kind === 'trash' ? (
            <>
              <h2>No deleted photos</h2>
              <div>Deleted photos stay here until you remove them permanently.</div>
            </>
          ) : (
            <>
              <h2>{total ? 'No photos here yet' : 'Welcome to GradeStudio'}</h2>
              <div>Drag photos into this window or add them with the button below.<br />Everything stays on your device.</div>
              <button className="btn primary" onClick={() => A.pickFiles()}>
                Add Photos
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid-scroll" ref={scrollRef} onClick={(e) => e.target === e.currentTarget && ui.set({ selection: [] })}>
          {layout.map(({ g, cols, size, rows }) => (
            <div key={g.key}>
              {g.title && <div className="grid-group">{g.title}</div>}
              {square ? (
                <div className="square-grid" style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)` }}>
                  {g.photos.map((p) => cell(p, { width: size, height: size }))}
                </div>
              ) : (
                <div className="grid-rows">
                  {rows.map((r, i) => (
                    <div className="grid-row" key={i}>
                      {r.items.map(({ p, w }) => cell(p, { width: w, height: r.h }))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function FilterChips() {
  const f = ui.use((s) => s.filter)
  const set = (patch: Partial<typeof f>) => ui.set((s) => ({ filter: { ...s.filter, ...patch } }))
  const ratingLabel = f.rating ? `${f.ratingOp === 'gte' ? '≥' : f.ratingOp === 'lte' ? '≤' : '='} ${'★'.repeat(f.rating)}` : 'Rating'
  const flagLabel = { all: 'Flag', picked: 'Picked', unflagged: 'Unflagged', rejected: 'Rejected' }[f.flag]
  return (
    <>
      <Dropdown
        className={`chip${f.rating ? ' on' : ''}`}
        label={ratingLabel}
        align="right"
        items={() => [
          { label: 'All', checked: f.rating === 0, onClick: () => set({ rating: 0 }) },
          ...[1, 2, 3, 4, 5].map((r) => ({ label: '★'.repeat(r), checked: f.rating === r, onClick: () => set({ rating: r }) })),
          { sep: true },
          { label: 'At Least', checked: f.ratingOp === 'gte', onClick: () => set({ ratingOp: 'gte' }) },
          { label: 'Exactly', checked: f.ratingOp === 'eq', onClick: () => set({ ratingOp: 'eq' }) },
          { label: 'At Most', checked: f.ratingOp === 'lte', onClick: () => set({ ratingOp: 'lte' }) },
        ]}
      />
      <Dropdown
        className={`chip${f.flag !== 'all' ? ' on' : ''}`}
        label={flagLabel}
        align="right"
        items={() =>
          (['all', 'picked', 'unflagged', 'rejected'] as const).map((k) => ({
            label: { all: 'All', picked: 'Picked', unflagged: 'Unflagged', rejected: 'Rejected' }[k],
            checked: f.flag === k,
            onClick: () => set({ flag: k }),
          }))
        }
      />
      <Dropdown
        className={`chip${f.label !== 'all' || f.edited !== 'all' ? ' on' : ''}`}
        label="More Filters"
        align="right"
        items={() => [
          { heading: 'Color Label' },
          { label: 'All', checked: f.label === 'all', onClick: () => set({ label: 'all' }) },
          ...Object.keys(LABEL_COLORS).map((k) => ({ label: LABEL_NAMES[k], checked: f.label === k, onClick: () => set({ label: k as typeof f.label }) })),
          { sep: true },
          { heading: 'Editing' },
          { label: 'All', checked: f.edited === 'all', onClick: () => set({ edited: 'all' }) },
          { label: 'Edited', checked: f.edited === 'edited', onClick: () => set({ edited: 'edited' }) },
          { label: 'Unedited', checked: f.edited === 'unedited', onClick: () => set({ edited: 'unedited' }) },
          { sep: true },
          { label: 'Reset All Filters', onClick: () => ui.set({ filter: { ...NO_FILTER, text: f.text } }) },
        ]}
      />
    </>
  )
}
