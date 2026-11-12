import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { connectorProxyConfigSchema, connectorProxyTask } from '../../src/connector/common/proxy.ts'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { FlowEditor } from '../../src/workbench/browser/runtime/flowWorkspace.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession, createInspectorTransport } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const task = (config: object = {}) => connectorProxyTask(connectorProxyConfigSchema.parse({ providerId: 'github', ...config }))
function content(): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: { endpoint: { kind: 'variable', target: 'API_ENDPOINT' } },
      graph: {
        edges: ['post', 'object'].map((target) => ({ source: 'data', target })),
        nodes: {
          'data': {
            kind: 'value',
            name: 'Request data',
            inputs: {},
            values: [
              {
                handle: 'query',
                jsonSchema: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
                nullable: false,
                value: { page: 0, enabled: false },
              },
              {
                handle: 'headers',
                jsonSchema: { type: 'object', additionalProperties: { type: 'string' } },
                nullable: false,
                value: { Accept: 'application/json' },
              },
            ],
          },
          'get': { kind: 'task', name: 'GitHub request', task: task(), inputs: { endpoint: { kind: 'value', value: '/user' } } },
          'long-query': {
            kind: 'task',
            name: 'Search repositories',
            task: task({ connectionId: 'work', query: { names: ['q', 'sort', 'order', 'per_page', 'page'] }, headers: { names: ['Accept'] } }),
            inputs: {
              'endpoint': { kind: 'value', value: '/search/repositories' },
              'query.q': { kind: 'value', value: 'open-flow' },
              'query.sort': { kind: 'value', value: 'updated' },
              'query.order': { kind: 'value', value: 'desc' },
              'query.per_page': { kind: 'value', value: 10 },
              'query.page': { kind: 'value', value: 1 },
              'header.Accept': { kind: 'value', value: 'application/vnd.github+json' },
            },
          },
          'saved-get': {
            kind: 'task',
            name: 'Saved GET body',
            task: task({ bodyFormat: 'json' }),
            inputs: { endpoint: { kind: 'value', value: '/user' }, body: { kind: 'value', value: null } },
          },
          'post': {
            kind: 'task',
            name: 'JSON POST',
            task: task({ connectionId: 'work', method: 'POST', bodyFormat: 'json', query: { names: ['page'] }, headers: { names: ['X-Test'] } }),
            inputs: {
              'endpoint': { kind: 'value', value: '/unlisted' },
              'body': { kind: 'value', value: null },
              'query.page': { kind: 'value', value: 0 },
              'header.X-Test': { kind: 'value', value: 'Workbench' },
            },
          },
          'body-object': {
            kind: 'task',
            name: 'Object POST',
            task: task({ connectionId: 'work', method: 'POST', bodyFormat: 'json' }),
            inputs: {
              endpoint: { kind: 'value', value: '/unlisted' },
              body: { kind: 'value', value: { message: 'hello', metadata: { source: 'Workbench' }, optional: null } },
            },
          },
          'object': {
            kind: 'task',
            name: 'Deferred account',
            task: task({ connectionId: '', query: { mode: 'object' }, headers: { mode: 'object' } }),
            inputs: {
              endpoint: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'endpoint' }] },
              query: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'data', output: 'query' }] },
              headers: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'data', output: 'headers' }] },
            },
          },
          'public': { kind: 'task', name: 'Public API', task: task({ providerId: 'public-api' }), inputs: { endpoint: { kind: 'value', value: '/items' } } },
          'missing': {
            kind: 'task',
            name: 'Unavailable Provider',
            task: task({ providerId: 'retired-provider' }),
            inputs: { endpoint: { kind: 'value', value: '/items' } },
          },
        },
      },
    },
  }
}

function ProxyStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const [selected, setSelected] = useState('get')
  const [readOnly, setReadOnly] = useState(false)
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), content(), {
      actions: [],
      providers: [
        { service: 'github', displayName: 'GitHub', authTypes: ['oauth'] },
        { service: 'public-api', displayName: 'Public API', authTypes: ['no_auth'] },
      ],
      connections: [
        { id: 'work', service: 'github', displayName: 'Work account', status: 'active', isDefault: true },
        { id: 'expired', service: 'github', displayName: 'Expired account', status: 'reauth_required', isDefault: false },
      ],
    })
    setSession(next)
    void next.start().then(() => {
      next.store.selectNodes(['get'])
      return next.connectors.refresh()
    })
    return () => next.dispose()
  }, [language])
  useStoryActions([
    ...['get', 'long-query', 'post', 'body-object', 'object', 'public', 'missing', 'saved-get'].map((id) => ({
      label: id,
      onClick: () => {
        setSelected(id)
        session?.store.selectNodes([id])
        void session?.connectors.refresh()
      },
    })),
    { label: readOnly ? 'Edit' : 'Read only', onClick: () => setReadOnly(!readOnly) },
    { label: 'Undo', onClick: () => void session?.store.undo() },
    { label: 'Redo', onClick: () => void session?.store.redo() },
  ])
  return session == null ? null : <ProxyPanel session={session} selected={selected} readOnly={readOnly} dark={dark} />
}
function ProxyPanel({
  session,
  selected,
  readOnly,
  dark,
}: {
  session: ReturnType<typeof createInspectorSession>
  selected: string
  readOnly: boolean
  dark: boolean
}) {
  const revision = useVal(session.store.$.revision)
  const provider = useVal(session.connectors.$.selectedProvider)
  const connection = useVal(session.connectors.$.selectedConnection)
  const active = useVal(session.connectors.$.selectedActiveConnections)
  const error = useVal(session.connectors.$.selectedActionError)
  const selection = revision?.node(selected)
  if (revision == null || selection == null) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <div
        className="open-flow-workbench open-flow-theme grid"
        data-theme={dark ? 'dark' : 'light'}
        style={{ height: '100%', width: '100%', gridTemplateColumns: 'var(--context-panel-width, 400px)' }}
      >
        <InspectorSamplePanel disabled={readOnly} revision={revision} selection={selection} store={session.store} theme={dark ? 'dark' : 'light'} resizable>
          <NodeInspector
            revision={revision}
            selection={selection}
            theme={dark ? 'dark' : 'light'}
            connectorProvider={provider}
            connectorConnection={connection}
            activeConnectorConnections={active}
            connectorActionError={error}
            {...(readOnly
              ? { readOnly: true as const }
              : {
                  store: session.store,
                  connectors: session.connectors,
                  triggers: session.triggers,
                  variables: { enabled: true, names: ['API_ENDPOINT'], loaded: true, loading: false, onOpen: () => {} },
                })}
          />
        </InspectorSamplePanel>
      </div>
    </I18nProvider>
  )
}
export const connectorProxyStory: FrontendStory = {
  id: 'connector-proxy-properties',
  group: 'Node Task',
  title: 'Provider API Request',
  standalone: true,
  description:
    'GET hides Request body. Other methods prefer the Object editor: create an optional body, add and edit fields, or bind the whole body to a variable or upstream output. An unset body is not sent; null, empty objects and existing non-object values retain their meaning. Change POST with a literal or bound body to GET: method and body clear together in one Undo/Redo entry. saved-get covers an older invalid GET body with a clear action and read-only error. Edit endpoint, scalar Query and Headers using fixed values, variables or Request data. In long-query, scroll the expanded Query under the sticky Custom API Request title and hover its children: ordinary controls stay behind the title. Compare editing and Read only, then open a source menu across the title. Compare unconfigured, selected and deferred accounts, public and missing Providers. HTTP Request has its own shared-parameter regression story.',
  render: (log, dark, language) => <ProxyStory dark={dark} language={language} log={log} />,
}

function ProxyCreationStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [session, setSession] = useState<{ store: WorkbenchStore; i18n: ReturnType<typeof createI18n> }>()
  const logRef = useRef(log)
  useEffect(() => {
    logRef.current = log
  }, [log])
  useEffect(() => {
    const i18n = createI18n(language)
    const { client, flowId } = createInspectorTransport(
      (name, value) => logRef.current(name, value),
      {
        modelVersion: currentFlowModelVersion,
        modules: {},
        document: { bindings: {}, graph: { edges: [], nodes: {} } },
      },
      {
        providers: [
          { service: 'github', displayName: 'GitHub', authTypes: ['oauth'] },
          { service: 'public-api', displayName: 'Public API', authTypes: ['no_auth'] },
        ],
        actions: [
          {
            actionId: 'github.get_user',
            serviceId: 'github',
            serviceName: 'GitHub',
            name: 'Get user',
            description: 'Read a user.',
            authenticated: true,
            inputs: {},
            outputs: {},
            inputSchema: { type: 'object', properties: {} },
            outputSchema: { type: 'object', properties: { login: { type: 'string' } }, required: ['login'], additionalProperties: false },
          },
        ],
        connections: [{ id: 'work', service: 'github', displayName: 'Work account', status: 'active', isDefault: true }],
      },
    )
    const store = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, i18n, undefined, false)
    setSession({ store, i18n })
    void store.start(flowId)
    return () => {
      store.dispose()
      i18n.dispose()
    }
  }, [language])
  useStoryActions([{ label: 'Reload saved data', onClick: () => void session?.store.workspace.selectFlow('inspector-lab') }])
  if (session == null) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme grid h-full" data-theme={dark ? 'dark' : 'light'}>
        <FlowEditor
          store={session.store}
          theme={dark ? 'dark' : 'light'}
          onRun={() => {}}
          onRunStarted={() => {}}
          onOpenPublications={() => {}}
          onOpenRuns={() => {}}
          onCloseRuns={() => {}}
          onToggleRuns={() => {}}
          runDrawerOpen={false}
        />
      </div>
    </I18nProvider>
  )
}

export const connectorProxyCreationStory: FrontendStory = {
  id: 'connector-proxy-creation',
  group: 'Node Task',
  title: 'Create Provider API Request',
  standalone: true,
  description:
    'Use the production Add node panel to open GitHub or Public API and select Custom API Request from the bottom Custom group. GitHub also has an Action; Public API has none. New cards show Custom API Request above Connector · Provider, matching Action cards. Rename a node, edit its endpoint and account, then undo, redo and reload saved data. The real Workbench saves the graph and presentation through the fixture transport.',
  render: (log, dark, language) => <ProxyCreationStory dark={dark} language={language} log={log} />,
}
