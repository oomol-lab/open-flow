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
  const [single, setSingle] = useState(false)
  const [embedded, setEmbedded] = useState(false)
  const [teams, setTeams] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [connected, setConnected] = useState(false)
  const [session, setSession] = useState<{ connect: () => void; i18n: ReturnType<typeof createI18n>; store: WorkbenchStore }>()
  useStoryActions([
    {
      label: single ? 'Show status examples' : 'Show single workflow',
      onClick: () => {
        setSingle(!single)
        setTeams(true)
        setEmbedded(true)
      },
    },
    { label: embedded ? 'Standalone layout' : 'Embedded layout', onClick: () => setEmbedded(!embedded) },
    { label: teams ? 'Hide teams' : 'Show teams', onClick: () => setTeams(!teams) },
    { label: empty ? 'Show workflows' : 'Show empty list', onClick: () => setEmpty(!empty) },
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
    const flows: Flow[] = (single ? ['xxx'] : ['Published flow', 'Unpublished changes with a long flow name', 'Disabled flow', 'Draft flow']).map(
      (name, index) => {
        const flow: Flow = {
          flowId: single ? 'flow_7a7ca0123456789abcdef67e0dd' : `flow-list-sample-${index}`,
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
      },
    )
    let reads = 0
    const client = new WorkbenchClient(
      async (path, init) => {
        const url = String(path).split('?')[0]!
        const index = flows.findIndex((flow) => url == `/v1/flows/${flow.flowId}` || url == `/v1/flows/${flow.flowId}/enabled`)
        const flow = flows[index]
        if (flow != null && init?.method == 'PATCH') {
          const { name } = JSON.parse(String(init.body)) as { name: string }
          flows[index] = { ...flow, name }
          log('flow.rename', name)
          return Response.json(flows[index])
        }
        if (flow?.live != null && init?.method == 'PUT' && url.endsWith('/enabled')) {
          const { enabled } = JSON.parse(String(init.body)) as { enabled: boolean }
          flows[index] = { ...flow, live: { ...flow.live, enabled } }
          log('flow.enabled', enabled)
          return Response.json(flows[index])
        }
        if (url.endsWith('/error-listeners')) return Response.json({ version: 1, listeners: [] })
        if (String(path).split('?')[0] == '/v1/flows') {
          const catalog = reads++ == 0 ? flows : flows.map((item, position) => (position == 3 ? Object.assign({}, item, { name: 'Updated draft flow' }) : item))
          return Response.json({ version: 1, flows: empty ? [] : catalog, total: empty ? 0 : catalog.length })
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
  }, [empty, language, log, single])
  if (session == null) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme h-[520px] w-full" data-theme={dark ? 'dark' : 'light'}>
        <FlowBrowser
          catalogWidth={embedded ? 'embedded' : undefined}
          createFlowField={{
            state: 'ready',
            ariaLabel: 'Team',
            label: 'Team',
            description: 'The workflow uses this team after creation.',
            options: [{ label: 'Sample team', value: 'sample-team' }],
            value: 'sample-team',
            onValueChange: () => {},
          }}
          flowBadges={
            teams && single
              ? { flow_7a7ca0123456789abcdef67e0dd: 'crimx_team' }
              : teams
                ? Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`flow-list-sample-${index}`, 'Sample team']))
                : undefined
          }
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
    'Show single workflow reproduces a short name, a full-length ID, and a team in an embedded list. Compare column spacing at wide and compact widths. Hover or focus a flow name to see its full text. Hover, focus, or click a Flow ID to inspect its full value and copy action; Escape closes the tooltip. Embedded layout leaves page width and spacing to the host. Show empty list to inspect the empty state. New Flow includes a team field for checking modal controls. The list loads before notifications connect. Connect notifications to refresh the Draft row without clearing the list. Show startup to inspect the skeleton. Use the row menu to rename a flow or start/stop its publication. Search for Published flow to verify the menu extends beyond a single-row table. Show teams to inspect the optional Team column. At compact widths, team names sit below flow names, unassigned teams are hidden, and status columns stay aligned across rows. Switch language and theme to inspect labels and menus.',
  standalone: true,
  render: (log, dark, language) => <FlowBrowserStory dark={dark} language={language} log={log} />,
}
