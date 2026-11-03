// @vitest-environment happy-dom
import type { NavigationStore } from './navigation.ts'
import type { OpenFlowWorkbenchProps } from './openFlowWorkbench.tsx'

import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { click, render } from '../../../../test/support/render.tsx'
import { currentFlowModelVersion } from '../../../flow/common/change.ts'
import { OpenFlowWorkbench } from './openFlowWorkbench.tsx'

vi.mock('./flowWorkspace.tsx', () => ({
  default: ({ navigation }: { navigation: NavigationStore }) => (
    <main aria-label="Workflow editor">
      <button onClick={() => void navigation.openFlows()}>Back to workflows</button>
    </main>
  ),
}))

const timestamp = '2026-11-03T00:00:00.000Z'
const flow = {
  createdAt: timestamp,
  draftRevisionId: 'revision-1',
  flowId: 'flow-1',
  name: 'Example workflow',
  referenceCount: 0,
  resourceReferences: {
    draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
    sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
  },
  status: 'active',
  updatedAt: timestamp,
  version: 1,
} as const
const editor = {
  flow,
  draft: {
    actorId: 'actor-1',
    content: { document: { bindings: {}, graph: { nodes: {}, edges: [] } }, modelVersion: currentFlowModelVersion, modules: {} },
    createdAt: timestamp,
    digest: 'digest-1',
    flowId: flow.flowId,
    modelVersion: currentFlowModelVersion,
    parentRevisionId: null,
    revisionId: flow.draftRevisionId,
    version: 1,
  },
  live: { flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
  presentation: { revision: 1, updatedAt: timestamp, value: {}, version: 1 },
  version: 1,
}

it('keeps the list and editor aligned with the host route throughout asynchronous navigation', async () => {
  const loading = Promise.withResolvers<Response>()
  const onNavigate = vi.fn()
  const notify = vi.fn()
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path == `/v1/flows/${flow.flowId}/editor`) return loading.promise
    if (path == `/v1/flows/${flow.flowId}/connector-access`)
      return Response.json({ accessRevision: 0, bindings: [], mode: 'implicit', sharedAccessDigest: 'digest', version: 1 })
    if (path.startsWith('/v1/flows?')) return Response.json({ flows: [flow], total: 1, version: 1 })
    if (path.startsWith('/v1/tags')) return Response.json({ tags: [], version: 1 })
    throw new Error(`Unexpected request: ${path}`)
  })
  const props: OpenFlowWorkbenchProps = {
    host: {
      notify,
      openExternalPage: async () => false,
      request,
      subscribeFlow: () => ({ ready: Promise.resolve(), stop() {} }),
      subscribeFlowCatalog: () => ({ ready: Promise.resolve(), stop() {} }),
    },
    hrefFor: ({ flowId }) => (flowId == null ? '/' : `/flows/${flowId}/design`),
    language: 'en',
    location: { view: 'design' },
    onNavigate,
    preferences: { getItem: () => null, setItem() {} },
    sessionKey: 'navigation',
    theme: 'light',
  }
  const { container, rerender } = render(<OpenFlowWorkbench {...props} />)
  await act(async () => {})
  const search = () => container.querySelector('input[aria-label="Search by name"]')
  const workspace = () => container.querySelector('[aria-label="Workflow editor"]')
  const link = [...container.querySelectorAll('a')].find((element) => element.textContent == flow.name)!

  await click(link)
  expect(request).toHaveBeenCalledWith(`/v1/flows/${flow.flowId}/editor`, expect.anything())
  expect(onNavigate).not.toHaveBeenCalled()
  expect(search()).not.toBeNull()
  expect(workspace()).toBeNull()

  await act(async () => loading.resolve(Response.json(editor)))
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith({ flowId: flow.flowId, view: 'design' }, { replace: false })
  expect(search()).not.toBeNull()
  expect(workspace()).toBeNull()

  await act(async () => rerender(<OpenFlowWorkbench {...props} location={{ flowId: flow.flowId, view: 'design' }} />))
  await vi.waitFor(() => expect(workspace()).not.toBeNull())
  expect(search()).toBeNull()

  onNavigate.mockClear()
  await click(container.querySelector('button')!)
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith({ flowId: undefined, view: 'design' }, { replace: false })
  expect(workspace()).not.toBeNull()
  expect(search()).toBeNull()

  await act(async () => rerender(<OpenFlowWorkbench {...props} />))
  expect(search()).not.toBeNull()
  expect(workspace()).toBeNull()
  expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
})
