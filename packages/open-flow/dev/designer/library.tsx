import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { AddNodeOption } from '../../src/workbench/browser/runtime/editor/addNodeOptions.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useCallback, useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { BlockLibrary, ContextPanel } from '../../src/workbench/browser/runtime/editor/contextPanel.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

const options: readonly AddNodeOption[] = [
  { id: 'value', kind: 'value', label: 'Value', description: 'Provide reusable values.', group: 'Blocks', inputs: [], outputs: [] },
  { id: 'condition', kind: 'condition', label: 'Condition', description: 'Route values through named outputs.', group: 'Blocks', inputs: [], outputs: [] },
  {
    id: 'task',
    kind: 'new-task',
    label: 'JavaScript',
    description: 'A long description to inspect clipping in a narrow sidebar and preserve the full text in the tooltip.',
    group: 'Blocks',
    inputs: [],
    outputs: [],
  },
]

type State = 'ready' | 'empty' | 'loading' | 'error' | 'disabled'

function LibraryStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [state, setState] = useState<State>('ready')
  const i18n = useMemo(() => createI18n(language), [language])
  const browseOptions = useCallback(
    async (signal: AbortSignal): Promise<readonly AddNodeOption[]> => {
      if (state == 'error') throw new Error('Story catalog failure')
      if (state == 'loading')
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
      return []
    },
    [state],
  )
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-workbench open-flow-theme"
        data-theme={dark ? 'dark' : 'light'}
        style={{ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 24, padding: 24 }}
      >
        <div>
          <label htmlFor="library-state">Library state</label>{' '}
          <select id="library-state" value={state} onChange={(event) => setState(event.target.value as State)}>
            {(['ready', 'empty', 'loading', 'error', 'disabled'] as const).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <p>Search to inspect matching rows and empty results. Select a row to log its action.</p>
        </div>
        <div style={{ minWidth: 0, height: '100%', display: 'grid' }}>
          <ContextPanel focusOnOpen={false} icon="task" onClose={() => log('Close library')} theme={dark ? 'dark' : 'light'} title="Blocks">
            <BlockLibrary
              key={state}
              searchOptions={async () => []}
              browseOptions={browseOptions}
              disabled={state == 'disabled'}
              draggable
              focusRequest={0}
              onAdd={async (option) => {
                log('Add node', option.id)
                return undefined
              }}
              onRegisterDragOption={(option) => log('Drag node', option.id)}
              options={state == 'empty' ? [] : options}
              provideChoices={async () => []}
            />
          </ContextPanel>
        </div>
      </div>
    </I18nProvider>
  )
}

export const libraryStory: FrontendStory = {
  group: 'Workbench',
  id: 'node-library',
  title: 'Node Library',
  standalone: true,
  render: (log, dark, language) => <LibraryStory dark={dark} language={language} log={log} />,
}
