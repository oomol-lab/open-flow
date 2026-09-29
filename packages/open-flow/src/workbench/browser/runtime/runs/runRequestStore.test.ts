import type { Draft, Flow } from '../api.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it, vi } from 'vitest'
import { sampleErrorOutputs } from '../../../../trigger/common/contract.ts'
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
    modelVersion: currentFlowModelVersion,
    modules: { module: { imports: [], name: 'Code', source: 'export default () => ({})' } },
  },
  createdAt: timestamp,
  digest: 'digest',
  flowId: flow.flowId,
  modelVersion: currentFlowModelVersion,
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
      const request = store.requestDraft(flow, webhookDraft())

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
    expect(client.createDraftRun).toHaveBeenCalledWith('flow', 'revision', expect.objectContaining({ trigger: { nodeId: 'start', outputs: {} } }))
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
      expect.objectContaining({ trigger: { nodeId: 'start', outputs: { scheduledAt: expect.any(String) } }, inputs: {} }),
    )
    expect(client.createLiveRun).not.toHaveBeenCalled()
  } finally {
    store.dispose()
  }
})

it.each(['manual', 'cron'] as const)('ignores downstream inputs when testing %s', async (kind) => {
  const { client, store } = harness()
  const revision = kind === 'cron' ? cronDraft(draft) : draft
  try {
    expect(store.inputStatus(flow.flowId, revision, 'start')).toBe('none')
    expect(await store.requestDraft(flow, revision, 'start')).toBe('started')
    expect(store.$.inputRequest.value).toBeUndefined()
    expect(client.createDraftRun).toHaveBeenCalledExactlyOnceWith(
      'flow',
      'revision',
      expect.objectContaining({
        trigger: { nodeId: 'start', outputs: kind === 'cron' ? { scheduledAt: expect.any(String) } : {} },
        inputs: {},
      }),
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
    expect(client.createDraftRun).toHaveBeenCalledWith('flow', 'revision', expect.objectContaining({ trigger: { nodeId: 'start', outputs: {} } }))
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
    expect(client.createLiveRun).toHaveBeenCalledWith('publication', expect.objectContaining({ trigger: { nodeId: 'start', outputs: {} } }))
  } finally {
    store.dispose()
  }
})

it('runs the manual entry selected on the canvas without reopening entry selection', async () => {
  const { client, store } = harness()
  try {
    expect(await store.requestDraft(flow, entryDraft(true), 'other')).toBe('started')
    expect(store.$.inputRequest.value).toBeUndefined()
    expect(client.createDraftRun).toHaveBeenCalledWith('flow', 'revision', expect.objectContaining({ trigger: { nodeId: 'other', outputs: {} } }))
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
    expect(await store.requestDraft(flow, webhookDraft())).toBe('input')
    store.$.inputRequest.value?.editor?.replaceValues(webhookOutputs)
    prepare.mockResolvedValueOnce(undefined)
    expect(await store.confirmInputs()).toBe(false)
    expect(createDraftRun).not.toHaveBeenCalled()
    expect(await store.confirmInputs()).toBe(true)
    expect(createDraftRun).toHaveBeenCalledWith(
      'flow',
      'saved-revision',
      expect.objectContaining({ inputs: {}, trigger: { nodeId: 'start', outputs: webhookOutputs } }),
    )
  } finally {
    store.dispose()
  }
})

it('remembers valid test data for the selected trigger and reuses it on the next run', async () => {
  const { client, store } = harness()
  try {
    expect(store.inputStatus(flow.flowId, webhookDraft(), 'start')).toBe('missing')
    expect(await store.requestDraft(flow, webhookDraft(), 'start')).toBe('input')
    store.$.inputRequest.value?.editor?.replaceValues(webhookOutputs)
    store.dismissInputs()

    expect(store.inputStatus(flow.flowId, webhookDraft(), 'start')).toBe('ready')
    expect(await store.requestDraft(flow, webhookDraft(), 'start')).toBe('started')
    expect(client.createDraftRun).toHaveBeenCalledWith(
      'flow',
      'revision',
      expect.objectContaining({ inputs: {}, trigger: { nodeId: 'start', outputs: webhookOutputs } }),
    )
  } finally {
    store.dispose()
  }
})

it('reopens test data when its input shape changes', async () => {
  const { client, store } = harness()
  try {
    expect(await store.requestDraft(flow, webhookDraft(), 'start')).toBe('input')
    store.$.inputRequest.value?.editor?.replaceValues(webhookOutputs)
    store.dismissInputs()
    const revision = webhookDraft()
    const changed = {
      ...revision,
      content: {
        ...revision.content,
        document: {
          ...revision.content.document,
          graph: {
            ...revision.content.document.graph,
            nodes: {
              ...revision.content.document.graph.nodes,
              start: {
                kind: 'webhook',
                method: 'POST',
                name: 'Webhook',
                options: {},
                bodyFields: [{ handle: 'count', jsonSchema: { type: 'number' }, nullable: false }],
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

const webhookOutputs = { headers: {}, query: {}, body: {}, webhookUrl: 'http://example.com/webhook' }

function webhookDraft(): Draft {
  const revision = draft
  return {
    ...revision,
    content: {
      ...revision.content,
      document: {
        ...revision.content.document,
        graph: {
          ...revision.content.document.graph,
          nodes: { ...revision.content.document.graph.nodes, start: { kind: 'webhook', method: 'POST', name: 'Webhook', bodyFields: [], options: {} } },
        },
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
      expect(store.$.inputRequest.value?.editor?.values()).toEqual({})
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

it('remembers explicitly entered empty bodies and keeps cleared data missing', async () => {
  const { client, store } = harness()
  const revision = webhookDraft()
  try {
    await store.editDraft(flow, revision, 'start')
    const outputs = { headers: {}, query: {}, body: {}, webhookUrl: 'http://example.com/webhook' }
    store.$.inputRequest.value?.editor?.replaceValues(outputs)
    store.dismissInputs()
    expect(store.inputStatus(flow.flowId, revision, 'start')).toBe('ready')
    expect(await store.requestDraft(flow, revision, 'start')).toBe('started')
    expect(client.createDraftRun).toHaveBeenCalledWith('flow', 'revision', expect.objectContaining({ trigger: { nodeId: 'start', outputs } }))
    await store.editDraft(flow, revision, 'start')
    expect(store.$.inputRequest.value?.editor?.values()).toEqual(outputs)
    store.$.inputRequest.value?.editor?.setValue('body', undefined)
    store.dismissInputs()
    expect(store.inputStatus(flow.flowId, revision, 'start')).toBe('missing')
    await store.editDraft(flow, revision, 'start')
    expect(store.$.inputRequest.value?.editor?.values()).toEqual({ headers: {}, query: {}, webhookUrl: outputs.webhookUrl })
  } finally {
    store.dispose()
  }
})

it('prefills Flow Error test data and preserves intentional edits in the session', async () => {
  const { store, client } = harness()
  const revision = entryDraft()
  const errorDraft: Draft = {
    ...revision,
    content: {
      ...revision.content,
      document: { ...revision.content.document, graph: { nodes: { error: { kind: 'error', name: 'Flow Error' } }, edges: [] } },
    },
  }
  try {
    await store.editDraft(flow, errorDraft, 'error')
    const request = store.$.inputRequest.value!
    expect(request.editor!.values()).toEqual(sampleErrorOutputs)
    expect(request.valid.value).toBe(true)
    request.editor!.replaceValues({})
    store.dismissInputs()
    await store.editDraft(flow, errorDraft, 'error')
    expect(store.$.inputRequest.value!.editor!.values()).toEqual({})
    expect(store.$.inputRequest.value!.valid.value).toBe(false)
    expect(client.createDraftRun).not.toHaveBeenCalled()
  } finally {
    store.dispose()
  }
})

it('edits only the selected trigger outputs and remembers each trigger separately', async () => {
  const { client, store } = harness()
  const revision = webhookDraft()
  const graph = revision.content.document.graph
  const multiple: Draft = {
    ...revision,
    content: {
      ...revision.content,
      document: {
        ...revision.content.document,
        graph: { ...graph, nodes: { ...graph.nodes, other: { kind: 'webhook', name: 'Other', method: 'POST', bodyFields: [], options: {} } } },
      },
    },
  }
  try {
    await store.editDraft(flow, multiple, 'start')
    expect(store.$.inputRequest.value?.editor?.definitions.map((definition) => definition.handle)).toEqual(['headers', 'query', 'body', 'webhookUrl'])
    store.$.inputRequest.value?.editor?.replaceValues(webhookOutputs)
    await store.selectTrigger('other')
    expect(store.$.inputRequest.value?.editor?.values()).toEqual({})
    expect(await store.confirmInputs()).toBe(false)
    await store.selectTrigger('start')
    expect(store.$.inputRequest.value?.editor?.values()).toEqual(webhookOutputs)
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledWith(
      'flow',
      'revision',
      expect.objectContaining({
        inputs: {},
        trigger: { nodeId: 'start', outputs: webhookOutputs },
      }),
    )
  } finally {
    store.dispose()
  }
})
