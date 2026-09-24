import type { FlowCanvasViewTaskNode, FlowCanvasViewTriggerNode } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
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
  modelVersion: currentFlowModelVersion,
  modules: {
    automation: { name: 'Automation', imports: [], source: 'export default async (_, context) => context.actions.call("github.get_current_user", {})' },
    review: { name: 'Review', imports: [], source: 'export default () => ({ summary: "Ready for review" })' },
  },
  document: {
    bindings: {},
    tasks: {
      github: {
        name: 'Read GitHub profile',
        executor: { kind: 'connector', action: 'github.get_current_user', connectionId: 'github-work' },
        inputs: [],
        outputs: [],
      },
    },
    subflows: {
      child: {
        name: 'Follow-up',
        inputs: [],
        outputs: [],
        graph: { edges: [], nodes: { profile: { kind: 'task', inputs: {}, taskId: 'github', name: 'Read child profile' } } },
      },
    },
    graph: {
      nodes: {
        profile: { kind: 'task', inputs: {}, taskId: 'github' },
        child: { kind: 'subflow', subflowId: 'child', inputs: {} },
        data: {
          kind: 'value',
          name: 'Issue text',
          inputs: {},
          values: [{ handle: 'text', nullable: false, jsonSchema: { type: 'string' }, value: 'Review sidebar interactions' }],
        },
        review: { kind: 'task', name: 'Review issues', inputs: {}, task: { name: 'Review', moduleId: 'review', inputs: [], outputs: [] } },
        automation: {
          kind: 'task',
          name: 'Legacy Code access',
          inputs: {},
          task: { capabilities: [{ kind: 'connector' }], name: 'Automation', moduleId: 'automation', inputs: [], outputs: [] },
        },
        sharedCode: {
          kind: 'task',
          name: 'Code · shared permissions',
          inputs: {},
          task: {
            capabilities: [{ kind: 'connector', mode: 'shared' }],
            name: 'Shared permissions',
            moduleId: 'automation',
            inputs: [],
            outputs: [],
          },
        },
        emptyCode: {
          kind: 'task',
          name: 'Code · empty actions',
          inputs: {},
          task: {
            capabilities: [{ kind: 'connector', mode: 'independent', actions: [] }],
            name: 'Empty actions',
            moduleId: 'automation',
            inputs: [],
            outputs: [],
          },
        },
        independentCode: {
          kind: 'task',
          name: 'Code · independent accounts',
          inputs: {},
          task: {
            capabilities: [
              {
                kind: 'connector',
                mode: 'independent',
                actions: [{ action: 'github.get_current_user', connectionId: 'github-work' }, { action: 'slack.post_message' }],
              },
            ],
            name: 'Independent account',
            moduleId: 'automation',
            inputs: [],
            outputs: [],
          },
        },
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
            <div className="grid h-[300px] overflow-hidden rounded-lg border border-border">
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
    const { client, flowId } = createInspectorTransport(log, content, {
      access: {
        mode: 'selectable',
        version: 1,
        accessRevision: 1,
        sharedAccessDigest: 'lab',
        providerIds: ['github', 'slack'],
        bindings: [
          {
            accessBindingId: 'github-access',
            connectionId: 'github-work',
            connectionDisplayName: 'GitHub · Work',
            providerId: 'github',
            source: { kind: 'admin-delegation' },
            status: 'active',
          },
        ],
      },
      candidates: [
        { accessBindingId: 'github-access', connectionDisplayName: 'GitHub · Work', providerId: 'github' },
        { accessBindingId: 'github-personal-access', connectionDisplayName: 'GitHub · Personal', providerId: 'github' },
        { accessBindingId: 'slack-access', connectionDisplayName: 'Slack · Product', providerId: 'slack' },
      ],
      actions: [
        {
          actionId: 'github.get_current_user',
          serviceId: 'github',
          serviceName: 'GitHub',
          name: 'Get current user',
          description: 'Read the signed-in user.',
          authenticated: true,
          inputs: {},
          outputs: {},
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: { login: { type: 'string' } }, required: ['login'] },
        },
        {
          actionId: 'slack.post_message',
          serviceId: 'slack',
          serviceName: 'Slack',
          name: 'Post message',
          description: 'Post a message.',
          authenticated: true,
          inputs: {},
          outputs: {},
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          outputSchema: { type: 'object', properties: {} },
        },
      ],
      connections: [
        { id: 'github-work', displayName: 'GitHub · Work', isDefault: true, service: 'github', status: 'active' },
        { id: 'github-personal', displayName: 'GitHub · Personal', isDefault: false, service: 'github', status: 'active' },
        { id: 'slack-team', displayName: 'Slack · Product', isDefault: true, service: 'slack', status: 'active' },
      ],
      providers: [
        { authTypes: ['oauth2'], displayName: 'GitHub', service: 'github' },
        { authTypes: ['oauth2'], displayName: 'Slack', service: 'slack' },
      ],
    })
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
    void next.start(flowId)
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
      <div className="open-flow-workbench open-flow-theme w-full" data-theme={dark ? 'dark' : 'light'}>
        <div className="h-full space-y-5 overflow-auto p-5">
          <PanelStates dark={dark} />
          <div className="grid h-[580px] overflow-hidden rounded-lg border border-border">
            {store && (
              <FlowEditor
                key={generation}
                store={store}
                theme={dark ? 'dark' : 'light'}
                onRun={() => {}}
                onRunStarted={() => {}}
                onOpenPublications={() => {}}
                onOpenRuns={() => {}}
                onCloseRuns={() => {}}
                onToggleRuns={() => {}}
                runDrawerOpen={false}
              />
            )}
          </div>
        </div>
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
    'Inspect independent Code Actions, Action removal, and account selection. Shared permission controls and configuration links are currently hidden; explicit shared and legacy fixtures remain for implementation coverage. Check collapsed Actions with account summaries, expanded Actions missing accounts, default account selection on add, empty Actions, and long labels at narrow width in both themes.',
  render: (log, dark, language) => <Gallery dark={dark} language={language} log={log} />,
}
