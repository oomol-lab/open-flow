/* oxlint-disable no-underscore-dangle -- Guest bridge names match the VM host bindings. */
/* global groups */
import { loadBuiltin as load } from './web.mjs'
const defineProperty = Object.defineProperty
const target = globalThis
// Global groups.
for (const [group, names] of Object.entries(groups)) {
  let exports
  for (const name of names) {
    const set = (value) => defineProperty(target, name, { value, writable: true, enumerable: true, configurable: true })
    defineProperty(target, name, {
      configurable: true,
      enumerable: true,
      get() {
        exports ??= load(group)
        const value = exports[name]
        set(value)
        return value
      },
      set,
    })
  }
}
