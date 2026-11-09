// @vitest-environment happy-dom
import type { InputMapping, JsonValue, RevisionContent } from '../../../../flow/common/change.ts'

import { act } from 'react'
import { useVal } from 'use-value-enhancer'
import { expect, it, vi } from 'vitest'
import { createInspectorSession } from '../../../../../dev/designer/inspectorSession.ts'
import { click, input, render } from '../../../../../test/support/render.tsx'
import { connectorProxyConfigSchema, connectorProxyTask } from '../../../../connector/common/proxy.ts'
import { currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { ConnectorProxySection } from './connectorProxySection.tsx'
import { NodeInspector } from './nodeInspector.tsx'

vi.mock('../../../../ui/browser/icons/IconifyIcon.tsx', () => ({ IconifyIcon: () => null }))

function Inspector({
  session,
  readOnly = false,
  disabled = false,
}: {
  session: ReturnType<typeof createInspectorSession>
  readOnly?: boolean
  disabled?: boolean
}) {
  const revision = useVal(session.store.$.revision)!
  const props = { theme: 'light' as const, revision, selection: revision.node('request') }
  return readOnly ? (
    <NodeInspector {...props} readOnly />
  ) : (
    <NodeInspector
      {...props}
      disabled={disabled}
      store={session.store}
      connectors={session.connectors}
      triggers={session.triggers}
      variables={{ enabled: true, loaded: true, loading: false, names: ['PAYLOAD'] }}
    />
  )
}

it('edits an optional Provider request body without a format selector and preserves history, sources and read-only state', async () => {
  const content: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          request: {
            kind: 'task',
            inputs: { endpoint: { kind: 'value', value: '/items' } },
            task: connectorProxyTask(connectorProxyConfigSchema.parse({ providerId: 'example', method: 'POST', connectionId: '' })),
          },
          data: { kind: 'value', inputs: {}, values: [{ handle: 'payload', jsonSchema: {}, nullable: true, value: {} }] },
        },
      },
    },
  }
  const session = createInspectorSession('en', () => {}, content, { providers: [{ service: 'example', displayName: 'Example', authTypes: ['no_auth'] }] })
  let mounted: ReturnType<typeof render> | undefined
  try {
    await session.start()
    mounted = render(<Inspector session={session} />)
    const { container } = mounted
    const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
    const setBody = `Request body ${session.i18n.t('valueEditor.setValue')}`
    const node = () => session.store.$.draft.value!.content.document.graph.nodes.request!
    const body = () => container.querySelector<HTMLElement>('[role="group"][aria-label="Request body"]')!

    expect(container.textContent).not.toContain('Request body format')
    expect(button(setBody)).not.toBeNull()
    expect(body().querySelector('[aria-label="Request body, data type: Object"]')).not.toBeNull()
    expect(body().querySelector('textarea')).toBeNull()
    expect(body().querySelector('[aria-invalid="true"]')).toBeNull()
    await click(button(setBody)!)
    expect(node()).toMatchObject({ inputs: { body: { kind: 'value', value: {} } }, task: { executor: { bodyFormat: 'json', connectionId: '' } } })

    await click(button('Add field Request body')!)
    expect(node()).toMatchObject({ inputs: { body: { value: { field: null } } } })
    expect(body().querySelector('[aria-invalid="true"]')).toBeNull()
    await click(button('Request body.field null')!)
    const field = [...body().querySelectorAll<HTMLInputElement>('input')].find((element) =>
      [...(element.labels ?? [])].some((label) => label.textContent === 'Request body.field'),
    )!
    await input(field, 'hello')
    await act(async () => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(node()).toMatchObject({ inputs: { body: { value: { field: 'hello' } } } })
    const name = body().querySelector<HTMLInputElement>('input[aria-label="Field name"]')!
    await input(name, 'message')
    await act(async () => {
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(node()).toMatchObject({ inputs: { body: { value: { message: 'hello' } } } })
    await click(button('Remove message')!)
    expect(node()).toMatchObject({ inputs: { body: { value: {} } } })

    for (const value of [null, {}, [], '', 'message', false, 0]) {
      await act(async () => session.store.nodes.setInputValue('request', 'body', value))
      const before = structuredClone(node())
      expect(before).toMatchObject({ inputs: { body: { kind: 'value', value } }, task: { executor: { bodyFormat: 'json' } } })
      expect(button('Clear Request body')).not.toBeNull()
      await click(button('Clear Request body')!)
      expect(node()).toMatchObject({
        inputs: { endpoint: { value: '/items' }, body: { kind: 'unset' } },
        task: { executor: { connectionId: '' } },
      })
      expect(button(setBody)).not.toBeNull()
      await act(async () => session.store.undo())
      expect(node()).toEqual(before)
      await act(async () => session.store.redo())
      expect(node()).toMatchObject({ inputs: { body: { kind: 'unset' } } })
    }

    await act(async () => session.store.nodes.setInputVariable('request', 'body', 'PAYLOAD'))
    expect(node()).toMatchObject({ inputs: { body: { kind: 'sources' } }, task: { executor: { bodyFormat: 'json' } } })
    expect(body().textContent).toContain('PAYLOAD')
    await act(async () => session.store.nodes.setInputValue('request', 'body', undefined))
    await act(async () => session.store.nodes.setInputSource('request', 'body', { nodeId: 'data', output: 'payload' }))
    expect(node()).toMatchObject({
      inputs: { body: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'data', output: 'payload' }] } },
      task: { executor: { bodyFormat: 'json' } },
    })
    const saved = structuredClone(node())
    await act(async () => session.store.selectFlow('inspector-lab'))
    expect(node()).toEqual(saved)
    mounted.rerender(<Inspector session={session} readOnly />)
    expect(container.textContent).not.toContain('Request body format')
    expect(button('Request body Select input source')).toBeNull()
    expect(button('Clear Request body')).toBeNull()
    expect(node()).toEqual(saved)
  } finally {
    mounted?.unmount()
    session.dispose()
  }
})

