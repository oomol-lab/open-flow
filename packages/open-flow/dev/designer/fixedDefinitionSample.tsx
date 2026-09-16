import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { InputPort, JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { NodeInputs } from '../../src/workbench/browser/runtime/editor/nodeInputs.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
const field = (handle: string, type = 'string'): InputPort => ({ handle, jsonSchema: { type }, nullable: false })
export const propertyValues: readonly InputPort[] = [
  { ...field('message'), value: 'Review the release notes' },
  { ...field('instructions'), jsonSchema: { 'type': 'string', 'ui:widget': 'text' }, value: 'Keep the summary concise.\nInclude the next steps.' },
  { ...field('count', 'integer'), value: 3 },
  { ...field('enabled', 'boolean'), value: false },
  { ...field('priority'), jsonSchema: { enum: ['low', 'normal', 'high'] }, value: 'normal' },
  { ...field('channels', 'array'), jsonSchema: { type: 'array', uniqueItems: true, items: { enum: ['email', 'sms'] } }, value: ['email'] },
  { ...field('color'), jsonSchema: { 'type': 'string', 'ui:widget': 'color', 'ui:options': { colorType: 'HEX8' } }, value: '#7C73E6FF' },
  { ...field('date'), jsonSchema: { type: 'string', format: 'date' }, value: '2026-09-14' },
  { ...field('time'), jsonSchema: { type: 'string', format: 'time' }, value: '09:30:00' },
  { ...field('timestamp'), jsonSchema: { type: 'string', format: 'date-time' }, value: '2026-09-14T09:30:00+08:00' },
  {
    ...field('payload', 'object'),
    jsonSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        active: { type: 'boolean' },
        status: { enum: ['draft', 'ready'] },
        details: { type: 'object', properties: { count: { type: 'integer' } } },
      },
    },
    value: { name: 'Ada', active: true, status: 'draft', details: { count: 2 }, extra: 'Editable field' },
  },
  { ...field('tags', 'array'), jsonSchema: { type: 'array', items: { type: 'string' } }, value: ['design', 'review'] },
  { ...field('choice'), jsonSchema: { 'oneOf': [{ type: 'string' }, { type: 'number' }], 'ui:options': { labels: ['Text', 'Number'] } }, value: 'hello' },
  { ...field('note'), nullable: true, value: null },
  { ...field('nullValue', 'null'), value: null },
  field('unsetNull', 'null'),
  { ...field('unsetNullable'), nullable: true },
  field('unsetBoolean', 'boolean'),
  { ...field('unsetSelect'), jsonSchema: { enum: ['first', 'second'] } },
  { ...field('emptyObject', 'object'), jsonSchema: { type: 'object', additionalProperties: false }, value: {} },
  { ...field('openObject', 'object'), value: {} },
  { ...field('limitedArray', 'array'), jsonSchema: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 }, value: ['one'] },
  { ...field('emptyArray', 'array'), value: [] },
  { ...field('emptySelect'), jsonSchema: { enum: [] } },
  { ...field('emptyMultiSelect', 'array'), jsonSchema: { type: 'array', uniqueItems: true, items: { enum: [] } }, value: [] },
  field('unset'),
]

export function FixedDefinitionSample({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [values, setValues] = useState<Record<string, JsonValue | undefined>>(() => Object.fromEntries(propertyValues.map((port) => [port.handle, port.value])))
  return (
    <I18nProvider i18n={i18n}>
      <section className="node-properties-case trigger-case" aria-label="Fixed types · editable values">
        <h3>Fixed types · editable values</h3>
        <div
          className="fixed-definition-panel editor-context-panel open-flow-property-panel open-flow-workbench open-flow-theme"
          data-theme={dark ? 'dark' : 'light'}
        >
          <NodeInputs
            entries={propertyValues.map(({ value: _value, ...definition }) => ({ definition, value: values[definition.handle], connected: false }))}
            variables={{ enabled: false, loaded: true, loading: false, names: [], onOpen: () => {} }}
            disabled={false}
            onValue={(name, value) => {
              setValues((previous) => ({ ...previous, [name]: value }))
              log('fixed value.saved', { name, value: value ?? null })
            }}
            onVariable={() => {}}
          />
        </div>
      </section>
    </I18nProvider>
  )
}
