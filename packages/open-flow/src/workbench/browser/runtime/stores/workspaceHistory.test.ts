import type { Draft, Presentation } from '../api.ts'

import { describe, expect, it, vi } from 'vitest'
import { applyFlowChanges } from '../../../../flow/common/change.ts'
import { createCodeTask, createValue } from '../../../../flow/common/nodeChanges.ts'
import { ApiError, WorkbenchClient } from '../api.ts'
import { designerGraph, setComment, setNodePositions } from '../workspace.ts'
import { WorkspaceStore } from './workspaceStore.ts'

const target = { kind: 'flow' } as const
const timestamp = '2026-09-10T00:00:00.000Z'
async function session() {
  const flow = { flowId: 'flow', name: 'Flow', status: 'active', createdAt: timestamp, updatedAt: timestamp, draftRevisionId: 'r1', version: 1 } as const
  let draft: Draft = {
    actorId: 'test',
    content: applyFlowChanges({ modelVersion: 1, document: { graph: { nodes: {}, edges: [] }, tasks: {}, subflows: {}, bindings: {} }, modules: {} }, [
      ...createCodeTask(target, { nodeId: 'code', moduleId: 'module' }, 'Code'),
      ...createValue(target, 'value', 'Value'),
      { kind: 'graph.edge.connect', target, edge: { source: 'value', target: 'code' } },
    ]),
    createdAt: timestamp,
    digest: 'digest',
    flowId: 'flow',
    modelVersion: 1,
    parentRevisionId: null,
    revisionId: 'r1',
    version: 1,
  }
  let presentation: Presentation = {
    revision: 1,
    updatedAt: timestamp,
    version: 1,
    value: setComment(setNodePositions({}, target, { code: { x: 300, y: 0 }, value: { x: 0, y: 0 } }), target, 'note', {
      title: 'Note',
      content: 'Keep this',
      position: { x: 0, y: 300 },
    }),
  }
  let sequence = 1
  const client = new WorkbenchClient(vi.fn())
  const getEditor = vi.spyOn(client, 'getEditor').mockImplementation(async () => ({
    flow,
    draft,
    presentation,
    live: { flowId: 'flow', hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
    version: 1,
  }))
  const change = vi.spyOn(client, 'changeDraft').mockImplementation(async (_flowId, expected, operations) => {
    expect(expected).toBe(draft.revisionId)
    draft = { ...draft, content: applyFlowChanges(draft.content, operations), parentRevisionId: expected, revisionId: `r${++sequence}` }
    const { content: _content, ...revision } = draft
    return { revision, version: 1 }
  })
  const update = vi.spyOn(client, 'updatePresentation').mockImplementation(async (_flowId, expected, value) => {
    expect(expected).toBe(presentation.revision)
    presentation = { ...presentation, revision: expected + 1, value }
    return presentation
  })
  vi.spyOn(client, 'syncDraft').mockImplementation(async () => ({ draft, kind: 'snapshot', version: 1 }))
  vi.spyOn(client, 'getPresentation').mockImplementation(async () => presentation)
  vi.spyOn(client, 'checkFlow').mockResolvedValue({
    closureDigest: 'digest',
    diagnostics: [],
    engineContract: 'open-flow-engine/v2',
    flowId: 'flow',
    modelVersion: 1,
    revisionDigest: 'digest',
    revisionId: 'r1',
    valid: true,
    version: 1,
  })
  const notices = vi.fn()
  let id = 0
  const store = new WorkspaceStore(client, notices, () => `new-${++id}`)
  await store.selectFlow('flow')
  return { store, client, change, update, getEditor, notices, saved: () => ({ draft, presentation }) }
}

describe('Workspace canvas history', () => {
  it('restores mixed deletion, module, edges, comments and selection in one step, preserving viewport', async () => {
    const { store, saved } = await session()
    try {
      const before = saved()
      store.selectNodes(['code', 'note'])
      await store.deleteSelectedNodes()
      expect(store.history$.value.canUndo).toBe(true)
      expect(saved().draft.content.document.graph.nodes.code).toBeUndefined()
      await store.moveViewport({ x: 110, y: -80, zoom: 0.9 })
      await store.undo()
      expect(saved().draft.content).toEqual(before.draft.content)
      expect(saved().presentation.value).toMatchObject({
        designer: { flow: { comments: { note: { content: 'Keep this' } }, viewport: { x: 110, y: -80, zoom: 0.9 } } },
      })
      expect(store.$.selectedNodeIds.value).toEqual(['code', 'note'])
      expect(store.history$.value.canUndo).toBe(false)
      await store.redo()
      expect(saved().draft.content.document.graph.nodes.code).toBeUndefined()
      expect(store.$.selectedNodeIds.value).toEqual([])
    } finally {
      store.dispose()
    }
  })

  it('groups paste and layout, ignores no-ops, and clears redo after a new move', async () => {
    const { store, saved } = await session()
    try {
      store.selectNodes(['code', 'note'])
      await store.duplicateSelectedNodes()
      const copied = saved()
      expect(store.history$.value.undo?.action).toBe('paste')
      await store.undo()
      expect(Object.keys(saved().draft.content.document.graph.nodes)).toEqual(['code', 'value'])
      await store.redo()
      expect(saved().draft.content).toEqual(copied.draft.content)
      await store.moveNodes({ code: { x: 300, y: 0 } })
      expect(store.history$.value.undo?.action).toBe('paste')
      await store.moveNodes({ code: { x: 400, y: 40 }, value: { x: 100, y: 40 } })
      expect(store.history$.value.undo?.count).toBe(2)
      await store.undo()
      await store.moveNodes({ code: { x: 500, y: 40 } })
      expect(store.history$.value.canRedo).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('keeps history for selection, no-op settings and viewport; clears it for content edits', async () => {
    const { store } = await session()
    try {
      await store.moveNodes({ code: { x: 400, y: 0 } })
      store.selectNodes(['code'])
      await store.saveNodeTitle('code', 'Code')
      await store.moveViewport({ x: 20, y: 20, zoom: 1 })
      expect(store.history$.value.canUndo).toBe(true)
      await store.saveNodeTitle('code', 'Renamed')
      expect(store.history$.value.canUndo).toBe(false)
      await store.moveNodes({ code: { x: 500, y: 0 } })
      store.updateModuleSource('export default () => ({result: 1})')
      expect(store.history$.value.canUndo).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('blocks undo until all queued moves save and preserves their order', async () => {
    const { store, update } = await session()
    const gate = Promise.withResolvers<void>()
    const original = update.getMockImplementation()!
    update.mockImplementationOnce(async (...args) => {
      await gate.promise
      return original(...args)
    })
    try {
      const first = store.moveNodes({ code: { x: 400, y: 0 } })
      const second = store.moveNodes({ code: { x: 500, y: 0 } })
      expect(store.history$.value.canUndo).toBe(false)
      await store.undo()
      gate.resolve()
      await Promise.all([first, second])
      await store.undo()
      expect(store.$.presentation.value?.value).toMatchObject({ designer: { flow: { nodes: { code: { x: 400, y: 0 } } } } })
      await store.undo()
      expect(store.history$.value.canUndo).toBe(false)
    } finally {
      gate.resolve()
      store.dispose()
    }
  })

  it('reloads both channels after partial success, and retry recovers from a failed reload', async () => {
    const { store, update, getEditor, saved } = await session()
    update.mockRejectedValueOnce(new ApiError(500, 'request.failed', 'Failed'))
    getEditor.mockRejectedValueOnce(new Error('offline'))
    try {
      store.selectNodes(['code', 'note'])
      await store.deleteSelectedNodes()
      await vi.waitFor(() => expect(store.history$.value.failed).toBe(true))
      await vi.waitFor(() => expect(getEditor).toHaveBeenCalledTimes(2))
      expect(store.history$.value.canUndo).toBe(false)
      await store.retryHistorySync()
      expect(store.history$.value.failed).toBe(false)
      expect(store.$.draft.value?.content).toEqual(saved().draft.content)
      expect(saved().draft.content.document.graph.nodes.code).toBeUndefined()
      expect(store.$.presentation.value?.value).toMatchObject({ designer: { flow: { comments: { note: { content: 'Keep this' } } } } })
    } finally {
      store.dispose()
    }
  })

  it('clears history on a presentation conflict and does not revive late actions after target switches', async () => {
    const { store, update } = await session()
    try {
      await store.moveNodes({ code: { x: 400, y: 0 } })
      update.mockRejectedValueOnce(new ApiError(412, 'flow.presentation-conflict', 'Conflict'))
      await store.moveNodes({ code: { x: 500, y: 0 } })
      await store.retryHistorySync()
      expect(store.history$.value.canUndo).toBe(false)
      const gate = Promise.withResolvers<void>()
      const original = update.getMockImplementation()!
      update.mockImplementationOnce(async (...args) => {
        await gate.promise
        return original(...args)
      })
      const pending = store.moveNodes({ code: { x: 600, y: 0 } })
      store.selectTarget(undefined)
      gate.resolve()
      await pending
      expect(store.history$.value.canUndo).toBe(false)
    } finally {
      store.dispose()
    }
  })
  it('adds a connected node as one step and restores disconnected edges', async () => {
    const { store, saved } = await session()
    try {
      const before = saved().draft.content
      const option = store.$.addNodeOptions.value.find((candidate) => candidate.kind == 'value')!
      const id = await store.addNode(option, { x: 700, y: 200 }, (nodeId) => ({
        source: 'value',
        target: nodeId,
        sourceHandle: '$execution',
        targetHandle: '$execution',
      }))
      expect(id).toBeDefined()
      await store.undo()
      expect(saved().draft.content).toEqual(before)
      await store.redo()
      expect(saved().draft.content.document.graph.nodes[id!]).toBeDefined()
      await store.disconnect({ id: 'edge', source: 'value', target: id!, sourceHandle: '$execution', targetHandle: '$execution' })
      expect(saved().draft.content.document.graph.edges.some((edge) => edge.target == id)).toBe(false)
      await store.undo()
      expect(saved().draft.content.document.graph.edges.some((edge) => edge.target == id)).toBe(true)
    } finally {
      store.dispose()
    }
  })

  it('blocks content edits during undo and reloads when undo is rejected', async () => {
    const { store, change, saved } = await session()
    const gate = Promise.withResolvers<void>()
    try {
      store.selectNodes(['code'])
      await store.deleteSelectedNodes()
      change.mockImplementationOnce(async () => {
        await gate.promise
        throw new ApiError(500, 'request.failed', 'Failed')
      })
      const undo = store.undo()
      expect(store.history$.value.applying).toBe(true)
      expect(await store.saveNodeTitle('value', 'Blocked')).toBe(false)
      gate.resolve()
      await undo
      await store.retryHistorySync()
      expect(store.history$.value.canUndo).toBe(false)
      expect(store.history$.value.canRedo).toBe(false)
      expect(store.$.draft.value?.content).toEqual(saved().draft.content)
      expect(saved().draft.content.document.graph.nodes.code).toBeUndefined()
      expect(saved().draft.content.document.graph.nodes.value?.name).toBe('Value')
    } finally {
      gate.resolve()
      store.dispose()
    }
  })

  it('clears history when an external head is observed during conflict recovery', async () => {
    const { store, client, change, saved } = await session()
    try {
      await store.moveNodes({ code: { x: 400, y: 0 } })
      const latest = { ...saved().draft, revisionId: 'external' }
      vi.spyOn(client, 'syncDraft').mockResolvedValue({ draft: latest, kind: 'snapshot', version: 1 })
      change.mockRejectedValueOnce(new ApiError(412, 'flow.revision-conflict', 'Conflict'))
      change.mockRejectedValueOnce(new ApiError(412, 'flow.revision-conflict', 'Conflict'))
      store.selectNodes(['code'])
      await store.deleteSelectedNodes()
      await store.retryHistorySync()
      expect(store.history$.value.canUndo).toBe(false)
      expect(store.history$.value.canRedo).toBe(false)
    } finally {
      store.dispose()
    }
  })
  it('does not update disposed history when a workspace load resumes after unmount', async () => {
    const { store, getEditor } = await session()
    const loading = store.selectFlow('flow')
    store.dispose()
    expect(await loading).toBe(false)
    expect(getEditor).toHaveBeenCalledTimes(1)
  })
})

describe('Node content presentation', () => {
  it('persists visibility across reopening without changing the draft and restores shown content', async () => {
    const { store, saved, change } = await session()
    const contentNode = () => designerGraph(store.$.draft.value, target, store.$.presentation.value?.value).nodes.find((node) => node.id == 'value')
    try {
      const draft = saved().draft
      expect(contentNode()).toMatchObject({ kind: 'value', contentHidden: false })
      await store.saveNodeContentHidden('value', true)
      await store.moveNodes({ value: { x: 60, y: 100 } })
      await store.selectFlow('flow')
      expect(contentNode()).toMatchObject({ contentHidden: true, position: { x: 60, y: 100 } })
      expect(saved().draft).toEqual(draft)
      expect(change).not.toHaveBeenCalled()
      await store.saveNodeContentHidden('value', false)
      await store.selectFlow('flow')
      expect(contentNode()).toMatchObject({ contentHidden: false })
    } finally {
      store.dispose()
    }
  })

  it('copies visibility and restores it through deletion undo and redo', async () => {
    const { store, saved } = await session()
    try {
      await store.saveNodeContentHidden('value', true)
      store.selectNodes(['value'])
      await store.duplicateSelectedNodes()
      const copy = store.$.selectedNodeIds.value[0]!
      expect(designerGraph(saved().draft, target, saved().presentation.value).nodes.find((node) => node.id == copy)).toMatchObject({ contentHidden: true })
      await store.deleteSelectedNodes()
      const hidden = (saved().presentation.value.designer as { flow: { hiddenNodeContent: Record<string, boolean> } }).flow.hiddenNodeContent
      expect(hidden[copy]).toBeUndefined()
      await store.undo()
      expect(designerGraph(saved().draft, target, saved().presentation.value).nodes.find((node) => node.id == copy)).toMatchObject({ contentHidden: true })
      await store.redo()
      expect(designerGraph(saved().draft, target, saved().presentation.value).nodes.some((node) => node.id == copy)).toBe(false)
    } finally {
      store.dispose()
    }
  })
})

it('persists generic task and comment visibility, including copying comments', async () => {
  const { store, saved, change } = await session()
  try {
    await store.saveNodeContentHidden('code', true)
    await store.saveNodeContentHidden('note', true)
    await store.selectFlow('flow')
    const nodes = designerGraph(store.$.draft.value, target, store.$.presentation.value?.value).nodes
    expect(nodes.find((node) => node.id == 'code')).toMatchObject({ contentHidden: true })
    expect(nodes.find((node) => node.id == 'note')).toMatchObject({ contentHidden: true })
    expect(change).not.toHaveBeenCalled()
    store.selectNodes(['note'])
    await store.duplicateSelectedNodes()
    const copy = store.$.selectedNodeIds.value[0]!
    expect(designerGraph(saved().draft, target, saved().presentation.value).nodes.find((node) => node.id == copy)).toMatchObject({
      kind: 'comment',
      contentHidden: true,
    })
  } finally {
    store.dispose()
  }
})
