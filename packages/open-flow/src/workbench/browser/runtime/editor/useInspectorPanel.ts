import type { WorkbenchPreferences } from '../contract.ts'

import { useEffect, useRef, useState } from 'react'

export const inspectorPreferenceKey = 'open-flow:inspector-open'

export function readInspectorOpen(preferences: WorkbenchPreferences): boolean {
  try {
    return preferences.getItem(inspectorPreferenceKey) === 'true'
  } catch {
    return false
  }
}

export function writeInspectorOpen(preferences: WorkbenchPreferences, open: boolean): void {
  try {
    preferences.setItem(inspectorPreferenceKey, String(open))
  } catch {
    // Unavailable browser storage must not prevent using the inspector.
  }
}

/** Navigation is independent of selection; only a completed gesture commits workspace selection. */
export function useInspectorPanel({
  identity,
  preferences,
  selectedNodeIds,
  onSelectNodes,
}: {
  readonly identity: string
  readonly preferences: WorkbenchPreferences
  readonly selectedNodeIds: readonly string[]
  readonly onSelectNodes: (ids: readonly string[]) => void
}) {
  const [open, setOpen] = useState(() => readInspectorOpen(preferences))
  const [page, setPage] = useState<'outline' | 'properties'>('outline')
  const [gestureSelection, setGestureSelection] = useState<readonly string[]>()
  const selecting = useRef(false)

  useEffect(() => {
    selecting.current = false
    setGestureSelection(undefined)
    setPage('outline')
  }, [identity])

  useEffect(() => {
    if (selectedNodeIds.length === 0) setPage('outline')
  }, [selectedNodeIds])

  const changeOpen = (next: boolean): void => {
    setOpen(next)
    writeInspectorOpen(preferences, next)
  }
  const showSelection = (ids: readonly string[]): void => setPage(ids.length > 0 ? 'properties' : 'outline')
  const select = (ids: readonly string[]): void => {
    if (selecting.current) setGestureSelection(ids)
    else onSelectNodes(ids)
  }
  const activate = (ids: readonly string[]): void => {
    select(ids)
    if (!selecting.current && open) showSelection(ids)
  }
  const openInspector = (): void => {
    changeOpen(true)
    setPage('properties')
  }

  return {
    open,
    page: selectedNodeIds.length === 0 ? ('outline' as const) : page,
    canvasSelection: gestureSelection ?? selectedNodeIds,
    selecting: gestureSelection != null,
    select,
    activate,
    back: () => setPage('outline'),
    openInspector,
    close: () => changeOpen(false),
    startSelection: () => {
      selecting.current = true
      setGestureSelection(selectedNodeIds)
    },
    endSelection: (ids: readonly string[]) => {
      if (!selecting.current) return
      selecting.current = false
      setGestureSelection(undefined)
      onSelectNodes(ids)
      if (open) showSelection(ids)
    },
  }
}