function requestSession(config: object, body?: InputMapping, defaultBody?: JsonValue) {
  const task = connectorProxyTask(
    connectorProxyConfigSchema.parse({ providerId: 'example', connectionId: '', query: { names: ['page'] }, headers: { names: ['X-Test'] }, ...config }),
  )
  const content: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: { query: { kind: 'variable', target: 'PAYLOAD' }, payload: { kind: 'variable', target: 'PAYLOAD' } },
      graph: {
        edges: [{ source: 'data', target: 'request' }],
        nodes: {
          request: {
            kind: 'task',
            task: {
              ...task,
              inputs: task.inputs.map((port) =>
                'handle' in port && port.handle === 'body' && defaultBody !== undefined ? Object.assign({}, port, { value: defaultBody }) : port,
              ),
              outputs: task.outputs.map((port) => Object.assign({}, port, { description: 'Saved output' })),
            },
            inputs: {
              'endpoint': { kind: 'value', value: '/items' },
              'query.page': { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'query' }] },
              'header.X-Test': { kind: 'value', value: 'Keep me' },
              ...(body == null ? {} : { body }),
            },
          },
          data: { kind: 'value', inputs: {}, values: [{ handle: 'payload', jsonSchema: {}, nullable: true, value: {} }] },
        },
      },
    },
  }
  return createInspectorSession('en', () => {}, content, { providers: [{ service: 'example', displayName: 'Example', authTypes: ['no_auth'] }] })
}

async function selectMethod(container: HTMLElement, value: string) {
  const select = container.querySelector<HTMLSelectElement>('select[id$="-method"]')!
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('shows the applicable request fields for %s in edit and read-only views', async (method) => {
  const session = requestSession({ method })
  let mounted: ReturnType<typeof render> | undefined
  try {
    await session.start()
    mounted = render(<Inspector session={session} />)
    const { container } = mounted
    for (const readOnly of [false, true]) {
      mounted.rerender(<Inspector session={session} readOnly={readOnly} />)
      expect(container.querySelector('[role="group"][aria-label="Request body"]') != null).toBe(method !== 'GET')
      expect(container.querySelector('[role="group"][aria-label="Endpoint"]')).not.toBeNull()
      expect(container.querySelector('[role="group"][aria-label="Query parameters"]')).not.toBeNull()
      expect(container.querySelector('[role="group"][aria-label="Request headers"]')).not.toBeNull()
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.textContent).not.toContain('Request body format')
    }
  } finally {
    mounted?.unmount()
    session.dispose()
  }
})

