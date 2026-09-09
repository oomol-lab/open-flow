import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { ConditionSettings } from '../../src/workbench/browser/runtime/editor/flowChanges.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { Checkbox } from '../../src/ui/browser/checkbox.tsx'
import { ConditionBranchesEditor } from '../../src/workbench/browser/runtime/editor/conditionBranchesEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
function ConditionEditorStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [disabled, setDisabled] = useState(false)
  const [value, setValue] = useState<ConditionSettings>({
    input: { handle: 'value', jsonSchema: { type: 'string' }, nullable: true },
    cases: [{ output: 'matched', relation: 'all', expressions: [{ input: 'value', operator: 'contains', value: 'hello' }] }],
    defaultOutput: 'fallback',
  })
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, maxWidth: 500 }}>
        <label className="flex items-center gap-2">
          <Checkbox checked={disabled} onCheckedChange={(next) => setDisabled(next === true)} />
          Read only
        </label>
        <ConditionBranchesEditor
          value={value}
          disabled={disabled}
          onChange={(next) => {
            setValue(next)
            log('Save conditions', next)
          }}
        />
        <output aria-label="Saved conditions" style={{ overflowWrap: 'anywhere' }}>
          {JSON.stringify(value)}
        </output>
      </div>
    </I18nProvider>
  )
}
export const conditionEditorStory: FrontendStory = {
  group: 'Workbench',
  id: 'condition-editor',
  title: 'Condition Editor',
  standalone: true,
  render: (log, dark, language) => <ConditionEditorStory dark={dark} language={language} log={log} />,
}
