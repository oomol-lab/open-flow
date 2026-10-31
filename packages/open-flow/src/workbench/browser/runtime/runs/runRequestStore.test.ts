import type { Draft, Flow, Port } from '../api.ts'
import type { RunInputStorageScope } from './runInputStorage.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it, vi } from 'vitest'
import { sampleErrorOutputs } from '../../../../trigger/common/contract.ts'
import { Latest } from '../stores/latest.ts'
import { RunRequestStore } from './runRequestStore.ts'

const timestamp = '2026-08-30T00:00:00.000Z'

const flow: Flow = {
  createdAt: timestamp,
  draftRevisionId: 'revision',
  resourceReferences: {
    draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
    sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
  },
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
      { captureSelection: () => () => true, follow: vi.fn(), prepareStart: vi.fn() },
      vi.fn(),
      async () => draft,
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

function harness(inputStorage?: RunInputStorageScope) {
  const client = {
    createDraftRun: vi.fn().mockResolvedValue({ runId: 'run' }),
    createLiveRun: vi.fn().mockResolvedValue({ runId: 'live-run' }),
    getLive: vi.fn(),
    getRevision: vi.fn(),
  }
  const notice = vi.fn()
  let currentDraft = draft
  const prepare = vi.fn(async (): Promise<Draft | undefined> => currentDraft)
  const selection = new Latest()
  const runs = {
    captureSelection: vi.fn(() => selection.capture()),
    follow: vi.fn().mockResolvedValue(true),
    prepareStart: vi.fn(() => selection.begin()),
  }
  const store = new RunRequestStore(client, runs, notice, prepare, undefined, undefined, inputStorage)
  const requestDraft = store.requestDraft.bind(store)
  const editDraft = store.editDraft.bind(store)
  vi.spyOn(store, 'requestDraft').mockImplementation((requestedFlow, revision, triggerId) => {
    currentDraft = revision
    return requestDraft(requestedFlow, revision, triggerId)
  })
  vi.spyOn(store, 'editDraft').mockImplementation((requestedFlow, revision, triggerId) => {
    currentDraft = revision
    return editDraft(requestedFlow, revision, triggerId)
  })
  return { client, notice, store, prepare, runs, selection }
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
  const prepare = vi.fn(async (): Promise<Draft | undefined> => ({ ...webhookDraft(), revisionId: 'saved-revision' }))
  const store = new RunRequestStore(
    { createDraftRun, createLiveRun: vi.fn(), getLive: vi.fn(), getRevision: vi.fn() },
    { captureSelection: () => () => true, follow: vi.fn().mockResolvedValue(true), prepareStart: () => () => true },
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

function startDraft(required = false): Draft {
  return {
    ...draft,
    content: {
      ...draft.content,
      document: {
        ...draft.content.document,

        graph: {
          ...draft.content.document.graph,
          nodes: {
            ...draft.content.document.graph.nodes,
            start: { kind: 'start', name: 'Start', inputDefs: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: !required }] },
          },
        },
      },
    },
  }
}

it('restores submitted Start parameters from IndexedDB in a new editing session', async () => {
  const scope = { sessionId: crypto.randomUUID(), environment: 'test', connectorOwnerId: 'team' }
  const revision = startDraft()
  const first = harness(scope)
  await first.store.editDraft(flow, revision, 'start')
  first.store.$.inputRequest.value!.editor!.setValue('message', 'Keep after refresh')
  expect(await first.store.confirmInputs()).toBe(true)
  first.store.dispose()

  const restored = harness(scope)
  try {
    expect(await restored.store.requestDraft(flow, revision, 'start')).toBe('started')
    expect(restored.client.createDraftRun).toHaveBeenCalledWith(
      flow.flowId,
      revision.revisionId,
      expect.objectContaining({ trigger: { nodeId: 'start', outputs: { message: 'Keep after refresh' } } }),
    )
    expect(restored.store.$.inputsLoaded.value).toBe(true)
    expect(restored.store.inputStatus(flow.flowId, revision, 'start')).toBe('ready')
    await restored.store.editDraft(flow, revision, 'start')
    expect(restored.store.$.inputRequest.value!.editor!.values()).toEqual({ message: 'Keep after refresh' })
  } finally {
    restored.store.dispose()
  }

  for (const otherScope of [
    { ...scope, sessionId: 'other-user' },
    { ...scope, environment: 'other-environment' },
    { ...scope, connectorOwnerId: 'other-team' },
  ]) {
    const other = harness(otherScope)
    try {
      expect(await other.store.editDraft(flow, revision, 'start')).toBe('input')
      expect(other.store.$.inputRequest.value!.editor!.values()).toEqual({})
      expect(other.store.inputStatus(flow.flowId, revision, 'start')).toBe('missing')
    } finally {
      other.store.dispose()
    }
  }
})

it.each([undefined, null, ''])('preserves omitted, null and empty Start values across sessions: %s', async (value) => {
  const scope = { sessionId: crypto.randomUUID() }
  const revision = startDraft()
  const first = harness(scope)
  await first.store.editDraft(flow, revision, 'start')
  first.store.$.inputRequest.value!.editor!.setValue('message', value)
  expect(await first.store.confirmInputs()).toBe(true)
  first.store.dispose()

  const restored = harness(scope)
  try {
    await restored.store.editDraft(flow, revision, 'start')
    expect(restored.store.$.inputRequest.value!.editor!.values()).toEqual(value === undefined ? {} : { message: value })
    restored.store.dismissInputs()
    if (value === undefined) {
      expect(await restored.store.requestDraft(flow, startDraft(true), 'start')).toBe('input')
      expect(await restored.store.confirmInputs()).toBe(false)
      expect(restored.client.createDraftRun).not.toHaveBeenCalled()
    }
  } finally {
    restored.store.dispose()
  }
})

it('silently keeps in-memory test data usable when IndexedDB is unavailable', async () => {
  const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
    throw new Error('Storage unavailable')
  })
  const { store, client, notice } = harness({ sessionId: crypto.randomUUID() })
  try {
    await store.editDraft(flow, startDraft(), 'start')
    store.$.inputRequest.value!.editor!.setValue('message', 'Still usable')
    expect(await store.confirmInputs()).toBe(true)
    await store.editDraft(flow, startDraft(), 'start')
    expect(store.$.inputRequest.value!.editor!.values()).toEqual({ message: 'Still usable' })
    expect(client.createDraftRun).toHaveBeenCalledTimes(1)
    expect(notice).not.toHaveBeenCalled()
  } finally {
    store.dispose()
    open.mockRestore()
  }
})

