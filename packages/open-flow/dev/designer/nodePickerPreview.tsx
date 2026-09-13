import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useMemo, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import snapshots from 'virtual:lab-trigger-snapshots'
import { localizeTrigger } from '../../src/trigger/providers/localization.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { BlockLibrary } from '../../src/workbench/browser/runtime/editor/contextPanel.tsx'
import { NodePickerPopover } from '../../src/workbench/browser/runtime/editor/nodePickerPopover.tsx'
import { WorkbenchCanvasActions } from '../../src/workbench/browser/runtime/editor/workbenchCanvas.tsx'
import { ConnectorStore } from '../../src/workbench/browser/runtime/stores/connectorStore.ts'
import { useStoryActions } from './storyActions.tsx'
import { triggerFixtures } from './triggerFixtures.ts'
import { createTriggerSession } from './triggerSession.ts'

const sampleActions = [
  {
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

function Preview({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [mode, setMode] = useState<'ready' | 'failed' | 'loading'>('ready')
  const [disabled, setDisabled] = useState(false)
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
  const connectors = useMemo(
    () =>
      new ConnectorStore(
        new WorkbenchClient(async (path) => {
          const url = new URL(String(path), 'https://lab.invalid')
          if (url.pathname.endsWith('/providers'))
            return Response.json({
              version: 1,
              providers: sampleActions.map((action) => ({
                serviceId: action.serviceId,
                serviceName: action.serviceName,
                ...(action.icon ? { icon: action.icon } : {}),
              })),
            })
          return Response.json({
            version: 1,
            actions: sampleActions.filter(
              (action) =>
                (!url.searchParams.get('service') || action.serviceId == url.searchParams.get('service')) &&
                (!url.searchParams.get('q') || `${action.name} ${action.serviceName}`.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase())),
            ),
          })
        }),
        session.workspace,
        (notice) => log('notice', notice),
        { openExternalPage: async () => false },
        session.i18n,
      ),
    [session, log],
  )
  const lifetime = useMemo(() => ({ users: 0 }), [session, connectors])
  useEffect(() => {
    lifetime.users++
    void session.start()
    return () => {
      lifetime.users--
      queueMicrotask(() => {
        if (lifetime.users == 0) {
          connectors.dispose()
          session.dispose()
        }
      })
    }
  }, [session, connectors, lifetime])
  const options = useVal(session.workspace.$.addNodeOptions)
  const catalog = useVal(session.triggers.catalog.state)
  useStoryActions([
    { label: 'Ready', onClick: () => setMode('ready') },
    { label: 'Loading', onClick: () => setMode('loading') },
    { label: 'Error', onClick: () => setMode('failed') },
    { label: disabled ? 'Enable' : 'Disable', onClick: () => setDisabled(!disabled) },
  ])
  const data = useMemo(
    () => ({
      browseOptions: async (signal: AbortSignal) => {
        if (mode == 'failed') throw new Error('Sample failure')
        if (mode == 'loading')
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => resolve(), { once: true })
          })
        return [...((await session.triggers.browseAddNodeOptions(signal)) ?? []), ...((await connectors.browseAddNodeOptions(signal)) ?? [])]
      },
      searchOptions: async (query: string, signal: AbortSignal) => [
        ...((await session.triggers.provideAddNodeOptions(query, signal)) ?? []),
        ...((await connectors.provideAddNodeOptions(query, signal)) ?? []),
      ],
      provideChoices: connectors.provideAddNodeOptionChoices,
    }),
    [session, connectors, mode],
  )
  const props = {
    ...data,
    options,
    catalogRevision: catalog.revision,
    disabled,
    focusRequest: 0,
    onAdd: async (option: (typeof options)[number]) => {
      log('Add node', option.id)
      return option.id
    },
  }
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ height: '100%', overflow: 'auto', padding: 24 }}>
        <div className="grid gap-8 min-[1100px]:grid-cols-2">
          <section>
            <h3 className="mb-3 text-sm font-medium">Catalog · open preview</h3>
            <div className="h-[560px] max-h-[70vh] w-[440px] max-w-full overflow-hidden rounded-xl border border-[var(--ui-border)] bg-popover text-popover-foreground shadow-md">
              <BlockLibrary {...props} presentation="picker" />
            </div>
          </section>
          <section className="relative min-h-[640px] rounded-xl border border-[var(--ui-border)] bg-muted/30">
            <h3 className="p-4 text-sm font-medium">Button dock · anchored popover</h3>
            <div className="absolute bottom-4 left-4">
              <WorkbenchCanvasActions
                blocksOpen={false}
                disabled={disabled}
                onOpenBlocks={() => log('Legacy sidebar')}
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
    'Gmail shows a brand logo; Google Drive shows the initials fallback. Nodes and Triggers use real definitions. Search across both tabs, browse app actions, or select an event directly.',
  render: (log, dark, language) => <Preview dark={dark} language={language} log={log} />,
}
