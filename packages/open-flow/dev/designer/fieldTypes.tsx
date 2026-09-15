import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { EditorComponentSelect } from '../../src/form/browser/editorComponentSelect.tsx'
import { editorGroups, schemaForEditor } from '../../src/form/common/editorComponent.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

function FieldTypes({ dark, language }: { dark: boolean; language: UiLanguage }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [schemas, setSchemas] = useState(() =>
    Object.values(editorGroups)
      .flat()
      .map((type) => ({ type, schema: schemaForEditor(type, {}) })),
  )
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme p-6" data-theme={dark ? 'dark' : 'light'}>
        <table className="text-left text-xs">
          <thead>
            <tr>
              <th className="p-2 font-normal">Type</th>
              <th className="p-2 font-normal">Editable</th>
              <th className="p-2 font-normal">Fixed / read-only</th>
              <th className="p-2 font-normal">Temporarily disabled</th>
            </tr>
          </thead>
          <tbody>
            {schemas.map(({ type, schema }, index) => (
              <tr key={type}>
                <th className="p-2 font-normal">{type}</th>
                <td className="p-2">
                  <div className="w-14">
                    <EditorComponentSelect
                      schema={schema}
                      name={`Editable ${type}`}
                      onChange={(next) => setSchemas((current) => current.map((entry, i) => (i === index ? { ...entry, schema: next } : entry)))}
                    />
                  </div>
                </td>
                <td className="p-2">
                  <div className="w-8">
                    <EditorComponentSelect schema={schema} name={`Fixed ${type}`} readOnly onChange={() => {}} />
                  </div>
                </td>
                <td className="p-2">
                  <div className="w-14">
                    <EditorComponentSelect schema={schema} name={`Disabled ${type}`} disabled onChange={() => {}} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </I18nProvider>
  )
}

export const fieldTypesStory: FrontendStory = {
  id: 'field-type-states',
  title: 'Type States',
  description: 'All 15 types: editable selectors, fixed labels, and temporarily disabled selectors.',
  group: 'Node Fixed Values',
  standalone: true,
  render: (_log, dark, language) => <FieldTypes dark={dark} language={language} />,
}
