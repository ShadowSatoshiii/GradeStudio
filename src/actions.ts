// Commands shared by menus, toolbars and keyboard shortcuts.
import { autoStraightenAngle, autoTone, autoWhiteBalance, smallCopy, type Small } from './engine/analyze'
import { constrainCrop, fitAfterRotate } from './engine/cropmath'
import { solveUpright, type UprightMode } from './engine/upright'
import { orientedSize } from './engine/transform'
import { cloneParams, defaultParams, normalizeParams, type Params } from './engine/params'
import { editor, change, flushSave, redo, saveParams, undo } from './store/editor'
import { baseThumb, deleteForever, importFiles, lib, moveToTrash, originalFile, restoreFromTrash, updatePhotos, type Flag, type Label } from './store/library'
import { targets, toast, ui } from './store/ui'

/** Small linear copy of the photo shown in the editor (set by the detail view). */
let editorSmall: { id: string; small: Small } | null = null
export function setEditorSmall(id: string, small: Small) {
  editorSmall = { id, small }
}

export function getEditorSmall(): Small | null {
  return editorSmall && editorSmall.id === editor.get().photoId ? editorSmall.small : null
}

async function smallFor(id: string): Promise<Small | null> {
  if (editorSmall?.id === id) return editorSmall.small
  const blob = await baseThumb(id)
  if (!blob) return null
  const bmp = await createImageBitmap(blob)
  const s = smallCopy(bmp, bmp.width, bmp.height)
  bmp.close()
  return s
}

/** Applies a params change to photos; the editor photo goes through undo history. */
export async function applyParams(ids: string[], fn: (p: Params) => Params, label: string) {
  const ed = editor.get()
  for (const id of ids) {
    if (id === ed.photoId) change(fn(cloneParams(ed.params)), label)
    else {
      const p = lib.get().photos[id]
      if (p) await saveParams(id, fn(normalizeParams(p.params)))
    }
  }
}

export function pickFiles(opts: { folder?: boolean } = {}) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'image/*'
  if (opts.folder) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
  input.onchange = async () => {
    const files = Array.from(input.files ?? [])
    if (!files.length) return
    const src = ui.get().source
    const ids = await importFiles(files, src.kind === 'album' ? src.id : undefined)
    if (ids.length) toast(`${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} added`)
  }
  input.click()
}

export async function setRating(r: number, ids = targets()) {
  if (!ids.length) return
  await updatePhotos(ids, () => ({ rating: r }))
}

export async function setFlag(f: Flag, ids = targets()) {
  if (!ids.length) return
  await updatePhotos(ids, () => ({ flag: f }))
}

export async function setLabel(l: Label, ids = targets()) {
  if (!ids.length) return
  await updatePhotos(ids, (p) => ({ label: p.label === l ? null : l }))
}

export function rotate(dir: 1 | -1, ids = targets()) {
  return applyParams(
    ids,
    (p) => {
      const c = p.crop
      // Rotating keeps the crop: rotate the crop rectangle with the image.
      const nx = dir === 1 ? 1 - c.y - c.h : c.y
      const ny = dir === 1 ? c.x : 1 - c.x - c.w
      return { ...p, crop: { ...c, rot90: (c.rot90 + (dir === 1 ? 1 : 3)) % 4, x: nx, y: ny, w: c.h, h: c.w } }
    },
    dir === 1 ? 'Rotate Right' : 'Rotate Left',
  )
}

export function flip(axis: 'h' | 'v', ids = targets()) {
  return applyParams(
    ids,
    (p) => {
      const c = p.crop
      // Flips act on the displayed orientation.
      const visualH = axis === 'h'
      const swap = c.rot90 % 2 === 1
      const flipH = visualH !== swap ? !c.flipH : c.flipH
      const flipV = visualH === swap ? !c.flipV : c.flipV
      return {
        ...p,
        crop: {
          ...c,
          flipH,
          flipV,
          x: axis === 'h' ? 1 - c.x - c.w : c.x,
          y: axis === 'v' ? 1 - c.y - c.h : c.y,
          angle: -c.angle,
        },
      }
    },
    axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical',
  )
}

export async function autoSettings(ids = targets()) {
  for (const id of ids) {
    const sm = await smallFor(id)
    if (!sm) continue
    await applyParams([id], (p) => ({ ...p, ...autoTone(sm, p) }), 'Auto Settings')
  }
}

export async function autoWB(ids = targets()) {
  for (const id of ids) {
    const sm = await smallFor(id)
    if (!sm) continue
    const wb = autoWhiteBalance(sm)
    await applyParams([id], (p) => ({ ...p, wb: 'auto', ...wb }), 'White Balance: Auto')
  }
}

/** Levels the horizon automatically (crop straighten angle). */
export async function autoStraighten(ids = targets()) {
  for (const id of ids) {
    const p = lib.get().photos[id]
    const blob = p && (await originalFile(id))
    if (!p || !blob) continue
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    const found = autoStraightenAngle(smallCopy(bmp, bmp.width, bmp.height, 800))
    bmp.close()
    if (found === null) {
      toast('No straight lines found')
      continue
    }
    await applyParams(
      [id],
      (q) => {
        const [ow, oh] = orientedSize(p.width, p.height, q.crop.rot90)
        // The analysis runs on the unrotated source; quarter turns and flips change the sign.
        const sign = (q.crop.flipH ? -1 : 1) * (q.crop.flipV ? -1 : 1)
        const next = { ...q.crop, angle: Math.max(-45, Math.min(45, +(found * sign).toFixed(2))) }
        return { ...q, crop: { ...next, ...fitAfterRotate({ x: q.crop.x, y: q.crop.y, w: q.crop.w, h: q.crop.h }, next, ow, oh) } }
      },
      'Auto Straighten',
    )
  }
}

