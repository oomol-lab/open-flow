import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DesignerStory } from './stories.tsx'

import { useEffect, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { val } from 'value-enhancer'
import { FlowRunInputEditor } from '../../src/workbench/browser/flowRunInputEditor.tsx'
import { FlowRunInputEditorStore } from '../../src/workbench/browser/flowRunInputEditorStore.ts'

function FormStory({ dark, language }: { dark: boolean; language: UiLanguage }) {
  const [resource, setResource] = useState<{ store: FlowRunInputEditorStore; language$: ReturnType<typeof val<string>> }>()
  useEffect(() => {
    const language$ = val<string>('en')
    const created = new FlowRunInputEditorStore(
      [
        {
          handle: 'payload',
          nullable: false,
          description: 'Structured input with required fields, an open object and an array.',
          jsonSchema: {
            type: 'object',
            required: ['name'],
            additionalProperties: true,
            properties: {
              name: { type: 'string', minLength: 1 },
              count: { type: 'integer', minimum: 0 },
              active: { type: 'boolean' },
              tags: { type: 'array', items: { type: 'string' } },
              metadata: { type: 'object', additionalProperties: true },
            },
          },
        },
        { handle: 'choice', nullable: false, jsonSchema: { 'enum': ['first', 'second'], 'ui:options': { labels: ['First choice', 'Second choice'] } } },
        { handle: 'color', nullable: true, jsonSchema: { 'type': 'string', 'ui:widget': 'color', 'ui:options': { colorType: 'HEX8' } } },
        { handle: 'date', nullable: true, jsonSchema: { type: 'string', format: 'date' } },
        { handle: 'time', nullable: true, jsonSchema: { type: 'string', format: 'time' } },
        { handle: 'timestamp', nullable: true, jsonSchema: { type: 'string', format: 'date-time' } },
        { handle: 'optional', nullable: true, jsonSchema: { type: 'string' } },
        {
          handle: 'delivery',
          nullable: false,
          jsonSchema: {
            'oneOf': [
              { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'], additionalProperties: false },
              { type: 'object', properties: { phone: { type: 'string', minLength: 3 } }, required: ['phone'], additionalProperties: false },
            ],
            'ui:options': { labels: ['Email', 'Phone'] },
          },
        },
        {
          handle: 'channels',
          nullable: false,
          jsonSchema: { 'type': 'array', 'uniqueItems': true, 'items': { enum: ['email', 'sms'] }, 'ui:options': { labels: ['Email updates', 'SMS updates'] } },
        },
      ],
      language$,
    )
    setResource({ store: created, language$ })
    return () => {
      created.dispose()
      language$.dispose()
    }
  }, [])
  const store = resource?.store
  const values = useVal(store?.values$)
  const valid = useVal(store?.valid$)
  useEffect(() => resource?.language$.set(language), [language, resource])
  if (!store) return null
  return (
    <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ overflow: 'auto', height: '100%', padding: 24 }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <FlowRunInputEditor store={store} theme={dark ? 'dark' : 'light'} showErrors />
        <output aria-label="Form validity">{valid ? 'Valid' : 'Invalid'}</output>
        <pre aria-label="Form values">{JSON.stringify(values, null, 2)}</pre>
      </div>
    </div>
  )
}

export const formStory: DesignerStory = {
  group: 'Workbench',
  id: 'run-inputs',
  title: 'Run Inputs',
  standalone: true,
  render: (_log, dark, language) => <FormStory dark={dark} language={language} />,
}
