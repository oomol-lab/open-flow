import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DesignerStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { VariablePicker } from '../../src/ui/browser/variable-picker.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
function VariablesStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [name, setName] = useState<string | undefined>('API_TOKEN')
  const common = {
    names: ['API_TOKEN', 'API_URL', 'TEAM_NAME'],
    enabled: true,
    loaded: true,
    loading: false,
    onChange: (next: string | undefined) => {
      setName(next)
      log('Bind variable', next ?? null)
    },
    onOpen: () => log('Refresh variable names'),
  }
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme flex flex-col gap-5" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, width: 400 }}>
        <section>
          <h3>Available</h3>
          <VariablePicker {...common} name={name} />
        </section>
        <output aria-label="Saved variable">{name ?? '(unset)'}</output>
        <section>
          <h3>Missing</h3>
          <VariablePicker {...common} name="REMOVED_NAME" />
        </section>
        <section>
          <h3>Loading</h3>
          <VariablePicker {...common} names={[]} loading loaded={false} />
        </section>
        <section>
          <h3>Empty</h3>
          <VariablePicker {...common} names={[]} />
        </section>
        <section>
          <h3>Unavailable</h3>
          <VariablePicker {...common} name="API_TOKEN" enabled={false} />
        </section>
        <section>
          <h3>Read only</h3>
          <VariablePicker {...common} name="API_TOKEN" disabled />
        </section>
      </div>
    </I18nProvider>
  )
}
export const variablesStory: DesignerStory = {
  group: 'Workbench',
  id: 'variable-picker',
  title: 'Variable Picker',
  standalone: true,
  render: (log, dark, language) => <VariablesStory dark={dark} language={language} log={log} />,
}
