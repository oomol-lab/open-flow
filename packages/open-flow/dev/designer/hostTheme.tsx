import './hostTheme.css'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { Button } from '../../src/ui/browser/button.tsx'
import { Input } from '../../src/ui/browser/input.tsx'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { OpenFlowPreview } from '../../src/workbench/browser/runtime/openFlowPreview.tsx'
import { FlowBrowser } from '../../src/workbench/browser/runtime/shell/resourceBrowser.tsx'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { publicationFixture } from './publicationFixture.ts'
import { useStoryActions } from './storyActions.tsx'

const fixture = publicationFixture('host-theme', 'host-theme-revision')
const preferences = { getItem: () => null, setItem: () => {} }

function ThemeFlowList({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const [session, setSession] = useState<{ i18n: ReturnType<typeof createI18n>; store: WorkbenchStore }>()
  useEffect(() => {
    const client = new WorkbenchClient(async (input) => {
      const path = new URL(String(input), 'https://lab.local').pathname
      if (path === '/v1/flows') {
        return Response.json({
          version: 1,
          total: 2,
          flows: ['Customer onboarding', 'Weekly digest'].map((name, index) => ({
            flowId: `host-theme-${index}`,
            name,
            createdAt: fixture.draft.createdAt,
            updatedAt: fixture.draft.createdAt,
            draftRevisionId: fixture.draft.revisionId,
            resourceReferences: {
              draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
              sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
            },
            referenceCount: 0,
            status: 'active',
            version: 1,
          })),
        })
      }
      return Response.json({ message: 'Unsupported theme sample request' }, { status: 400 })
    })
    const i18n = createI18n(language)
    const store = new WorkbenchStore(client, preferences, undefined, i18n)
    setSession({ i18n, store })
    void store.start()
    return () => {
      store.dispose()
      i18n.dispose()
    }
  }, [language])
  if (session == null) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-theme open-flow-workbench h-full" data-theme={dark ? 'dark' : 'light'}>
        <FlowBrowser
          store={session.store}
          language={language}
          hrefForFlow={() => '#'}
          onSelectFlow={(flow) => log('navigate', flow.flowId)}
          onCreateFlow={async (name) => {
            log('create', name)
            return false
          }}
          onImportFlow={async () => false}
          catalogWidth="embedded"
        />
      </div>
    </I18nProvider>
  )
}

function ThemeSample({
  brand,
  canvas,
  dark,
  language,
  log,
}: {
  readonly brand: boolean
  readonly canvas: boolean
  readonly dark: boolean
  readonly language: UiLanguage
  readonly log: LogAction
}) {
  const theme = dark ? 'dark' : 'light'
  return (
    <section className={brand ? 'host-theme-sample host-theme-brand' : 'host-theme-sample'} data-theme={theme}>
      <h2>{brand ? 'Host palette' : 'Open Flow defaults'}</h2>
      <div className="host-theme-runtime" data-view={canvas ? 'canvas' : 'list'}>
        {canvas ? <OpenFlowPreview {...fixture} theme={theme} language={language} /> : <ThemeFlowList dark={dark} language={language} log={log} />}
      </div>
    </section>
  )
}

function HostThemeStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const [canvas, setCanvas] = useState(false)
  useStoryActions([{ label: canvas ? 'Show Flow lists' : 'Show canvases', onClick: () => setCanvas(!canvas) }])
  return (
    <div className="host-theme-gallery">
      {[false, true].map((brand) => (
        <ThemeSample key={String(brand)} brand={brand} canvas={canvas} dark={dark} language={language} log={log} />
      ))}
      <section className="host-theme-partial">
        <div
          className="open-flow-theme flex flex-col gap-3 rounded-lg border border-border bg-background p-4 text-foreground"
          data-theme={dark ? 'dark' : 'light'}
        >
          <h2>Partial override · primary and focus</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary action</Button>
            <Button variant="outline">Outline action</Button>
            <Input aria-label="Partial theme input" defaultValue="Focus this field" className="w-60" />
          </div>
          <div
            className="open-flow-theme flex flex-col gap-3 rounded-lg border border-border bg-background p-4 text-foreground"
            data-theme={dark ? 'light' : 'dark'}
          >
            <h3>Nested {dark ? 'light' : 'dark'} defaults</h3>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Inherited primary</Button>
              <Button variant="outline">Nested outline</Button>
              <Input aria-label="Nested theme input" defaultValue="Independent default surface" className="w-60" />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export const hostThemeStory: FrontendStory = {
  group: 'Theme Preview',
  id: 'host-theme',
  title: 'Host theme',
  description:
    'Compare independent default and host palettes in Flow lists and canvases. Open New Flow, row menus and node properties; inspect focus and selection in both themes. The partial override inherits into the opposite nested theme while unconfigured surfaces use their own defaults.',
  standalone: true,
  render: (log, dark, language) => <HostThemeStory dark={dark} language={language} log={log} />,
}
