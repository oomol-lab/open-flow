import { useCallback, useEffect, useState } from 'react'

/** Temporary display state. It does not change the saved graph or execution. */
export function useIgnoredNodes(identity: string) {
  const [ignoredNodeIds, setIgnoredNodeIds] = useState<readonly string[]>([])
  useEffect(() => setIgnoredNodeIds([]), [identity])
  const onIgnoreNodes = useCallback((nodeIds: readonly string[], ignored: boolean) => {
    setIgnoredNodeIds((previous) => {
      const next = new Set(previous)
      for (const id of nodeIds) {
        if (ignored) next.add(id)
        else next.delete(id)
      }
      return [...next]
    })
  }, [])
  return { ignoredNodeIds, onIgnoreNodes }
}
