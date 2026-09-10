import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { CommentInspector } from '../../src/workbench/browser/runtime/editor/commentInspector.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

const cases = [
  { label: 'Editable', title: 'Review notes', content: '### Before running\nCheck the inputs and review the output.', disabled: false },
  { label: 'Empty content', title: 'New comment', content: '', disabled: false },
  { label: 'Read only', title: 'Team guidelines', content: 'Keep each step focused on one task.', disabled: true },
] as const

function CommentCase({ sample, dark, log }: { sample: (typeof cases)[number]; dark: boolean; log: LogAction }) {
  const [value, setValue] = useState<{ title: string; content: string }>({ title: sample.title, content: sample.content })
  return (
    <section className="comment-properties-case" aria-label={sample.label}>
      <h2>{sample.label}</h2>
      <CommentInspector
        {...value}
        dark={dark}
        disabled={sample.disabled}
        onSave={(next) => {
          setValue(next)
          log('comment.saved', { sample: sample.label, ...next })
        }}
        onDuplicate={() => log('comment.duplicate', sample.label)}
        onDelete={() => log('comment.delete', sample.label)}
      />
    </section>
  )
}

function CommentProperties({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  return (
    <I18nProvider i18n={i18n}>
      <div className="comment-properties-stories open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'}>
        {cases.map((sample) => (
          <CommentCase key={sample.label} sample={sample} dark={dark} log={log} />
        ))}
      </div>
    </I18nProvider>
  )
}

export const commentPropertiesStory: FrontendStory = {
  group: 'Node Comment',
  id: 'comment-properties',
  title: 'Properties',
  standalone: true,
  render: (log, dark, language) => <CommentProperties dark={dark} language={language} log={log} />,
}
