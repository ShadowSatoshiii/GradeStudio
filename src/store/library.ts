// Photo library: metadata, originals and thumbnails in IndexedDB.
import { exifDate, readExif, type Exif } from '../engine/exif'
import { normalizeParams, type Params } from '../engine/params'
import * as db from './db'
import { createStore } from './store'

export type Flag = -1 | 0 | 1
export type Label = 'red' | 'yellow' | 'green' | 'blue' | 'purple' | null

export interface Version {
  id: string
  name: string
  date: number
  auto: boolean
  params: Params
}

export interface Photo {
  id: string
  name: string
  type: string
  size: number
  width: number
  height: number
  addedAt: number
  captureDate?: number
  exif?: Exif
  rating: number
  flag: Flag
  label: Label
  keywords: string[]
  title: string
  caption: string
  copyright: string
  albums: string[]
  deletedAt?: number
  params?: Params
  editedAt?: number
  versions: Version[]
  /** Bumped whenever the thumbnail changes, so <img> URLs refresh. */
  thumbRev: number
}

export interface Album {
  id: string
  name: string
  createdAt: number
  coverId?: string
}

interface LibState {
  loaded: boolean
  photos: Record<string, Photo>
  albums: Record<string, Album>
  importing: { done: number; total: number } | null
}

export const lib = createStore<LibState>({ loaded: false, photos: {}, albums: {}, importing: null })

export const uid = () => crypto.randomUUID()

export async function loadLibrary() {
  const [photos, albums] = await Promise.all([db.all<Photo>('photos'), db.all<Album>('albums')])
  const p: Record<string, Photo> = {}
  for (const ph of photos) p[ph.id] = { ...ph, params: ph.params ? normalizeParams(ph.params) : undefined }
  const a: Record<string, Album> = {}
  for (const al of albums) a[al.id] = al
  lib.set({ loaded: true, photos: p, albums: a })
}

export function photoList(): Photo[] {
  return Object.values(lib.get().photos)
}

/** Saves changed fields of a photo (state + IndexedDB). */
export async function updatePhoto(id: string, patch: Partial<Photo>) {
  const cur = lib.get().photos[id]
  if (!cur) return
  const next = { ...cur, ...patch }
  lib.set((s) => ({ photos: { ...s.photos, [id]: next } }))
  await db.put('photos', id, next)
}

export async function updatePhotos(ids: string[], patch: (p: Photo) => Partial<Photo>) {
  const photos = { ...lib.get().photos }
  const changed: Photo[] = []
  for (const id of ids) {
    const cur = photos[id]
    if (!cur) continue
    photos[id] = { ...cur, ...patch(cur) }
    changed.push(photos[id])
  }
  lib.set({ photos })
  await Promise.all(changed.map((p) => db.put('photos', p.id, p)))
}

// ---------- Thumbnails ----------

const thumbUrls = new Map<string, { rev: number; url: string }>()

export async function thumbUrl(p: Photo): Promise<string | null> {
  const c = thumbUrls.get(p.id)
  if (c && c.rev === p.thumbRev) return c.url
  const blob = (await db.get<Blob>('thumbs', p.id + ':edit')) ?? (await db.get<Blob>('thumbs', p.id))
  if (!blob) return null
  if (c) URL.revokeObjectURL(c.url)
  const url = URL.createObjectURL(blob)
  thumbUrls.set(p.id, { rev: p.thumbRev, url })
  return url
}

export const baseThumb = (id: string) => db.get<Blob>('thumbs', id)

export async function setEditedThumb(id: string, blob: Blob | null) {
  if (blob) await db.put('thumbs', id + ':edit', blob)
  else await db.del('thumbs', id + ':edit')
  const p = lib.get().photos[id]
  if (p) await updatePhoto(id, { thumbRev: p.thumbRev + 1 })
}

export const originalFile = (id: string) => db.get<Blob>('files', id)

function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, q))
}

