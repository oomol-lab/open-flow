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

function cronDraft(base: Draft): Draft {
  return {
    ...base,
    content: {
      ...base.content,
      document: {
        ...base.content.document,
        graph: {
          ...base.content.document.graph,
          nodes: {
            ...base.content.document.graph.nodes,
            start: { kind: 'cron', name: 'Schedule', cronTimes: [{ type: 'every', unit: 'day', value: 1 }] },
          },
        },
      },
    },
  }
}

it.each([false, true])('starts a cron test immediately with an explicit selection: %s', async (selected) => {
  const { client, store } = harness()
  const revision = cronDraft(entryDraft(selected))
  try {
    expect(await store.requestDraft(flow, revision, selected ? 'start' : undefined)).toBe('started')
    expect(store.$.inputRequest.value).toBeUndefined()
    expect(client.createDraftRun).toHaveBeenCalledExactlyOnceWith(
      'flow',
      'revision',
      expect.objectContaining({ trigger: { nodeId: 'start', payload: {} }, inputs: {} }),
    )
    expect(client.createLiveRun).not.toHaveBeenCalled()
  } finally {
    store.dispose()
  }
})

it('collects downstream inputs for a cron test without asking for a trigger payload', async () => {
  const { client, store } = harness()
  const revision = cronDraft(draft)
  try {
    expect(await store.requestDraft(flow, revision)).toBe('input')
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(await store.confirmInputs()).toBe(false)
    const groups = store.$.inputRequest.value?.groups ?? []
    expect(groups.map((group) => group.nodeId)).toEqual(['task'])
    groups[0]?.editor.replaceValues({ value: 'test' })
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledExactlyOnceWith(
      'flow',
      'revision',
      expect.objectContaining({ trigger: { nodeId: 'start', payload: {} }, inputs: { task: { value: 'test' } } }),
    )
  } finally {
    store.dispose()
  }
})

