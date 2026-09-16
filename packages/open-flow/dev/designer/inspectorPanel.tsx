import type { FlowCanvasViewTaskNode, FlowCanvasViewTriggerNode } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useMemo, useState } from 'react'
import { I18nProvider, useTranslate } from 'val-i18n-react'
import { initialsIcon } from '../../src/ui/browser/icons/ContentIcon.tsx'
import { EditorContextPanel } from '../../src/workbench/browser/runtime/editor/editorContextPanel.tsx'
import { FlowNodeList } from '../../src/workbench/browser/runtime/editor/flowNodeList.tsx'
import { NodeDescription } from '../../src/workbench/browser/runtime/editor/nodeDescription.tsx'
import { FlowEditor } from '../../src/workbench/browser/runtime/flowWorkspace.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { createInspectorTransport } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const reviewNode: FlowCanvasViewTaskNode = {
  id: 'review',
  kind: 'task',
  reference: 'lab/review',
  title: 'Review issues',
  inputs: [],
  outputs: [],
  position: { x: 60, y: 100 },
}
const providerNode: FlowCanvasViewTaskNode = { ...reviewNode, id: 'provider', title: 'Provider action', icon: initialsIcon('PA') }
const triggerNode: FlowCanvasViewTriggerNode = {
  id: 'trigger',
  kind: 'trigger',
  title: 'Manual trigger',
  inputs: [],
  outputs: [],
  position: { x: 60, y: 20 },
  presentation: { kind: 'manual', schedules: [] },
}
const content: RevisionContent = {
  modelVersion: 2,
  modules: { review: { name: 'Review', imports: [], source: 'export default () => ({ summary: "Ready for review" })' } },
  document: {
    bindings: {},
    tasks: {},
    subflows: {},
    graph: {
      nodes: {
        data: {
          kind: 'value',
          name: 'Issue text',
          inputs: {},
          values: [{ handle: 'text', nullable: false, jsonSchema: { type: 'string' }, value: 'Review sidebar interactions' }],
        },
        review: { kind: 'task', name: 'Review issues', inputs: {}, task: { name: 'Review', moduleId: 'review', inputs: [], outputs: [] } },
      },
      edges: [],
    },
  },
}

function PanelStates({ dark }: { dark: boolean }) {
  const t = useTranslate()
  const [description, setDescription] = useState<string | undefined>('Review the current selection without losing the canvas context.')
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-4">
      {(['empty', 'outline', 'single', 'multiple', 'returned'] as const).map((state) => {
        const outline = state === 'empty' || state === 'outline' || state === 'returned'
        return (
          <section key={state} className="min-w-0">
            <h3 className="mb-2 text-sm font-medium">
              {
                {
                  empty: 'Empty canvas',
                  outline: 'Node outline',
                  single: 'Single selection',
                  multiple: 'Multiple selection',
                  returned: 'Outline · selection retained',
                }[state]
              }
            </h3>
            <div className="h-[300px] overflow-hidden rounded-lg border border-border">
              <EditorContextPanel
                icon={outline || state === 'multiple' ? 'flow' : 'task'}
                title={outline ? t('inspector.outline') : state === 'multiple' ? t('inspector.multipleSelected', { count: 2 }) : reviewNode.title}
                theme={dark ? 'dark' : 'light'}
                focusOnOpen={false}
                onClose={() => {}}
                onBack={outline ? undefined : () => {}}
              >
                {outline ? (
                  <FlowNodeList
                    groupTriggers
                    nodes={state === 'empty' ? [] : [triggerNode, reviewNode, providerNode]}
                    onSelect={() => {}}
                    onFocusNode={() => {}}
                    onAdd={state === 'empty' ? () => {} : undefined}
                  />
                ) : state === 'multiple' ? (
                  <FlowNodeList nodes={[providerNode, reviewNode]} onSelect={() => {}} onFocusNode={() => {}} />
                ) : (
                  <NodeDescription value={description} disabled={false} onSave={setDescription} />
                )}
              </EditorContextPanel>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Gallery({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [generation, reset] = useState(0)
  const [store, setStore] = useState<WorkbenchStore>()
  const i18n = useMemo(() => createI18n(language), [language])
  useEffect(() => {
    const { client, flowId } = createInspectorTransport(log, content)
    const next = new WorkbenchStore(
      client,
      {
        getItem: (key) => window.localStorage.getItem(`lab:${key}`),
        setItem: (key, value) => window.localStorage.setItem(`lab:${key}`, value),
      },
      undefined,
      i18n,
      undefined,
      false,
    )
    setStore(next)
    void next.workspace.start(flowId)
    return () => next.dispose()
  }, [generation, i18n, log])
  useStoryActions([
    { label: 'Reset samples', onClick: () => reset((value) => value + 1) },
    {
      label: 'Reload saved data',
      disabled: store == null,
      onClick: () => {
        void store?.workspace.selectFlow('inspector-lab')
      },
    },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme w-full space-y-5 overflow-auto p-5" data-theme={dark ? 'dark' : 'light'}>
        <div className="grid h-[580px] overflow-hidden rounded-lg border border-border">
          {store && (
            <FlowEditor
              key={generation}
              store={store}
              theme={dark ? 'dark' : 'light'}
              onRun={() => {}}
              onRunStarted={() => {}}
              onCloseRuns={() => {}}
              onToggleRuns={() => {}}
              runDrawerOpen={false}
              runDrawerVisible={false}
            />
          )}
        </div>
        <PanelStates dark={dark} />
      </div>
    </I18nProvider>
  )
}

export const inspectorPanelStory: FrontendStory = {
  group: 'Workbench',
  id: 'inspector-panel',
  title: 'Properties Panel',
  standalone: true,
  description:
    'Production editor: open properties from the node toolbar, return without clearing selection, and marquee-select. Panel states appear together below.',
  render: (log, dark, language) => <Gallery dark={dark} language={language} log={log} />,
}
