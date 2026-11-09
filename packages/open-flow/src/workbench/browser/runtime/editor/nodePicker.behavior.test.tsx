// @vitest-environment happy-dom
import type { ReactNode } from 'react'

import { act, useEffect, useRef } from 'react'
import { expect, it, vi } from 'vitest'
import { createInspectorSession } from '../../../../../dev/designer/inspectorSession.ts'
import { click, render } from '../../../../../test/support/render.tsx'
import { currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { resourceValue } from '../stores/resource.ts'
import { NodePickerContent } from './nodePicker.tsx'

vi.mock('../../../../ui/browser/icons/IconifyIcon.tsx', () => ({ IconifyIcon: () => null }))

vi.mock('../../../../ui/browser/scroll-area.tsx', () => ({
  ScrollArea: ({ children, events }: { children: ReactNode; events?: { initialized: (instance: unknown) => void } }) => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
      events?.initialized({ elements: () => ({ viewport: ref.current }) })
    }, [])
    return <div ref={ref}>{children}</div>
  },
}))

it.each([true, false])('creates a Provider request from the actual picker and preserves it across undo, redo and reload (Actions: %s)', async (hasActions) => {
  const session = createInspectorSession(
    'en',
    () => {},
    {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: { bindings: {}, graph: { edges: [], nodes: {} } },
    },
    {
      providers: [{ service: 'github', displayName: 'GitHub', authTypes: ['no_auth'] }],
      actions: hasActions
        ? [
            {
              actionId: 'github.get_user',
              serviceId: 'github',
              serviceName: 'GitHub',
              name: 'Get user',
              description: 'Read a user.',
              authenticated: false,
              inputs: {},
              outputs: {},
              inputSchema: { type: 'object', properties: {} },
              outputSchema: { type: 'object', properties: {} },
            },
          ]
        : [],
    },
  )
  let mounted: ReturnType<typeof render> | undefined
  try {
    await session.start()
    const add = vi.fn((option: Parameters<typeof session.store.addNode>[0]) => session.store.addNode(option, { x: 100, y: 100 }))
    mounted = render(
      <NodePickerContent
        options={session.store.$.addNodeOptions.value}
        disabled={false}
        focusRequest={0}
        browseOptions={session.connectors.browseAddNodeOptions}
        searchOptions={session.connectors.provideAddNodeOptions}
        provideChoices={session.connectors.provideAddNodeOptionChoices}
        onAdd={add}
      />,
    )
    const { container } = mounted
    const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(name))
    await act(async () => {
      await resourceValue(session.connectors.browseAddNodeOptions(new AbortController().signal))
    })
    expect(button('GitHub')).toBeDefined()
    await click(button('GitHub')!)
    await act(async () => {
      await resourceValue(session.store.catalogs.actions.get('github', 'inspector-lab', 'en'))
    })
    expect(button('Custom API Request')).toBeDefined()
    expect(button('Get user') != null).toBe(hasActions)
    const customGroup = [...container.querySelectorAll('section')].at(-1)
    expect(customGroup?.querySelector('h3')?.textContent).toBe('Custom')
    expect(customGroup?.contains(button('Custom API Request')!)).toBe(true)
    if (hasActions) expect(customGroup?.contains(button('Get user')!)).toBe(false)
    await click(button('Custom API Request')!)
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'connector-proxy', provider: expect.objectContaining({ serviceId: 'github' }) }))
    const id = await add.mock.results[0]!.value
    expect(id).toBeDefined()
    const node = session.store.$.draft.value?.content.document.graph.nodes[id!]
    expect(node).toMatchObject({
      kind: 'task',
      name: 'Custom API Request',
      task: { name: 'Custom API Request', executor: { kind: 'connector-proxy', providerId: 'github', method: 'GET' } },
    })
    await act(async () => session.store.undo())
    expect(session.store.$.draft.value?.content.document.graph.nodes[id!]).toBeUndefined()
    await act(async () => session.store.redo())
    expect(session.store.$.draft.value?.content.document.graph.nodes[id!]).toEqual(node)
    await act(async () => session.store.selectFlow('inspector-lab'))
    expect(session.store.$.draft.value?.content.document.graph.nodes[id!]).toEqual(node)
  } finally {
    mounted?.unmount()
    session.dispose()
  }
})