it('auto-selects the first entry when a graph has multiple triggers', async () => {
  const { client, store } = harness()
  try {
    expect(await store.requestDraft(flow, entryDraft(true))).toBe('started')
    expect(store.$.inputRequest.value).toBeUndefined()
    expect(client.createDraftRun).toHaveBeenCalledWith('flow', 'revision', expect.objectContaining({ trigger: { nodeId: 'start', payload: {} } }))
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

it('uses the fixed Live revision and its first entry', async () => {
  const { client, store } = harness()
  client.getLive.mockResolvedValue({ publication: { publicationId: 'publication', revisionId: 'published' } })
  client.getRevision.mockResolvedValue({ ...entryDraft(true), revisionId: 'published' })
  try {
    expect(await store.requestLive(flow)).toBe('started')
    expect(client.getRevision).toHaveBeenCalledWith('flow', 'published')
    expect(client.createLiveRun).toHaveBeenCalledWith('publication', expect.objectContaining({ trigger: { nodeId: 'start', payload: {} } }))
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
    expect(await store.requestDraft(flow, draft)).toBe('input')
    store.$.inputRequest.value?.groups[0]?.editor.replaceValues({ value: 'test' })
    prepare.mockResolvedValueOnce(undefined)
    expect(await store.confirmInputs()).toBe(false)
    expect(createDraftRun).not.toHaveBeenCalled()
    expect(await store.confirmInputs()).toBe(true)
    expect(createDraftRun).toHaveBeenCalledWith(
      'flow',
      'saved-revision',
      expect.objectContaining({ inputs: { task: { value: 'test' } }, trigger: { nodeId: 'start', payload: {} } }),
    )
  } finally {
    store.dispose()
  }
})

it('remembers valid test data for the selected trigger and reuses it on the next run', async () => {
  const { client, store } = harness()
  try {
    expect(store.inputStatus(flow.flowId, draft, 'start')).toBe('missing')
    expect(await store.requestDraft(flow, draft, 'start')).toBe('input')
    store.$.inputRequest.value?.groups[0]?.editor.replaceValues({ value: 'remembered' })
    store.dismissInputs()

    expect(store.inputStatus(flow.flowId, draft, 'start')).toBe('ready')
    expect(await store.requestDraft(flow, draft, 'start')).toBe('started')
    expect(client.createDraftRun).toHaveBeenCalledWith(
      'flow',
      'revision',
      expect.objectContaining({ inputs: { task: { value: 'remembered' } }, trigger: { nodeId: 'start', payload: {} } }),
    )
  } finally {
    store.dispose()
  }
})

it('reopens test data when its input shape changes', async () => {
  const { client, store } = harness()
  try {
    expect(await store.requestDraft(flow, draft, 'start')).toBe('input')
    store.$.inputRequest.value?.groups[0]?.editor.replaceValues({ value: 'remembered' })
    store.dismissInputs()
    const changed = {
      ...draft,
      content: {
        ...draft.content,
        document: {
          ...draft.content.document,
          graph: {
            ...draft.content.document.graph,
            nodes: {
              ...draft.content.document.graph.nodes,
              task: {
                inputs: {},
                kind: 'task',
                task: {
                  inputs: [{ handle: 'value', jsonSchema: { type: 'number' }, nullable: false }],
                  moduleId: 'module',
                  name: 'Code',
                  outputs: [],
                },
              },
            },
          },
        },
      },
    } satisfies Draft

    expect(store.inputStatus(flow.flowId, changed, 'start')).toBe('missing')
    expect(await store.requestDraft(flow, changed, 'start')).toBe('input')
    expect(client.createDraftRun).not.toHaveBeenCalled()
  } finally {
    store.dispose()
  }
})

function webhookDraft(): Draft {
  const revision = entryDraft()
  return {
    ...revision,
    content: {
      ...revision.content,
      document: {
        ...revision.content.document,
        graph: { edges: [], nodes: { start: { kind: 'webhook', name: 'Webhook', inputsDef: [], options: {} } } },
      },
    },
  }
}

it('keeps the run button idle throughout opening the test data editor', async () => {
  const { client, store } = harness()
  const starting: boolean[] = []
  const unsubscribe = store.$.starting.subscribe((value) => starting.push(value))
  try {
    const opening = store.editDraft(flow, webhookDraft(), 'start')
    expect(store.$.starting.value).toBe(false)
    expect(await opening).toBe('input')
    expect(starting).not.toContain(true)
    expect(client.createDraftRun).not.toHaveBeenCalled()
  } finally {
    unsubscribe()
    store.dispose()
  }
})

it('preserves missing webhook data across untouched open/close cycles', async () => {
  const { client, store } = harness()
  const revision = webhookDraft()
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      expect(await store.editDraft(flow, revision, 'start')).toBe('input')
      expect(store.$.inputRequest.value?.groups[0]?.editor.values()).toEqual({})
      expect(store.$.inputRequest.value?.valid.value).toBe(false)
      store.dismissInputs()
      expect(store.inputStatus(flow.flowId, revision, 'start')).toBe('missing')
    }
    expect(await store.requestDraft(flow, revision, 'start')).toBe('input')
    expect(await store.confirmInputs()).toBe(false)
    expect(client.createDraftRun).not.toHaveBeenCalled()
  } finally {
    store.dispose()
  }
})

it('remembers explicitly entered empty payloads and keeps cleared data missing', async () => {
  const { client, store } = harness()
  const revision = webhookDraft()
  try {
    await store.editDraft(flow, revision, 'start')
    store.$.inputRequest.value?.groups[0]?.editor.setValue('payload', {})
    store.dismissInputs()
    expect(store.inputStatus(flow.flowId, revision, 'start')).toBe('ready')
    expect(await store.requestDraft(flow, revision, 'start')).toBe('started')
    expect(client.createDraftRun).toHaveBeenCalledWith('flow', 'revision', expect.objectContaining({ trigger: { nodeId: 'start', payload: {} } }))
    await store.editDraft(flow, revision, 'start')
    expect(store.$.inputRequest.value?.groups[0]?.editor.values()).toEqual({ payload: {} })
    store.$.inputRequest.value?.groups[0]?.editor.setValue('payload', undefined)
    store.dismissInputs()
    expect(store.inputStatus(flow.flowId, revision, 'start')).toBe('missing')
    await store.editDraft(flow, revision, 'start')
    expect(store.$.inputRequest.value?.groups[0]?.editor.values()).toEqual({})
  } finally {
    store.dispose()
  }
})