/** Upright: automatic perspective correction. */
export async function upright(mode: UprightMode | 'off', ids = targets()) {
  for (const id of ids) {
    const p = lib.get().photos[id]
    if (!p) continue
    if (mode === 'off') {
      await applyParams([id], (q) => ({ ...q, geometry: { ...q.geometry, upright: 'off', rotate: 0, vertical: 0, horizontal: 0 } }), 'Upright: Off')
      continue
    }
    const blob = await originalFile(id)
    if (!blob) continue
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    const sm = smallCopy(bmp, bmp.width, bmp.height, 800)
    bmp.close()
    const ed = editor.get()
    const cur = id === ed.photoId ? ed.params : normalizeParams(p.params)
    const g = solveUpright(sm, cur.crop, cur.geometry, mode)
    if (!g) {
      toast('No straight lines found')
      continue
    }
    const names = { auto: 'Auto', level: 'Level', vertical: 'Vertical', full: 'Full' }
    await applyParams(
      [id],
      (q) => {
        const next = { ...q, geometry: g }
        if (!g.constrain) return next
        const [ow, oh] = orientedSize(p.width, p.height, q.crop.rot90)
        return { ...next, crop: { ...q.crop, ...constrainCrop(q.crop, g, ow, oh) } }
      },
      `Upright: ${names[mode]}`,
    )
  }
}

export function resetEdits(ids = targets()) {
  return applyParams(ids, () => defaultParams(), 'Reset Edits')
}

export function toggleBW(ids = targets()) {
  return applyParams(ids, (p) => ({ ...p, bw: !p.bw }), 'Black & White')
}

// ---------- Copy / paste settings ----------

export type SettingGroup = 'profile' | 'light' | 'curve' | 'color' | 'mixer' | 'grade' | 'effects' | 'detail' | 'optics' | 'geometry' | 'crop'

export const SETTING_GROUPS: { id: SettingGroup; label: string; keys: (keyof Params)[] }[] = [
  { id: 'profile', label: 'Profile and Black & White', keys: ['profile', 'profileAmount', 'bw'] },
  { id: 'light', label: 'Light', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { id: 'curve', label: 'Tone Curve', keys: ['curve'] },
  { id: 'color', label: 'White Balance, Vibrance, Saturation', keys: ['wb', 'temp', 'tint', 'vibrance', 'saturation'] },
  { id: 'mixer', label: 'Color Mixer', keys: ['mixHue', 'mixSat', 'mixLum', 'grayMix'] },
  { id: 'grade', label: 'Color Grading', keys: ['grade'] },
  { id: 'effects', label: 'Effects', keys: ['texture', 'clarity', 'dehaze', 'vignette', 'grain'] },
  { id: 'detail', label: 'Detail', keys: ['sharpen', 'noise'] },
  { id: 'optics', label: 'Optics', keys: ['optics'] },
  { id: 'geometry', label: 'Geometry', keys: ['geometry'] },
  { id: 'crop', label: 'Crop', keys: ['crop'] },
]

let clipboard: { params: Partial<Params>; groups: SettingGroup[] } | null = null

export function copySettings(groups: SettingGroup[] = SETTING_GROUPS.filter((g) => g.id !== 'crop').map((g) => g.id)) {
  const id = targets()[0]
  if (!id) return
  const ed = editor.get()
  const src = id === ed.photoId ? ed.params : normalizeParams(lib.get().photos[id]?.params)
  const part: Partial<Params> = {}
  for (const g of SETTING_GROUPS)
    if (groups.includes(g.id)) for (const k of g.keys) (part as Record<string, unknown>)[k] = structuredClone(src[k])
  clipboard = { params: part, groups }
  toast('Edit settings copied')
}

export const hasClipboard = () => !!clipboard

export async function pasteSettings(ids = ui.get().selection.length ? ui.get().selection : targets()) {
  if (!clipboard || !ids.length) return
  const part = clipboard.params
  await applyParams(ids, (p) => ({ ...p, ...structuredClone(part) }), 'Paste Settings')
  toast(`Settings pasted to ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}`)
}

// ---------- Undo / delete ----------

export function doUndo() {
  const l = undo()
  if (l) toast(`Undo: ${l}`)
}

export function doRedo() {
  const l = redo()
  if (l) toast(`Redo: ${l}`)
}

export async function deleteSelected() {
  const ids = targets()
  if (!ids.length) return
  if (ui.get().source.kind === 'trash') {
    ui.set({ dialog: 'deleteForever' })
    return
  }
  flushSave()
  await moveToTrash(ids)
  const s = ui.get()
  ui.set({ selection: [], current: s.view === 'detail' ? null : s.current, view: s.view === 'detail' ? 'grid' : s.view })
  toast(`${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} moved to Deleted`)
}

export async function restoreSelected() {
  const ids = targets()
  await restoreFromTrash(ids)
  ui.set({ selection: [] })
  toast('Restored')
}

export async function deleteSelectedForever() {
  const ids = targets()
  await deleteForever(ids)
  ui.set({ selection: [], current: null, dialog: null })
  toast(`${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} permanently deleted`)
}
