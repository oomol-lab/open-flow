// @vitest-environment happy-dom
import type { ComponentProps } from 'react'
import type { GraphEdge, GraphNode } from '../../../../flow/common/change.ts'

import { act } from 'react'
import { val } from 'value-enhancer'
import { expect, it, vi } from 'vitest'
import { publicationFixture } from '../../../../../dev/designer/publicationFixture.ts'
import { click, render } from '../../../../../test/support/render.tsx'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { CodeEditor } from './codeEditor.tsx'
import { CodeTaskSection } from './codeTaskSection.tsx'
import { presentConnectorInputs } from './connectorInputPresentation.ts'
import { NodeInspector } from './nodeInspector.tsx'
import { OpenApiSection } from './openApiSection.tsx'

vi.mock('./codeEditor.tsx', () => ({
  CodeEditor: (props: ComponentProps<typeof CodeEditor>) => (
    <>
      <textarea aria-label={props.ariaLabel} aria-invalid={props.invalid} aria-describedby={props.ariaDescribedBy} defaultValue={props.value} />
      <button
        onClick={async (event) => {
          event.currentTarget.textContent = (await props.prepareCompletion?.()) ?? ''
        }}
      >
        Complete code
      </button>
    </>
  ),
}))
vi.mock('./actionPicker.tsx', () => ({
  ActionPicker: ({ onToggle }: { onToggle: (action: unknown) => void }) => (
    <button onClick={() => onToggle({ actionId: 'public.read', serviceId: 'public', serviceName: 'Public', authenticated: false, name: 'Read' })}>
      Select read action
    </button>
  ),
}))

function inspector(
  node: GraphNode,
  options: Partial<ComponentProps<typeof NodeInspector>> = {},
  nodes: Record<string, GraphNode> = {},
  bindings = {},
  edges: readonly GraphEdge[] = [],
) {
  const { draft } = publicationFixture('flow', 'fixed')
  const revision = revisionView({
    ...draft,
    content: { ...draft.content, document: { ...draft.content.document, bindings, graph: { nodes: { current: node, ...nodes }, edges } } },
  })
  const base = { revision, selection: revision.node('current'), theme: 'light' as const }
  const props =
    options.readOnly === true
      ? { ...base, ...options, readOnly: true as const }
      : {
          ...base,
          store: { nodes: {}, listWorkflowTargets: vi.fn() },
          connectors: {},
          triggers: {},
          variables: { enabled: true, names: ['API_TOKEN'], loaded: true, loading: false, onOpen: vi.fn() },
          ...options,
        }
  return render(<NodeInspector {...(props as ComponentProps<typeof NodeInspector>)} />)
}

it('orders Webhook outputs before its response settings and forwards missing Outputs creation', async () => {
  const addOutputs = vi.fn()
  const { container, i18n } = inspector(
    { kind: 'webhook', name: 'Webhook', method: 'POST', bodyFields: [], options: { responseBody: { kind: 'workflow-outputs' } } },
    { onAddWorkflowOutputs: addOutputs },
  )
  const text = container.textContent!
  expect(text).toContain(i18n.t('inspector.ports.outputsTitle'))
  expect(text).toContain(i18n.t('webhookEditor.webhookResponse'))
  expect(text.indexOf(i18n.t('inspector.ports.outputsTitle'))).toBeLessThan(text.indexOf(i18n.t('webhookEditor.webhookResponse')))
  const add = [...container.querySelectorAll('button')].find((button) => button.textContent === i18n.t('webhookEditor.webhookAddOutputs'))!
  expect(add).toBeDefined()
  await click(add)
  expect(addOutputs).toHaveBeenCalledOnce()
})

it('offers workflow output fields under the output node name in the status source menu', async () => {
  const { container, i18n } = inspector(
    { kind: 'webhook', name: 'Webhook', method: 'POST', bodyFields: [], options: { responseBody: { kind: 'workflow-outputs' } } },
    { sourceNodeIcons: { outputs: ':lucide-light:log-out:' } },
    {
      outputs: {
        kind: 'outputs',
        name: 'HTTP result',
        outputDefs: [
          { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
          { handle: 'status', jsonSchema: { type: 'integer' }, nullable: false },
        ],
        outputMappings: {},
      },
    },
    {},
    [{ source: 'current', target: 'outputs' }],
  )
  await click(container.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t('webhookEditor.webhookStatusSource')}"]`)!)
  const node = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'HTTP result')!
  expect(node).toBeDefined()
  await click(node)
  const fields = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
  expect(fields.find((field) => field.textContent?.includes('message'))?.getAttribute('aria-disabled')).toBe('true')
  const status = fields.find((field) => field.textContent === 'status')
  expect(status).toBeDefined()
  expect(status!.getAttribute('aria-disabled')).not.toBe('true')
})

