// @vitest-environment happy-dom
import type { ComponentProps } from 'react'
import type { GraphEdge, GraphNode, JsonValue, TaskCapability } from '../../../../flow/common/change.ts'

import { act } from 'react'
import { val } from 'value-enhancer'
import { expect, it, vi } from 'vitest'
import { publicationFixture } from '../../../../../dev/designer/publicationFixture.ts'
import { click, input as enterInput, render } from '../../../../../test/support/render.tsx'
import { inputValues } from '../../../../flow/common/inputValue.ts'
import { triggerDefinitions } from '../../../../trigger/providers/definitions.ts'
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
      <textarea
        aria-label={props.ariaLabel}
        aria-invalid={props.invalid}
        aria-describedby={props.ariaDescribedBy}
        defaultValue={props.value}
        readOnly={props.disabled}
      />
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

it('shows the localized optional notification subscription without changing the saved value', async () => {
  const { container, i18n } = inspector(
    {
      kind: 'task',
      inputs: {
        leinaId: { kind: 'value', value: 'default' },
        message: { kind: 'value', value: 'Report ready.' },
        subscription: { kind: 'value', value: 'sub_conversation' },
      },
      task: {
        name: 'Notify',
        executor: { kind: 'connector', action: 'leina.send_notification' },
        inputs: [
          { handle: 'leinaId', jsonSchema: { type: 'string' }, nullable: false },
          { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
          { handle: 'subscription', jsonSchema: { type: 'string' }, nullable: true, description: 'A fixed conversation; leave unset for Home.' },
        ],
        outputs: [],
      },
    },
    { readOnly: true },
  )
  const optional = [...container.querySelectorAll('summary')].find((summary) => summary.textContent?.includes(i18n.t('inspector.ports.optionalInputs')))
  expect(optional).toBeDefined()
  await click(optional!)
  const values = () => [...container.querySelectorAll('input')].map((input) => input.value)
  expect(values()).toContain(i18n.t('leina.subscription'))
  expect(values()).toContain('sub_conversation')
  await act(() => i18n.switchLang('zh-CN'))
  expect(values()).toContain('通知订阅')
  expect(values()).toContain('sub_conversation')
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
    listWorkflowTargets: vi.fn().mockResolvedValue([]),
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

function savedProviderTrigger(key: string, config: Readonly<Record<string, JsonValue>>): GraphNode {
  const definition = triggerDefinitions.find((item) => item.snapshot.key === key)!.snapshot
  const base = { name: definition.displayName, config: inputValues(config), connectionId: 'saved-account' }
  return definition.type === 'poll' ? { ...base, definition, kind: 'poll', pollTimes: [] } : { ...base, definition, kind: 'integration' }
}

it('uses the Feishu event picker and chat filter for a read-only trigger without loading online configuration', async () => {
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  const node = savedProviderTrigger('feishu_app_bot.on_event', { sourceId: 'saved-source', eventTypes: ['im.message.receive_v1'], chatIds: ['oc_saved'] })
  const { container, i18n } = inspector(node, { readOnly: true })
  const source = container.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t('eventSources.source')}"]`)!
  expect(source.disabled).toBe(true)
  expect(source.textContent).toContain('saved-source')
  expect(container.textContent).toContain(i18n.t('eventSources.eventNames.im_message_receive_v1'))
  const checked = [
    ...container.querySelectorAll<HTMLElement>(`[role="group"][aria-label="${i18n.t('eventSources.events')}"] [role="checkbox"][aria-checked="true"]`),
  ]
  expect(checked.length).toBeGreaterThan(0)
  for (const checkbox of checked) expect(checkbox.getAttribute('aria-disabled')).toBe('true')
  expect([...container.querySelectorAll('button')].some((button) => button.getAttribute('aria-label')?.startsWith(`${i18n.t('eventSources.delete')}:`))).toBe(
    false,
  )
  const chats = [...container.querySelectorAll('textarea')].find((element) => element.value === 'oc_saved')!
  expect(chats.readOnly).toBe(true)
  expect(chats.disabled).toBe(false)
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
  await enterInput(search, 'nonmatching event')
  expect(container.textContent).toContain(i18n.t('eventSources.noEventMatches'))
  expect(container.textContent).not.toContain(i18n.t('eventSources.managementRequired'))
  expect(request).not.toHaveBeenCalled()
})

it('keeps the saved Feishu resource controls inspectable without asserting subscription management authority', () => {
  const { container, i18n } = inspector(
    savedProviderTrigger('feishu_app_bot.on_event', {
      sourceId: 'saved-source',
      eventTypes: ['drive.file.edit_v1'],
      resource: { kind: 'document', id: 'saved-document', documentType: 'docx' },
    }),
    { readOnly: true },
  )
  const id = [...container.querySelectorAll('input')].find((element) => element.value === 'saved-document')!
  expect(id.readOnly).toBe(true)
  expect(id.disabled).toBe(false)
  expect(container.textContent).not.toContain(i18n.t('eventSources.managementRequired'))
})

it.each<{ key: string; config: Readonly<Record<string, JsonValue>>; control: string; value: string }>([
  { key: 'linear.on_issue_changed', config: { teamId: 'saved-team', stateIds: ['saved-status'] }, control: 'linearTrigger.team', value: 'saved-team' },
  { key: 'tally.on_form_response', config: { formId: 'saved-form' }, control: 'tallyTrigger.form', value: 'saved-form' },
])('uses the existing saved selection control for read-only $key', ({ key, config, control, value }) => {
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  const { container, i18n } = inspector(savedProviderTrigger(key, config), { readOnly: true })
  const select = container.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t(control)}"]`)!
  expect(select.disabled).toBe(true)
  expect(select.textContent).toContain(value)
  expect(select.getAttribute('aria-invalid')).not.toBe('true')
  expect(request).not.toHaveBeenCalled()
})

it('omits the account section when snapshot Provider metadata declares no setup', () => {
  const { container, i18n } = inspector(
    { kind: 'task', inputs: {}, task: { name: 'Read public data', inputs: [], outputs: [], executor: { kind: 'connector', action: 'public.read' } } },
    { readOnly: true, connectorProviders: { public: { serviceId: 'public', serviceName: 'Public', noSetup: true } } },
  )
  expect([...container.querySelectorAll('h3')].some((heading) => heading.textContent === i18n.t('inspector.account.title'))).toBe(false)
})

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
  const editor = view.container.querySelector('textarea[aria-label="Source"]')!
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
  await click(
    [...container.querySelectorAll<HTMLButtonElement>('[aria-haspopup="dialog"]')].find((button) =>
      button.getAttribute('aria-label')?.startsWith(i18n.t('actionPicker.configureActions')),
    )!,
  )
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

it('inspects saved Code tools, accounts and HTTP hosts through the read-only node panel', async () => {
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  const { container, i18n } = inspector(
    {
      kind: 'task',
      name: 'Code',
      inputs: {},
      task: {
        name: 'Code',
        moduleId: 'main',
        inputs: [],
        outputs: [],
        capabilities: [
          {
            kind: 'connector',
            mode: 'independent',
            actions: [
              { action: 'blog.list', connectionId: 'saved-account' },
              { action: 'blog.read', connectionId: '' },
            ],
          },
          { kind: 'workflow', flowId: 'summary', revisionId: 'r1', name: 'summarize', inputs: [], outputs: [] },
          { kind: 'http', hosts: ['api.example.com', '*.example.org'] },
        ],
      },
    },
    { readOnly: true, connectorProviders: { blog: { serviceId: 'blog', serviceName: 'Blog' } } },
  )
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Source"]')!.readOnly).toBe(true)
  expect(container.textContent).not.toContain('independent')
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t('actionPicker.configureActions')} · 3"]`)!
  expect(trigger.disabled).toBe(false)
  await click(trigger)
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.textContent).toContain('blog.list')
  expect(dialog.textContent).toContain('Blog')
  expect(dialog.textContent).toContain('summarize')
  const account = dialog.querySelector<HTMLInputElement>(`input[aria-label="${i18n.t('actionPicker.accountFor', { action: 'blog.list' })}"]`)!
  expect(account.readOnly).toBe(true)
  expect(account.value).toBe('saved-account')
  expect(dialog.querySelector<HTMLInputElement>(`input[aria-label="${i18n.t('actionPicker.accountFor', { action: 'blog.read' })}"]`)!.value).toBe(
    i18n.t('inspector.account.deferred'),
  )
  expect(dialog.querySelector('[role="searchbox"], [role="combobox"]')).toBeNull()
  expect([...dialog.querySelectorAll('button')].some((button) => button.textContent === i18n.t('common.save'))).toBe(false)
  await click([...dialog.querySelectorAll('button')].find((button) => button.textContent === i18n.t('common.close'))!)
  const hosts = [...container.querySelectorAll('button')].find((button) => button.textContent === `${i18n.t('inspector.task.httpHosts')} · 2`)!
  await click(hosts)
  const hostDialog = container.querySelector<HTMLElement>('[role="dialog"]')!
  const hostList = hostDialog.querySelector('textarea')!
  expect(hostList.readOnly).toBe(true)
  expect(hostList.disabled).toBe(false)
  expect(hostList.value).toBe('api.example.com\n*.example.org')
  expect(hostDialog.textContent).not.toContain(i18n.t('inspector.task.httpHostsHint'))
  expect([...hostDialog.querySelectorAll('button')].some((button) => button.textContent === i18n.t('common.save'))).toBe(false)
  expect(request).not.toHaveBeenCalled()
})