it('silently tolerates failed writes and retries saving the same test data on the next run', async () => {
  const scope = { sessionId: crypto.randomUUID() }
  const { store, notice } = harness(scope)
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new Error('Storage quota exceeded')
  })
  try {
    await store.editDraft(flow, startDraft(), 'start')
    expect(notice).not.toHaveBeenCalled()
    store.$.inputRequest.value!.editor!.setValue('message', 'Retry this data')
    expect(await store.confirmInputs()).toBe(true)
    expect(notice).not.toHaveBeenCalled()

    await store.editDraft(flow, startDraft(), 'start')
    expect(store.$.inputRequest.value!.editor!.values()).toEqual({ message: 'Retry this data' })
    put.mockRestore()
    expect(await store.confirmInputs()).toBe(true)
  } finally {
    put.mockRestore()
    store.dispose()
  }

  const restored = harness(scope)
  try {
    await restored.store.editDraft(flow, startDraft(), 'start')
    expect(restored.store.$.inputRequest.value!.editor!.values()).toEqual({ message: 'Retry this data' })
  } finally {
    restored.store.dispose()
  }
})

it('shows nullable Start parameters before running and normalizes omissions only on submission', async () => {
  const { client, store } = harness()
  const revision = startDraft()
  try {
    expect(await store.requestDraft(flow, revision)).toBe('input')
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(store.$.inputRequest.value?.editor?.values()).toEqual({})
    expect(store.$.inputRequest.value?.valid.value).toBe(true)
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledWith(
      flow.flowId,
      draft.revisionId,
      expect.objectContaining({ trigger: { nodeId: 'start', outputs: { message: null } } }),
    )
    expect(store.inputStatus(flow.flowId, revision, 'start')).toBe('ready')
    expect(await store.requestDraft(flow, revision)).toBe('started')
    expect(await store.editDraft(flow, revision, 'start')).toBe('input')
    expect(store.$.inputRequest.value?.editor?.values()).toEqual({})
  } finally {
    store.dispose()
  }
})

