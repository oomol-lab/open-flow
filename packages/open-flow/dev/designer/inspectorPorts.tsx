import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { Group, InputPort, JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { ValueEditor } from '../../src/form/browser/valueEditor.tsx'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { PortDefinitionEditor } from '../../src/workbench/browser/runtime/editor/portDefinitionEditor.tsx'
import { WorkbenchCanvas } from '../../src/workbench/browser/runtime/editor/workbenchCanvas.tsx'
import { designerGraph } from '../../src/workbench/browser/runtime/workspace.ts'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const target = { kind: 'flow' } as const
const port = (handle: string, type = 'string') => ({ handle, jsonSchema: { type } as const, nullable: false })
const inputs: (Group | InputPort)[] = [
  { group: 'Request' },
  { ...port('trackings', 'array'), jsonSchema: { type: 'array', items: { type: 'string' } }, description: '要注册的追踪号。' },
  port('message'),
  port('missing_source'),
  { ...port('language'), nullable: true },
  { group: 'Options' },
  {
    ...port('instructions_for_the_summary'),
    jsonSchema: { 'type': 'string', 'ui:widget': 'text' },
    description: 'Keep the summary concise and preserve issue identifiers.',
  },
  { ...port('limit', 'integer'), value: 10 },
]
const outputs = [port('summary'), port('issues', 'array'), port('count', 'integer')]
const valueStates: InputPort[] = [
  port('message'),
  { ...port('tags', 'array'), jsonSchema: { type: 'array', items: { type: 'string' } }, value: [] },
  { ...port('note'), nullable: true, value: null },
  { ...port('enabled', 'boolean'), value: false },
  { ...port('nullValue', 'null'), nullable: true, value: null },
  { ...port('invalidNull', 'null'), nullable: true, value: 'old value' },
]
const portsContent: RevisionContent = {
  modelVersion: 2,
  modules: { module: { name: 'Summarize', imports: [], source: 'export default (inputs) => ({ summary: inputs.message, issues: [], count: 0 })' } },
  document: {
    bindings: {},
    tasks: {},
    subflows: {},
    graph: {
      nodes: {
        source: {
          kind: 'value',
          inputs: {},
          name: 'Issue text',
          values: [
            { ...port('text'), value: 'Review the new sidebar' },
            { ...port('issue_count', 'integer'), value: 3 },
          ],
        },
        summarize: {
          kind: 'task',
          name: 'Summarize issues',
          description: 'Prepare a short summary for the team.',
          task: { name: 'Summarize', moduleId: 'module', inputs, outputs },
          inputs: {
            message: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'text' }] },
            missing_source: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'removed' }] },
            language: { kind: 'value', value: 'English' },
            instructions_for_the_summary: { kind: 'value', value: 'Use bullet points. Include issue identifiers and next steps.' },
          },
        },
      },
      edges: [{ source: 'source', sourceHandle: 'text', target: 'summarize' }],
    },
  },
}
function Gallery({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const [generation, reset] = useState(0)
  const [disabled, setDisabled] = useState(false)
  const [open, setOpen] = useState(true)
  const selected = useVal(session?.store.$.selectedNodeIds) ?? []
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), portsContent)
    setSession(next)
    void next.start().then(() => next.store.selectNodes(['summarize']))
    return () => next.dispose()
  }, [language, generation])
  const revision = useVal(session?.store.$.revision)
  const presentation = useVal(session?.store.$.presentation)
  const [sampleOutputs, setSampleOutputs] = useState(outputs)
  const [payload, setPayload] = useState<JsonValue>({ body: {}, deliveryId: 'sample', event: 'sample' })
  const [items, setItems] = useState<JsonValue>([{ name: 'Issue summary', labels: ['design', 'review'] }])
  const [emptyValues, setEmptyValues] = useState(valueStates)
  useStoryActions([
    { label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled(!disabled) },
    {
      label: 'Reset samples',
      onClick: () => {
        reset(generation + 1)
        setSampleOutputs(outputs)
        setPayload({ body: {}, deliveryId: 'sample', event: 'sample' })
        setItems([{ name: 'Issue summary', labels: ['design', 'review'] }])
        setEmptyValues(valueStates)
        setOpen(true)
      },
    },
    {
      label: 'Reload saved data',
      onClick: () => {
        void session?.start().then(() => session.store.selectNodes(selected))
      },
    },
  ])
  if (session == null || revision == null) return null
  const selection = session.store.$.selection.value
  const model = designerGraph(revision.revision, target, presentation?.value, [], {}, {}, session.i18n.t)
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme h-full p-5" style={{ overflow: 'auto' }} data-theme={dark ? 'dark' : 'light'}>
        <div className={`editor-grid h-[650px] overflow-hidden rounded-lg border border-border ${open ? '' : 'context-panel-closed'}`}>
          <WorkbenchCanvas
            model={model}
            target={target}
            theme={dark ? 'dark' : 'light'}
            disabled={disabled}
            inspectorOpen={open}

            addNodeOptions={[]}
            provideAddNodeOptions={async () => []}
            onAddNode={async () => undefined}
            ignoredNodeIds={[]}
            onIgnoreNodes={() => {}}
            selectedNodeIds={selected}
            onSelectNodes={(ids) => {
              session.store.selectNodes(ids)
              if (ids.length > 0) setOpen(true)
            }}
            onConnect={(edge) => {
              void session.store.connect(edge)
            }}
            onDeleteEdge={() => {}}
            onDeleteNodes={() => {}}
            onMoveNodes={(positions) => {
              void session.store.moveNodes(positions)
            }}
            onMoveViewport={(viewport) => {
              void session.store.moveViewport(viewport)
            }}
            onChangeComment={() => {}}
            onCopy={() => {}}
            onPaste={() => {}}
            onDuplicate={() => {}}
            onOpenInspector={() => setOpen(true)}
            onToggleInspector={() => setOpen(!open)}
          />
          {open && (
            <InspectorSamplePanel
              resizable
              disabled={disabled}
              revision={revision}
              selection={selection}
              store={session.store}
              theme={dark ? 'dark' : 'light'}
              onClose={() => setOpen(false)}
            >
              <NodeInspector
                variables={{ enabled: true, names: ['API_TOKEN', 'TEAM_NAME'], loaded: true, loading: false, onOpen: () => {} }}
                connectorAuthorizationPending={false}
                connectorLoading={false}
                connectors={session.connectors}
                disabled={disabled}
                revision={revision}
                selection={selection}
                store={session.store}
                theme={dark ? 'dark' : 'light'}
                target={target}
                triggerAuthorizationPending={false}
                triggerConnectionLoading={false}
                triggers={session.triggers}
              />
            </InspectorSamplePanel>
          )}
        </div>
        <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-5">
          <section className="inspector-port-section p-3">
            <h3 className="mb-3 text-xs font-medium">Payload · structured fields</h3>
            <ValueEditor
              key={`payload-${generation}`}
              label="payload"
              path="/payload"
              schema={{
                type: 'object',
                required: ['body', 'deliveryId', 'event'],
                additionalProperties: false,
                properties: { body: { type: 'object' }, deliveryId: { type: 'string' }, event: { type: 'string' } },
              }}
              value={payload}
              disabled={disabled}
              onDraftIssue={() => {}}
              onChange={(value) => setPayload(value as JsonValue)}
            />
          </section>
          <section className="inspector-port-section p-3">
            <h3 className="mb-3 text-xs font-medium">Array · nested values</h3>
            <ValueEditor
              key={`items-${generation}`}
              label="items"
              path="/items"
              schema={{
                type: 'array',
                items: { type: 'object', properties: { name: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } } },
              }}
              value={items}
              disabled={disabled}
              onDraftIssue={() => {}}
              onChange={(value) => setItems(value as JsonValue)}
            />
          </section>
        </div>
        <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-5">
          <section className="inspector-port-section">
            <h3 className="px-3 pt-3 text-xs font-medium">Outputs · drag to reorder</h3>
            <PortDefinitionEditor output disabled={disabled} values={sampleOutputs} onChange={(next) => setSampleOutputs([...next] as typeof outputs)} />
          </section>
          <section className="inspector-port-section">
            <h3 className="px-3 pt-3 text-xs font-medium">Fixed interface · read only</h3>
            <PortDefinitionEditor groups output disabled values={inputs} onChange={() => {}} />
          </section>
          <section className="inspector-port-section">
            <h3 className="px-3 pt-3 text-xs font-medium">Values · unset, empty, null, false</h3>
            <PortDefinitionEditor disabled={disabled} values={emptyValues} onChange={(next) => setEmptyValues([...next] as typeof emptyValues)} />
          </section>
        </div>
      </div>
    </I18nProvider>
  )
}
export const inspectorPortsStory: FrontendStory = {
  group: 'Node Task',
  id: 'inspector-ports',
  title: 'Ports & sources',
  standalone: true,
  description:
    'Saved sources render before their checks. Select the incompatible issue_count source, then edit its upstream type to clear the input error. Reload checks saved values and ordering.',
  render: (log, dark, language) => <Gallery dark={dark} language={language} log={log} />,
}
