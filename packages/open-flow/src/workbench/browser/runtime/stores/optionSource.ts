import type { ReadonlyVal } from 'value-enhancer'
import type { ResourceSource, ResourceState } from './resource.ts'

import { compute } from 'value-enhancer'

export function mapSource<T, U>(source: ResourceSource<T>, signal: AbortSignal, map: (data: T) => U): ResourceSource<U> {
  if ('then' in source) return source.then((data) => (data === undefined ? undefined : map(data)))
  return scopedValue(signal, (get) => {
    const state = get(source)
    return { ...state, data: state.data === undefined ? undefined : map(state.data) }
  })
}

export function scopedValue<T>(signal: AbortSignal, derive: (get: <V>(value: ReadonlyVal<V>) => V) => ResourceState<T>): ReadonlyVal<ResourceState<T>> {
  const value = compute(derive)
  signal.addEventListener('abort', () => value.dispose(), { once: true })
  return value
}

export function combineSources<T>(signal: AbortSignal, sources: readonly ReadonlyVal<ResourceState<readonly T[]>>[]): ReadonlyVal<ResourceState<readonly T[]>> {
  return scopedValue(signal, (get) => {
    const states = sources.map((source) => get(source))
    return {
      data: states.every((state) => state.data === undefined) ? undefined : states.flatMap((state) => state.data ?? []),
      refreshing: states.some((state) => state.refreshing || (state.data === undefined && state.error == null)),
      error: states.find((state) => state.error != null)?.error,
    }
  })
}
