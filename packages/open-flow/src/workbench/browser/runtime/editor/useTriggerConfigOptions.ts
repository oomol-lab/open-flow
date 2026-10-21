import type { TriggerConfigOption } from '../../../../control/common/api.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useEffect, useState } from 'react'

type OptionsState = {
  readonly failed: boolean
  readonly key: string
  readonly loading: boolean
  readonly options?: readonly TriggerConfigOption[]
}

export function useTriggerConfigOptions(store: WorkspaceStore, nodeId: string, field: string, scope: string, enabled: boolean) {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([nodeId, field, scope])
  const [state, setState] = useState<OptionsState>()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState((current) => ({
      failed: false,
      key,
      loading: true,
      options: current?.key == key ? current.options : undefined,
    }))
    void store.loadTriggerConfigOptions(nodeId, field, controller.signal).then(
      (options) => {
        if (!controller.signal.aborted) setState({ failed: false, key, loading: false, options })
      },
      () => {
        if (!controller.signal.aborted)
          setState((current) => ({
            failed: true,
            key,
            loading: false,
            options: current?.key == key ? current.options : undefined,
          }))
      },
    )
    return () => controller.abort()
  }, [store, nodeId, field, scope, key, enabled, attempt])
  const current = enabled && state?.key == key ? state : undefined
  return {
    failed: current?.failed ?? false,
    loading: enabled && (current?.loading ?? true),
    options: current?.options,
    refresh: () => setAttempt((value) => value + 1),
  }
}