it('requires non-nullable Start parameters and invalidates nullable omission caches when constraints change', async () => {
  const { client, store } = harness()
  try {
    await store.editDraft(flow, startDraft(), 'start')
    store.dismissInputs()
    const required = startDraft(true)
    expect(store.inputStatus(flow.flowId, required, 'start')).toBe('missing')
    expect(await store.requestDraft(flow, required, 'start')).toBe('input')
    expect(await store.confirmInputs()).toBe(false)
    expect(client.createDraftRun).not.toHaveBeenCalled()
    store.$.inputRequest.value?.editor?.setValue('message', 'hello')
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledWith(
      flow.flowId,
      draft.revisionId,
      expect.objectContaining({ trigger: { nodeId: 'start', outputs: { message: 'hello' } } }),
    )
  } finally {
    store.dispose()
  }
})

it('prefers Start over an earlier event trigger and normalizes Live run parameters too', async () => {
  const { client, store } = harness()
  const revision: Draft = {
    ...startDraft(),
    content: {
      ...startDraft().content,
      document: {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            timer: { kind: 'cron', name: 'Schedule', cronTimes: [{ type: 'every', unit: 'hour', value: 1 }] },
            start: {
              ...(startDraft().content.document.graph.nodes.start! as Extract<import('../../../../flow/common/change.ts').GraphNode, { kind: 'start' }>),
            },
          },
        },
      },
    },
  }
  client.getLive.mockResolvedValue({ publication: { publicationId: 'publication', revisionId: revision.revisionId } })
  client.getRevision.mockResolvedValue(revision)
  try {
    expect(await store.requestLive(flow)).toBe('input')
    expect(store.$.inputRequest.value?.triggerId).toBe('start')
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createLiveRun).toHaveBeenCalledWith('publication', expect.objectContaining({ trigger: { nodeId: 'start', outputs: { message: null } } }))
  } finally {
    store.dispose()
  }
})

it('rejects invalid Live inputs without preparing a Run or saving the Draft', async () => {
  const { client, store, prepare, runs } = harness()
  client.getLive.mockResolvedValue({ publication: { publicationId: 'publication', revisionId: draft.revisionId } })
  client.getRevision.mockResolvedValue(startDraft(true))
  try {
    expect(await store.requestLive(flow)).toBe('input')
    expect(await store.confirmInputs()).toBe(false)
    expect(store.$.inputRequest.value?.attempted).toBe(true)
    expect(prepare).not.toHaveBeenCalled()
    expect(runs.prepareStart).not.toHaveBeenCalled()
    expect(client.createLiveRun).not.toHaveBeenCalled()
  } finally {
    store.dispose()
  }
})

function parameterDraft(parameters: readonly Port[], revisionId = 'revision'): Draft {
  const base = startDraft()
  return {
    ...base,
    revisionId,
    content: {
      ...base.content,
      document: {
        ...base.content.document,

        graph: {
          ...base.content.document.graph,
          nodes: { ...base.content.document.graph.nodes, start: { kind: 'start', name: 'Start', inputDefs: parameters } },
        },
      },
    },
  }
}

it('reopens the saved contract before a nullable omission can become an explicit required value', async () => {
  const { client, store, prepare, runs } = harness()
  const original = parameterDraft([{ handle: 'note', jsonSchema: {}, nullable: true }])
  const saved = parameterDraft([{ handle: 'note', jsonSchema: {}, nullable: false }], 'saved-revision')
  const held = Promise.withResolvers<Draft>()
  try {
    expect(await store.requestDraft(flow, original)).toBe('input')
    expect(store.$.inputRequest.value?.valid.value).toBe(true)
    prepare.mockImplementationOnce(async () => await held.promise)
    const confirming = store.confirmInputs()
    expect(client.createDraftRun).not.toHaveBeenCalled()
    held.resolve(saved)
    expect(await confirming).toBe(false)
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(runs.prepareStart).not.toHaveBeenCalled()
    expect(store.$.inputRequest.value?.revision).toBe(saved)
    expect(store.$.inputRequest.value?.editor?.values()).toEqual({})
    expect(store.$.inputRequest.value?.valid.value).toBe(false)
    prepare.mockResolvedValue(saved)
    expect(await store.confirmInputs()).toBe(false)
    store.$.inputRequest.value?.editor?.setValue('note', 'entered')
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledWith(
      flow.flowId,
      saved.revisionId,
      expect.objectContaining({ trigger: { nodeId: 'start', outputs: { note: 'entered' } } }),
    )
  } finally {
    held.resolve(saved)
    store.dispose()
  }
})

