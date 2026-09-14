import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { CommentInspector } from '../../src/workbench/browser/runtime/editor/commentInspector.tsx'
import { EditorContextPanel } from '../../src/workbench/browser/runtime/editor/editorContextPanel.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

const cases = [
  { label: 'Editable', title: 'Review notes', content: '### Before running\nCheck the inputs and review the output.', disabled: false },
  { label: 'Empty content', title: 'New comment', content: '', disabled: false },
  {
    label: 'Long content',
    title: 'Review checklist',
    content: Array.from({ length: 24 }, (_, index) => `### Step ${index + 1}\nCheck the inputs and review the output.`).join('\n\n'),
    disabled: false,
  },
  { label: 'Read only', title: 'Team guidelines', content: 'Keep each step focused on one task.', disabled: true },
] as const

function CommentCase({ sample, dark, log }: { sample: (typeof cases)[number]; dark: boolean; log: LogAction }) {
  const [value, setValue] = useState<{ title: string; content: string }>({ title: sample.title, content: sample.content })
  return (
    <section className="comment-properties-case" aria-label={sample.label}>
      <h2>{sample.label}</h2>
      <EditorContextPanel
        title={value.title}
        icon="panel"
        theme={dark ? 'dark' : 'light'}
        focusOnOpen={false}
        onClose={() => log('comment.close', sample.label)}
        nodeHeading={{
          title: value.title,
          disabled: sample.disabled,
          fallback: <i aria-hidden="true" className="i-lucide-light:sticky-note" />,
          validate: () => undefined,
          onRename: (title) => {
            setValue((previous) => ({ ...previous, title }))
            log('comment.renamed', { sample: sample.label, title })
          },
        }}
      >
        <CommentInspector
          {...value}
          dark={dark}
          disabled={sample.disabled}
          onSave={(next) => {
            setValue(next)
            log('comment.saved', { sample: sample.label, ...next })
          }}
        />
      </EditorContextPanel>
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
