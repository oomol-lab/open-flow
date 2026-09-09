import type { DisposableType, Disposer } from '@wopjs/disposable'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { ReadonlyReactiveMap, ReactiveMap, ReadonlyReactiveList, ReactiveList, ReadonlyReactiveSet, ReactiveSet } from 'value-enhancer/collections'

import { disposableMap } from '@wopjs/disposable'

export type ToReadonly$<T> =
  T extends Val<infer TValue>
    ? ReadonlyVal<TValue>
    : T extends ReactiveMap<infer TKey, infer TValue>
      ? ReadonlyReactiveMap<TKey, TValue>
      : T extends ReactiveList<infer TValue>
        ? ReadonlyReactiveList<TValue>
        : T extends ReactiveSet<infer TValue>
          ? ReadonlyReactiveSet<TValue>
          : T

export type ToReadonly$Group<TObj> = {
  [K in keyof TObj]: ToReadonly$<TObj[K]>
}

/** Runs and owns one disposable effect for every reactive map entry. */
export const watchEach = <K, V>(
  map$: ReadonlyReactiveMap<K, V>,
  callbackfn: (value: V, key: K, map$: ReadonlyReactiveMap<K, V>) => DisposableType,
  thisArg?: any,
): Disposer => {
  const disposers = disposableMap()
  const disposer = map$.$.subscribe((map) => {
    for (const key of disposers.keys()) {
      if (!map.has(key)) {
        disposers.flush(key)
      }
    }
    for (const [key, value] of map) {
      if (!disposers.has(key)) {
        disposers.set(key, callbackfn.call(thisArg, value, key, map$))
      }
    }
  })
  return () => {
    disposer()
    disposers()
  }
}
