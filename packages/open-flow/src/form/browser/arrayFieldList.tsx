import type { ReactNode } from 'react'

import { useState } from 'react'
import { SortableFieldList } from './sortableFieldList.tsx'

/** Local keys follow moved items, including duplicate values, so editor state and focus move with them. */
export function ArrayFieldList({
  values,
  label,
  onReorder,
  children,
}: {
  values: readonly unknown[]
  label: string
  onReorder?: (values: unknown[]) => void
  children: (value: unknown, index: number, handle?: ReactNode) => ReactNode
}) {
  const [identity, setIdentity] = useState(() => ({ values, keys: values.map((_, i) => String(i)), nextKey: values.length }))
  let current = identity
  if (identity.values !== values) {
    let nextKey = identity.nextKey
    const used = new Set<number>()
    const keys = values.map((value, index) => {
      // Ordinary edits retain the editor at that position; insertions/removals track unchanged items.
      const previous = values.length === identity.values.length ? index : identity.values.findIndex((entry, i) => !used.has(i) && Object.is(entry, value))
      if (previous < 0) return String(nextKey++)
      used.add(previous)
      return identity.keys[previous]!
    })
    current = { values, keys, nextKey }
    setIdentity(current)
  }
  return (
    <SortableFieldList
      kind="array"
      names={current.keys}
      getLabel={(key) => `${label}.${current.keys.indexOf(key)}`}
      onReorder={
        onReorder
          ? (keys) => {
              const next = keys.map((key) => values[current.keys.indexOf(key)])
              setIdentity({ values: next, keys, nextKey: current.nextKey })
              onReorder(next)
            }
          : undefined
      }
    >
      {(key, handle) => {
        const index = current.keys.indexOf(key)
        return children(values[index], index, handle)
      }}
    </SortableFieldList>
  )
}