it('preserves raw values when reopening new fields and requires another confirmation for a valid changed contract', async () => {
  const { client, store, prepare } = harness()
  const original = parameterDraft([
    { handle: 'message', jsonSchema: { type: 'string' }, nullable: true },
    { handle: 'removed', jsonSchema: { type: 'number' }, nullable: true },
  ])
  const saved = parameterDraft(
    [
      { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
      { handle: 'required', jsonSchema: { type: 'string' }, nullable: false },
      { handle: 'optional', jsonSchema: { type: 'string' }, nullable: true },
    ],
    'new-contract',
  )
  try {
    await store.requestDraft(flow, original)
    store.$.inputRequest.value?.editor?.replaceValues({ message: 'Keep this text', removed: 12 })
    prepare.mockResolvedValue(saved)
    expect(await store.confirmInputs()).toBe(false)
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(store.$.inputRequest.value?.editor?.values()).toEqual({ message: 'Keep this text' })
    expect(store.$.inputRequest.value?.valid.value).toBe(false)
    store.$.inputRequest.value?.editor?.setValue('required', 'added')
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledWith(
      flow.flowId,
      saved.revisionId,
      expect.objectContaining({ trigger: { nodeId: 'start', outputs: { message: 'Keep this text', required: 'added', optional: null } } }),
    )
    await store.editDraft(flow, saved, 'start')
    expect(store.$.inputRequest.value?.editor?.values()).toEqual({ message: 'Keep this text', required: 'added' })
  } finally {
    store.dispose()
  }
})

it('reopens changed definitions even if the entered values remain valid', async () => {
  const { client, store, prepare } = harness()
  const original = startDraft()
  const saved = { ...startDraft(true), revisionId: 'stricter-contract' }
  try {
    await store.requestDraft(flow, original)
    store.$.inputRequest.value?.editor?.setValue('message', 'Already valid')
    prepare.mockResolvedValue(saved)
    expect(await store.confirmInputs()).toBe(false)
    expect(store.$.inputRequest.value?.valid.value).toBe(true)
    expect(store.$.inputRequest.value?.editor?.values()).toEqual({ message: 'Already valid' })
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledWith(flow.flowId, saved.revisionId, expect.anything())
  } finally {
    store.dispose()
  }
})

it('keeps the confirmation form visible when the saved definition removes every parameter', async () => {
  const { client, store, prepare } = harness()
  const saved = parameterDraft([], 'no-parameters')
  try {
    await store.requestDraft(flow, startDraft())
    prepare.mockResolvedValue(saved)
    expect(await store.confirmInputs()).toBe(false)
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(store.$.inputRequest.value?.revision).toBe(saved)
    expect(store.inputStatus(flow.flowId, saved, 'start')).toBe('ready')
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledWith(flow.flowId, saved.revisionId, expect.objectContaining({ trigger: { nodeId: 'start', outputs: {} } }))
    expect(store.inputStatus(flow.flowId, saved, 'start')).toBe('none')
  } finally {
    store.dispose()
  }
})

it('refreshes a previously invalid form after its saved definition changes instead of validating the old fields', async () => {
  const { client, store, prepare } = harness()
  const saved = { ...startDraft(), revisionId: 'nullable-now' }
  try {
    await store.requestDraft(flow, startDraft(true))
    expect(store.$.inputRequest.value?.valid.value).toBe(false)
    prepare.mockResolvedValue(saved)
    expect(await store.confirmInputs()).toBe(false)
    expect(store.$.inputRequest.value?.revision).toBe(saved)
    expect(store.$.inputRequest.value?.valid.value).toBe(true)
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(await store.confirmInputs()).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledWith(
      flow.flowId,
      saved.revisionId,
      expect.objectContaining({ trigger: { nodeId: 'start', outputs: { message: null } } }),
    )
  } finally {
    store.dispose()
  }
})

it('reports a deleted selected entry without falling back to another Trigger', async () => {
  const { client, store, prepare, notice } = harness()
  const original = startDraft()
  const saved: Draft = {
    ...original,
    revisionId: 'entry-deleted',
    content: {
      ...original.content,
      document: { bindings: {}, graph: { nodes: { timer: { kind: 'cron', name: 'Schedule', cronTimes: [] } }, edges: [] } },
    },
  }
  try {
    await store.requestDraft(flow, original)
    prepare.mockResolvedValue(saved)
    expect(await store.confirmInputs()).toBe(false)
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith({ kind: 'error', message: 'Select a start node' })
  } finally {
    store.dispose()
  }
})

it('does not reopen a form or create a Run after its session resets while final Draft saving is pending', async () => {
  const { client, store, prepare } = harness()
  const held = Promise.withResolvers<Draft>()
  const saved = { ...startDraft(true), revisionId: 'saved-after-reset' }
  try {
    await store.requestDraft(flow, startDraft())
    prepare.mockImplementationOnce(async () => await held.promise)
    const confirming = store.confirmInputs()
    store.reset()
    held.resolve(saved)
    expect(await confirming).toBe(false)
    expect(store.$.inputRequest.value).toBeUndefined()
    expect(client.createDraftRun).not.toHaveBeenCalled()
  } finally {
    held.resolve(saved)
    store.dispose()
  }
})

it('keeps an invalid text draft from submitting its previous valid value after saving the final Draft', async () => {
  const { client, store, prepare, runs } = harness()
  try {
    await store.requestDraft(flow, startDraft())
    const editor = store.$.inputRequest.value?.editor
    editor?.setValue('message', 'Previous valid value')
    editor?.setDraftIssue('/message', true)
    expect(await store.confirmInputs()).toBe(false)
    expect(prepare).toHaveBeenCalledOnce()
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(runs.prepareStart).not.toHaveBeenCalled()
    expect(store.$.inputRequest.value?.attempted).toBe(true)
    expect(editor?.values()).toEqual({ message: 'Previous valid value' })
  } finally {
    store.dispose()
  }
})

it('leaves the selected Run untouched when Draft inputs remain invalid after saving', async () => {
  const { client, store, prepare, runs, selection } = harness()
  const selected = selection.capture()
  try {
    await store.requestDraft(flow, startDraft(true))
    expect(await store.confirmInputs()).toBe(false)
    expect(prepare).toHaveBeenCalledOnce()
    expect(runs.captureSelection).toHaveBeenCalledOnce()
    expect(runs.prepareStart).not.toHaveBeenCalled()
    expect(selected()).toBe(true)
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(store.$.inputRequest.value?.attempted).toBe(true)
    expect(store.$.starting.value).toBe(false)
    expect(store.$.submitting.value).toBeUndefined()
  } finally {
    store.dispose()
  }
})

it('cancels a pending confirmation when the viewed Run changes and still finishes its own request state', async () => {
  const { client, store, prepare, runs, selection } = harness()
  const held = Promise.withResolvers<Draft>()
  const original = startDraft()
  try {
    await store.requestDraft(flow, original)
    prepare.mockImplementationOnce(async () => await held.promise)
    const confirming = store.confirmInputs()
    selection.begin()
    held.resolve(original)
    expect(await confirming).toBe(false)
    expect(runs.prepareStart).not.toHaveBeenCalled()
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(runs.follow).not.toHaveBeenCalled()
    expect(store.$.starting.value).toBe(false)
    expect(store.$.submitting.value).toBeUndefined()
    expect(store.$.inputRequest.value?.revision).toBe(original)
  } finally {
    held.resolve(original)
    store.dispose()
  }
})

it.each(['saved', 'failed'] as const)('does not let an older %s Draft request finish a newer pending request', async (outcome) => {
  const { client, store, prepare, runs, notice } = harness()
  const original = entryDraft()
  const first = Promise.withResolvers<Draft>()
  const second = Promise.withResolvers<Draft>()
  prepare.mockImplementationOnce(async () => await first.promise).mockImplementationOnce(async () => await second.promise)
  try {
    const older = store.requestDraft(flow, original)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
    const newer = store.requestDraft(flow, original)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2))
    if (outcome == 'saved') first.resolve(original)
    else first.reject(new Error('Obsolete save failed'))
    expect(await older).toBe('unavailable')
    expect(notice).not.toHaveBeenCalled()
    expect(runs.prepareStart).not.toHaveBeenCalled()
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(store.$.starting.value).toBe(true)
    expect(store.$.submitting.value).toBe('draft')
    second.resolve(original)
    expect(await newer).toBe('started')
    expect(client.createDraftRun).toHaveBeenCalledOnce()
    expect(runs.follow).toHaveBeenCalledOnce()
    expect(store.$.starting.value).toBe(false)
    expect(store.$.submitting.value).toBeUndefined()
  } finally {
    first.resolve(original)
    second.resolve(original)
    store.dispose()
  }
})

