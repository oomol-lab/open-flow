import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { WorkflowContract } from '../../src/workflow/common/workflow.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { ApiError } from '../../src/workbench/browser/runtime/api.ts'
import { deriveInspectorDiagnostics } from '../../src/workbench/browser/runtime/editor/diagnostics.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { WorkbenchLinkContext } from '../../src/workbench/browser/runtime/linkContext.ts'
import { workflowTask, workflowCompatibility } from '../../src/workflow/common/workflow.ts'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'
const contract: WorkflowContract = {
  version: 1,
  flowId: 'weekly-report',
  name: 'Generate weekly report',
  publicationId: 'p1',
  revisionId: 'r1',
  inputs: [{ handle: 'amount', jsonSchema: { type: 'number' }, nullable: false, description: 'Invoice amount' }],
  outputs: [{ handle: 'total', jsonSchema: { type: 'number' }, nullable: false, description: 'Computed invoice total' }],
}
function WorkflowStory({ dark, language, log, empty = false }: { dark: boolean; language: UiLanguage; log: LogAction; empty?: boolean }) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const failure = useRef(false),
    changed = useRef(false),
    implementationChanged = useRef(false),
    saveFailure = useRef(false),
    published = useRef(false),
    hideAvailable = useRef(false),
    logRef = useRef(log)
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
            call: {
              kind: 'task',
              name: empty ? 'Call Workflow' : contract.name,
              inputs: empty ? {} : { amount: { kind: 'value', value: 42 } },
              task: empty
                ? { name: 'Call Workflow', inputs: [], outputs: [], executor: { kind: 'workflow', flowId: '', revisionId: '' } }
                : workflowTask(contract),
            },
          },
        },
      },
    }
    const currentContract = (): WorkflowContract =>
      changed.current
        ? {
            ...contract,
            revisionId: 'r3',
            inputs: [...contract.inputs, { handle: 'note', jsonSchema: { type: 'string' }, nullable: true, description: 'Optional note' }],
          }
        : { ...contract, revisionId: implementationChanged.current ? 'r2' : 'r1' }
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), content, {
      saveError: () => saveFailure.current,
      workflows: () =>
        [
          { ...contract, live: { hasStart: true, enabled: true, publicationId: 'p1', revisionId: currentContract().revisionId } },
          {
            flowId: 'draft-target',
            name: 'Draft target',
            live: published.current ? { hasStart: true, enabled: true, publicationId: 'p1', revisionId: 'r1' } : null,
          },
          { flowId: 'disabled-target', name: 'Disabled target', live: { hasStart: true, enabled: false, publicationId: 'p1', revisionId: 'r1' } },
          { flowId: 'no-start-target', name: 'Published without Start', live: { hasStart: false, enabled: true, publicationId: 'p1', revisionId: 'r1' } },
          { flowId: 'empty-target', name: 'Empty published workflow', live: { hasStart: true, enabled: true, publicationId: 'p1', revisionId: 'r1' } },
        ].filter((target) => !hideAvailable.current || target.live == null || !target.live.enabled || !target.live.hasStart),
      checkDiagnostics: (draft) => {
        const node = draft.document.graph.nodes.call
        if (node?.kind != 'task' || !('executor' in node.task) || node.task.executor.kind != 'workflow') return []
        if (!node.task.executor.flowId)
          return [
            {
              code: 'workflow.target-required',
              message: 'Select a target workflow.',
              path: '/document/graph/nodes/call/task/executor/flowId',
              line: 0,
              column: 0,
            },
          ]
        const executor = node.task.executor
        const flowId = executor.flowId
        const problem =
          flowId == 'draft-target' && !published.current
            ? 'unpublished'
            : flowId == 'disabled-target'
              ? 'disabled'
              : flowId == 'no-start-target'
                ? 'missing-start'
                : flowId == 'inspector-lab'
                  ? 'recursive'
                  : null
        if (problem) return [{ code: `workflow.${problem}`, message: problem, path: '/document/graph/nodes/call/task/executor/flowId', line: 0, column: 0 }]
        return workflowCompatibility(
          node,
          flowId == contract.flowId ? currentContract() : { ...contract, flowId, inputs: [], outputs: null },
          executor.revisionId == 'r3' ? currentContract() : contract,
        )
          .filter((issue) => issue.side == 'revision')
          .map((issue) => ({
            code: `workflow.${issue.reason ?? 'revision-stale'}`,
            message: issue.message,
            path: '/document/graph/nodes/call/task/executor/revisionId',
            line: 0,
            column: 0,
            values: { flowId: contract.flowId },
          }))
      },
      workflowContract: async (flowId) => {
        logRef.current('workflow.contract-request', flowId)
        if (failure.current) throw new Error('Unavailable')
        const problem =
          flowId == 'draft-target' && !published.current
            ? 'unpublished'
            : flowId == 'disabled-target'
              ? 'disabled'
              : flowId == 'no-start-target'
                ? 'missing-start'
                : null
        if (problem) throw new ApiError(400, 'flow.invalid', problem, { reason: `workflow.${problem}` })
        if (flowId != contract.flowId)
          return { ...contract, flowId, name: flowId == 'draft-target' ? 'Draft target' : 'Empty published workflow', inputs: [], outputs: null }
        return currentContract()
      },
    })
    setSession(next)
    void next.start().then(() => next.store.selectNodes(['call']))
    return () => next.dispose()
  }, [language, empty])
  useStoryActions([
    {
      label: 'Toggle available targets',
      onClick: () => {
        hideAvailable.current = !hideAvailable.current
      },
    },
    {
      label: 'Undo',
      onClick: () => {
        void session?.store.undo()
      },
    },
    {
      label: 'Redo',
      onClick: () => {
        void session?.store.redo()
      },
    },
    {
      label: 'Publish implementation change',
      onClick: () => {
        implementationChanged.current = true
        void session?.store.check()
      },
    },
    {
      label: 'Publish interface change',
      onClick: () => {
        changed.current = true
        void session?.store.check()
      },
    },
    {
      label: 'Publish draft target',
      onClick: () => {
        published.current = true
      },
    },
    {
      label: 'Fail contract requests',
      onClick: () => {
        failure.current = true
      },
    },
    {
      label: 'Fail saves',
      onClick: () => {
        saveFailure.current = true
      },
    },
    {
      label: 'Restore requests',
      onClick: () => {
        failure.current = false
        saveFailure.current = false
      },
    },
  ])
  return session == null ? null : <WorkflowPanel session={session} dark={dark} />
}
function WorkflowPanel({ session, dark }: { session: ReturnType<typeof createInspectorSession>; dark: boolean }) {
  const revision = useVal(session.store.$.revision)
  const selection = revision?.node('call')
  const diagnostics = useVal(session.store.$.diagnostics)
  return (
    <I18nProvider i18n={session.i18n}>
      <WorkbenchLinkContext.Provider value={({ flowId }) => `?story=workflow-properties&flow=${encodeURIComponent(flowId ?? '')}`}>
        <div className="open-flow-workbench open-flow-theme h-full w-full" data-theme={dark ? 'dark' : 'light'}>
          {revision != null && selection != null && (
            <InspectorSamplePanel disabled={false} revision={revision} selection={selection} store={session.store} theme={dark ? 'dark' : 'light'} resizable>
              <NodeInspector
                connectors={session.connectors}
                triggers={session.triggers}
                variables={{ enabled: true, names: [], loaded: true, loading: false, onOpen: () => {} }}
                diagnostics={deriveInspectorDiagnostics(revision, diagnostics, selection)}
                revision={revision}
                selection={selection}
                store={session.store}
                theme={dark ? 'dark' : 'light'}
              />
            </InspectorSamplePanel>
          )}
        </div>
      </WorkbenchLinkContext.Provider>
    </I18nProvider>
  )
}
export const workflowCallStories: FrontendStory[] = [
  {
    id: 'workflow-properties',
    group: 'Node Workflow',
    title: 'Properties',
    description:
      'The saved interface renders without a contract request. Publish an implementation change to keep the call valid, or an interface change to show the update prompt; updating keeps existing input values. Failed updates keep the saved contract. Published targets without Start remain unavailable.',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory log={log} dark={dark} language={language} />,
  },
  {
    id: 'workflow-empty',
    group: 'Node Workflow',
    title: 'Select workflow',
    description:
      'Targets exclude the current workflow. Check compact spacing between each heading and its first item or empty state, shared with the Agent and Code tool picker. Group status dots are green for available, amber for published without Start, and gray for unpublished or unavailable. Toggle available targets and reopen the list to inspect the persistent empty group. Search filters each group. Unavailable targets remain selectable; publish the draft target to test recovery.',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory empty log={log} dark={dark} language={language} />,
  },
]