it.each(['mixed', 'grouped', 'required-only', 'optional-only'] as const)('groups %s Provider inputs without changing saved definitions', (kind) => {
  const i18n = createI18n('en')
  const optional = { handle: 'cc', jsonSchema: { type: 'string' }, nullable: true }
  const required = { handle: 'to', jsonSchema: { type: 'string' }, nullable: false }
  const inputs =
    kind === 'required-only'
      ? [required]
      : kind === 'optional-only'
        ? [optional]
        : kind === 'grouped'
          ? [{ group: 'Recipients' }, optional, required]
          : [optional, required]
  try {
    expect(presentConnectorInputs(inputs, i18n.t)).toEqual(
      kind === 'mixed'
        ? [{ group: i18n.t('inspector.ports.requiredInputs') }, required, { group: i18n.t('inspector.ports.optionalInputs'), collapsed: true }, optional]
        : inputs,
    )
    expect(inputs).toEqual(
      kind === 'required-only'
        ? [required]
        : kind === 'optional-only'
          ? [optional]
          : kind === 'grouped'
            ? [{ group: 'Recipients' }, optional, required]
            : [optional, required],
    )
  } finally {
    i18n.dispose()
  }
})

it.each(['approval', 'wait', 'task'] as const)('renders %s variable bindings from the revision', (kind) => {
  const definitions = [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }]
  const inputs = { message: { kind: 'sources' as const, sources: [{ kind: 'binding' as const, bindingId: 'binding' }] } }
  const node: GraphNode =
    kind === 'task'
      ? { kind, inputs, task: { name: 'Task', inputs: definitions, outputs: [], executor: { kind: 'llm', mode: 'chat' } } }
      : { kind, inputs, inputDefinitions: definitions, prompt: 'Continue?' }
  const { container } = inspector(node, { readOnly: true }, {}, { binding: { kind: 'variable', target: 'API_TOKEN' } })
  expect(container.textContent).toContain('API_TOKEN')
})

it.each([false, true])('shows the upstream label without leaking a deleted node ID (deleted=%s)', (deleted) => {
  const upstream = '0199b784-internal'
  const { container } = inspector(
    {
      kind: 'wait',
      prompt: 'Continue?',
      inputDefinitions: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }],
      inputs: { message: { kind: 'sources', sources: [{ kind: 'node', nodeId: upstream, output: 'title' }] } },
    },
    { readOnly: true },
    deleted
      ? {}
      : {
          [upstream]: {
            kind: 'value',
            inputs: {},
            name: 'Source',
            values: [{ handle: 'title', description: 'The complete upstream title.', jsonSchema: { type: 'string' }, nullable: false }],
          },
        },
  )
  expect(container.textContent).not.toContain(upstream)
  if (!deleted) expect(container.textContent).toContain('Source')
})

it.each(['', 'https://api.example.test/spec.json'])('exposes a blocking OpenAPI error before loading %s', (sourceUrl) => {
  const load = vi.fn()
  const { container, i18n } = render(
    <OpenApiSection
      task={{ name: 'API', inputs: [], outputs: [], executor: { kind: 'openapi', sourceUrl, path: '', method: 'get', serverUrl: '', document: {}, auth: [] } }}
      disabled={false}
      load={load}
      onSave={vi.fn()}
    />,
  )
  const input = container.querySelector<HTMLInputElement>('input[aria-invalid="true"]')!
  expect(input).not.toBeNull()
  expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toContain(
    i18n.t(sourceUrl ? 'openapi.loadRequired' : 'openapi.urlRequired'),
  )
  expect(load).not.toHaveBeenCalled()
})

it.each([
  { code: undefined, readOnly: false, shown: false },
  { code: 'workflow.revision-stale', readOnly: false, shown: true },
  { code: 'workflow.dependency-stale', readOnly: false, shown: true },
  { code: 'workflow.unpublished', readOnly: false, shown: true },
  { code: 'workflow.revision-stale', readOnly: true, shown: false },
])('shows workflow recovery only for an editable stale call ($code, readOnly=$readOnly)', ({ code, readOnly, shown }) => {
  const node: GraphNode = {
    kind: 'task',
    inputs: {},
    task: { name: 'Call', inputs: [], outputs: [], executor: { kind: 'workflow', flowId: 'target', revisionId: 'r1' } },
  }
  const { container, i18n } = inspector(node, {
    readOnly,
    diagnostics: code ? [{ code, message: 'Changed', path: '/document/graph/nodes/current/task/executor/revisionId', line: 0, column: 0 }] : [],
  } as Partial<ComponentProps<typeof NodeInspector>>)
  expect(
    [...container.querySelectorAll('button')].some(
      (button) => button.textContent === i18n.t(code === 'workflow.revision-stale' ? 'workflow.refresh' : 'workflow.recheck'),
    ),
  ).toBe(shown)
})