it('starts only the latest of repeated confirmations while Draft saving is pending', async () => {
  const { client, store, prepare, runs } = harness()
  const original = startDraft()
  const first = Promise.withResolvers<Draft>()
  const second = Promise.withResolvers<Draft>()
  try {
    await store.requestDraft(flow, original)
    prepare.mockImplementationOnce(async () => await first.promise).mockImplementationOnce(async () => await second.promise)
    store.$.inputRequest.value?.editor?.setValue('message', 'First value')
    const older = store.confirmInputs()
    store.$.inputRequest.value?.editor?.setValue('message', 'Latest value')
    const newer = store.confirmInputs()
    first.resolve(original)
    expect(await older).toBe(false)
    expect(runs.prepareStart).not.toHaveBeenCalled()
    expect(client.createDraftRun).not.toHaveBeenCalled()
    expect(store.$.starting.value).toBe(true)
    expect(store.$.submitting.value).toBe('draft')
    second.resolve(original)
    expect(await newer).toBe(true)
    expect(client.createDraftRun).toHaveBeenCalledExactlyOnceWith(
      flow.flowId,
      original.revisionId,
      expect.objectContaining({ trigger: { nodeId: 'start', outputs: { message: 'Latest value' } } }),
    )
    expect(runs.follow).toHaveBeenCalledOnce()
    expect(store.$.inputRequest.value).toBeUndefined()
    expect(store.$.starting.value).toBe(false)
    expect(store.$.submitting.value).toBeUndefined()
  } finally {
    first.resolve(original)
    second.resolve(original)
    store.dispose()
  }
})