it.each<{ capabilities?: readonly TaskCapability[] }>([{}, { capabilities: [] }, { capabilities: [{ kind: 'connector', mode: 'independent', actions: [] }] }])(
  'omits empty Code capability controls in the read-only inspector ($capabilities)',
  ({ capabilities }) => {
    const { container, i18n } = inspector(
      { kind: 'task', name: 'Code', inputs: {}, task: { name: 'Code', moduleId: 'main', inputs: [], outputs: [], capabilities } },
      { readOnly: true },
    )
    expect(container.querySelector(`[aria-label^="${i18n.t('actionPicker.configureActions')}"]`)).toBeNull()
    expect(container.textContent).not.toContain(i18n.t('inspector.task.httpHosts'))
    expect(container.textContent).not.toContain('independent')
  },
)

it.each([
  ['node', false],
  ['node', true],
  ['flow', false],
  ['flow', true],
] as const)('isolates Skip Duplicates edits when switching %s with pending=%s', async (switchBy, pending) => {
  const deferred = Promise.withResolvers<boolean>()
  const saveTaskSettings = vi
    .fn()
    .mockImplementationOnce(() => (pending ? deferred.promise : Promise.resolve(false)))
    .mockResolvedValue(true)
  const store = { $: { flowId: val(undefined) }, nodes: { saveTaskSettings } }
  const section = (flowId: string, nodeId: string) => {
    const { draft } = publicationFixture(flowId, 'fixed')
    const node: GraphNode = {
      kind: 'task',
      name: 'Dedupe',
      inputs: {},
      task: { name: 'Dedupe', inputs: [], outputs: [], executor: { kind: 'skip-duplicates', fields: [] } },
    }
    const revision = revisionView({
      ...draft,
      content: { ...draft.content, document: { ...draft.content.document, graph: { nodes: { [nodeId]: node }, edges: [] } } },
    })
    return (
      <NodeInspector
        {...({
          revision,
          selection: revision.node(nodeId),
          store,
          connectors: {},
          triggers: {},
          disabled: false,
          theme: 'light',
          variables: { enabled: false, names: [], loaded: true, loading: false },
        } as unknown as ComponentProps<typeof NodeInspector>)}
      />
    )
  }
  const view = render(section('first', 'node-a'))
  const fieldSelector = `[role="group"][aria-label="${view.i18n.t('flowState.field')}.0"] input`
  async function addField() {
    const label = `${view.i18n.t('valueEditor.addItem')} ${view.i18n.t('flowState.field')}`
    await click(view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!)
    return view.container.querySelector<HTMLInputElement>(fieldSelector)!
  }
  const field = await addField()
  await enterInput(field, 'id')
  await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(saveTaskSettings).toHaveBeenCalledTimes(1)
  const nextId = switchBy === 'node' ? 'node-b' : 'node-a'
  view.rerender(section(switchBy === 'flow' ? 'second' : 'first', nextId))
  expect(view.container.querySelector(fieldSelector)).toBeNull()
  expect(view.container.textContent).not.toContain(view.i18n.t('flowState.saveFailed'))
  const nextField = await addField()
  await enterInput(nextField, 'url')
  await act(async () => {
    nextField.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    deferred.resolve(true)
  })
  expect(saveTaskSettings).toHaveBeenCalledTimes(2)
  expect(saveTaskSettings).toHaveBeenLastCalledWith(
    nextId,
    expect.objectContaining({ task: expect.objectContaining({ executor: { kind: 'skip-duplicates', fields: ['url'] } }) }),
  )
})
