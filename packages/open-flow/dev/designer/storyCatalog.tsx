import type { FrontendStory, LogAction } from './stories.tsx'

import { useState } from 'react'
import { CodeEditor } from '../../src/workbench/browser/runtime/editor/codeEditor.tsx'
import { agentStory } from './agent.tsx'
import { cardStories } from './cards.tsx'
import { commentPropertiesStory } from './commentProperties.tsx'
import { conditionEditorStory } from './conditionEditor.tsx'
import { connectionPathsStory } from './connectionPaths.tsx'
import { eventSourcesStory, createEventSourceStory, eventSourceSetupStory, feishuFiltersStory, feishuSummaryStory, eventPickerStory } from './eventSources.tsx'
import { fieldSettingsStory, groupSettingsStory } from './fieldSettings.tsx'
import { formStory } from './form.tsx'
import { historyStory, historyControlsStory, historyKeyboardStory } from './history.tsx'
import { iconPickerStory } from './iconPicker.tsx'
import { inputErrorsStory } from './inputErrors.tsx'
import { inspectorPanelStory } from './inspectorPanel.tsx'
import { inspectorPortsStory } from './inspectorPorts.tsx'
import { jsonThemeStory } from './jsonTheme.tsx'
import { libraryStory } from './library.tsx'
import { llmStory } from './llm.tsx'
import { markdownStory } from './markdown.tsx'
import { metadataStory } from './metadata.tsx'
import { nodeInputStory } from './nodeInput.tsx'
import { nodePickerPreviewStory } from './nodePickerPreview.tsx'
import { nodePropertiesStories } from './nodeProperties.tsx'
import { nodeStories } from './nodeStories.tsx'
import { notificationsStory } from './notifications.tsx'
import { overviewStories } from './overview.tsx'
import { popupLayoutStory } from './popupLayout.tsx'
import { scheduleStory } from './schedule.tsx'
import { stories } from './stories.tsx'
import { triggerConfigStory } from './triggerConfig.tsx'
import { triggerStories } from './triggerStories.tsx'
import { additionalInputsStory, lazyFieldsStory, groupedInputsStory, outputPortsStory, valueNodeStory } from './valueNode.tsx'
import { variablesStory } from './variables.tsx'
import { waitRunsStory } from './waitRuns.tsx'
import { webhookStory } from './webhook.tsx'
import { workflowStories } from './workflow.tsx'

const codeEditorTyping = `/**
 * @typedef {{
 *   value: string;
 * }} Inputs;
 * @typedef {{
 *   result: string;
 * }} Outputs;
 */
`

const codeEditorSource = `export default async function (inputs, context) {
  await context.reportProgress(20)
  const response = await context.fetch("https://example.com")
  const text = await response.text()
  return { result: inputs.value + text }
}
`

const codeEditorStory: FrontendStory = {
  group: 'Node Task',
  id: 'code-editor',
  render: (log, dark) => <CodeEditorStory dark={dark} log={log} />,
  standalone: true,
  title: 'Code Editor',
}

export const labStories: readonly FrontendStory[] = [
  waitRunsStory,
  notificationsStory,
  iconPickerStory,
  historyStory,
  historyControlsStory,
  historyKeyboardStory,
  ...nodeStories,
  ...nodePropertiesStories,
  commentPropertiesStory,
  ...triggerStories,
  ...cardStories,
  ...workflowStories,
  connectionPathsStory,
  ...stories,
  formStory,
  popupLayoutStory,
  libraryStory,
  nodePickerPreviewStory,
  agentStory,
  llmStory,
  metadataStory,
  inspectorPanelStory,
  inspectorPortsStory,
  markdownStory,
  scheduleStory,
  triggerConfigStory,
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
  return (
    <div className="code-editor-story open-flow-workbench" data-theme={dark ? 'dark' : 'light'}>
      <CodeEditor
        ariaLabel="JavaScript source"
        disabled={false}
        errorLabel="Code editor unavailable"
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
    </div>
  )
}
