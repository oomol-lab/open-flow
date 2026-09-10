import type { FrontendStory, LogAction } from './stories.tsx'

import { useState } from 'react'
import { CodeEditor } from '../../src/workbench/browser/runtime/editor/codeEditor.tsx'
import { agentStory } from './agent.tsx'
import { cardStories } from './cards.tsx'
import { commentPropertiesStory } from './commentProperties.tsx'
import { conditionEditorStory } from './conditionEditor.tsx'
import { formStory } from './form.tsx'
import { libraryStory } from './library.tsx'
import { llmStory } from './llm.tsx'
import { markdownStory } from './markdown.tsx'
import { metadataStory } from './metadata.tsx'
import { nodeInputStory } from './nodeInput.tsx'
import { nodeStories } from './nodeStories.tsx'
import { overviewStories } from './overview.tsx'
import { scheduleStory } from './schedule.tsx'
import { stories } from './stories.tsx'
import { triggerConfigStory } from './triggerConfig.tsx'
import { triggerStories } from './triggerStories.tsx'
import { additionalInputsStory, groupedInputsStory, outputPortsStory, valueNodeStory } from './valueNode.tsx'
import { variablesStory } from './variables.tsx'
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
  group: 'Workbench',
  id: 'code-editor',
  render: (log, dark) => <CodeEditorStory dark={dark} log={log} />,
  standalone: true,
  title: 'Code Editor',
}

export const labStories: readonly FrontendStory[] = [
  ...nodeStories,
  commentPropertiesStory,
  ...triggerStories,
  ...cardStories,
  ...workflowStories,
  ...stories,
  formStory,
  libraryStory,
  agentStory,
  llmStory,
  metadataStory,
  markdownStory,
  scheduleStory,
  triggerConfigStory,
  webhookStory,
  conditionEditorStory,
  variablesStory,
  nodeInputStory,
  valueNodeStory,
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
