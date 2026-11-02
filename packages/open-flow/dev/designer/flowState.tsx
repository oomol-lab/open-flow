import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FlowStateView } from '../../src/state/common/state.ts'
import type { FlowStateClient } from '../../src/workbench/browser/runtime/editor/flowStatePanel.tsx'
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

const sample: FlowStateView = {
  version: 1,
  scope: 'draft',
  limits: { maxValueBytes: 65536, maxValues: 1000, maxSpaces: 100, maxIdentities: 10000, maxRunWrites: 1000 },
  values: [{ key: 'cursor', size: 80, updatedAt: 1793322000000, value: { page: 3 } }],
  spaces: [
    { space: 'flow', count: 500, pendingCount: 0, reservedCount: 500, updatedAt: 1793322000000 },
    { space: 'node:filter', count: 9000, pendingCount: 0, reservedCount: 9000, updatedAt: 1793322000000 },
    { space: 'node:pending', count: 5, pendingCount: 20, reservedCount: 20, updatedAt: 1793322000000 },
    { space: 'node:removed', count: 4, pendingCount: 0, reservedCount: 4, updatedAt: 1793322000000 },
  ],
}
function finishPending(state: FlowStateView): FlowStateView {
  return { ...state, spaces: state.spaces.map((space) => Object.assign({}, space, { count: space.reservedCount, pendingCount: 0 })) }
}
const cases = [
  { title: 'Single field', fields: ['id'], items: [{ id: 1 }, { id: 1 }, { id: 2 }] },
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
  const [scopes, setScopes] = useState<Record<'draft' | 'live', FlowStateView>>({ draft: sample, live: { ...sample, scope: 'live' } })
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
      onClick: () => setScopes({ draft: { ...sample, values: [], spaces: [] }, live: { ...sample, scope: 'live', values: [], spaces: [] } }),
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
      async getFlowState(_flowId, scope, includeValues = false) {
        const value = current.current[scope]
        return { ...value, values: value.values.map(({ value: stored, ...item }) => (includeValues ? Object.assign(item, { value: stored }) : item)) }
      },
      async clearFlowState(_flowId, scope, key) {
        setScopes((value) => ({ ...value, [scope]: { ...value[scope], values: key == null ? [] : value[scope].values.filter((item) => item.key !== key) } }))
      },
      async clearFlowDedupe(_flowId, scope, space) {
        if (current.current[scope].spaces.some((item) => item.space === space && item.pendingCount > 0))
          throw new Error('Finish or cancel the pending Run before clearing history.')
        setScopes((value) => ({ ...value, [scope]: { ...value[scope], spaces: value[scope].spaces.filter((item) => item.space !== space) } }))
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
              flowId="sample"
              nodeIds={['filter', 'pending']}
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
            {stateOpen && <FlowStateButton client={client} flowId="sample" nodeIds={['filter', 'pending']} onClose={() => setStateOpen(false)} />}
            <FlowStatePanel
              value={scopes.draft}
              nodeIds={['filter', 'pending']}
              busy={false}
              onClearValues={(key) => void client.clearFlowState('sample', 'draft', key)}
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
      'Production properties with single, composite, scalar, read-only and failed-save samples. Use Undo/Redo on the single-field sample, including an unsaved blank row. Check keyboard focus after deletion. History commits after Run success; inspect reserved capacity, empty history and production reset confirmation.',
    render: (log, dark, language) => <StateStory language={language} dark={dark} log={log} />,
  },
]
