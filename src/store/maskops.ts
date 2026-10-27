// Mask editing operations on the editor params (each one is an undo step).
import { defaultLocal, type LocalAdjust, type Mask, type MaskComp, type MaskKind, type PersonPart } from '../engine/params'
import { change, editor } from './editor'
import { uid } from './library'
import { createStore } from './store'

export interface MaskUI {
  maskId: string | null
  compId: string | null
  overlay: boolean
  brush: { size: number; feather: number; flow: number; erase: boolean }
}

export const maskUI = createStore<MaskUI>({ maskId: null, compId: null, overlay: true, brush: { size: 22, feather: 60, flow: 100, erase: false } })

export const KIND_NAMES: Record<MaskKind, string> = {
  brush: 'Brush',
  linear: 'Linear Gradient',
  radial: 'Radial Gradient',
  color: 'Color Range',
  luminance: 'Luminance Range',
  subject: 'Subject',
  background: 'Background',
  sky: 'Sky',
  person: 'Person',
}

export const PART_NAMES: Record<PersonPart, string> = { person: 'Whole Person', faceSkin: 'Facial Skin', bodySkin: 'Body Skin', hair: 'Hair', clothes: 'Clothes' }

export function compName(c: MaskComp) {
  return c.kind === 'person' && c.part && c.part !== 'person' ? PART_NAMES[c.part] : KIND_NAMES[c.kind]
}

function newComp(kind: MaskKind, mode: MaskComp['mode'], part?: PersonPart): MaskComp {
  const c: MaskComp = { id: uid(), kind, mode, invert: false }
  if (kind === 'brush') c.strokes = []
  if (kind === 'color') c.color = { samples: [], range: 40 }
  if (kind === 'luminance') c.lum = { min: 50, max: 100, softLow: 15, softHigh: 0 }
  if (kind === 'person') c.part = part ?? 'person'
  return c
}

const masks = () => editor.get().params.masks

function setMasks(next: Mask[], label: string) {
  change({ ...editor.get().params, masks: next }, label)
}

export function selectedMask(): Mask | undefined {
  const id = maskUI.get().maskId
  return masks().find((m) => m.id === id)
}

export function createMask(kind: MaskKind, part?: PersonPart) {
  const c = newComp(kind, 'add', part)
  const n = masks().length + 1
  const m: Mask = { id: uid(), name: `Mask ${n}`, visible: true, invert: false, amount: 100, comps: [c], adj: defaultLocal() }
  setMasks([...masks(), m], `New Mask: ${compName(c)}`)
  maskUI.set({ maskId: m.id, compId: c.id })
}

export function addComp(kind: MaskKind, mode: MaskComp['mode'], part?: PersonPart) {
  const m = selectedMask()
  if (!m) return createMask(kind, part)
  const c = newComp(kind, mode, part)
  updateMask(m.id, (x) => ({ ...x, comps: [...x.comps, c] }), `${mode === 'subtract' ? 'Subtract' : mode === 'intersect' ? 'Intersect' : 'Add'}: ${compName(c)}`)
  maskUI.set({ compId: c.id })
}

export function updateMask(id: string, fn: (m: Mask) => Mask, label: string) {
  setMasks(
    masks().map((m) => (m.id === id ? fn(m) : m)),
    label,
  )
}

export function updateComp(maskId: string, compId: string, fn: (c: MaskComp) => MaskComp, label: string, key?: string) {
  const next = masks().map((m) => (m.id === maskId ? { ...m, comps: m.comps.map((c) => (c.id === compId ? fn(c) : c)) } : m))
  change({ ...editor.get().params, masks: next }, label, key)
}

export function deleteMask(id: string) {
  setMasks(
    masks().filter((m) => m.id !== id),
    'Delete Mask',
  )
  if (maskUI.get().maskId === id) {
    const first = masks()[0]
    maskUI.set({ maskId: first?.id ?? null, compId: first?.comps[0]?.id ?? null })
  }
}

export function deleteComp(maskId: string, compId: string) {
  const m = masks().find((x) => x.id === maskId)
  if (!m) return
  if (m.comps.length <= 1) return deleteMask(maskId)
  updateMask(maskId, (x) => ({ ...x, comps: x.comps.filter((c) => c.id !== compId) }), 'Delete Mask Component')
  if (maskUI.get().compId === compId) maskUI.set({ compId: m.comps.find((c) => c.id !== compId)?.id ?? null })
}

export function duplicateMask(id: string) {
  const m = masks().find((x) => x.id === id)
  if (!m) return
  const copy: Mask = { ...structuredClone(m), id: uid(), name: `${m.name} Copy`, comps: m.comps.map((c) => ({ ...structuredClone(c), id: uid() })) }
  setMasks([...masks(), copy], 'Duplicate Mask')
  maskUI.set({ maskId: copy.id, compId: copy.comps[0]?.id ?? null })
}

export function setAdj(id: string, key: keyof LocalAdjust, value: number, label: string) {
  const next = masks().map((m) => (m.id === id ? { ...m, adj: { ...m.adj, [key]: value } } : m))
  change({ ...editor.get().params, masks: next }, label, `mask.${id}.${key}`)
}
