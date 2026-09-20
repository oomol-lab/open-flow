import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { FieldTable, FieldTableRow } from '../../src/form/browser/fieldTable.tsx'
import { ValueField } from '../../src/form/browser/valueField.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

const fixtures = [
  { name: 'openEmptyObject', schema: { type: 'object' }, value: {}, nullable: false },
  {
    name: 'openObject',
    schema: { type: 'object', properties: { title: { type: 'string' } } },
    value: { title: 'Fixed type', extra: { list: [] } },
    nullable: false,
  },
  {
    name: 'objectArray',
    schema: { type: 'array', items: { type: 'object', properties: { note: { 'type': 'string', 'ui:widget': 'text' } } } },
    value: [{ note: '' }, { note: 'Saved draft' }],
    nullable: false,
  },
  {
    name: 'textArray',
    schema: { type: 'array', items: { 'type': 'string', 'ui:widget': 'text' } },
    value: ['First line\nSecond line', ''],
    nullable: false,
  },
  {
    name: 'jsonArray',
    schema: { type: 'array', items: {} },
    value: [{ title: 'Draft', enabled: true }, {}],
    nullable: false,
  },
  { name: 'nullableUnset', schema: { type: 'string' }, value: undefined, nullable: true },
  { name: 'nullObject', schema: { type: 'object' }, value: null, nullable: true },
  { name: 'unsetObject', schema: { type: 'object' }, value: undefined, nullable: false },
  { name: 'nullArray', schema: { type: 'array', items: { type: 'string' } }, value: null, nullable: true },
  { name: 'invalidNullArray', schema: { type: 'array', items: { type: 'string' } }, value: null, nullable: false },
  { name: 'unsetArray', schema: { type: 'array', items: { type: 'string' } }, value: undefined, nullable: false },
  { name: 'nullableChoice', schema: { enum: ['one', 'two', null] }, value: undefined, nullable: true },
  { name: 'nullableNull', schema: { type: 'boolean' }, value: null, nullable: true },
  { name: 'invalidNull', schema: { type: 'number' }, value: null, nullable: false },
  { name: 'emptyObject', schema: { type: 'object', additionalProperties: false }, value: {}, nullable: false },
  { name: 'emptyArray', schema: { type: 'array', items: { type: 'string' } }, value: [], nullable: false },
  { name: 'emptyText', schema: { 'type': 'string', 'ui:widget': 'text' }, value: '', nullable: false },
  { name: 'nullableText', schema: { 'type': 'string', 'ui:widget': 'text' }, value: undefined, nullable: true },
  { name: 'nullText', schema: { 'type': 'string', 'ui:widget': 'text' }, value: null, nullable: true },
  { name: 'unsetText', schema: { 'type': 'string', 'ui:widget': 'text' }, value: undefined, nullable: false },
  { name: 'invalidText', schema: { 'type': 'string', 'ui:widget': 'text', 'minLength': 12 }, value: 'short', nullable: false },
  { name: 'emptyJson', schema: {}, value: undefined, nullable: true },
  { name: 'invalidEmptyJson', schema: { minProperties: 1 }, value: {}, nullable: false },
] as const

function FieldLayouts({ dark, language }: { dark: boolean; language: UiLanguage }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [values, setValues] = useState<readonly unknown[]>(() => fixtures.map((field) => field.value))
  const [narrow, setNarrow] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [generation, setGeneration] = useState(0)
  useStoryActions([
    { label: narrow ? 'Wide' : 'Narrow', onClick: () => setNarrow(!narrow) },
    {
      label: readOnly ? 'Editable' : 'Read only',
      onClick: () => {
        setReadOnly(!readOnly)
        setGeneration(generation + 1)
      },
    },
    {
      label: 'External update',
      onClick: () => setValues((current) => current.map((value, index) => (fixtures[index]!.name === 'invalidText' ? 'bad' : value))),
    },
    { label: 'Reopen panel', onClick: () => setGeneration(generation + 1) },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-workbench open-flow-theme open-flow-property-panel p-4"
        data-theme={dark ? 'dark' : 'light'}
        style={{ width: narrow ? 340 : 640 }}
      >
        <FieldTable key={generation} layout="ports" fixedTypes nullable>
          {fixtures.map((field, index) => (
            <FieldTableRow key={field.name}>
              <ValueField
                label={field.name}
                schema={field.schema}
                value={values[index]}
                nullable={field.nullable}
                disabled={readOnly}
                path={`/${field.name}`}
                onDraftIssue={() => {}}
                onChange={(value) => setValues((current) => current.with(index, value))}
              />
            </FieldTableRow>
          ))}
        </FieldTable>
        <output aria-label="Saved field values" className="block whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(values, null, 2)}
        </output>
      </div>
    </I18nProvider>
  )
}
export const fieldLayoutStory: FrontendStory = {
  id: 'field-layout',
  title: 'Field Layout',
  group: 'Node Fixed Values',
  propertyPanel: true,
  standalone: true,
  description:
    'Array-item text and JSON values start collapsed and expand in place. Compare emptyJson, which remains collapsed after validation, with invalidEmptyJson, which opens for its initial error. Root and object-child editors retain their branches. Clear a text item to keep an editable empty string. Compare wide, narrow and read-only states. Collapse invalidText, then update it externally to check that it stays collapsed.',
  render: (_log, dark, language) => <FieldLayouts dark={dark} language={language} />,
}
