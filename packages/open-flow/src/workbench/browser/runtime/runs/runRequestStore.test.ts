import type { Draft, Flow } from '../api.ts'

import { describe, expect, it, vi } from 'vitest'
import { RunRequestStore } from './runRequestStore.ts'

const timestamp = '2026-08-30T00:00:00.000Z'

const flow: Flow = {
  createdAt: timestamp,
  draftRevisionId: 'revision',
  flowId: 'flow',
  name: 'Flow',
  status: 'active',
  updatedAt: timestamp,
  version: 1,
}

const draft: Draft = {
  actorId: 'actor',
  content: {
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          task: {
            inputs: {},
            kind: 'task',
            task: {
              inputs: [{ handle: 'value', jsonSchema: {}, nullable: false }],
              moduleId: 'module',
              name: 'Code',
              outputs: [],
            },
          },
        },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: { module: { imports: [], name: 'Code', source: 'export default () => ({})' } },
  },
  createdAt: timestamp,
  digest: 'digest',
  flowId: flow.flowId,
  modelVersion: 1,
  parentRevisionId: null,
  revisionId: flow.draftRevisionId,
  version: 1,
}

describe('RunRequestStore input preparation', () => {
  it('does not report a run submission while collecting required inputs', async () => {
    const store = new RunRequestStore(
      {
        createDraftRun: vi.fn(),
        createLiveRun: vi.fn(),
        getLive: vi.fn(),
        getRevision: vi.fn(),
      },
      { follow: vi.fn(), prepareStart: vi.fn() },
      vi.fn(),
    )

    try {
      const request = store.requestDraft(flow, draft)

      expect(store.$.starting.value).toBe(true)
      expect(store.$.submitting.value).toBeUndefined()
      await expect(request).resolves.toBe('input')
    } finally {
      store.dispose()
    }
  })
})
