import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { ValueEditorFeedback } from '../../src/form/browser/fieldControl.tsx'
import { Input } from '../../src/ui/browser/input.tsx'
import { CodeEditor } from '../../src/workbench/browser/runtime/editor/codeEditor.tsx'
import { CodeEditorPlaceholder } from '../../src/workbench/browser/runtime/editor/codeEditorPlaceholder.tsx'
import { agentStory, codeActionsStory } from './agent.tsx'
import { cardStories } from './cards.tsx'
import { commentPropertiesStory } from './commentProperties.tsx'
import { conditionEditorStory } from './conditionEditor.tsx'
import { connectionPathsStory } from './connectionPaths.tsx'
import { connectorAccessStory } from './connectorAccess.tsx'
import { decisionStory } from './decision.tsx'
import { errorWorkflowStory } from './errorWorkflow.tsx'
import { eventSourcesStory, createEventSourceStory, eventSourceSetupStory, feishuFiltersStory, feishuSummaryStory, eventPickerStory } from './eventSources.tsx'
import { fieldLayoutStory } from './fieldLayout.tsx'
import { fieldSettingsStory, groupSettingsStory } from './fieldSettings.tsx'
import { fieldTypesStory } from './fieldTypes.tsx'
import { flowBrowserStory } from './flowBrowser.tsx'
import { flowStateStories } from './flowState.tsx'
import { formStory } from './form.tsx'
import { historyStory, historyControlsStory, historyKeyboardStory } from './history.tsx'
import { hostThemeStory } from './hostTheme.tsx'
import { httpRequestStories } from './httpRequest.tsx'
import { iconPickerStory } from './iconPicker.tsx'
import { inputErrorsStory } from './inputErrors.tsx'
import { inspectorPanelStory } from './inspectorPanel.tsx'
import { inspectorPortsStory } from './inspectorPorts.tsx'
import { jsonThemeStory } from './jsonTheme.tsx'
import { leinaStory } from './leina.tsx'
import { libraryStory } from './library.tsx'
import { llmStory } from './llm.tsx'
import { markdownStory } from './markdown.tsx'
import { metadataStory } from './metadata.tsx'
import { nodeInputStory } from './nodeInput.tsx'
import { nodePickerPreviewStory } from './nodePickerPreview.tsx'
import { nodePropertiesStories } from './nodeProperties.tsx'
import { nodeStories } from './nodeStories.tsx'
import { notificationsStory } from './notifications.tsx'
import { openApiStories } from './openapi.tsx'
import { outputsStory } from './outputs.tsx'
import { overviewStories } from './overview.tsx'
import { popupLayoutStory } from './popupLayout.tsx'
import { previewStories } from './preview.tsx'
import { providerSpritesStory } from './providerSprites.tsx'
import { publicationsStory } from './publications.tsx'
import { scheduleStory } from './schedule.tsx'
import { stories } from './stories.tsx'
import { useStoryActions } from './storyActions.tsx'
import { diagnosticsStory, triggerConfigStory } from './triggerConfig.tsx'
import { triggerStories } from './triggerStories.tsx'
import { valueEditorDangerStory } from './valueEditorDanger.tsx'
import { additionalInputsStory, lazyFieldsStory, groupedInputsStory, outputPortsStory, valueNodeStory } from './valueNode.tsx'
import { variablesStory } from './variables.tsx'
import { waitConfigurationStory } from './waitConfiguration.tsx'
import { executionLogsStory, runHistoryStory, runStatusIslandStory, waitRunsStory } from './waitRuns.tsx'
import { webhookStory } from './webhook.tsx'
import { workflowStories } from './workflow.tsx'
import { workflowCallStories } from './workflowCalls.tsx'
import { workspaceRecoveryStory } from './workspaceRecovery.tsx'

const codeEditorTyping = `/**
 * @typedef {{
 *   value: string;
 * }} Inputs;
 * @typedef {{
 *   result: string;
 * }} Outputs;
 */
`

const codeEditorSource = `import { createHash } from "node:crypto"

export default async function (inputs, context) {
  const previous = await context.getPrevious()
  const digest = createHash("sha256").update(inputs.value).digest("hex")
  return { result: \`\${digest} after \${previous.length} nodes\` }
}
`
const codeEditorServerSource = codeEditorSource.replace('"node:crypto"\n', '"node:crypto"\nimport { request } from "node:http"\n')

