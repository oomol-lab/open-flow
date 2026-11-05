import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FlowStateSummary } from '../../src/state/common/state.ts'
import type { FlowStateClient, FlowStateNodes } from '../../src/workbench/browser/runtime/editor/flowStatePanel.tsx'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { NodeHistoryContext } from '../../src/canvas/browser/nodeActions.tsx'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { skipDuplicatesTask } from '../../src/state/common/state.ts'
import { FlowStateButton, FlowStatePanel } from '../../src/workbench/browser/runtime/editor/flowStatePanel.tsx'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkspacePublishIsland } from '../../src/workbench/browser/runtime/shell/workspacePublishIsland.tsx'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const sampleNodes: FlowStateNodes = [
  { id: 'filter', title: 'Filter new articles', icon: ':twemoji:package:', fallbackIcon: ':lucide-light:list-filter:' },
  { id: 'pending', title: 'Filter new orders', icon: ':lucide-light:list-filter:', fallbackIcon: ':lucide-light:list-filter:' },
]

const sample: FlowStateSummary = {
  version: 1,
  scope: 'draft',
  limits: { maxValueBytes: 65536, maxValues: 1000, maxSpaces: 100, maxIdentities: 10000, maxRunWrites: 1000 },
  values: { count: 23, updatedAt: 1793322000000 },
  spaces: [
    { space: 'flow', count: 500, pendingCount: 0, reservedCount: 500, updatedAt: 1793322000000 },
    { space: 'node:filter', count: 1200, pendingCount: 0, reservedCount: 1200, updatedAt: 1793322000000 },
    { space: 'node:pending', count: 5, pendingCount: 20, reservedCount: 20, updatedAt: 1793322000000 },
    { space: 'node:removed', count: 4, pendingCount: 0, reservedCount: 4, updatedAt: 1793322000000 },
  ],
}
function finishPending(state: FlowStateSummary): FlowStateSummary {
  return { ...state, spaces: state.spaces.map((space) => Object.assign({}, space, { count: space.reservedCount, pendingCount: 0 })) }
}
const cases = [
  { title: 'Single field', icon: ':twemoji:package:', fields: ['id'], items: [{ id: 1 }, { id: 1 }, { id: 2 }] },
  {
    title: 'Composite identity',
    fields: ['company', 'id'],
    items: [
      { company: 'a', id: 1 },
      { company: 'b', id: 1 },
    ],
  },
  { title: 'Scalar items', fields: [], items: ['article-a', 'article-b', 'article-a'] },
  { title: 'Read only', fields: ['id'], items: [{ id: 1 }], readOnly: true },
  { title: 'Save failure · edit to inspect retry', fields: ['id'], items: [{ id: 1 }], saveError: true },
] as const

