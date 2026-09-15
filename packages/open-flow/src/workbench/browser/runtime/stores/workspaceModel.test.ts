import type { Draft } from '../api.ts'

import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { FlowCatalog } from './flowCatalog.ts'
import { WorkspaceModel } from './workspaceModel.ts'

function draft(): Draft {
  return {
    actorId: 'test',
    createdAt: '2026-09-15T00:00:00.000Z',
    digest: 'd1',
    flowId: 'flow',
    modelVersion: 1,
    parentRevisionId: null,
    revisionId: 'r1',
    version: 1,
    content: {
      modelVersion: 1,
      modules: {},
      document: {
        bindings: {},
        subflows: {},
        tasks: {
          task: {
            name: 'Task',
            executor: { kind: 'connector', action: 'test' },
            inputs: Array.from({ length: 16 }, (_, index) => ({ handle: `input${index}`, jsonSchema: { type: 'string' }, nullable: true })),
            outputs: [],
          },
        },
        graph: {
          edges: [{ source: 'source', target: 'task' }],
          nodes: {
            source: { kind: 'value', inputs: {}, values: [{ handle: 'text', jsonSchema: { type: 'string' }, nullable: false, value: 'hello' }] },
            task: { kind: 'task', taskId: 'task', inputs: {} },
            other: { kind: 'task', taskId: 'task', inputs: {} },
          },
        },
      },
    },
  }
}

function setup() {
  const i18n = createI18n('en')
  const catalog = new FlowCatalog(new WorkbenchClient(vi.fn()), vi.fn(), i18n)
  const model = new WorkspaceModel(i18n, catalog)
  return {
    model,
    dispose() {
      model.dispose()
      catalog.dispose()
      i18n.dispose()
    },
  }
}

describe('Inspector input source derivation', () => {
  it('computes all fields once and skips unrelated workspace updates', () => {
    const session = setup()
    const source = draft()
    const calculate = vi.spyOn(revisionView(source), 'inputSources')
    const notify = vi.fn()
    const unsubscribe = session.model.$.inputSources.subscribe(notify)
    try {
      session.model.set({ draft: source, target: { kind: 'flow' }, selectedNodeIds: ['task'] })
      for (let index = 0; index < 16; index++) expect(session.model.$.inputSources.value[`input${index}`]?.outputs).toEqual({ source: ['text'] })
      expect(calculate).toHaveBeenCalledTimes(1)
      notify.mockClear()
      session.model.set({ busy: 'designer' })
      session.model.set({ checkLoading: true, nodeFocus: { nodeId: 'task', requestId: 1 } })
      expect(session.model.$.inputSources.value.input0?.outputs).toEqual({ source: ['text'] })
      expect(calculate).toHaveBeenCalledTimes(1)
      expect(notify).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      session.dispose()
    }
  })

  it('retains equal results across revisions and invalidates changed edges and schemas', () => {
    const session = setup()
    const source = draft()
    const unsubscribe = session.model.$.inputSources.subscribe(() => {})
    try {
      session.model.set({ draft: source, target: { kind: 'flow' }, selectedNodeIds: ['task'] })
      const before = session.model.$.inputSources.value
      session.model.set({ draft: { ...source, revisionId: 'r2' } })
      expect(session.model.$.inputSources.value).toBe(before)
      const disconnected: Draft = {
        ...source,
        content: { ...source.content, document: { ...source.content.document, graph: { ...source.content.document.graph, edges: [] } } },
      }
      session.model.set({ draft: disconnected })
      expect(session.model.$.inputSources.value.input0?.outputs).toEqual({})
      const task = source.content.document.tasks.task!
      const changed: Draft = {
        ...source,
        content: {
          ...source.content,
          document: {
            ...source.content.document,
            tasks: { task: { ...task, inputs: [{ handle: 'number', jsonSchema: { type: 'number' }, nullable: true }] } },
          },
        },
      }
      session.model.set({ draft: changed })
      expect(session.model.$.inputSources.value).toEqual({ number: { handle: 'number', outputs: {} } })
    } finally {
      unsubscribe()
      session.dispose()
    }
  })

  it('keeps node selection and graph scope distinct and clears absent selections', () => {
    const session = setup()
    const source = draft()
    const scoped: Draft = {
      ...source,
      content: {
        ...source.content,
        document: {
          ...source.content.document,
          subflows: { nested: { name: 'Nested', inputs: [], outputs: [], graph: { ...source.content.document.graph, edges: [] } } },
        },
      },
    }
    try {
      session.model.set({ draft: scoped, target: { kind: 'flow' }, selectedNodeIds: ['task'] })
      expect(session.model.$.inputSources.value.input0?.outputs).toEqual({ source: ['text'] })
      session.model.set({ selectedNodeIds: ['other'] })
      expect(session.model.$.inputSources.value.input0?.outputs).toEqual({})
      session.model.set({ target: { kind: 'subflow', id: 'nested' }, selectedNodeIds: ['task'] })
      expect(session.model.$.inputSources.value.input0?.outputs).toEqual({})
      session.model.set({ selectedNodeIds: [] })
      expect(session.model.$.inputSources.value).toEqual({})
      session.model.set({ selectedNodeIds: ['task', 'other'] })
      expect(session.model.$.inputSources.value).toEqual({})
      session.model.set({ selectedNodeIds: ['source'] })
      expect(session.model.$.inputSources.value).toEqual({})
    } finally {
      session.dispose()
    }
  })
})
