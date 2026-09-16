import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useMemo, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import snapshots from 'virtual:lab-trigger-snapshots'
import { localizeTrigger } from '../../src/trigger/providers/localization.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { BlockLibrary } from '../../src/workbench/browser/runtime/editor/contextPanel.tsx'
import { NodePickerContent } from '../../src/workbench/browser/runtime/editor/nodePicker.tsx'
import { NodePickerPopover } from '../../src/workbench/browser/runtime/editor/nodePickerPopover.tsx'
import { WorkbenchCanvas, WorkbenchCanvasActions } from '../../src/workbench/browser/runtime/editor/workbenchCanvas.tsx'
import { CatalogStores } from '../../src/workbench/browser/runtime/stores/catalogStores.ts'
import { ConnectorStore } from '../../src/workbench/browser/runtime/stores/connectorStore.ts'
import { combineSources, mapSource } from '../../src/workbench/browser/runtime/stores/optionSource.ts'
import { useStoryActions } from './storyActions.tsx'
import { triggerFixtures } from './triggerFixtures.ts'
import { createTriggerSession } from './triggerSession.ts'

const sampleActions = [
  {
    operationType: 'write',
    actionId: 'gmail.send',
    name: 'Send email',
    description: 'Send an email to one or more recipients.',
    serviceId: 'gmail',
    serviceName: 'Gmail',
    icon: ':logos:google-gmail:',
    authenticated: true,
    inputs: {},
    outputs: {},
  },
  {
    operationType: 'read',
    actionId: 'googledrive.find',
    name: 'Find files',
    description: 'Find files by name in Google Drive.',
    serviceId: 'googledrive',
    serviceName: 'Google Drive',
    authenticated: true,
    inputs: {},
    outputs: {},
  },
]

sampleActions.push(
  { ...sampleActions[0]!, actionId: 'gmail.list', name: 'List emails', description: 'Read messages in the inbox.', operationType: 'read' },
  { ...sampleActions[0]!, actionId: 'gmail.delete', name: 'Delete email', description: 'Permanently delete a message.', operationType: 'destructive' },
  { ...sampleActions[0]!, actionId: 'gmail.legacy', name: 'Legacy action', description: 'An action without a recognized operation type.', operationType: '' },
)

const sampleProviders = [
  ...sampleActions
    .filter((action, index) => sampleActions.findIndex((candidate) => candidate.serviceId == action.serviceId) == index)
    .map((action) => ({
      service: action.serviceId,
      displayName: action.serviceName,
      authTypes: ['oauth2'],
      iconUrl: action.icon,
    })),
  { service: 'feishu', displayName: '飞书', authTypes: ['oauth2'] },
  { service: 'wecom', displayName: '企业微信', authTypes: ['oauth2'] },
  { service: '17track', displayName: '17TRACK', authTypes: ['no_auth'] },
  { service: 'seedream', displayName: 'Doubao Seedream', authTypes: ['api_key'] },
]

const sampleConnections = ['feishu', 'gmail', 'seedream'].map((serviceId) => ({
  marketplace: serviceId == 'seedream' ? { id: 'oomol' } : undefined,
  id: `${serviceId}-account`,
  displayName: serviceId,
  service: serviceId,
  isDefault: true,
  status: 'active' as const,
}))

function sampleActionData(path: string, cached = false) {
  const url = new URL(path, 'https://lab.invalid')
  return {
    version: 1,
    actions: sampleActions
      .filter(
        (action) =>
          (!url.searchParams.get('service') || action.serviceId == url.searchParams.get('service')) &&
          (!url.searchParams.get('q') || `${action.name} ${action.description}`.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase())),
      )
      .map((action) => Object.assign({}, action, { operationType: action.operationType || undefined }, cached ? { name: `${action.name} (cached)` } : {})),
  }
}

function proxyActions(path: string, cached = false) {
  return {
    success: true,
    data: sampleActionData(path, cached).actions.map((action) => ({
      id: action.actionId,
      operationType: action.operationType || undefined,
      service: action.serviceId,
      name: action.name,
      description: action.description,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
    })),
  }
}