it.each<{ label: string; body?: InputMapping; defaultBody?: JsonValue }>([
  { label: 'null', body: { kind: 'value', value: null } },
  { label: 'empty object', body: { kind: 'value', value: {} } },
  { label: 'string', body: { kind: 'value', value: 'message' } },
  { label: 'upstream output', body: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'data', output: 'payload' }] } },
  { label: 'variable', body: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'payload' }] } },
  { label: 'inherited default', defaultBody: { keep: true } },
])('clears a $label body when changing to GET as one undoable edit', async ({ body, defaultBody }) => {
  const session = requestSession({ method: 'POST', bodyFormat: 'json' }, body, defaultBody)
  let mounted: ReturnType<typeof render> | undefined
  try {
    await session.start()
    mounted = render(<Inspector session={session} />)
    const { container } = mounted
    const node = () => session.store.$.draft.value!.content.document.graph.nodes.request!
    const original = structuredClone(node())
    const originalBindings = structuredClone(session.store.$.draft.value!.content.document.bindings)
    await selectMethod(container, 'GET')
    expect(node()).toMatchObject({ inputs: { body: { kind: 'unset' } }, task: { executor: { method: 'GET', connectionId: '' } } })
    expect(container.querySelector('[role="group"][aria-label="Request body"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    if (original.kind !== 'task') throw new Error('Expected a Provider request.')
    expect(node()).toMatchObject({
      inputs: { 'endpoint': original.inputs.endpoint, 'query.page': original.inputs['query.page'], 'header.X-Test': original.inputs['header.X-Test'] },
      task: { inputs: original.task.inputs, outputs: original.task.outputs },
    })
    expect(session.store.$.draft.value!.content.document.bindings.query).toEqual({ kind: 'variable', target: 'PAYLOAD' })
    const saved = structuredClone(node())
    await act(async () => session.store.undo())
    expect(node()).toEqual(original)
    expect(session.store.$.draft.value!.content.document.bindings).toEqual(originalBindings)
    expect(container.querySelector('[role="group"][aria-label="Request body"]')).not.toBeNull()
    await act(async () => session.store.redo())
    expect(node()).toEqual(saved)
    await act(async () => session.store.selectFlow('inspector-lab'))
    expect(node()).toEqual(saved)
    expect(container.querySelector('[role="group"][aria-label="Request body"]')).toBeNull()
    await selectMethod(container, 'POST')
    expect(node()).toMatchObject({ inputs: { body: { kind: 'unset' } } })
    expect(container.querySelector('[role="group"][aria-label="Request body"]')).not.toBeNull()
  } finally {
    mounted?.unmount()
    session.dispose()
  }
})

it('repairs a saved GET body without displaying an unusable editor, while respecting read-only and disabled state', async () => {
  const session = requestSession({ method: 'GET', bodyFormat: 'json' }, { kind: 'value', value: null })
  let mounted: ReturnType<typeof render> | undefined
  try {
    await session.start()
    mounted = render(<Inspector session={session} />)
    const { container } = mounted
    const repair = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Clear Request body')
    const node = () => session.store.$.draft.value!.content.document.graph.nodes.request!
    const original = structuredClone(node())
    expect(container.querySelector('[role="group"][aria-label="Request body"]')).toBeNull()
    expect(repair()).toBeDefined()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('GET requests do not support a request body.')
    mounted.rerender(<Inspector session={session} readOnly />)
    expect(repair()).toBeUndefined()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('GET requests do not support a request body.')
    mounted.rerender(<Inspector session={session} disabled />)
    expect(repair()?.disabled).toBe(true)
    mounted.rerender(<Inspector session={session} />)
    await click(repair()!)
    expect(node()).toMatchObject({ inputs: { body: { kind: 'unset' } }, task: { executor: { method: 'GET' } } })
    expect(repair()).toBeUndefined()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await act(async () => session.store.undo())
    expect(node()).toEqual(original)
    expect(repair()).toBeDefined()
    await act(async () => session.store.redo())
    expect(repair()).toBeUndefined()
  } finally {
    mounted?.unmount()
    session.dispose()
  }
})

it('does not show a stale body error while a method change is being saved', async () => {
  const task = connectorProxyTask(connectorProxyConfigSchema.parse({ providerId: 'example', method: 'POST', bodyFormat: 'json' }))
  const saved = Promise.withResolvers<boolean>()
  const onClearBody = vi.fn()
  const mounted = render(
    <ConnectorProxySection task={task} disabled={false} hasBody input={() => null} parameters={null} onSave={() => saved.promise} onClearBody={onClearBody} />,
  )
  try {
    await selectMethod(mounted.container, 'GET')
    expect(mounted.container.querySelector('[role="alert"]')).toBeNull()
    expect(mounted.container.textContent).not.toContain('Clear Request body')
    expect(onClearBody).not.toHaveBeenCalled()
  } finally {
    await act(async () => saved.resolve(true))
    mounted.unmount()
  }
})
