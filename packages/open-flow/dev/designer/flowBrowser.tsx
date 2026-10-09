import type { Flow } from '../../src/control/common/api.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { FlowBrowser } from '../../src/workbench/browser/runtime/shell/resourceBrowser.tsx'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { useStoryActions } from './storyActions.tsx'

function FlowBrowserStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [initializing, setInitializing] = useState(false)
  const [connected, setConnected] = useState(false)
  const [session, setSession] = useState<{ connect: () => void; i18n: ReturnType<typeof createI18n>; store: WorkbenchStore }>()
  useStoryActions([
    { label: initializing ? 'Finish startup' : 'Show startup', onClick: () => setInitializing(!initializing) },
    {
      label: 'Connect notifications',
      disabled: session == null || connected,
      onClick: () => {
        session?.connect()
        setConnected(true)
      },
    },
  ])
  useEffect(() => {
    setConnected(false)
    const connection = Promise.withResolvers<void>()
    const i18n = createI18n(language)
    const flows: Flow[] = ['Published flow', 'Unpublished changes with a long flow name', 'Disabled flow', 'Draft flow'].map((name, index) => {
      const flow: Flow = {
        flowId: `flow-list-sample-${index}`,
        name,
        createdAt: '2026-09-24T09:00:00.000Z',
        updatedAt: '2026-09-24T09:00:00.000Z',
        draftRevisionId: 'draft',
        resourceReferences: {
          draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
          sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
        },
        status: 'active',
        version: 1,
      }
      return index == 3
        ? flow
        : Object.assign(flow, { live: { enabled: index != 2, publicationId: `publication-${index}`, revisionId: index == 1 ? 'previous' : 'draft' } })
    })
    let reads = 0
    const client = new WorkbenchClient(
      async (path) => {
        if (String(path).split('?')[0] == '/v1/flows') {
          const catalog = reads++ == 0 ? flows : flows.map((flow, index) => (index == 3 ? Object.assign({}, flow, { name: 'Updated draft flow' }) : flow))
          return Response.json({ version: 1, flows: catalog, total: catalog.length })
        }
        return Response.json({ message: 'Unsupported story action' }, { status: 400 })
      },
      undefined,
      () => ({ ready: connection.promise, stop: () => connection.resolve() }),
    )
    const store = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, i18n)
    setSession({ connect: () => connection.resolve(), i18n, store })
    void store.start()
    return () => {
      store.dispose()
      i18n.dispose()
    }
  }, [language])
  if (session == null) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme h-[520px] w-full" data-theme={dark ? 'dark' : 'light'}>
        <FlowBrowser
          initializing={initializing}
          language={language}
          store={session.store}
          hrefForFlow={(flow) => `#${flow.flowId}`}
          onCreateFlow={async () => false}
          onSelectFlow={(flow) => log('flow.open', flow.flowId)}
        />
      </div>
    </I18nProvider>
  )
}

export const flowBrowserStory: FrontendStory = {
  group: 'Workbench',
  id: 'flow-browser',
  title: 'Flow list',
  description:
    'The list loads before notifications connect. Connect notifications to refresh the Draft row without clearing the list. Show startup to inspect the skeleton. Compact widths stack actions; switch language to inspect longer labels.',
  standalone: true,
  render: (log, dark, language) => <FlowBrowserStory dark={dark} language={language} log={log} />,
}
