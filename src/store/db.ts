// Minimal IndexedDB wrapper. Everything stays in this browser.

const DB_NAME = 'gradestudio'
const VERSION = 1
export const STORES = ['photos', 'files', 'thumbs', 'albums', 'presets'] as const
export type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open()
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>
}

export async function put(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await open()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value, key)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function del(store: StoreName, key: string): Promise<void> {
  const db = await open()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function all<T>(store: StoreName): Promise<T[]> {
  const db = await open()
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>
}
