// UI state: current view, selection, panels, sort/filter. Preferences persist in localStorage.
import type { Label, Photo } from './library'
import { lib } from './library'
import { createStore } from './store'

export type Source = { kind: 'all' } | { kind: 'recent' } | { kind: 'edited' } | { kind: 'album'; id: string } | { kind: 'month'; key: string } | { kind: 'trash' }
export type View = 'grid' | 'square' | 'detail' | 'compare'
export type Panel = 'edit' | 'crop' | 'heal' | 'mask' | 'redeye' | 'presets' | 'versions' | 'info' | 'keywords'
export type SortKey = 'capture' | 'added' | 'edited' | 'name' | 'rating'
export type Zoom = 'fit' | 'fill' | 1 | 2

export interface Filter {
  rating: number
  ratingOp: 'gte' | 'eq' | 'lte'
  flag: 'all' | 'picked' | 'unflagged' | 'rejected'
  label: Label | 'all'
  edited: 'all' | 'edited' | 'unedited'
  text: string
}

export interface UIState {
  source: Source
  view: View
  panel: Panel | null
  selection: string[]
  current: string | null
  anchor: string | null
  sort: { key: SortKey; desc: boolean }
  filter: Filter
  filterOpen: boolean
  thumbSize: number
  filmstrip: boolean
  left: boolean
  histogram: boolean
  clip: boolean
  showOriginal: boolean
  zoom: Zoom
  compareLayout: 'lr' | 'tb'
  dialog: null | 'export' | 'about' | 'shortcuts' | 'savePreset' | 'copySettings' | 'deleteForever' | 'slideshow'
  /** Active pointer tool on the photo (white balance picker, straighten line, …). */
  tool: null | 'wb' | 'straighten' | 'focus' | 'pointcolor'
  cropOverlay: 'thirds' | 'grid' | 'golden' | 'diagonal' | 'none'
  cropLocked: boolean
  toast: string | null
  sections: Record<string, boolean>
}

const PREF_KEY = 'gradestudio.prefs'
const PREFS: (keyof UIState)[] = ['view', 'sort', 'thumbSize', 'filmstrip', 'left', 'histogram', 'sections', 'compareLayout', 'panel', 'cropOverlay', 'cropLocked']

function loadPrefs(): Partial<UIState> {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<UIState>
    // No photo is open after a reload, so start in a grid.
    if (p.view === 'detail' || p.view === 'compare') p.view = 'grid'
    return p
  } catch {
    return {}
  }
}

export const NO_FILTER: Filter = { rating: 0, ratingOp: 'gte', flag: 'all', label: 'all', edited: 'all', text: '' }

export const ui = createStore<UIState>({
  source: { kind: 'all' },
  view: 'grid',
  panel: 'edit',
  selection: [],
  current: null,
  anchor: null,
  sort: { key: 'capture', desc: true },
  filter: NO_FILTER,
  filterOpen: false,
  thumbSize: 190,
  filmstrip: true,
  left: true,
  histogram: true,
  clip: false,
  showOriginal: false,
  zoom: 'fit',
  compareLayout: 'lr',
  dialog: null,
  tool: null,
  cropOverlay: 'thirds',
  cropLocked: true,
  toast: null,
  sections: { light: true, color: true, effects: false, detail: false, optics: false, geometry: false },
  ...loadPrefs(),
})

ui.subscribe(() => {
  const s = ui.get()
  const out: Record<string, unknown> = {}
  for (const k of PREFS) out[k] = s[k]
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(out))
  } catch {
    /* storage may be unavailable */
  }
})

let toastTimer = 0
export function toast(msg: string) {
  ui.set({ toast: msg })
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => ui.set({ toast: null }), 2600)
}

export function sourceTitle(s: Source): string {
  switch (s.kind) {
    case 'all':
      return 'All Photos'
    case 'recent':
      return 'Recently Added'
    case 'edited':
      return 'Edited'
    case 'trash':
      return 'Deleted'
    case 'month': {
      const [y, m] = s.key.split('-').map(Number)
      return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }
    case 'album':
      return lib.get().albums[s.id]?.name ?? 'Album'
  }
}

