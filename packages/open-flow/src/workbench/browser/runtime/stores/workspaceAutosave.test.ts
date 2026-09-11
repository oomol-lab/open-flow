import type { ChangeOperation } from '../../../../flow/common/change.ts'
import type { Draft } from '../api.ts'

import { afterEach, assert, describe, expect, it, vi } from 'vitest'
import { applyFlowChanges } from '../../../../flow/common/change.ts'
import { createCodeTask } from '../../../../flow/common/nodeChanges.ts'
import { WorkbenchClient } from '../api.ts'
import { WorkbenchStore } from './workbenchStore.ts'

const timestamp = '2026-09-07T00:00:00.000Z'

async function setup() {
  const flow = { createdAt: timestamp, updatedAt: timestamp, draftRevisionId: 'r0', flowId: 'flow', name: 'Flow', status: 'active', version: 1 } as const
  const target = { kind: 'flow' } as const
  const content = applyFlowChanges({ modelVersion: 1, document: { bindings: {}, tasks: {}, subflows: {}, graph: { nodes: {}, edges: [] } }, modules: {} }, [
    ...createCodeTask(target, { moduleId: 'a', nodeId: 'a' }, 'A'),
    ...createCodeTask(target, { moduleId: 'b', nodeId: 'b' }, 'B'),
  ])
  let revision: Draft = {
    actorId: 'actor',
    content,
    createdAt: timestamp,
    digest: 'd0',
    flowId: 'flow',
    modelVersion: 1,
    parentRevisionId: null,
    revisionId: 'r0',
    version: 1,
  }
  let sequence = 0
  const commit = vi.fn(async (operations: readonly ChangeOperation[]) => {
    sequence++
    revision = {
      ...revision,
      content: applyFlowChanges(revision.content, operations),
      digest: `d${sequence}`,
      parentRevisionId: revision.revisionId,
      revisionId: `r${sequence}`,
    }
    const { content: _, ...metadata } = revision
    return Response.json({ revision: metadata, version: 1 })
  })
  const request = async (path: string, init?: RequestInit) => {
    if (path.startsWith('/v1/flows?')) return Response.json({ flows: [flow], total: 1, version: 1 })
    if (path.endsWith('/editor'))
      return Response.json({
        flow,
        draft: revision,
        live: { flowId: 'flow', hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
        presentation: { revision: 1, updatedAt: timestamp, value: {}, version: 1 },
        version: 1,
      })
    if (path.endsWith('/draft/changes')) return commit(JSON.parse(String(init?.body)).operations)
    if (path.endsWith('/check'))
      return Response.json({
        closureDigest: 'closure',
        diagnostics: [],
        engineContract: 'engine',
        flowId: 'flow',
        modelVersion: 1,
        revisionDigest: revision.digest,
        revisionId: revision.revisionId,
        valid: true,
        version: 1,
      })
    throw new Error(`Unexpected request: ${path}`)
  }
  const client = new WorkbenchClient(request)
  const store = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} })
  await store.workspace.start('flow')
  store.workspace.selectNodes(['a'])
  return { client, commit, store, workspace: store.workspace, revision: () => revision }
}

afterEach(() => vi.useRealTimers())

