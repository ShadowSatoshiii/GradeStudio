// User presets in IndexedDB.
import type { Preset } from '../engine/presets'
import * as db from './db'
import { createStore } from './store'

export const presetStore = createStore<{ list: Preset[]; loaded: boolean }>({ list: [], loaded: false })

export async function loadPresets() {
  const list = await db.all<Preset>('presets')
  presetStore.set({ list: list.sort((a, b) => a.name.localeCompare(b.name, 'de')), loaded: true })
}

export async function savePreset(p: Preset) {
  await db.put('presets', p.id, p)
  presetStore.set((s) => ({ list: [...s.list.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name, 'de')) }))
}

export async function deletePreset(id: string) {
  await db.del('presets', id)
  presetStore.set((s) => ({ list: s.list.filter((x) => x.id !== id) }))
}
