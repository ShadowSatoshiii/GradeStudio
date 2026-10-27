import { useMemo, useState } from 'react'
import { addToAlbum, createAlbum, deleteAlbum, lib, renameAlbum } from '../store/library'
import { monthKey, toast, ui, type Source } from '../store/ui'
import { IconAlbum, IconCalendar, IconChevron, IconChevronRight, IconClock, IconEdited, IconPhotos, IconPlus, IconTrash } from './Icons'
import { openContextMenu } from './Menu'

const same = (a: Source, b: Source) => JSON.stringify(a) === JSON.stringify(b)

export function LeftPanel() {
  const photos = lib.use((s) => s.photos)
  const albums = lib.use((s) => s.albums)
  const source = ui.use((s) => s.source)
  const [openYears, setOpenYears] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)

  const stats = useMemo(() => {
    const list = Object.values(photos)
    const live = list.filter((p) => !p.deletedAt)
    const months = new Map<string, number>()
    for (const p of live) {
      const k = monthKey(p.captureDate ?? p.addedAt)
      months.set(k, (months.get(k) ?? 0) + 1)
    }
    const years = new Map<string, { count: number; months: [string, number][] }>()
    for (const [k, n] of [...months].sort((a, b) => b[0].localeCompare(a[0]))) {
      const y = k.slice(0, 4)
      const e = years.get(y) ?? { count: 0, months: [] }
      e.count += n
      e.months.push([k, n])
      years.set(y, e)
    }
    const albumCount = new Map<string, number>()
    for (const p of live) for (const a of p.albums) albumCount.set(a, (albumCount.get(a) ?? 0) + 1)
    return {
      all: live.length,
      recent: live.filter((p) => Date.now() - p.addedAt < 1000 * 60 * 60 * 24 * 30).length,
      edited: live.filter((p) => p.editedAt).length,
      trash: list.length - live.length,
      years,
      albumCount,
    }
  }, [photos])

  const go = (s: Source) => ui.set({ source: s, selection: [], view: ui.get().view === 'detail' || ui.get().view === 'compare' ? 'grid' : ui.get().view })

  const Item = ({ s, icon, label, count, cls = '' }: { s: Source; icon?: React.ReactNode; label: string; count?: number; cls?: string }) => (
    <button className={`lp-item ${cls}${same(s, source) ? ' active' : ''}`} onClick={() => go(s)}>
      {icon}
      <span>{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  )

  const newAlbum = async () => {
    const a = await createAlbum('New Album')
    setEditing(a.id)
    go({ kind: 'album', id: a.id })
  }

  const albumList = Object.values(albums).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <aside className="left">
      <div className="lp-section">
        <div className="lp-head">My Photos</div>
        <Item s={{ kind: 'all' }} icon={<IconPhotos size={16} />} label="All Photos" count={stats.all} />
        <Item s={{ kind: 'recent' }} icon={<IconClock size={16} />} label="Recently Added" count={stats.recent} />
        <Item s={{ kind: 'edited' }} icon={<IconEdited size={16} />} label="Edited" count={stats.edited} />
      </div>
      {stats.years.size > 0 && (
        <div className="lp-section">
          <div className="lp-head">By Date</div>
          {[...stats.years].map(([y, e]) => (
            <div key={y}>
              <button className="lp-item" onClick={() => setOpenYears((o) => ({ ...o, [y]: !o[y] }))}>
                <span className="tw">{openYears[y] ? <IconChevron size={12} /> : <IconChevronRight size={12} />}</span>
                <IconCalendar size={16} />
                <span>{y}</span>
                <span className="count">{e.count}</span>
              </button>
              {openYears[y] &&
                e.months.map(([k, n]) => (
                  <Item key={k} s={{ kind: 'month', key: k }} cls="sub2" label={new Date(+k.slice(0, 4), +k.slice(5) - 1, 1).toLocaleDateString('en-US', { month: 'long' })} count={n} />
                ))}
            </div>
          ))}
        </div>
      )}
      <div className="lp-section">
        <div className="lp-head">
          Albums
          <button className="icon-btn" title="Create Album" onClick={newAlbum}>
            <IconPlus size={15} />
          </button>
        </div>
        {albumList.length === 0 && <div style={{ padding: '2px 14px 6px', color: 'var(--c-text-3)' }}>No albums yet</div>}
        {albumList.map((a) => {
          const s: Source = { kind: 'album', id: a.id }
          if (editing === a.id)
            return (
              <div key={a.id} className="lp-item active">
                <IconAlbum size={16} />
                <input
                  autoFocus
                  defaultValue={a.name}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => {
                    void renameAlbum(a.id, e.target.value.trim() || a.name)
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                  }}
                />
              </div>
            )
          return (
            <button
              key={a.id}
              className={`lp-item${same(s, source) ? ' active' : ''}${dropOn === a.id ? ' drop' : ''}`}
              onClick={() => go(s)}
              onDoubleClick={() => setEditing(a.id)}
              onContextMenu={(e) =>
                openContextMenu(e, [
                  { label: 'Rename', onClick: () => setEditing(a.id) },
                  {
                    label: 'Add Selected Photos',
                    disabled: !ui.get().selection.length,
                    onClick: async () => {
                      await addToAlbum(a.id, ui.get().selection)
                      toast(`Added to “${a.name}”`)
                    },
                  },
                  { sep: true },
                  {
                    label: 'Delete Album',
                    onClick: async () => {
                      if (same(s, ui.get().source)) go({ kind: 'all' })
                      await deleteAlbum(a.id)
                      toast('Album deleted (its photos are kept)')
                    },
                  },
                ])
              }
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-gradestudio')) {
                  e.preventDefault()
                  setDropOn(a.id)
                }
              }}
              onDragLeave={() => setDropOn(null)}
              onDrop={async (e) => {
                setDropOn(null)
                const ids = JSON.parse(e.dataTransfer.getData('application/x-gradestudio') || '[]') as string[]
                if (!ids.length) return
                e.preventDefault()
                await addToAlbum(a.id, ids)
                toast(`${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} added to “${a.name}”`)
              }}
            >
              <IconAlbum size={16} />
              <span>{a.name}</span>
              <span className="count">{stats.albumCount.get(a.id) ?? 0}</span>
            </button>
          )
        })}
      </div>
      <div className="lp-section" style={{ borderBottom: 'none' }}>
        <Item s={{ kind: 'trash' }} icon={<IconTrash size={16} />} label="Deleted" count={stats.trash} />
      </div>
    </aside>
  )
}