describe('code autosave', () => {
  it('keeps typing local until a save is requested, including incomplete source', async () => {
    const { commit, store, workspace, revision } = await setup()
    vi.useFakeTimers()
    try {
      workspace.updateModuleSource('export default function')
      await vi.advanceTimersByTimeAsync(500)
      workspace.updateModuleSource('export default function (')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(commit).not.toHaveBeenCalled()
      expect(workspace.$.moduleEditor.value).toMatchObject({ source: 'export default function (', status: 'dirty' })
      expect(await workspace.saveModuleEditor()).toBe(true)
      expect(commit).toHaveBeenCalledTimes(1)
      expect(revision().content.modules.a?.source).toBe('export default function (')
      expect(workspace.$.moduleEditor.value?.status).toBe('saved')
    } finally {
      store.dispose()
    }
  })

  it('retains edits made during a slow save and while switching nodes', async () => {
    const { commit, store, workspace, revision } = await setup()
    const first = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    const original = commit.getMockImplementation()
    assert(original != null)
    commit.mockImplementationOnce(async (operations) => {
      started.resolve()
      await first.promise
      return original(operations)
    })
    try {
      workspace.updateModuleSource('export default () => 1')
      const saving = workspace.saveModuleEditor()
      await started.promise
      workspace.updateModuleSource('export default () => 2')
      expect(workspace.selectNodes(['b'])).toBe(true)
      workspace.updateModuleSource('export default () => 3')
      expect(workspace.selectNodes(['a'])).toBe(true)
      expect(workspace.$.moduleEditor.value?.source).toBe('export default () => 2')
      first.resolve(Response.json({}))
      expect(await saving).toBe(true)
      expect(revision().content.modules.a?.source).toBe('export default () => 2')
      expect(revision().content.modules.b?.source).toBe('export default () => 3')
      expect(workspace.hasUnsavedCode).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('keeps failed edits across node switches and retries explicitly', async () => {
    const { commit, store, workspace, revision } = await setup()
    commit.mockResolvedValueOnce(Response.json({ error: { code: 'flow.unavailable', message: 'Unavailable' }, version: 1 }, { status: 503 }))
    try {
      workspace.updateModuleSource('export default () => 4')
      expect(await workspace.saveModuleEditor()).toBe(false)
      expect(workspace.$.status.value).toBe('failed')
      workspace.selectNodes(['b'])
      workspace.selectNodes(['a'])
      expect(workspace.$.moduleEditor.value).toMatchObject({ source: 'export default () => 4', status: 'failed' })
      expect(await workspace.saveModuleEditor()).toBe(true)
      expect(revision().content.modules.a?.source).toBe('export default () => 4')
    } finally {
      store.dispose()
    }
  })

  it('flushes code before starting a run or publishing and blocks both on failure', async () => {
    const { client, commit, store, workspace } = await setup()
    const run = vi.spyOn(store.runRequests, 'requestDraft').mockResolvedValue('unavailable')
    const publish = vi.spyOn(client, 'publishFlow').mockRejectedValue(new Error('Stop after capturing the request'))
    try {
      workspace.updateModuleSource('export default () => 5')
      await store.requestDraftRun()
      expect(run.mock.calls[0]?.[1].content.modules.a?.source).toBe('export default () => 5')
      workspace.updateModuleSource('export default () => 6')
      await store.publications.publish()
      expect(publish.mock.calls[0]?.[1]).toBe(workspace.$.draft.value?.revisionId)
      expect(workspace.$.draft.value?.content.modules.a?.source).toBe('export default () => 6')
      run.mockClear()
      publish.mockClear()
      commit.mockResolvedValue(Response.json({ error: { code: 'flow.unavailable', message: 'Unavailable' }, version: 1 }, { status: 503 }))
      workspace.updateModuleSource('export default () => 7')
      await store.requestDraftRun()
      await store.publications.publish()
      expect(run).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    } finally {
      store.dispose()
    }
  })

  it.each(['run', 'inputs'] as const)('waits for ordinary draft saves before %s and uses the saved revision', async (action) => {
    const { client, store, workspace } = await setup()
    const held = Promise.withResolvers<void>()
    const realChange = client.changeDraft.bind(client)
    vi.spyOn(client, 'changeDraft').mockImplementation(async (...args) => {
      await held.promise
      return realChange(...args)
    })
    const request = vi.spyOn(store.runRequests, action == 'run' ? 'requestDraft' : 'editDraft').mockResolvedValue('unavailable')
    try {
      const changing = workspace.saveNodeTitle('a', 'Edited A')
      const running = action == 'run' ? store.requestDraftRun('start') : store.editDraftRunInputs('start')
      await Promise.resolve()
      expect(request).not.toHaveBeenCalled()
      held.resolve()
      await changing
      await running
      expect(request).toHaveBeenCalledOnce()
      expect(request.mock.calls[0]?.[1].revisionId).toBe(workspace.$.draft.value?.revisionId)
      expect(request.mock.calls[0]?.[1].content.document.graph.nodes.a?.name).toBe('Edited A')
    } finally {
      held.resolve()
      store.dispose()
    }
  })

  it('does not run when a pending ordinary save fails', async () => {
    const { client, store, workspace } = await setup()
    const held = Promise.withResolvers<void>()
    vi.spyOn(client, 'changeDraft').mockImplementation(async () => {
      await held.promise
      throw new Error('Save failed')
    })
    const request = vi.spyOn(store.runRequests, 'requestDraft').mockResolvedValue('unavailable')
    try {
      const changing = workspace.saveNodeTitle('a', 'Unsaved A')
      const running = store.requestDraftRun('start')
      held.resolve()
      await changing
      expect(await running).toBe('unavailable')
      expect(request).not.toHaveBeenCalled()
    } finally {
      held.resolve()
      store.dispose()
    }
  })

  it('preserves local code when another client changes the same module', async () => {
    const { client, commit, store, workspace, revision } = await setup()
    const remoteSource = 'export default () => "remote"'
    const module = revision().content.modules.a
    assert(module != null)
    const remote = {
      ...revision(),
      revisionId: 'remote',
      content: { ...revision().content, modules: { ...revision().content.modules, a: { ...module, source: remoteSource } } },
    }
    const editor = await client.getEditor('flow')
    // Both reload endpoints observe the same external commit.
    vi.spyOn(client, 'getEditor').mockResolvedValue({ ...editor, draft: remote })
    vi.spyOn(client, 'syncDraft').mockResolvedValue({ draft: remote, kind: 'snapshot', version: 1 })
    commit.mockResolvedValueOnce(Response.json({ error: { code: 'flow.revision-conflict', message: 'Conflict' }, version: 1 }, { status: 409 }))
    try {
      workspace.updateModuleSource('export default () => "local"')
      expect(await workspace.saveModuleEditor()).toBe(false)
      expect(workspace.$.draft.value?.content.modules.a?.source).toBe(remoteSource)
      expect(workspace.$.moduleEditor.value).toMatchObject({ source: 'export default () => "local"', status: 'failed' })
      expect(await workspace.saveModuleEditor()).toBe(false)
      expect(commit).toHaveBeenCalledTimes(1)
      workspace.discardModuleChanges()
      expect(workspace.$.moduleEditor.value).toMatchObject({ source: remoteSource, status: 'saved' })
    } finally {
      store.dispose()
    }
  })

  it('does not create a Revision when typing is undone before autosave', async () => {
    const { commit, store, workspace } = await setup()
    try {
      const editor = workspace.$.moduleEditor.value
      assert(editor != null)
      const source = editor.source
      workspace.updateModuleSource('export default () => 10')
      workspace.updateModuleSource(source)
      expect(await workspace.saveModuleEditor()).toBe(true)
      expect(commit).not.toHaveBeenCalled()
    } finally {
      store.dispose()
    }
  })

  it('saves before leaving a flow and does not save after disposal', async () => {
    const { commit, store, workspace } = await setup()
    vi.useFakeTimers()
    try {
      workspace.updateModuleSource('export default () => 8')
      expect(await workspace.selectFlow(undefined)).toBe(true)
      expect(commit).toHaveBeenCalledTimes(1)
      await workspace.selectFlow('flow')
      workspace.selectNodes(['a'])
      workspace.updateModuleSource('export default () => 9')
      store.dispose()
      await vi.advanceTimersByTimeAsync(1000)
      expect(commit).toHaveBeenCalledTimes(1)
    } finally {
      store.dispose()
    }
  })
})
