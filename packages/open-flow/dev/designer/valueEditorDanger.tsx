import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { InputPort } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useMemo, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { EditorContextPanel } from '../../src/workbench/browser/runtime/editor/editorContextPanel.tsx'
import { PortDefinitionEditor } from '../../src/workbench/browser/runtime/editor/portDefinitionEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

const invalidValues: readonly InputPort[] = [
  { handle: 'text', jsonSchema: { type: 'string', minLength: 8 }, nullable: false, value: 'short' },
  { handle: 'multiline', jsonSchema: { 'type': 'string', 'ui:widget': 'text', 'minLength': 40 }, nullable: false, value: 'Too short.\nSecond line.' },
  { handle: 'number', jsonSchema: { type: 'number', minimum: 0 }, nullable: false, value: -1.5 },
  { handle: 'integer', jsonSchema: { type: 'integer' }, nullable: false, value: 1.5 },
  { handle: 'boolean', jsonSchema: { type: 'boolean' }, nullable: false, value: 'invalid' },
  { handle: 'select', jsonSchema: { enum: ['small', 'large'] }, nullable: false, value: 'removed' },
  { handle: 'multiSelect', jsonSchema: { type: 'array', uniqueItems: true, items: { enum: ['red', 'blue'] }, minItems: 1 }, nullable: false, value: [] },
  { handle: 'date', jsonSchema: { type: 'string', format: 'date' }, nullable: false, value: '2026-02-30' },
  { handle: 'time', jsonSchema: { type: 'string', format: 'time' }, nullable: false, value: '25:00:00Z' },
  { handle: 'dateTime', jsonSchema: { type: 'string', format: 'date-time' }, nullable: false, value: 'not-a-date' },
  { handle: 'color', jsonSchema: { 'type': 'string', 'ui:widget': 'color' }, nullable: false, value: 'not-a-color' },
  {
    handle: 'object',
    jsonSchema: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 8 } } },
    nullable: false,
    value: { title: 'short' },
  },
  { handle: 'array', jsonSchema: { type: 'array', minItems: 2, items: { type: 'number', minimum: 0 } }, nullable: false, value: [-1] },
  { handle: 'requiredObject', jsonSchema: { type: 'object', required: ['title'] }, nullable: false, value: { count: 2 } },
  { handle: 'null', jsonSchema: { type: 'null' }, nullable: true, value: 'invalid' },
]

const missingChoices: readonly InputPort[] = [
  {
    handle: 'nestedObject',
    jsonSchema: { type: 'object', properties: { details: { type: 'object', properties: { title: { type: 'string', minLength: 8 } } } } },
    nullable: false,
    value: { details: { title: 'short' } },
  },
  { handle: 'selectNoOptions', jsonSchema: { enum: [] }, nullable: false },
  { handle: 'multiNoOptions', jsonSchema: { type: 'array', uniqueItems: true, items: { enum: [] } }, nullable: false },
  { handle: 'multiRemoved', jsonSchema: { type: 'array', uniqueItems: true, items: { enum: ['red', 'blue'] } }, nullable: false, value: ['removed'] },
  { handle: 'nonNullableNull', jsonSchema: { type: 'string' }, nullable: false, value: null },
  { handle: 'nonNullableJsonNull', jsonSchema: {}, nullable: false, value: null },
  { handle: 'nullableJsonUnset', jsonSchema: {}, nullable: true },
  { handle: 'emptyText', jsonSchema: { type: 'string', minLength: 1 }, nullable: false, value: '' },
  { handle: 'emptyObject', jsonSchema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } }, nullable: false, value: {} },
  { handle: 'emptyArray', jsonSchema: { type: 'array', minItems: 1, items: { type: 'string' } }, nullable: false, value: [] },
]

const draftValues: readonly InputPort[] = [
  { handle: 'numberDraft', jsonSchema: { type: 'number' }, nullable: false, value: 1 },
  { handle: 'integerDraft', jsonSchema: { type: 'integer' }, nullable: false, value: 1 },
  { handle: 'jsonDraft', jsonSchema: {}, nullable: false, value: {} },
]

