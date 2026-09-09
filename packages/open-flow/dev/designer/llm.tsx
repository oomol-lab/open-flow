import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { NodeInputValue } from '../../src/workbench/browser/runtime/editor/nodeInputValue.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

function LlmStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [messages, setMessages] = useState<JsonValue | undefined>([{ role: 'user', content: 'Summarize {{topic}}.' }])
  const [model, setModel] = useState<JsonValue | undefined>({ model: 'example-model', temperature: 0.7, custom: 'preserve' })
  const variables = { enabled: false, names: [], loaded: true, loading: false, onOpen: () => {} }
  const messageDefinition = { handle: 'messages', nullable: false, jsonSchema: { 'type': 'array', 'ui:widget': 'llm/messages', 'minItems': 1 } }
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, width: 560 }}>
        <NodeInputValue
          definition={messageDefinition}
          value={messages}
          connected={false}
          variables={variables}
          disabled={false}
          handleNames={['topic']}
          onValue={(value) => {
            setMessages(value)
            log('Save messages', value)
          }}
          onVariable={() => {}}
        />
        <NodeInputValue
          definition={{ handle: 'model', nullable: false, jsonSchema: { 'type': 'object', 'ui:widget': 'llm/model' } }}
          value={model}
          connected={false}
          variables={variables}
          disabled={false}
          onValue={(value) => {
            setModel(value)
            log('Save model', value)
          }}
          onVariable={() => {}}
        />
        <h3>Read only</h3>
        <NodeInputValue
          definition={messageDefinition}
          value={messages}
          connected={false}
          variables={variables}
          disabled
          handleNames={['topic']}
          onValue={() => log('Unexpected read-only save')}
          onVariable={() => {}}
        />
        <output aria-label="Saved LLM inputs">{JSON.stringify({ messages, model })}</output>
      </div>
    </I18nProvider>
  )
}
export const llmStory: FrontendStory = {
  group: 'Workbench',
  id: 'llm-inputs',
  title: 'LLM Inputs',
  standalone: true,
  render: (log, dark, language) => <LlmStory dark={dark} language={language} log={log} />,
}
