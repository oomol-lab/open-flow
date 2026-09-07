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
        edges: [{ source: 'start', target: 'task' }],
        nodes: {
          start: { kind: 'manual', name: 'Start' },
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
      async () => draft.revisionId,
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

function harness() {
  const client = {
    createDraftRun: vi.fn().mockResolvedValue({ runId: 'run' }),
    createLiveRun: vi.fn().mockResolvedValue({ runId: 'live-run' }),
    getLive: vi.fn(),
    getRevision: vi.fn(),
  }
  const notice = vi.fn()
  const store = new RunRequestStore(client, { follow: vi.fn().mockResolvedValue(true), prepareStart: () => () => true }, notice, async () => draft.revisionId)
  return { client, notice, store }
}

function entryDraft(multiple = false): Draft {
  return {
    ...draft,
    content: {
      ...draft.content,
      document: {
        ...draft.content.document,
        graph: {
          nodes: { start: { kind: 'manual', name: 'Start' }, ...(multiple ? { other: { kind: 'manual' as const, name: 'Other' } } : {}) },
          edges: [],
        },
      },
    },
  }
}

it('starts directly from the only manual trigger', async () => {
  const { client, store } = harness()
  try {
    expect(await store.requestDraft(flow, entryDraft())).toBe('started')
    expect(client.createDraftRun).toHaveBeenCalledWith('flow', 'revision', expect.objectContaining({ trigger: { nodeId: 'start', payload: {} } }))
    expect(store.$.inputRequest.value).toBeUndefined()
  } finally {
    store.dispose()
  }
})

it('requires an explicit choice for multiple triggers and submits only the selected entry', async () => {
  const { client, store } = harness()
  try {
    expect(await store.requestDraft(flow, entryDraft(true))).toBe('input')
    expect(store.$.inputRequest.value?.triggerId).toBeUndefined()
    expect(await store.confirmInputs()).toBe(false)
    expect(client.createDraftRun).not.toHaveBeenCalled()
    await store.selectTrigger('other')
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledWith('flow', 'revision', expect.objectContaining({ trigger: { nodeId: 'other', payload: {} } }))
    expect(await store.requestDraft(flow, entryDraft(true))).toBe('input')
    expect(store.$.inputRequest.value?.triggerId).toBeUndefined()
  } finally {
    store.dispose()
  }
})

it('does not run a graph without an entry', async () => {
  const { client, notice, store } = harness()
  const empty = entryDraft()
  try {
    expect(
      await store.requestDraft(flow, { ...empty, content: { ...empty.content, document: { ...empty.content.document, graph: { nodes: {}, edges: [] } } } }),
    ).toBe('unavailable')
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
  } finally {
    store.dispose()
  }
})

it('uses the fixed Live revision when choosing an entry', async () => {
  const { client, store } = harness()
  client.getLive.mockResolvedValue({ publication: { publicationId: 'publication', revisionId: 'published' } })
  client.getRevision.mockResolvedValue({ ...entryDraft(true), revisionId: 'published' })
  try {
    expect(await store.requestLive(flow)).toBe('input')
    await store.selectTrigger('other')
    expect(await store.confirmInputs()).toBe(true)
    expect(client.getRevision).toHaveBeenCalledWith('flow', 'published')
    expect(client.createLiveRun).toHaveBeenCalledWith('publication', expect.objectContaining({ trigger: { nodeId: 'other', payload: {} } }))
  } finally {
    store.dispose()
  }
})

it('runs the manual entry selected on the canvas without reopening entry selection', async () => {
  const { client, store } = harness()
  try {
    expect(await store.requestDraft(flow, entryDraft(true), 'other')).toBe('started')
    expect(store.$.inputRequest.value).toBeUndefined()
    expect(client.createDraftRun).toHaveBeenCalledWith('flow', 'revision', expect.objectContaining({ trigger: { nodeId: 'other', payload: {} } }))
  } finally {
    store.dispose()
  }
})

it('refuses a deleted selection instead of running the remaining trigger', async () => {
  const { client, store } = harness()
  try {
    expect(await store.requestDraft(flow, entryDraft(), 'other')).toBe('unavailable')
    expect(client.createDraftRun).not.toHaveBeenCalled()
  } finally {
    store.dispose()
  }
})

it('flushes pending code again before confirming inputs and uses the saved revision', async () => {
  const createDraftRun = vi.fn().mockResolvedValue({ runId: 'run' })
  const prepare = vi.fn(async () => 'saved-revision' as string | undefined)
  const store = new RunRequestStore(
    { createDraftRun, createLiveRun: vi.fn(), getLive: vi.fn(), getRevision: vi.fn() },
    { follow: vi.fn().mockResolvedValue(true), prepareStart: () => () => true },
    vi.fn(),
    prepare,
  )
  try {
    expect(await store.requestDraft(flow, entryDraft(true))).toBe('input')
    await store.selectTrigger('other')
    prepare.mockResolvedValueOnce(undefined)
    expect(await store.confirmInputs()).toBe(false)
    expect(createDraftRun).not.toHaveBeenCalled()
    expect(await store.confirmInputs()).toBe(true)
    expect(createDraftRun).toHaveBeenCalledWith('flow', 'saved-revision', expect.objectContaining({ trigger: { nodeId: 'other', payload: {} } }))
  } finally {
    store.dispose()
  }
})