function Sample({
  title,
  theme,
  initial,
  expanded,
  drafts,
  log,
}: {
  title: string
  theme: 'light' | 'dark'
  initial: readonly InputPort[]
  expanded?: boolean
  drafts?: boolean
  log: LogAction
}) {
  const [values, setValues] = useState(initial)
  const container = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!expanded) return
    // Exercise the production disclosures without adding a story-only editor API.
    container.current?.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"][aria-controls]').forEach((button) => button.click())
  }, [expanded])
  useEffect(() => {
    if (!drafts || !container.current) return
    const root = container.current
    const pending = new Map([
      ['numberDraft', 'abc'],
      ['integerDraft', '1.5'],
      ['jsonDraft JSON', '{"title":'],
    ])
    // Seed unfinished drafts through the real controls, including the JSON loading textarea.
    // These strings cannot be represented by the persisted JSON value fixtures.
    const seed = () => {
      for (const [label, text] of pending) {
        const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`input[aria-label="${label}"], textarea[aria-label="${label}"]`)
        if (!input) continue
        pending.delete(label)
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      if (!pending.size) observer.disconnect()
    }
    const observer = new MutationObserver(seed)
    observer.observe(root, { childList: true, subtree: true })
    seed()
    return () => observer.disconnect()
  }, [drafts])
  return (
    <section ref={container} className="node-properties-case">
      <h3 className="mb-3 text-xs font-medium">{title}</h3>
      <EditorContextPanel title="Fixed Values" icon="value" theme={theme} focusOnOpen={false} onClose={() => {}}>
        <div className="inspector-content">
          <PortDefinitionEditor
            layout="values"
            disabled={false}
            values={values}
            onChange={(next) => {
              setValues(next)
              log(title, next)
            }}
          />
        </div>
      </EditorContextPanel>
    </section>
  )
}

function ValueEditorDanger({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [revision, setRevision] = useState(0)
  const [wrapped, setWrapped] = useState(false)
  const unsetValues = useMemo(() => invalidValues.map(({ value: _value, ...port }) => port), [])
  useStoryActions([
    { label: 'Reset samples', onClick: () => setRevision((value) => value + 1) },
    { label: wrapped ? 'Wide panels' : 'Narrow panels', onClick: () => setWrapped((value) => !value) },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="value-editor-danger-gallery open-flow-workbench open-flow-theme"
        data-theme={dark ? 'dark' : 'light'}
        style={{ height: '100%', padding: 16 }}
      >
        <div
          key={revision}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${wrapped ? 340 : 520}px), ${wrapped ? '340px' : '1fr'}))`,
            gap: 16,
            alignItems: 'start',
          }}
        >
          <Sample theme={dark ? 'dark' : 'light'} title="All 15 editors · invalid values" initial={invalidValues} expanded log={log} />
          <Sample theme={dark ? 'dark' : 'light'} title="Collapsed · invalid values" initial={invalidValues} log={log} />
          <Sample theme={dark ? 'dark' : 'light'} title="All 15 editors · unset values" initial={unsetValues} expanded log={log} />
          <Sample theme={dark ? 'dark' : 'light'} title="Draft errors · number / integer / JSON" initial={draftValues} expanded drafts log={log} />
          <Sample theme={dark ? 'dark' : 'light'} title="Missing options · empty values · null" initial={missingChoices} expanded log={log} />
        </div>
      </div>
    </I18nProvider>
  )
}

export const valueEditorDangerStory: FrontendStory = {
  id: 'value-editor-danger',
  title: 'Value Editor Danger',
  description:
    'All 15 editors, expanded and collapsed errors, unset values, missing options, nested Schema errors and invalid drafts. Hover reveals attached errors; focus takes priority within each panel. Reset restores initial sample states. Compare themes, languages and panel widths.',
  group: 'Node Fixed Values',
  propertyPanel: true,
  standalone: true,
  render: (log, dark, language) => <ValueEditorDanger dark={dark} language={language} log={log} />,
}