type Session = ReturnType<typeof createInspectorSession>
function NodeSample({
  fixture,
  client,
  dark,
  language,
  log,
  onReady,
}: {
  fixture: (typeof cases)[number]
  client: FlowStateClient
  dark: boolean
  language: UiLanguage
  log: LogAction
  onReady?: (session: Session) => void
}) {
  const [session, setSession] = useState<Session>()
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const content: RevisionContent = {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            filter: {
              kind: 'task',
              name: fixture.title,
              icon: 'icon' in fixture ? fixture.icon : undefined,
              inputs: { items: { kind: 'value', value: fixture.items } },
              task: skipDuplicatesTask({ fields: [...fixture.fields] }),
            },
          },
        },
      },
    }
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), content, { saveError: () => 'saveError' in fixture })
    Object.assign(next.store.state, client)
    setSession(next)
    void next.start().then(() => {
      next.store.selectNodes(['filter'])
      onReady?.(next)
    })
    return () => next.dispose()
  }, [fixture, language, client, onReady])
  const revision = useVal(session?.store.$.revision)
  if (session == null || revision == null) return null
  const selection = revision.selection('filter')
  const readOnly = 'readOnly' in fixture
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="min-w-0 rounded border border-border">
        <InspectorSamplePanel disabled={readOnly} revision={revision} selection={selection} store={session.store} theme={dark ? 'dark' : 'light'}>
          {readOnly ? (
            <NodeInspector readOnly revision={revision} selection={selection} theme={dark ? 'dark' : 'light'} />
          ) : (
            <NodeInspector
              revision={revision}
              selection={selection}
              store={session.store}
              connectors={session.connectors}
              triggers={session.triggers}
              variables={{ enabled: false, loaded: true, loading: false, names: [] }}
              theme={dark ? 'dark' : 'light'}
            />
          )}
        </InspectorSamplePanel>
      </div>
    </I18nProvider>
  )
}
function StateStory({ language, dark, log }: { language: UiLanguage; dark: boolean; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [scopes, setScopes] = useState<Record<'draft' | 'live', FlowStateSummary>>({ draft: sample, live: { ...sample, scope: 'live' } })
  const nextRead = useRef<'normal' | 'slow' | 'failure'>('normal')
  const current = useRef(scopes)
  current.current = scopes
  const [historyOpen, setHistoryOpen] = useState(false)
  const [stateOpen, setStateOpen] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [primary, setPrimary] = useState<Session>()
  const history = useVal(primary?.store.history$)
  useStoryActions([
    {
      label: 'Reset samples',
      onClick: () => {
        setScopes({ draft: sample, live: { ...sample, scope: 'live' } })
        setGeneration((value) => value + 1)
      },
    },
    {
      label: 'Empty state',
      onClick: () =>
        setScopes({
          draft: { ...sample, values: { count: 0, updatedAt: null }, spaces: [] },
          live: { ...sample, scope: 'live', values: { count: 0, updatedAt: null }, spaces: [] },
        }),
    },
    {
      label: 'Near capacity',
      onClick: () =>
        setScopes((value) => ({
          ...value,
          draft: {
            ...value.draft,
            values: { ...value.draft.values, count: 900 },
            spaces: value.draft.spaces.map((space) => (space.space === 'node:filter' ? { ...space, count: 9000, reservedCount: 9000 } : space)),
          },
        })),
    },
    {
      label: 'Many sources',
      onClick: () =>
        setScopes((value) => ({
          ...value,
          draft: {
            ...value.draft,
            spaces: Array.from({ length: 50 }, (_, index) => ({
              space: `node:sample-${index}`,
              count: index + 1,
              reservedCount: index + 1,
              pendingCount: 0,
              updatedAt: 1793322000000,
            })),
          },
        })),
    },
    {
      label: 'Fail next load',
      onClick: () => {
        nextRead.current = 'failure'
      },
    },
    {
      label: 'Slow next load',
      onClick: () => {
        nextRead.current = 'slow'
      },
    },
    {
      label: 'Empty Live',
      onClick: () => setScopes((value) => ({ ...value, live: { ...sample, scope: 'live', values: { count: 0, updatedAt: null }, spaces: [] } })),
    },
    {
      label: 'Finish pending Run',
      onClick: () =>
        setScopes((value) => {
          return { draft: finishPending(value.draft), live: finishPending(value.live) }
        }),
    },
    {
      label: 'Undo edit',
      disabled: !history?.canUndo,
      onClick: () => {
        void primary?.store.undo()
      },
    },
    {
      label: 'Redo edit',
      disabled: !history?.canRedo,
      onClick: () => {
        void primary?.store.redo()
      },
    },
  ])
  const client = useMemo<FlowStateClient>(
    () => ({
      async getFlowStateSummary(_flowId, scope) {
        const behavior = await Promise.resolve(nextRead.current)
        nextRead.current = 'normal'
        if (behavior === 'slow') await new Promise((resolve) => setTimeout(resolve, 3000))
        if (behavior === 'failure') throw new Error('State storage is unavailable.')
        return current.current[scope]
      },
      async clearFlowState(_flowId, scope) {
        setScopes((value) => ({ ...value, [scope]: { ...value[scope], values: { count: 0, updatedAt: null } } }))
      },
      async clearFlowDedupe(_flowId, scope, space) {
        if (current.current[scope].spaces.some((item) => item.space === space && item.pendingCount > 0))
          throw new Error('Finish or cancel the pending Run before clearing history.')
        setScopes((value) => ({ ...value, [scope]: { ...value[scope], spaces: value[scope].spaces.filter((item) => item.space !== space) } }))
      },
      async clearAllFlowDedupe(_flowId, scope) {
        setScopes((value) => ({ ...value, [scope]: { ...value[scope], spaces: value[scope].spaces.filter((item) => item.pendingCount > 0) } }))
      },
    }),
    [],
  )
  return (
    <I18nProvider i18n={i18n}>
      <NodeHistoryContext.Provider value={() => ({ label: i18n.t('flowState.history'), onClick: () => setHistoryOpen(true) })}>
        <div className="open-flow-workbench open-flow-theme flex flex-col gap-6 p-6" data-theme={dark ? 'dark' : 'light'}>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {cases.map((fixture, index) => (
              <NodeSample
                key={`${generation}:${fixture.title}`}
                fixture={fixture}
                client={client}
                language={language}
                dark={dark}
                log={log}
                onReady={index === 0 ? setPrimary : undefined}
              />
            ))}
          </div>
          {historyOpen && (
            <FlowStateButton
              client={client}
              notify={(notice) => log('notice', notice)}
              flowId="sample"
              nodes={sampleNodes}
              history={{ nodeId: 'filter' }}
              onClose={() => setHistoryOpen(false)}
            />
          )}
          <div className="flex flex-col gap-4 rounded border border-border p-4">
            <div className="flex justify-end">
              <WorkspacePublishIsland
                hasPublications={false}
                onOpenPublications={() => {}}
                onOpenRuns={() => {}}
                onPublish={() => {}}
                onOpenState={() => setStateOpen(true)}
                state="current"
              />
            </div>
            {stateOpen && (
              <FlowStateButton
                client={client}
                notify={(notice) => log('notice', notice)}
                flowId="sample"
                nodes={sampleNodes}
                onClose={() => setStateOpen(false)}
              />
            )}
            <FlowStatePanel
              value={scopes.draft}
              nodes={sampleNodes}
              busy={false}
              onClearValues={() => void client.clearFlowState('sample', 'draft')}
              onClearHistory={() => void client.clearAllFlowDedupe('sample', 'draft')}
              onClearSpace={(space) => void client.clearFlowDedupe('sample', 'draft', space)}
            />
          </div>
        </div>
      </NodeHistoryContext.Provider>
    </I18nProvider>
  )
}
export const flowStateStories: FrontendStory[] = [
  {
    id: 'flow-state',
    group: 'Node Skip Duplicates',
    title: 'Properties and history',
    standalone: true,
    description:
      'Production properties with single, composite, scalar, read-only and failed-save samples. The Identity fields section uses the shared array editor without item numbers or extra indentation: insert after a row, remove the final row and add to an empty list. Check Tab order across inputs and row actions. Blur or Enter saves valid paths; unfinished blank rows are not saved. Use Undo/Redo on the single-field sample, including an unsaved blank row. History commits after Run success. Inspect the separate sections for saved data and deduplication history in empty and populated states, custom and default canvas icons, outside-view history, pending protection and near-capacity summaries. Open persistent data from the workflow menu; check the toolbar beside environment tabs, Live confirmation, cancellation focus, narrow layouts and scrolling with Many sources in both themes. Clear history removes available sources and retains pending sources; when every source is pending, group and individual clear actions are disabled. Source rows omit visible column headings, show their last update below the name, and count committed and pending identities without overlap. Pending and outside-view explanations appear only in tooltips; hover or keyboard-focus a disabled clear action to read why it is unavailable. Storage info defines saved data and deduplication history before explaining environment separation and retention. Click it to keep the explanation open; dismiss with Escape or outside interaction, then click to reopen it. Fail next load and Slow next load apply to the next open or refresh; retry failures and switch environments during slow reads. Use Empty Live to check that the dialog height stays fixed across environments, loading, empty and populated states. Both section containers remain visible during initial loads and environment changes, with loading or empty text on the second line of their headings. Refresh retains the current rows while those headings show loading; failures retain the sections and offer retry.',
    render: (log, dark, language) => <StateStory language={language} dark={dark} log={log} />,
  },
]
