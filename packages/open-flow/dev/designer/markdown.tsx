import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DesignerStory } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import MarkdownContent from '../../src/ui/browser/markdown/markdownContent.tsx'
import { Textarea } from '../../src/ui/browser/textarea.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

const sample = [
  '### Markdown preview',
  '',
  '**Strong**, *emphasis*, and `inline code`.',
  '',
  '- [x] Completed',
  '- [ ] Pending',
  '',
  '| Field | Value |',
  '| --- | --- |',
  '| count | 42 |',
  '',
  '```javascript',
  'const count = 42;',
  '```',
  '',
  '$x^2 + y^2 = z^2$',
  '',
  '```mermaid',
  'graph LR',
  '  Input --> Output',
  '```',
].join('\n')

function MarkdownStory({ dark, language }: { dark: boolean; language: UiLanguage }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [text, setText] = useState(sample)
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <Textarea aria-label="Markdown source" value={text} onChange={(event) => setText(event.target.value)} />
        <MarkdownContent dark={dark} text={text} mermaid />
      </div>
    </I18nProvider>
  )
}

export const markdownStory: DesignerStory = {
  group: 'Controls',
  id: 'markdown',
  title: 'Markdown',
  standalone: true,
  render: (_log, dark, language) => <MarkdownStory dark={dark} language={language} />,
}
