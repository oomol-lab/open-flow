import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from './api.ts'

describe('WorkbenchClient notifications', () => {
  it('keeps catalog and current Flow subscriptions independent', () => {
    let catalogListener: ((event?: { readonly kind: 'flows.changed'; readonly version: 1 }) => void) | undefined
    let flowListener:
      | ((
          event?:
            | { readonly flowId: string; readonly kind: 'draft.changed'; readonly revisionId: string; readonly version: 1 }
            | { readonly flowId: string; readonly kind: 'run.created' | 'run.changed'; readonly runId: string; readonly version: 1 },
        ) => void)
      | undefined
    const subscribeCatalog = vi.fn((listener: typeof catalogListener) => {
      catalogListener = listener
      return () => {}
    })
    const subscribeFlow = vi.fn((_flowId: string, listener: NonNullable<typeof flowListener>) => {
      flowListener = listener
      return () => {}
    })
    const client = new WorkbenchClient(vi.fn(), subscribeFlow, subscribeCatalog)
    const catalogChanged = vi.fn()
    const draftChanged = vi.fn()
    const runCreated = vi.fn()

    client.watchFlowCatalog(catalogChanged)
    client.watchFlow('flow-1', draftChanged, runCreated)
    catalogListener?.({ kind: 'flows.changed', version: 1 })
    flowListener?.({ flowId: 'flow-1', kind: 'draft.changed', revisionId: 'revision-2', version: 1 })
    flowListener?.({ flowId: 'flow-1', kind: 'run.created', runId: 'run-1', version: 1 })
    flowListener?.({ flowId: 'flow-1', kind: 'run.changed', runId: 'run-1', version: 1 })

    expect(subscribeCatalog).toHaveBeenCalledOnce()
    expect(subscribeFlow).toHaveBeenCalledWith('flow-1', expect.any(Function))
    expect(catalogChanged).toHaveBeenCalledWith({ kind: 'flows.changed', version: 1 })
    expect(draftChanged).toHaveBeenCalledWith('revision-2')
    expect(runCreated).toHaveBeenNthCalledWith(1, { flowId: 'flow-1', kind: 'run.created', runId: 'run-1', version: 1 })
    expect(runCreated).toHaveBeenNthCalledWith(2, { flowId: 'flow-1', kind: 'run.changed', runId: 'run-1', version: 1 })
  })

  it('uses the Flow-scoped Presentation route', async () => {
    const request = vi.fn(async () => Response.json({ revision: 2, updatedAt: '2026-08-14T00:00:00.000Z', value: {}, version: 1 }))
    const client = new WorkbenchClient(request)

    await client.updatePresentation('flow/1', 1, { node: { x: 1 } })

    expect(request).toHaveBeenCalledWith(
      '/v1/flows/flow%2F1/presentation',
      expect.objectContaining({ body: JSON.stringify({ expectedRevision: 1, value: { node: { x: 1 } }, version: 1 }), method: 'PUT' }),
    )
  })
})
