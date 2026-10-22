import { vi } from 'vitest'

vi.mock('webextension-polyfill')

// Node 25 ships a global `localStorage` that lacks the Storage methods unless
// started with --localstorage-file, and it shadows jsdom's implementation.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const items = new Map<string, string>()
  globalThis.localStorage = {
    get length() {
      return items.size
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, String(v)),
    removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(),
  } as Storage
}