function Preview({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [mode, setMode] = useState<'ready' | 'failed' | 'loading'>('ready')
  const [disabled, setDisabled] = useState(false)
  const [largeCatalog, setLargeCatalog] = useState(false)
  const [configuredOnly, setConfiguredOnly] = useState(false)
  const [slowAdd, setSlowAdd] = useState(false)
  const [cancelAdd, setCancelAdd] = useState(false)
  const session = useMemo(
    () =>
      createTriggerSession(triggerFixtures[0]!.trigger, language, log, 'sample', false, {
        cache: undefined,
        request: async () =>
          Response.json({
            version: 1,
            locale: language,
            definitions: snapshots,
            display: Object.fromEntries(await Promise.all(snapshots.map(async (definition) => [definition.key, await localizeTrigger(definition, language)]))),
          }),
      }),
    [language, log],
  )
  const sampleCatalog = useMemo(() => {
    const providers = sampleProviders.map((provider) =>
      Object.assign({}, provider, {
        displayName: session.i18n.lang.startsWith('zh')
          ? provider.displayName
          : provider.service == 'feishu'
            ? 'Feishu'
            : provider.service == 'wecom'
              ? 'WeCom'
              : provider.displayName,
      }),
    )
    const client = new WorkbenchClient(async (path) => {
      const url = new URL(String(path), 'https://lab.invalid')
      if (url.pathname.endsWith('/apps')) return Response.json({ success: true, data: sampleConnections })
      if (url.pathname.endsWith('/providers')) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return Response.json({ success: true, data: providers })
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return Response.json(url.pathname.endsWith('/actions') ? proxyActions(String(path)) : sampleActionData(String(path)))
    })
    const entries = new Map<string, string>()
    const data = new CatalogStores(client, {
      namespace: 'lab-node-picker',
      localStorage: {
        getItem: (key) => {
          const stored = entries.get(key)
          if (stored != null) return stored
          if (key.includes(':providers:')) return JSON.stringify({ data: { success: true, data: providers.slice(0, 1) }, etag: '"cached"' })
          if (key.includes(':actions:')) {
            const path = key.slice(key.indexOf('/v1/'))
            return JSON.stringify({ data: proxyActions(path, true), etag: null })
          }
          return null
        },
        setItem: (key, value) => {
          entries.set(key, value)
        },
      },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    })
    const store = new ConnectorStore(client, session.workspace, (notice) => log('notice', notice), { openExternalPage: async () => false }, session.i18n, data)
    return { store, data }
  }, [session, log])
  const connectors = sampleCatalog.store
  const lifetime = useMemo(() => ({ users: 0 }), [session, connectors])
  useEffect(() => {
    lifetime.users++
    void session.start()
    return () => {
      lifetime.users--
      queueMicrotask(() => {
        if (lifetime.users == 0) {
          connectors.dispose()
          sampleCatalog.data.dispose()
          session.dispose()
        }
      })
    }
  }, [session, connectors, lifetime, sampleCatalog])
  const options = useVal(session.workspace.$.addNodeOptions)
  const connections = useVal(connectors.$.connections)
  useStoryActions([
    { label: configuredOnly ? 'All groups' : 'Configured only', onClick: () => setConfiguredOnly(!configuredOnly) },
    { label: largeCatalog ? 'Small catalog' : '1,000 apps', onClick: () => setLargeCatalog(!largeCatalog) },
    { label: slowAdd ? 'Instant add' : 'Slow add', onClick: () => setSlowAdd(!slowAdd) },
    { label: cancelAdd ? 'Create on selection' : 'Cancel on selection', onClick: () => setCancelAdd(!cancelAdd) },
    { label: 'Ready', onClick: () => setMode('ready') },
    { label: 'Loading', onClick: () => setMode('loading') },
    { label: 'Error', onClick: () => setMode('failed') },
    { label: disabled ? 'Enable' : 'Disable', onClick: () => setDisabled(!disabled) },
  ])
  const data = useMemo(
    () => ({
      browseOptions: (signal: AbortSignal) => {
        if (mode == 'failed') return Promise.reject(new Error('Sample failure'))
        if (mode == 'loading')
          return new Promise<readonly (typeof options)[number][]>((resolve) => signal.addEventListener('abort', () => resolve([]), { once: true }))
        return mapSource(combineSources(signal, [session.triggers.browseAddNodeOptions(signal), connectors.browseAddNodeOptions(signal)]), signal, (apps) => {
          if (configuredOnly) return apps.filter((item) => item.kind != 'connector-group' || ['gmail', 'feishu'].includes(item.serviceId))
          const sample = apps.find((item) => item.kind == 'connector-group')
          const extra =
            largeCatalog && sample
              ? Array.from({ length: 1000 }, (_, index) => ({
                  ...sample,
                  id: `sample-${index}`,
                  serviceId: `sample-${index}`,
                  label: `Sample App ${String(index).padStart(4, '0')}`,
                }))
              : []
          return [...apps, ...extra]
        })
      },
      searchOptions: (query: string, signal: AbortSignal, sessionSignal?: AbortSignal) =>
        combineSources(signal, [session.triggers.provideAddNodeOptions(query, signal), connectors.provideAddNodeOptions(query, signal, sessionSignal)]),
      provideChoices: connectors.provideAddNodeOptionChoices,
    }),
    [session, connectors, mode, largeCatalog, configuredOnly],
  )
  const props = {
    ...data,
    connections,
    loadConnections: connectors.loadConnections,
    options,
    disabled,
    focusRequest: 0,
    onAdd: async (option: (typeof options)[number]) => {
      if (slowAdd) await new Promise((resolve) => setTimeout(resolve, 1500))
      if (cancelAdd) {
        log('Add cancelled', option.id)
        return undefined
      }
      log('Add node', option.id)
      return option.id
    },
  }
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ height: '100%', overflow: 'auto', padding: 24 }}>
        <div className="grid gap-8 min-[1100px]:grid-cols-2">
          <section className="min-[1100px]:col-span-2">
            <h3 className="mb-3 text-sm font-medium">Empty canvas · centered picker</h3>
            <div className="editor-grid context-panel-closed h-[560px] max-h-[70vh] overflow-hidden rounded-xl border border-[var(--ui-border)]">
              <WorkbenchCanvas
                addNodeOptions={options}
                disabled={disabled}
                ignoredNodeIds={[]}
                inspectorOpen={false}
                model={{ edges: [], nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }}
                nodePicker={{
                  browseOptions: data.browseOptions,
                  connections,
                  loadConnections: connectors.loadConnections,
                  provideChoices: connectors.provideAddNodeOptionChoices,
                }}
                provideAddNodeOptions={data.searchOptions}
                selectedNodeIds={[]}
                target={{ kind: 'flow' }}
                theme={dark ? 'dark' : 'light'}
                onAddNode={async (option) => {
                  log('Add node from empty canvas', option.id)
                  return option.id
                }}
                onChangeComment={() => {}}
                onConnect={() => {}}
                onCopy={() => {}}
                onDeleteEdge={() => {}}
                onDeleteNodes={() => {}}
                onDuplicate={() => {}}
                onIgnoreNodes={() => {}}
                onMoveNodes={() => {}}
                onMoveViewport={() => {}}
                onOpenInspector={() => {}}
                onPaste={() => {}}
                onSelectNodes={() => {}}
                onToggleInspector={() => {}}
              />
            </div>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-medium">Catalog · open preview</h3>
            <div className="h-[560px] max-h-[70vh] w-[440px] max-w-full overflow-hidden rounded-xl border border-[var(--ui-border)] bg-popover text-popover-foreground shadow-md">
              <BlockLibrary {...props} presentation="picker" />
            </div>
          </section>
          {['g', 'gmail', 'email'].map((query) => (
            <section key={query}>
              <h3 className="mb-3 text-sm font-medium">
                {query == 'g' ? 'Provider matches · two columns' : query == 'gmail' ? 'Provider match · browse and return' : 'Action matches · direct add'}
              </h3>
              <div className="h-[560px] max-h-[70vh] w-[440px] max-w-full overflow-hidden rounded-xl border border-[var(--ui-border)] bg-popover text-popover-foreground shadow-md">
                <NodePickerContent {...props} initialQuery={query} />
              </div>
            </section>
          ))}
          <section className="relative min-h-[640px] rounded-xl border border-[var(--ui-border)] bg-muted/30">
            <h3 className="p-4 text-sm font-medium">Button dock · anchored popover</h3>
            <div className="absolute bottom-4 left-4">
              <WorkbenchCanvasActions
                pickerOpen={false}
                onOpenNodePicker={() => log('nodePicker.open')}
                disabled={disabled}
                addNodeControl={<NodePickerPopover {...props} />}
              />
            </div>
          </section>
        </div>
      </div>
    </I18nProvider>
  )
}

export const nodePickerPreviewStory: FrontendStory = {
  group: 'Workbench',
  id: 'node-picker-preview',
  title: 'Add Node Popover',
  standalone: true,
  description:
    'The production empty canvas opens the centered picker from its Add node button or the A key. Provider details use a centered title and quiet back arrow, matching the tab height and background and show real Triggers above action categories. Gmail covers every action category; Google Drive covers a single category. Open search samples compare Provider-only and action matches, app navigation and return. Includes cached loading and 1,000-app scrolling.',
  render: (log, dark, language) => <Preview dark={dark} language={language} log={log} />,
}