export function monthKey(t: number) {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function inSource(p: Photo, s: Source): boolean {
  if (s.kind === 'trash') return !!p.deletedAt
  if (p.deletedAt) return false
  switch (s.kind) {
    case 'all':
      return true
    case 'recent':
      return Date.now() - p.addedAt < 1000 * 60 * 60 * 24 * 30
    case 'edited':
      return !!p.editedAt
    case 'album':
      return p.albums.includes(s.id)
    case 'month':
      return monthKey(p.captureDate ?? p.addedAt) === s.key
  }
}

function matches(p: Photo, f: Filter): boolean {
  if (f.rating > 0) {
    if (f.ratingOp === 'gte' && p.rating < f.rating) return false
    if (f.ratingOp === 'eq' && p.rating !== f.rating) return false
    if (f.ratingOp === 'lte' && p.rating > f.rating) return false
  }
  if (f.flag === 'picked' && p.flag !== 1) return false
  if (f.flag === 'rejected' && p.flag !== -1) return false
  if (f.flag === 'unflagged' && p.flag !== 0) return false
  if (f.label !== 'all' && p.label !== f.label) return false
  if (f.edited === 'edited' && !p.editedAt) return false
  if (f.edited === 'unedited' && p.editedAt) return false
  if (f.text) {
    const q = f.text.toLowerCase()
    const hay = [p.name, p.title, p.caption, p.copyright, ...p.keywords, p.exif?.model ?? '', p.exif?.make ?? '', p.exif?.lens ?? ''].join(' ').toLowerCase()
    if (!q.split(/\s+/).every((t) => hay.includes(t))) return false
  }
  return true
}

/** Photos of the current source, filtered and sorted (memoized on input identity). */
let memo: { photos: unknown; source: unknown; filter: unknown; sort: unknown; out: Photo[] } | null = null
export function visiblePhotos(): Photo[] {
  const photos = lib.get().photos
  const { source, filter, sort } = ui.get()
  if (memo && memo.photos === photos && memo.source === source && memo.filter === filter && memo.sort === sort) return memo.out
  const list = Object.values(photos).filter((p) => inSource(p, source) && matches(p, filter))
  const key = (p: Photo): number | string => {
    switch (sort.key) {
      case 'capture':
        return p.captureDate ?? p.addedAt
      case 'added':
        return p.addedAt
      case 'edited':
        return p.editedAt ?? 0
      case 'name':
        return p.name.toLowerCase()
      case 'rating':
        return p.rating
    }
  }
  list.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    const c = ka < kb ? -1 : ka > kb ? 1 : a.name.localeCompare(b.name)
    return sort.desc ? -c : c
  })
  memo = { photos, source, filter, sort, out: list }
  return list
}

export function useVisible(): Photo[] {
  lib.use((s) => s.photos)
  ui.use((s) => s.source)
  ui.use((s) => s.filter)
  ui.use((s) => s.sort)
  return visiblePhotos()
}

/** Opens a photo in the detail view. */
export function openPhoto(id: string) {
  ui.set({ current: id, selection: [id], anchor: id, view: ui.get().view === 'compare' ? 'compare' : 'detail', zoom: 'fit' })
}

export function selectOnly(id: string) {
  ui.set({ selection: [id], current: id, anchor: id })
}

/** Moves the current photo by `delta` within the visible list. */
export function step(delta: number) {
  const list = visiblePhotos()
  if (!list.length) return
  const cur = ui.get().current
  let i = list.findIndex((p) => p.id === cur)
  i = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + delta))
  selectOnly(list[i].id)
}

/** Ids the toolbar actions apply to: the selection, or the current photo. */
export function targets(): string[] {
  const s = ui.get()
  if (s.view === 'detail' && s.current) return [s.current]
  return s.selection.length ? s.selection : s.current ? [s.current] : []
}