const codeEditorStory: FrontendStory = {
  group: 'Node Task',
  id: 'code-editor',
  render: (log, dark) => <CodeEditorStory dark={dark} log={log} />,
  standalone: true,
  title: 'Code Editor',
  description:
    'The static loading placeholder preserves the editor surface and gutter in both themes. Syntax and server errors keep the editor border in its danger state. Edit or reset the source to check that it clears when all errors are resolved.',
}

export const labStories: readonly FrontendStory[] = [
  hostThemeStory,
  executionLogsStory,
  runHistoryStory,
  publicationsStory,
  ...previewStories,
  waitRunsStory,
  waitConfigurationStory,
  runStatusIslandStory,
  notificationsStory,
  iconPickerStory,
  providerSpritesStory,
  historyStory,
  historyControlsStory,
  historyKeyboardStory,
  ...nodeStories,
  ...nodePropertiesStories,
  outputsStory,
  commentPropertiesStory,
  ...triggerStories,
  errorWorkflowStory,
  ...cardStories,
  ...workflowStories,
  workspaceRecoveryStory,
  flowBrowserStory,
  connectionPathsStory,
  connectorAccessStory,
  ...stories,
  formStory,
  popupLayoutStory,
  libraryStory,
  nodePickerPreviewStory,
  agentStory,
  codeActionsStory,
  llmStory,
  decisionStory,
  ...openApiStories,
  ...httpRequestStories,
  ...flowStateStories,
  ...workflowCallStories,
  metadataStory,
  inspectorPanelStory,
  inspectorPortsStory,
  leinaStory,
  markdownStory,
  scheduleStory,
  triggerConfigStory,
  diagnosticsStory,
  webhookStory,
  conditionEditorStory,
  variablesStory,
  eventSourcesStory,
  createEventSourceStory,
  eventSourceSetupStory,
  feishuFiltersStory,
  feishuSummaryStory,
  eventPickerStory,
  nodeInputStory,
  valueNodeStory,
  valueEditorDangerStory,
  fieldTypesStory,
  fieldLayoutStory,
  lazyFieldsStory,
  fieldSettingsStory,
  groupSettingsStory,
  jsonThemeStory,
  inputErrorsStory,
  additionalInputsStory,
  groupedInputsStory,
  outputPortsStory,
  codeEditorStory,
  ...overviewStories,
]

function CodeEditorStory({ dark, log }: { readonly dark: boolean; readonly log: LogAction }) {
  const [value, setValue] = useState(codeEditorSource)
  const [serverSource, setServerSource] = useState<string>()
  useStoryActions([
    {
      label: serverSource == null ? 'Show server issue' : 'Clear server issue',
      onClick: () => {
        if (serverSource != null) return setServerSource(undefined)
        setValue(codeEditorServerSource)
        setServerSource(codeEditorServerSource)
      },
    },
    { label: 'Insert syntax error', onClick: () => setValue(codeEditorSource.replace('const digest =', 'const digest = ; //')) },
    { label: 'Reset source', onClick: () => setValue(codeEditorSource) },
  ])
  const serverMessage = 'CodeModule "main" cannot import "node:http".'
  const diagnostics = useMemo(
    () => ({
      source: serverSource ?? '',
      items: serverSource != null ? [{ line: 2, column: 1, message: serverMessage }] : [],
    }),
    [serverSource],
  )
  const serverInvalid = value == serverSource
  return (
    <div className="code-editor-story open-flow-workbench open-flow-property-panel flex flex-col gap-3 p-4" data-theme={dark ? 'dark' : 'light'}>
      <label className="flex max-w-sm flex-col gap-1 text-xs">
        Standard input
        <Input aria-label="Standard input" defaultValue="Reference surface" />
      </label>
      <div className="flex flex-col gap-1 text-xs">
        Loading
        <div className="code-editor">
          <CodeEditorPlaceholder label="Loading code editor" />
        </div>
      </div>
      <ValueEditorFeedback error={serverInvalid ? serverMessage : undefined}>
        {(errorId) => (
          <CodeEditor
            ariaDescribedBy={errorId}
            ariaLabel="JavaScript source"
            disabled={false}
            errorLabel="Code editor unavailable"
            invalid={serverInvalid}
            diagnostics={diagnostics}
            loadingLabel="Loading code editor"
            onBlur={() => log('code.blur', { length: value.length })}
            onChange={(source) => {
              setValue(source)
              log('code.change', { length: source.length })
            }}
            theme={dark ? 'dark' : 'light'}
            typing={codeEditorTyping}
            uri="file:///modules/designer-lab.js"
            value={value}
          />
        )}
      </ValueEditorFeedback>
    </div>
  )
}
