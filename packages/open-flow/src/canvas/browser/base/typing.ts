import type { ReadonlyVal, Val } from 'value-enhancer'
import type { ReactiveList, ReactiveMap, ReactiveSet, ReadonlyReactiveList, ReadonlyReactiveMap, ReadonlyReactiveSet } from 'value-enhancer/collections'

export type ID<Type extends string | number, Entity> = Type & {
  __PHANTOM_TYPE__: Entity
}

// https://www.totaltypescript.com/concepts/the-prettify-helper
export type Prettify<T> = { [K in keyof T]: T[K] } & {}

export type MapUndefined<T> = { readonly [K in keyof T]?: undefined }

export type WritableReactive<T> =
  T extends ReadonlyVal<infer TValue>
    ? Val<TValue>
    : T extends ReadonlyReactiveMap<infer TKey, infer TValue>
      ? ReactiveMap<TKey, TValue>
      : T extends ReadonlyReactiveList<infer TValue>
        ? ReactiveList<TValue>
        : T extends ReadonlyReactiveSet<infer TValue>
          ? ReactiveSet<TValue>
          : T

export type Mutable<T> = { -readonly [TKey in keyof T]: T[TKey] }