it('ignores an older Run acknowledgement while the newer confirmation is still starting', async () => {
  const { client, store, runs, notice } = harness()
  const first = Promise.withResolvers<{ runId: string }>()
  const second = Promise.withResolvers<{ runId: string }>()
  client.createDraftRun.mockImplementationOnce(async () => await first.promise).mockImplementationOnce(async () => await second.promise)
  try {
    await store.requestDraft(flow, startDraft())
    const older = store.confirmInputs()
    await vi.waitFor(() => expect(client.createDraftRun).toHaveBeenCalledTimes(1))
    const newer = store.confirmInputs()
    await vi.waitFor(() => expect(client.createDraftRun).toHaveBeenCalledTimes(2))
    first.resolve({ runId: 'older-run' })
    expect(await older).toBe(false)
    expect(runs.follow).not.toHaveBeenCalled()
    expect(notice).not.toHaveBeenCalled()
    expect(store.$.starting.value).toBe(true)
    expect(store.$.submitting.value).toBe('draft')
    second.resolve({ runId: 'newer-run' })
    expect(await newer).toBe(true)
    expect(runs.follow).toHaveBeenCalledExactlyOnceWith({ runId: 'newer-run' }, expect.any(Function))
    expect(store.$.starting.value).toBe(false)
    expect(store.$.submitting.value).toBeUndefined()
  } finally {
    first.resolve({ runId: 'older-run' })
    second.resolve({ runId: 'newer-run' })
    store.dispose()
  }
})
