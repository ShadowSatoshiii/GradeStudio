// Edit state of the photo in the detail view: params, undo history, autosave, edited thumbnails.
import { cloneParams, defaultParams, isEdited, normalizeParams, setAt, type Params } from '../engine/params'
import { Renderer } from '../engine/renderer'
import { baseThumb, lib, setEditedThumb, updatePhoto, type Photo } from './library'
import { createStore } from './store'

interface Step {
  label: string
  params: Params
  key?: string
  at: number
}

interface EditorState {
  photoId: string | null
  params: Params
  history: Step[]
  index: number
  /** Temporary look shown while hovering a preset or version (not saved). */
  preview: Params | null
}

export const editor = createStore<EditorState>({ photoId: null, params: defaultParams(), history: [], index: -1, preview: null })

export function setPreview(p: Params | null) {
  editor.set({ preview: p })
}

/** Loads the edit state for a photo (called when the detail view changes photo). */
export function editPhoto(p: Photo | undefined) {
  flushSave()
  if (!p) {
    editor.set({ photoId: null, params: defaultParams(), history: [], index: -1, preview: null })
    return
  }
  const params = normalizeParams(p.params)
  editor.set({ photoId: p.id, params, history: [{ label: 'Original', params: cloneParams(params), at: 0 }], index: 0, preview: null })
}

/**
 * Applies a change. Consecutive changes with the same `key` within 1.2 s are
 * merged into one history step (slider drags).
 */
export function change(next: Params, label: string, key?: string) {
  const s = editor.get()
  if (!s.photoId) return
  const now = Date.now()
  let history = s.history.slice(0, s.index + 1)
  const last = history[history.length - 1]
  if (key && last && last.key === key && now - last.at < 1200 && history.length > 1) {
    history = [...history.slice(0, -1), { ...last, params: next, at: now }]
  } else {
    history = [...history, { label, params: next, key, at: now }]
  }
  editor.set({ params: next, history, index: history.length - 1, preview: null })
  scheduleSave()
}

export function setParam(key: string, value: unknown, label: string) {
  change(setAt(editor.get().params, key, value), label, key)
}

export function patchParams(patch: Partial<Params>, label: string) {
  change({ ...editor.get().params, ...patch }, label)
}

export function undo() {
  const s = editor.get()
  if (s.index <= 0) return false
  editor.set({ index: s.index - 1, params: s.history[s.index - 1].params })
  scheduleSave()
  return s.history[s.index].label
}

export function redo() {
  const s = editor.get()
  if (s.index >= s.history.length - 1) return false
  editor.set({ index: s.index + 1, params: s.history[s.index + 1].params })
  scheduleSave()
  return s.history[s.index + 1].label
}

export function resetAll() {
  change(defaultParams(), 'Reset Edits')
}

// ---------- Saving ----------

let saveTimer = 0
let pending: { id: string; params: Params } | null = null

function scheduleSave() {
  const s = editor.get()
  if (!s.photoId) return
  pending = { id: s.photoId, params: s.params }
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flushSave, 450)
}

export function flushSave() {
  clearTimeout(saveTimer)
  if (!pending) return
  const { id, params } = pending
  pending = null
  void saveParams(id, params)
}

const PENDING_KEY = 'gradestudio.pending'

/** On page close: IndexedDB writes may not finish, so keep a synchronous copy. */
export function saveBeforeUnload() {
  if (!pending) return
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    /* ignore */
  }
  flushSave()
}

/** Applies an edit that was still pending when the page closed. */
export async function restorePending() {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(PENDING_KEY)
    localStorage.removeItem(PENDING_KEY)
  } catch {
    return
  }
  if (!raw) return
  const { id, params } = JSON.parse(raw) as { id: string; params: Params }
  if (lib.get().photos[id]) await saveParams(id, normalizeParams(params))
}

/** Writes params of any photo and refreshes its thumbnail. */
export async function saveParams(id: string, params: Params) {
  const edited = isEdited(params)
  await updatePhoto(id, { params: edited ? params : undefined, editedAt: edited ? Date.now() : undefined })
  queueThumb(id)
}

// ---------- Edited thumbnails ----------

let thumbRenderer: Renderer | null = null
const thumbQueue = new Set<string>()
let thumbBusy = false
let thumbTimer = 0

export function queueThumb(id: string) {
  thumbQueue.add(id)
  clearTimeout(thumbTimer)
  thumbTimer = window.setTimeout(runThumbs, 700)
}

async function runThumbs() {
  if (thumbBusy) return
  thumbBusy = true
  try {
    while (thumbQueue.size) {
      const id = thumbQueue.values().next().value as string
      thumbQueue.delete(id)
      await renderThumb(id)
    }
  } finally {
    thumbBusy = false
  }
}

async function renderThumb(id: string) {
  const p = lib.get().photos[id]
  if (!p) return
  if (!p.params) {
    await setEditedThumb(id, null)
    return
  }
  const blob = await baseThumb(id)
  if (!blob) return
  const bmp = await createImageBitmap(blob)
  try {
    if (!thumbRenderer) thumbRenderer = new Renderer(document.createElement('canvas'))
    const r = thumbRenderer
    r.setImage(bmp, p.width, p.height, 512)
    r.photoId = p.id
    r.setParams(p.params)
    await r.waitForRetouch()
    await r.waitForAi()
    const [ow, oh] = r.orientedSize(p.params)
    const cw = p.params.crop.w * ow
    const ch = p.params.crop.h * oh
    const s = 512 / Math.max(cw, ch)
    const w = Math.max(1, Math.round(cw * s))
    const h = Math.max(1, Math.round(ch * s))
    const px = r.readPixels(w, h)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.putImageData(new ImageData(px, w, h), 0, 0)
    const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85))
    if (out) await setEditedThumb(id, out)
  } finally {
    bmp.close()
  }
}
