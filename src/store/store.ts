// Tiny observable store used with React's useSyncExternalStore.
import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get(): T
  set(update: Partial<T> | ((s: T) => Partial<T>)): void
  subscribe(fn: () => void): () => void
  use<U>(select: (s: T) => U): U
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  const store: Store<T> = {
    get: () => state,
    set(update) {
      const patch = typeof update === 'function' ? update(state) : update
      state = { ...state, ...patch }
      for (const l of listeners) l()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    use(select) {
      return useSyncExternalStore(store.subscribe, () => select(state))
    },
  }
  return store
}
