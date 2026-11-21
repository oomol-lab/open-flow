import type { Graph, OutputsNode } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { WebhookSettings } from '../../src/workbench/browser/runtime/editor/flowChanges.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useCallback, useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { webhookRequestDiagnostics, webhookResponseDiagnostics } from '../../src/flow/common/graph.ts'
import { ScrollArea } from '../../src/ui/browser/scroll-area.tsx'
import { applyFlowChanges } from '../../src/workbench/browser/runtime/editor/flowChanges.ts'
import { addNode } from '../../src/workbench/browser/runtime/editor/flowChanges.ts'
import { TriggerSummary } from '../../src/workbench/browser/runtime/editor/triggerSummary.tsx'
import { WebhookEditor } from '../../src/workbench/browser/runtime/editor/webhookEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { revisionView } from '../../src/workbench/browser/runtime/revisionView.ts'
import { useStoryActions } from './storyActions.tsx'
import { triggerDraft } from './triggerFixtures.ts'

const secretSource = { bindingId: 'secret', kind: 'binding' } as const
const storyVariables = { enabled: true, loaded: true, loading: false, names: ['WEBHOOK_TOKEN', 'RELAY_SECRET'] }

function WebhookStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [disabled, setDisabled] = useState(false)
  const [createdOutputs, setCreatedOutputs] = useState<OutputsNode>()
  const [outputState, setOutputState] = useState<'ready' | 'missing' | 'disconnected'>('ready')
  const [webhook, setWebhook] = useState<WebhookSettings>({
    bodyFields: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }],
    method: 'POST',
    options: {},
  })
  const [secretVariable, setSecretVariable] = useState('WEBHOOK_TOKEN')
  const setSample = useCallback(
    (next: WebhookSettings) => {
      setSecretVariable('WEBHOOK_TOKEN')
      setOutputState('ready')
      setCreatedOutputs(undefined)
      setWebhook(next)
      log('Load webhook sample', next)
    },
    [log],
  )
  useStoryActions(
    useMemo(
      () => [
        {
          label: 'Response node',
          onClick: () => setSample({ bodyFields: [], method: 'POST', options: { responseBody: { kind: 'webhook-response', nodeId: 'reply' } } }),
        },
        {
          label: 'Missing response node',
          onClick: () => {
            setSample({ bodyFields: [], method: 'POST', options: { responseBody: { kind: 'webhook-response', nodeId: 'removed' } } })
            setOutputState('missing')
          },
        },
        {
          label: 'Disconnected response node',
          onClick: () => {
            setSample({ bodyFields: [], method: 'POST', options: { responseBody: { kind: 'webhook-response', nodeId: 'reply' } } })
            setOutputState('disconnected')
          },
        },
        {
          label: 'File response',
          onClick: () =>
            setSample({ bodyFields: [], method: 'POST', options: { responseBody: { kind: 'workflow-outputs', bodyFormat: 'artifact', output: 'report' } } }),
        },
        { label: 'Default POST', onClick: () => setSample({ bodyFields: [], method: 'POST', options: {} }) },
        {
          label: 'Any JSON body',
          onClick: () =>
            setSample({ bodyFields: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }], method: 'POST', options: { bodyMode: 'any' } }),
        },
        {
          label: 'Bearer authentication',
          onClick: () => setSample({ bodyFields: [], method: 'POST', options: { authentication: { secret: secretSource, type: 'bearer' } } }),
        },
        {
          label: 'Header authentication',
          onClick: () =>
            setSample({ bodyFields: [], method: 'POST', options: { authentication: { name: 'X-Relay-Secret', secret: secretSource, type: 'header' } } }),
        },
        {
          label: 'Missing secret Variable',
          onClick: () => {
            setSample({ bodyFields: [], method: 'POST', options: { authentication: { secret: secretSource, type: 'bearer' } } })
            setSecretVariable('REMOVED_SECRET')
          },
        },
        {
          label: 'Hosted form',
          onClick: () =>
            setSample({
              bodyFields: [
                { handle: 'name', jsonSchema: { title: 'Name', type: 'string' }, nullable: false },
                { handle: 'plan', jsonSchema: { enum: ['free', 'pro'], type: 'string' }, nullable: true },
              ],
              method: 'POST',
              options: { form: { description: 'Tell us how to reach you.', title: 'Contact us' } },
            }),
        },
        {
          label: 'Hosted form conflicts',
          onClick: () =>
            setSample({
              bodyFields: [{ handle: 'tags', jsonSchema: { items: { type: 'string' }, type: 'array' }, nullable: true }],
              method: 'POST',
              options: { bodyMode: 'any', form: {} },
            }),
        },
        { label: 'GET', onClick: () => setSample({ bodyFields: [], method: 'GET', options: {} }) },
        {
          label: 'Request fields',
          onClick: () => setSample({ bodyFields: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }], method: 'POST', options: {} }),
        },
        {
          label: 'Full response',
          onClick: () =>
            setSample({
              bodyFields: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }],
              method: 'POST',
              options: { responseData: '{"accepted":true}', responseHeaders: { 'X-Webhook': 'accepted' }, responseStatusCode: 202 },
            }),
        },
        {
          label: 'Empty response',
          onClick: () => setSample({ bodyFields: [], method: 'POST', options: { responseHeaders: { 'X-Webhook': 'accepted' } } }),
        },
        { label: 'Dynamic JSON', onClick: () => setSample({ bodyFields: [], method: 'POST', options: { responseBody: { kind: 'workflow-outputs' } } }) },
        {
          label: 'Dynamic status',
          onClick: () =>
            setSample({
              bodyFields: [],
              method: 'POST',
              options: { responseBody: { kind: 'workflow-outputs', output: 'message' }, responseStatusCode: 202, responseStatusCodeOutput: 'status' },
            }),
        },
        {
          label: 'Header fields',
          onClick: () =>
            setSample({
              bodyFields: [],
              method: 'POST',
              options: {
                responseBody: { kind: 'workflow-outputs', output: 'message' },
                responseHeaders: { 'X-Message': 'saved text', 'X-Count': 'saved count', 'X-Enabled': 'saved flag' },
                responseHeaderOutputs: { 'X-Message': 'message', 'X-Count': 'status', 'X-Enabled': 'enabled' },
              },
            }),
        },
        {
          label: 'Header object',
          onClick: () =>
            setSample({
              bodyFields: [],
              method: 'POST',
              options: {
                responseBody: { kind: 'workflow-outputs' },
                responseHeaders: { 'X-Saved': 'restored on fixed' },
                responseHeaderOutputs: { 'X-Saved': 'removed' },
                responseHeadersSource: { kind: 'workflow-outputs', output: 'headers' },
              },
            }),
        },
        {
          label: 'Missing header',
          onClick: () =>
            setSample({
              bodyFields: [],
              method: 'POST',
              options: {
                responseBody: { kind: 'workflow-outputs' },
                responseHeaderOutputs: { 'X-Removed': 'removed' },
              },
            }),
        },
        {
          label: 'Missing status',
          onClick: () =>
            setSample({ bodyFields: [], method: 'POST', options: { responseBody: { kind: 'workflow-outputs' }, responseStatusCodeOutput: 'removed' } }),
        },
        {
          label: 'Dynamic text',
          onClick: () =>
            setSample({
              bodyFields: [],
              method: 'POST',
              options: { responseBody: { kind: 'workflow-outputs', output: 'message' }, responseData: 'saved fixed body' },
            }),
        },
        {
          label: 'Missing field',
          onClick: () => setSample({ bodyFields: [], method: 'POST', options: { responseBody: { kind: 'workflow-outputs', output: 'removed' } } }),
        },
        {
          label: 'No Outputs node',
          onClick: () => {
            setSample({ bodyFields: [], method: 'POST', options: { responseBody: { kind: 'workflow-outputs' } } })
            setOutputState('missing')
          },
        },
        {
          label: 'Disconnected Outputs',
          onClick: () => {
            setSample({ bodyFields: [], method: 'POST', options: { responseBody: { kind: 'workflow-outputs' } } })
            setOutputState('disconnected')
          },
        },
        { label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled((value) => !value) },
      ],
      [disabled, setSample],
    ),
  )
  const workflowOutputs = [
    { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
    { handle: 'data', jsonSchema: { type: 'object' }, nullable: true },
    { handle: 'status', jsonSchema: { type: 'integer' }, nullable: false },
    { handle: 'enabled', jsonSchema: { type: 'boolean' }, nullable: false },
    { handle: 'headers', jsonSchema: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } }, nullable: false },
    { handle: 'items', jsonSchema: { type: 'array' }, nullable: false },
    { handle: 'report', jsonSchema: { contentMediaType: 'oomol/artifact' }, nullable: false },
    { handle: 'business_result_message_for_the_http_response', jsonSchema: { type: 'string' }, nullable: false },
  ] as const
  const graph: Graph = {
    nodes: {
      ...(outputState === 'missing'
        ? {}
        : {
            reply: { kind: 'webhook-response' as const, name: 'Reply JSON', inputs: {} },
            other: { kind: 'webhook-response' as const, name: 'Reply text', inputs: {} },
          }),
      webhook: { kind: 'webhook', name: 'Webhook', ...webhook },
      ...(outputState === 'missing'
        ? {}
        : { outputs: createdOutputs ?? { kind: 'outputs' as const, name: i18n.t('addNode.outputs'), outputDefs: workflowOutputs, outputMappings: {} } }),
    },
    edges:
      outputState === 'ready'
        ? [
            { source: 'webhook', target: 'outputs' },
            { source: 'webhook', target: 'reply' },
          ]
        : [],
  }
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-workbench open-flow-theme"
        data-theme={dark ? 'dark' : 'light'}
        style={{ display: 'flex', height: '100%', minHeight: 0, overflow: 'hidden' }}
      >
        <div className="context-panel editor-context-panel open-flow-property-panel" style={{ width: 420, maxWidth: '100%', height: '100%', minHeight: 0 }}>
          <div className="context-panel-content">
            <ScrollArea className="inspector-scroll" tabIndex={-1}>
              <div className="inspector-content">
                <WebhookEditor
                  {...webhook}
                  responseNodes={Object.entries(graph.nodes).flatMap(([id, node]) =>
                    node.kind === 'webhook-response' ? [{ id, name: node.name ?? id, reachable: outputState === 'ready' && id === 'reply' }] : [],
                  )}
                  onAddResponseNode={() => {
                    setOutputState('disconnected')
                    setWebhook((value) => ({ ...value, options: { ...value.options, responseBody: { kind: 'webhook-response', nodeId: 'reply' } } }))
                    log('Add Webhook Response')
                  }}
                  workflowOutputs={graph.nodes.outputs?.kind === 'outputs' ? graph.nodes.outputs : undefined}
                  responseDiagnostics={webhookResponseDiagnostics(graph, 'webhook')}
                  authenticationVariable={webhook.options.authentication == null ? undefined : secretVariable}
                  variables={storyVariables}
                  requestDiagnostics={webhookRequestDiagnostics(
                    graph,
                    { bindings: { secret: { kind: 'variable', target: secretVariable } }, graph },
                    'webhook',
                  )}
                  onAuthenticationChange={(choice) => {
                    const options = { ...webhook.options }
                    if (choice == null) delete options.authentication
                    else {
                      setSecretVariable(choice.variable)
                      options.authentication =
                        choice.type === 'bearer' ? { secret: secretSource, type: 'bearer' } : { name: choice.name, secret: secretSource, type: 'header' }
                    }
                    setWebhook({ ...webhook, options })
                    log('Save webhook authentication', choice)
                  }}
                  onAddWorkflowOutputs={() => {
                    const { draft } = triggerDraft({ kind: 'webhook', name: 'Webhook', ...webhook })
                    const current = { ...draft, content: { ...draft.content, document: { bindings: {}, graph } } }
                    const changes = addNode(revisionView(current), 'outputs', { kind: 'outputs', name: i18n.t('addNode.outputs') })
                    if (changes == null) return
                    const added = applyFlowChanges(current, changes).content.document.graph.nodes.outputs
                    if (added?.kind !== 'outputs') return
                    setCreatedOutputs(added)
                    setOutputState('disconnected')
                    log('Add workflow Outputs', added)
                  }}
                  disabled={disabled}
                  readOnly={disabled}
                  outputSection={
                    <TriggerSummary
                      trigger={{ kind: 'webhook', method: webhook.method, name: 'Webhook', bodyFields: webhook.bodyFields, options: webhook.options }}
                    />
                  }
                  onChange={(next) => {
                    setWebhook(next)
                    log('Save webhook', next)
                  }}
                />
                <output aria-label="Saved webhook" style={{ overflowWrap: 'anywhere', padding: '12px 16px' }}>
                  {JSON.stringify(webhook)}
                </output>
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </I18nProvider>
  )
}
export const webhookStory: FrontendStory = {
  group: 'Trigger Webhook',
  id: 'webhook-editor',
  propertyPanel: true,
  title: 'Webhook Editor',
  description:
    'Choose declared or any-JSON request bodies, Bearer or custom-header authentication backed by a Variable (including a missing Variable), and a hosted form with its conflicts. Choose fixed content, workflow outputs or an early Webhook Response node. Compare body, status and whole/per-field header sources, standard object disclosure and child indentation, node submenus with incompatible fields, long names, missing or disconnected outputs, quick creation, and read-only settings.',
  standalone: true,
  render: (log, dark, language) => <WebhookStory dark={dark} language={language} log={log} />,
}
