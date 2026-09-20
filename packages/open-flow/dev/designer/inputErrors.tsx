import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { InputPort } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory } from './stories.tsx'

import { useCallback, useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { FieldValueEditor } from '../../src/form/browser/fieldValueEditor.tsx'
import { Checkbox } from '../../src/ui/browser/checkbox.tsx'
import { NativeSelect } from '../../src/ui/browser/native-select.tsx'
import { Switch } from '../../src/ui/browser/switch.tsx'
import { PortDefinitionEditor } from '../../src/workbench/browser/runtime/editor/portDefinitionEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

const cases = [
  { label: 'Text', schema: { type: 'string', minLength: 5 }, value: 'abc' },
  { label: 'Multiline', schema: { 'type': 'string', 'ui:widget': 'text', 'minLength': 10 }, value: 'Short' },
  { label: 'Number', schema: { type: 'number', minimum: 0 }, value: -1 },
  { label: 'Date', schema: { type: 'string', format: 'date' }, value: '2026-02-30' },
  { label: 'Time', schema: { type: 'string', format: 'time' }, value: '25:00:00Z' },
  { label: 'Date and time', schema: { type: 'string', format: 'date-time' }, value: 'not-a-date' },
  { label: 'Color', schema: { 'type': 'string', 'ui:widget': 'color' }, value: 'not-a-color' },
  { label: 'Select', schema: { enum: ['one', 'two'] }, value: 'missing' },
  { label: 'Boolean', schema: { type: 'boolean' }, value: 'missing' },
  { label: 'Multiple select', schema: { type: 'array', uniqueItems: true, items: { enum: ['one', 'two'] }, minItems: 1 }, value: [] },
  { label: 'Required object', schema: { type: 'object', required: ['title'] }, value: { count: 2 } },
] as const

function ErrorPanel({ theme }: { theme: 'light' | 'dark' }) {
  const [values, setValues] = useState<unknown[]>(cases.map((item) => item.value))
  const [ports, setPorts] = useState<readonly InputPort[]>([
    { handle: 'validTime', jsonSchema: { type: 'string', format: 'time' }, nullable: false, value: '09:30:00Z' },
    { handle: 'invalidTime', jsonSchema: { type: 'string', format: 'time' }, nullable: false, value: '09:30:00' },
    { handle: 'invalidText', jsonSchema: { type: 'string', minLength: 5 }, nullable: false, value: 'abc' },
    { handle: 'invalidObject', jsonSchema: { type: 'object', required: ['title'] }, nullable: false, value: { count: 2 } },
    { handle: 'requiredUnset', jsonSchema: { type: 'string' }, nullable: false },
    { handle: 'nullableUnset', jsonSchema: { type: 'string' }, nullable: true },
  ])
  const onDraftIssue = useCallback(() => {}, [])
  return (
    <section
      className="open-flow-theme"
      data-theme={theme}
      style={{ background: 'var(--ui-background)', color: 'var(--ui-foreground)', padding: 20, borderRadius: 12, border: '1px solid var(--ui-border)' }}
    >
      <h2 style={{ fontSize: 14, margin: '0 0 16px' }}>{theme === 'light' ? 'Light' : 'Dark'}</h2>
      <h3 style={{ fontSize: 12, margin: '0 0 6px' }}>Property editor</h3>
      <PortDefinitionEditor layout="definition" disabled={false} values={ports} onChange={setPorts} />
      <h3 style={{ fontSize: 12, margin: '20px 0 12px' }}>Individual controls</h3>
      <div style={{ display: 'grid', gap: 16 }}>
        {cases.map((item, index) => (
          <div key={item.label}>
            <h3 style={{ fontSize: 12, margin: '0 0 6px' }}>{item.label}</h3>
            <FieldValueEditor
              label={`${theme} ${item.label}`}
              schema={item.schema}
              value={values[index]}
              path={`/${theme}/${index}`}
              onChange={(value) => setValues((previous) => previous.map((entry, i) => (i === index ? value : entry)))}
              onDraftIssue={onDraftIssue}
            />
          </div>
        ))}
        <label className="grid gap-1 text-xs">
          Native select
          <NativeSelect aria-label={`${theme} Native select`} aria-invalid defaultValue="">
            <option value="">Choose a value</option>
            <option value="one">One</option>
          </NativeSelect>
        </label>
        <div className="flex items-center gap-3 text-xs">
          <Checkbox aria-label={`${theme} Checkbox`} aria-invalid />
          Checkbox
          <Checkbox aria-label={`${theme} Checked checkbox`} aria-invalid defaultChecked />
          Checked
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Switch aria-label={`${theme} Switch`} aria-invalid />
          Switch
        </div>
      </div>
    </section>
  )
}

function InputErrors({ language }: { language: UiLanguage }) {
  const [revision, setRevision] = useState(0)
  const i18n = useMemo(() => createI18n(language), [language])
  useStoryActions([{ label: 'Reset samples', onClick: () => setRevision(revision + 1) }])
  return (
    <I18nProvider i18n={i18n}>
      <div
        key={revision}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))',
          gap: 16,
          padding: 16,
          overflow: 'auto',
          height: '100%',
          alignItems: 'start',
        }}
      >
        <ErrorPanel theme="light" />
        <ErrorPanel theme="dark" />
      </div>
    </I18nProvider>
  )
}

export const inputErrorsStory: FrontendStory = {
  id: 'input-errors',
  title: 'Input Errors',
  description:
    'Invalid fields in both themes. Property rows compare valid, invalid and unset surfaces. Focus and correct values to inspect error borders and backgrounds; JSON requires a title. Selection controls at the bottom show fixed invalid states.',
  group: 'Node Fixed Values',
  propertyPanel: true,
  standalone: true,
  render: (_log, _dark, language) => <InputErrors language={language} />,
}
