/* oxlint-disable import/no-unassigned-import */
import 'fake-indexeddb/auto'
/* oxlint-enable import/no-unassigned-import */

if (typeof globalThis.sessionStorage === 'undefined') {
  const values = new Map<string, string>()
  globalThis.sessionStorage = {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(String(key), String(value))
    },
  } as Storage
}
