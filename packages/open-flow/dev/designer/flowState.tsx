import type { FlowStateView } from '../../src/state/common/state.ts'
import type { FrontendStory } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { NodeActions } from '../../src/canvas/browser/nodeActions.tsx'
import { dedupeTask } from '../../src/state/common/state.ts'
import { DedupeSection } from '../../src/workbench/browser/runtime/editor/dedupeSection.tsx'
import { FlowStateButton, FlowStatePanel } from '../../src/workbench/browser/runtime/editor/flowStatePanel.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkspacePublishIsland } from '../../src/workbench/browser/runtime/shell/workspacePublishIsland.tsx'
import { useStoryActions } from './storyActions.tsx'

const sample: FlowStateView = {
  version: 1,
  scope: 'draft',
  limits: { maxValueBytes: 65536, maxValues: 1000, maxSpaces: 100, maxIdentities: 10000, maxRunWrites: 1000 },
  values: [{ key: 'cursor', size: 80, updatedAt: 1793322000000, value: { page: 3 } }],
  spaces: [
    { space: 'node:filter', mode: 'new', count: 9000, watermark: null, updatedAt: 1793322000000 },
    { space: 'node:removed', mode: 'increasing', count: 0, watermark: '2026-10-30T01:00:00Z', updatedAt: 1793322000000 },
  ],
}
function StateStory({ language, dark }: { language: string; dark: boolean }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [scopes, setScopes] = useState<Record<'draft' | 'live', FlowStateView>>({ draft: sample, live: { ...sample, scope: 'live' } })
  const draftState = scopes.draft
  const [historyOpen, setHistoryOpen] = useState(false)
  const [stateOpen, setStateOpen] = useState(false)
  const [task, setTask] = useState<import('../../src/flow/common/change.ts').ManagedTaskDefinition>(dedupeTask())
  useStoryActions([
    { label: 'Reset state', onClick: () => setScopes({ draft: sample, live: { ...sample, scope: 'live' } }) },
    {
      label: 'Empty state',
      onClick: () => setScopes({ draft: { ...sample, values: [], spaces: [] }, live: { ...sample, scope: 'live', values: [], spaces: [] } }),
    },
  ])
  const client = useMemo(
    () => ({
      async getFlowState(_flowId: string, scope: 'draft' | 'live', includeValues = false) {
        const value = scopes[scope]
        return { ...value, scope, values: value.values.map(({ value: stored, ...item }) => (includeValues ? Object.assign(item, { value: stored }) : item)) }
      },
      async clearFlowState(_flowId: string, scope: 'draft' | 'live', key?: string) {
        setScopes((current) => {
          const value = current[scope]
          return {
            ...current,
            [scope]: {
              ...value,
              values: key == null ? [] : value.values.filter((item) => item.key !== key),
            },
          }
        })
      },
      async clearFlowDedupe(_flowId: string, scope: 'draft' | 'live', space: string) {
        setScopes((current) => {
          const value = current[scope]
          return { ...current, [scope]: { ...value, spaces: value.spaces.filter((item) => item.space !== space) } }
        })
      },
    }),
    [scopes],
  )
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-workbench open-flow-theme grid items-start gap-6 p-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]"
        data-theme={dark ? 'dark' : 'light'}
      >
        <div className="open-flow-property-panel rounded border border-border p-3">
          <div className="flex justify-end">
            <NodeActions ignored={false} history={{ label: i18n.t('flowState.history'), onClick: () => setHistoryOpen(true) }} />
          </div>
          {historyOpen && <FlowStateButton client={client} flowId="sample" nodeIds={['filter']} space="node:filter" onClose={() => setHistoryOpen(false)} />}
          <DedupeSection
            task={task}
            disabled={false}
            onSave={async (_, next) => {
              setTask(next)
              return true
            }}
            history={<FlowStateButton client={client} flowId="sample" nodeIds={['filter']} space="node:filter" />}
          />
        </div>
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
          {stateOpen && <FlowStateButton client={client} flowId="sample" nodeIds={['filter']} onClose={() => setStateOpen(false)} />}
          <FlowStatePanel
            value={draftState}
            nodeIds={['filter']}
            busy={false}
            onClearValues={(key) => void client.clearFlowState('sample', 'draft', key)}
            onClearSpace={(space) => void client.clearFlowDedupe('sample', 'draft', space)}
          />
        </div>
      </div>
    </I18nProvider>
  )
}
export const flowStateStories: FrontendStory[] = [
  {
    id: 'flow-state',
    group: 'Node Remove Duplicates',
    title: 'State and history',
    standalone: true,
    description:
      'Configure identity, mode and space. Inspect saved-entry counts, shared Flow identity counts, watermark slots and orphaned spaces together. Empty state uses short labels without inactive clear controls. Storage rules disclose isolation, retention and size/space limits on demand. Open persistent data from the publish menu, switch to production and clear a space to inspect production confirmation. Reset restores the examples.',
    render: (_log, _dark, language) => <StateStory language={language} dark={_dark} />,
  },
]