function codeFixture(mode: 'shared' | 'independent' | 'missing') {
  const data = val({ data: [{ actionId: 'public.echo', serviceId: 'public', authenticated: false }], refreshing: false, error: undefined })
  const actions = vi.fn(() => data)
  const moduleEditor = val({ moduleId: 'code', source: '', status: 'saved' })
  const store = {
    catalogs: {
      providers: {
        get: () =>
          val({
            data: [
              { serviceId: 'public', serviceName: 'Public', noSetup: true },
              { serviceId: 'other', serviceName: 'Other', noSetup: true },
            ],
          }),
      },
      actions: { get: actions },
    },
    $: { flowId: val('flow'), moduleEditor },
    nodes: { setCodeActions: vi.fn().mockResolvedValue(true) },
    notify: vi.fn(),
    discardModuleChanges: vi.fn(),
    saveModuleEditor: vi.fn(),
  }
  const connectors = {
    $: { actions: val({}), connections: val([]), catalogs: val({}) },
    loadCodeAction: vi.fn(async () => ({ actionId: 'public.read', serviceId: 'public', authenticated: false })),
    loadCodeConnections: vi.fn(async () => []),
    prepareAction: vi.fn(),
    retryAction: vi.fn(),
  }
  const props = {
    connectors,
    store,
    disabled: false,
    theme: 'light',
    selection: {
      id: 'code',
      kind: 'task',
      module: { source: '' },
      definition: { moduleId: 'code', inputs: [], outputs: [], capabilities: mode === 'missing' ? [] : [{ kind: 'connector', mode, actions: [] }] },
    },
  } as unknown as ComponentProps<typeof CodeTaskSection>
  return { props, store, actions, data, moduleEditor }
}

it.each(['shared', 'independent'] as const)('loads %s metadata only when the editor requests completion', async (mode) => {
  const fixture = codeFixture(mode)
  const { container } = render(<CodeTaskSection {...fixture.props} />)
  expect(fixture.actions).not.toHaveBeenCalled()
  const complete = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Complete code')!
  await click(complete)
  expect(complete.textContent).toContain('TaskContext')
  if (mode === 'shared') {
    expect(fixture.actions).toHaveBeenCalledTimes(2)
    expect(fixture.actions).toHaveBeenCalledWith('public', 'flow', 'en')
    expect(fixture.actions).toHaveBeenCalledWith('other', 'flow', 'en')
    expect(complete.textContent).toContain('public.echo')
    act(() => fixture.data.set({ ...fixture.data.value, data: [] }))
    expect(fixture.actions).toHaveBeenCalledTimes(2)
  } else expect(fixture.actions).not.toHaveBeenCalled()
})

it('shows only current module diagnostics and exposes recovery after a failed save', () => {
  const fixture = codeFixture('missing')
  const diagnostic = { code: 'module.syntax', column: 1, line: 2, message: 'Invalid JavaScript syntax.', path: '/modules/code/source' }
  const view = render(
    <CodeTaskSection {...fixture.props} diagnostics={[diagnostic, { ...diagnostic, path: '/modules/other/source', message: 'Other module error' }]} />,
  )
  const editor = view.container.querySelector('textarea')!
  expect(editor.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(editor.getAttribute('aria-describedby')!)!.textContent).toContain('invalid JavaScript syntax')
  expect(view.container.textContent).not.toContain('Other module error')
  view.rerender(<CodeTaskSection {...fixture.props} diagnostics={[]} />)
  expect(editor.getAttribute('aria-invalid')).toBe('false')
  expect(view.container.textContent).not.toContain(view.i18n.t('inspector.task.retrySave'))
  act(() => fixture.moduleEditor.set({ ...fixture.moduleEditor.value, status: 'failed' }))
  expect(view.container.textContent).toContain(view.i18n.t('inspector.task.retrySave'))
})

it.each(['independent', 'shared', 'missing'] as const)('saves selected actions from %s mode and keeps failed saves open for retry', async (mode) => {
  const fixture = codeFixture(mode)
  const { container, i18n } = render(<CodeTaskSection {...fixture.props} prepareAction={async (action) => ({ action, connections: [] })} />)
  await click(container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!)
  await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Select read action')!)
  const save = [...container.querySelectorAll('button')].find((button) => button.textContent === i18n.t('common.save'))!
  fixture.store.nodes.setCodeActions.mockResolvedValue(false)
  await click(save)
  expect(fixture.store.nodes.setCodeActions).toHaveBeenLastCalledWith('code', [
    { kind: 'connector', mode: 'independent', actions: [{ action: 'public.read' }] },
  ])
  expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  fixture.store.nodes.setCodeActions.mockResolvedValue(true)
  await click(save)
  expect(container.querySelector('[role="dialog"]')).toBeNull()
})
