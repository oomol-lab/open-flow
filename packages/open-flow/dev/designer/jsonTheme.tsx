import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { InputPort } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { PortDefinitionEditor } from '../../src/workbench/browser/runtime/editor/portDefinitionEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

const samples: readonly InputPort[] = [
  {
    handle: 'payload',
    jsonSchema: {},
    nullable: false,
    value: {
      title: 'A quiet workspace',
      description: '保持专注，让内容清晰。',
      enabled: true,
      archived: false,
      count: 24,
      ratio: 0.75,
      offset: -12,
      fallback: null,
      tags: ['design', 'automation'],
      metadata: { owner: 'Open Flow', note: 'Line one\nLine two', empty: '' },
    },
  },
  { handle: 'message', jsonSchema: { 'ui:widget': 'any' }, nullable: false, value: 'Editable field' },
  { handle: 'unset', jsonSchema: {}, nullable: false },
]

function JsonThemeStory({ language, log }: { language: UiLanguage; log: LogAction }) {
  const [values, setValues] = useState(samples)
  const [disabled, setDisabled] = useState(false)
  const [revision, setRevision] = useState(0)
  const i18n = useMemo(() => createI18n(language), [language])
  useStoryActions([
    { label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled(!disabled) },
    {
      label: 'Reset samples',
      onClick: () => {
        setValues(samples)
        setRevision(revision + 1)
      },
    },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          gap: 16,
          padding: 16,
          overflow: 'auto',
          height: '100%',
          alignItems: 'start',
        }}
      >
        {(['light', 'dark'] as const).map((theme) => (
          <section
            key={theme}
            className="open-flow-theme"
            data-theme={theme}
            style={{ background: 'var(--ui-background)', color: 'var(--ui-foreground)', border: '1px solid var(--ui-border)', borderRadius: 12, padding: 20 }}
          >
            <h2 style={{ fontSize: 14, margin: '0 0 16px' }}>{theme === 'light' ? 'Light' : 'Dark'}</h2>
            <PortDefinitionEditor
              key={revision}
              layout="definition"
              values={values}
              disabled={disabled}
              onChange={(next) => {
                setValues(next)
                log('Save JSON', next)
              }}
            />
          </section>
        ))}
      </div>
    </I18nProvider>
  )
}

export const jsonThemeStory: FrontendStory = {
  id: 'json-theme',
  title: 'JSON Colors',
  description: 'Warm strings, neutral keys and muted blue values. Edit JSON to inspect selection, focus and invalid drafts.',
  group: 'Node Fixed Values',
  standalone: true,
  render: (log, _dark, language) => <JsonThemeStory language={language} log={log} />,
}