export async function makeThumb(img: ImageBitmap, max = 512): Promise<Blob> {
  const s = Math.min(1, max / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.width * s))
  c.height = Math.max(1, Math.round(img.height * s))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return canvasToBlob(c, 'image/jpeg', 0.85)
}

// ---------- Import ----------

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|bmp|avif)$/

export function isImportable(f: File) {
  return IMAGE_TYPES.test(f.type) || /\.(jpe?g|png|webp|avif|bmp|gif)$/i.test(f.name)
}

export async function importFiles(files: File[], albumId?: string): Promise<string[]> {
  const list = files.filter(isImportable)
  if (!list.length) return []
  lib.set({ importing: { done: 0, total: list.length } })
  const ids: string[] = []
  for (const f of list) {
    try {
      const id = uid()
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' })
      const thumb = await makeThumb(bmp)
      let exif: Exif | undefined
      if (/jpe?g$/i.test(f.type) || /\.jpe?g$/i.test(f.name)) exif = readExif(await f.slice(0, 256 * 1024).arrayBuffer())
      const photo: Photo = {
        id,
        name: f.name,
        type: f.type || 'image/jpeg',
        size: f.size,
        width: bmp.width,
        height: bmp.height,
        addedAt: Date.now(),
        captureDate: exifDate(exif?.date) ?? (f.lastModified || Date.now()),
        exif,
        rating: 0,
        flag: 0,
        label: null,
        keywords: [],
        title: '',
        caption: '',
        copyright: '',
        albums: albumId ? [albumId] : [],
        versions: [],
        thumbRev: 0,
      }
      bmp.close()
      await db.put('files', id, f)
      await db.put('thumbs', id, thumb)
      await db.put('photos', id, photo)
      lib.set((s) => ({ photos: { ...s.photos, [id]: photo } }))
      ids.push(id)
    } catch (e) {
      console.warn('Import failed', f.name, e)
    }
    lib.set((s) => ({ importing: s.importing ? { ...s.importing, done: s.importing.done + 1 } : null }))
  }
  lib.set({ importing: null })
  return ids
}

// ---------- Delete / trash ----------

export async function moveToTrash(ids: string[]) {
  await updatePhotos(ids, () => ({ deletedAt: Date.now() }))
}

export async function restoreFromTrash(ids: string[]) {
  await updatePhotos(ids, () => ({ deletedAt: undefined }))
}

export async function deleteForever(ids: string[]) {
  const photos = { ...lib.get().photos }
  for (const id of ids) {
    delete photos[id]
    await Promise.all([db.del('photos', id), db.del('files', id), db.del('thumbs', id), db.del('thumbs', id + ':edit')])
  }
  lib.set({ photos })
}

// ---------- Albums ----------

export async function createAlbum(name: string): Promise<Album> {
  const a: Album = { id: uid(), name, createdAt: Date.now() }
  lib.set((s) => ({ albums: { ...s.albums, [a.id]: a } }))
  await db.put('albums', a.id, a)
  return a
}

export async function renameAlbum(id: string, name: string) {
  const a = lib.get().albums[id]
  if (!a) return
  const next = { ...a, name }
  lib.set((s) => ({ albums: { ...s.albums, [id]: next } }))
  await db.put('albums', id, next)
}

export async function deleteAlbum(id: string) {
  const albums = { ...lib.get().albums }
  delete albums[id]
  lib.set({ albums })
  await db.del('albums', id)
  const ids = photoList()
    .filter((p) => p.albums.includes(id))
    .map((p) => p.id)
  await updatePhotos(ids, (p) => ({ albums: p.albums.filter((x) => x !== id) }))
}

export async function addToAlbum(albumId: string, ids: string[]) {
  await updatePhotos(ids, (p) => ({ albums: p.albums.includes(albumId) ? p.albums : [...p.albums, albumId] }))
}

export async function removeFromAlbum(albumId: string, ids: string[]) {
  await updatePhotos(ids, (p) => ({ albums: p.albums.filter((x) => x !== albumId) }))
}
